const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { distanceKm } = require('../miniprogram/lib/domain');
const digest = (value) => createHash('sha256').update(value).digest('hex');
class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function createStore(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, openid TEXT NOT NULL,
      nickname TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL, privacy_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
      address TEXT NOT NULL, description TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
      type TEXT NOT NULL, age_band TEXT NOT NULL, cost TEXT NOT NULL, amenities TEXT NOT NULL, opening_hours TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS slides_location ON slides(hidden, latitude, longitude);
    CREATE INDEX IF NOT EXISTS slides_creator ON slides(creator_id);
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slide_id INTEGER NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(slide_id,user_id));
    CREATE TABLE IF NOT EXISTS favorites (slide_id INTEGER NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(slide_id,user_id));
    CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, slide_id INTEGER NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
      UNIQUE(slide_id,user_id));`);
  db.function('distance_km', { deterministic: true }, distanceKm);
  // Additive migration keeps existing shares and permits rolling back the application.
  const columns = db
    .prepare('PRAGMA table_info(slides)')
    .all()
    .map((c) => c.name);
  if (!columns.includes('travel')) db.exec("ALTER TABLE slides ADD COLUMN travel TEXT NOT NULL DEFAULT '{}'");
  if (!columns.includes('photos')) db.exec("ALTER TABLE slides ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'");
  db.exec(
    `CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), image BLOB NOT NULL, created_at INTEGER NOT NULL)`,
  );
  const publicUser = (row) => row && { id: row.id, nickname: row.nickname, createdAt: row.created_at };
  const slideColumns = `s.id,s.creator_id AS creatorId,s.title,s.address,s.description,s.latitude,s.longitude,s.type,
    s.age_band AS ageBand,s.cost,s.amenities,s.opening_hours AS openingHours,s.created_at AS createdAt,s.updated_at AS updatedAt,
    s.travel,s.photos,u.nickname AS creatorName,COALESCE((SELECT AVG(rating) FROM reviews WHERE slide_id=s.id),0) AS rating,
    (SELECT COUNT(*) FROM reviews WHERE slide_id=s.id) AS reviewCount`;
  const hydrate = (row) => {
    if (!row) return row;
    const { travel, ...fields } = row;
    return {
      parking: '',
      parkingAddress: '',
      parkingLocation: null,
      traffic: '',
      ...fields,
      ...JSON.parse(travel),
      photos: JSON.parse(row.photos),
      amenities: JSON.parse(row.amenities),
    };
  };
  function validatePhotos(uid, ids = []) {
    for (const id of ids) {
      if (!db.prepare('SELECT 1 FROM photos WHERE id=? AND owner_id=?').get(id, uid))
        throw new HttpError(400, '照片已失效或不属于当前账号，请移除后重新添加');
    }
  }
  const travelData = (input) =>
    JSON.stringify({
      parking: input.parking || '',
      parkingAddress: input.parkingAddress || '',
      parkingLocation: input.parkingLocation || null,
      traffic: input.traffic || '',
    });
  const requireSlide = (id) => {
    const row = db.prepare('SELECT * FROM slides WHERE id=? AND hidden=0').get(id);
    if (!row) throw new HttpError(404, '这个滑梯已下架或不存在');
    return row;
  };
  const requireOwner = (id, uid) => {
    const row = requireSlide(id);
    if (row.creator_id !== uid) throw new HttpError(403, '只能管理自己分享的滑梯');
    return row;
  };
  return {
    db,
    savePhoto(uid, image) {
      db.prepare(
        'DELETE FROM photos WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM slides s,json_each(s.photos) p WHERE p.value=photos.id)',
      ).run(Date.now() - 7 * 86400000);
      if (
        db
          .prepare('SELECT COUNT(*) n FROM photos WHERE owner_id=? AND created_at>?')
          .get(uid, Date.now() - 3600000).n >= 30
      )
        throw new HttpError(429, '照片上传过于频繁，请稍后再试');
      const id = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO photos VALUES (?,?,?,?)').run(id, uid, image, Date.now());
      return { id };
    },
    photo(id) {
      const row = db
        .prepare(
          'SELECT image FROM photos WHERE id=? AND EXISTS(SELECT 1 FROM slides s,json_each(s.photos) p WHERE p.value=photos.id AND s.hidden=0)',
        )
        .get(id);
      if (!row) throw new HttpError(404, '照片不存在');
      return row.image;
    },
    login(openid, appid) {
      const identity = digest(`${appid}:${openid}`),
        now = Date.now();
      db.prepare(
        `INSERT INTO users VALUES (?,?,?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET last_login_at=excluded.last_login_at,privacy_version=excluded.privacy_version`,
      ).run(randomUUID(), identity, openid, '滑梯探索者', now, now, '2026-09-30');
      const user = db.prepare('SELECT * FROM users WHERE identity=?').get(identity);
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      db.prepare(
        'DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 4)',
      ).run(user.id, user.id);
      const token = randomBytes(32).toString('base64url'),
        expiresAt = now + 7 * 86400000;
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user.id, expiresAt);
      return { token, expiresAt, user: publicUser(user) };
    },
    authenticate(token) {
      return db
        .prepare(
          'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
        )
        .get(digest(token), Date.now());
    },
    logout(token) {
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
    },
    me(uid) {
      return {
        ...publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(uid)),
        shares: db.prepare('SELECT COUNT(*) AS n FROM slides WHERE creator_id=? AND hidden=0').get(uid).n,
        reviews: db
          .prepare(
            'SELECT COUNT(*) AS n FROM reviews r JOIN slides s ON s.id=r.slide_id WHERE r.user_id=? AND s.hidden=0',
          )
          .get(uid).n,
        favorites: db
          .prepare(
            'SELECT COUNT(*) AS n FROM favorites f JOIN slides s ON s.id=f.slide_id WHERE f.user_id=? AND s.hidden=0',
          )
          .get(uid).n,
      };
    },
    updateProfile(uid, nickname) {
      db.prepare('UPDATE users SET nickname=? WHERE id=?').run(nickname, uid);
      return this.me(uid);
    },
    list({
      latitude,
      longitude,
      radius = 10,
      type,
      cost,
      q = '',
      sort = 'newest',
      offset = 0,
      limit = 20,
      scope,
      uid,
    }) {
      const clauses = ['s.hidden=0'],
        params = [];
      const nearby = latitude != null && longitude != null;
      if (nearby) {
        clauses.push('s.latitude BETWEEN ? AND ?', 'distance_km(?,?,s.latitude,s.longitude)<=?');
        params.push(latitude - radius / 110.574, latitude + radius / 110.574, latitude, longitude, radius);
      }
      if (type) {
        clauses.push('s.type=?');
        params.push(type);
      }
      if (cost) {
        clauses.push('s.cost=?');
        params.push(cost);
      }
      if (q) {
        clauses.push('(instr(s.title,?)>0 OR instr(s.address,?)>0)');
        params.push(q, q);
      }
      if (scope === 'shares') {
        clauses.push('s.creator_id=?');
        params.push(uid);
      }
      if (scope === 'favorites') {
        clauses.push('EXISTS(SELECT 1 FROM favorites f WHERE f.slide_id=s.id AND f.user_id=?)');
        params.push(uid);
      }
      if (scope === 'reviews') {
        clauses.push('EXISTS(SELECT 1 FROM reviews r WHERE r.slide_id=s.id AND r.user_id=?)');
        params.push(uid);
      }
      const where = clauses.join(' AND '),
        distance = nearby ? 'distance_km(?,?,s.latitude,s.longitude)' : 'NULL';
      const order =
        sort === 'rating'
          ? 'rating DESC, reviewCount DESC,s.id DESC'
          : sort === 'distance' && nearby
            ? 'distance ASC,s.id DESC'
            : 's.id DESC';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM slides s WHERE ${where}`).get(...params).n;
      const items = db
        .prepare(
          `SELECT ${slideColumns},${distance} AS distance FROM slides s JOIN users u ON u.id=s.creator_id WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        )
        .all(...(nearby ? [latitude, longitude] : []), ...params, limit, offset)
        .map(hydrate);
      return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
    },
    detail(id, uid) {
      requireSlide(id);
      const slide = hydrate(
        db
          .prepare(`SELECT ${slideColumns} FROM slides s JOIN users u ON u.id=s.creator_id WHERE s.id=?`)
          .get(id),
      );
      slide.isOwner = slide.creatorId === uid;
      slide.isFavorite = !!(
        uid && db.prepare('SELECT 1 FROM favorites WHERE slide_id=? AND user_id=?').get(id, uid)
      );
      slide.myReview = uid
        ? db.prepare('SELECT rating,content FROM reviews WHERE slide_id=? AND user_id=?').get(id, uid) || null
        : null;
      return slide;
    },
    createSlide(uid, input) {
      validatePhotos(uid, input.photos);
      const {
        title,
        address,
        description,
        latitude,
        longitude,
        type,
        ageBand,
        cost,
        amenities,
        openingHours,
      } = input;
      const now = Date.now();
      const result = db
        .prepare(
          `INSERT INTO slides (creator_id,title,address,description,latitude,longitude,type,age_band,cost,amenities,opening_hours,created_at,updated_at,travel,photos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          uid,
          title,
          address,
          description,
          latitude,
          longitude,
          type,
          ageBand,
          cost,
          JSON.stringify(amenities),
          openingHours,
          now,
          now,
          travelData(input),
          JSON.stringify(input.photos || []),
        );
      return this.detail(Number(result.lastInsertRowid), uid);
    },
    updateSlide(id, uid, input) {
      requireOwner(id, uid);
      validatePhotos(uid, input.photos);
      const {
        title,
        address,
        description,
        latitude,
        longitude,
        type,
        ageBand,
        cost,
        amenities,
        openingHours,
      } = input;
      db.prepare(
        'UPDATE slides SET title=?,address=?,description=?,latitude=?,longitude=?,type=?,age_band=?,cost=?,amenities=?,opening_hours=?,updated_at=?,travel=?,photos=? WHERE id=?',
      ).run(
        title,
        address,
        description,
        latitude,
        longitude,
        type,
        ageBand,
        cost,
        JSON.stringify(amenities),
        openingHours,
        Date.now(),
        travelData(input),
        JSON.stringify(input.photos || []),
        id,
      );
      return this.detail(id, uid);
    },
    deleteSlide(id, uid) {
      requireOwner(id, uid);
      db.prepare('DELETE FROM slides WHERE id=?').run(id);
    },
    reviews(id, offset = 0, limit = 20) {
      requireSlide(id);
      const total = db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE slide_id=?').get(id).n;
      const items = db
        .prepare(
          `SELECT r.id,r.user_id AS userId,r.rating,r.content,r.created_at AS createdAt,r.updated_at AS updatedAt,u.nickname FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.slide_id=? ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?`,
        )
        .all(id, limit, offset);
      return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
    },
    review(id, uid, { rating, content }) {
      const slide = requireSlide(id);
      if (slide.creator_id === uid) throw new HttpError(403, '不能给自己分享的滑梯评分');
      const now = Date.now();
      db.prepare(
        `INSERT INTO reviews (slide_id,user_id,rating,content,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(slide_id,user_id) DO UPDATE SET rating=excluded.rating,content=excluded.content,updated_at=excluded.updated_at`,
      ).run(id, uid, rating, content, now, now);
      return this.detail(id, uid);
    },
    deleteReview(id, uid) {
      requireSlide(id);
      db.prepare('DELETE FROM reviews WHERE slide_id=? AND user_id=?').run(id, uid);
    },
    favorite(id, uid, enabled) {
      requireSlide(id);
      if (enabled) db.prepare('INSERT OR IGNORE INTO favorites VALUES (?,?)').run(id, uid);
      else db.prepare('DELETE FROM favorites WHERE slide_id=? AND user_id=?').run(id, uid);
    },
    report(id, uid, reason) {
      requireSlide(id);
      db.prepare(
        'INSERT INTO reports (slide_id,user_id,reason,created_at) VALUES (?,?,?,?) ON CONFLICT(slide_id,user_id) DO UPDATE SET reason=excluded.reason,resolved=0,created_at=excluded.created_at',
      ).run(id, uid, reason, Date.now());
    },
    close() {
      db.close();
    },
  };
}
module.exports = { createStore, HttpError };
