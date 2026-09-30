const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createStore, HttpError } = require('../server/store.cjs');
const { createApi } = require('../server/service.cjs');
const { createWechat } = require('../server/wechat.cjs');
const { slideInput, reviewInput, distanceKm } = require('../miniprogram/lib/domain');
const sample = {
  title: '树下的滑滑梯',
  address: '上海市某公园东侧',
  description: '这里有一座适合小朋友的滑梯。',
  latitude: 31.23,
  longitude: 121.47,
  type: '公园滑梯',
  ageBand: '3–6岁',
  cost: '免费',
  amenities: ['有遮阴'],
  openingHours: '全天',
};
async function fixture(t, { demo = false, moderate = async () => {}, moderateImage = async () => {} } = {}) {
  const store = createStore();
  const server = createApi({
    store,
    appid: 'test-app',
    demo,
    wechat: { login: async (code) => 'openid-' + code, moderate, moderateImage },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  async function call(route, method = 'GET', body, token) {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  async function login(code = 'author') {
    const r = await call('/auth/wechat', 'POST', { code, acceptedPrivacy: true });
    assert.equal(r.status, 200);
    return r.data;
  }
  return { store, call, login, base };
}
test('validation rejects malformed coordinates, unsafe ratings, and unsupported fields', () => {
  for (const latitude of [null, '31', NaN, 91, Infinity])
    assert.throws(() => slideInput({ ...sample, latitude }));
  for (const rating of [0, 6, 2.5, '5', null])
    assert.throws(() => reviewInput({ rating, content: '很不错的滑梯' }));
  assert.throws(() => slideInput({ ...sample, amenities: ['管理员'] }));
  assert.throws(() => slideInput({ ...sample, type: '假的类型' }));
  assert.throws(() => reviewInput({ rating: 5, content: '短' }));
  assert.deepEqual(slideInput({ ...sample, creatorId: 'forged' }), {
    ...sample,
    photos: [],
    parking: '',
    parkingAddress: '',
    parkingLocation: null,
    traffic: '',
  });
  assert.ok(distanceKm(0, 179.99, 0, -179.99) < 3);
});
test('guest browsing works; writes, private scopes, and missing privacy consent require auth', async (t) => {
  const { call } = await fixture(t);
  assert.equal((await call('/slides')).status, 200);
  for (const route of ['/me', '/slides?scope=shares', '/slides?scope=favorites'])
    assert.equal((await call(route)).status, 401);
  assert.equal((await call('/slides', 'POST', sample)).status, 401);
  assert.equal((await call('/auth/wechat', 'POST', { code: 'author' })).status, 400);
  assert.equal((await call('/auth/demo', 'POST', { persona: 'explorer' })).status, 401);
});
test('same WeChat identity persists and secrets never leave the server', async (t) => {
  const { login, call, store } = await fixture(t);
  const first = await login(),
    second = await login();
  assert.equal(first.user.id, second.user.id);
  assert.notEqual(first.token, second.token);
  assert.ok(!JSON.stringify(first).includes('openid'));
  assert.ok(
    !store.db
      .prepare('SELECT token_hash FROM sessions')
      .all()
      .some((r) => r.token_hash === first.token),
  );
  await call('/me', 'PATCH', { nickname: '新昵称' }, first.token);
  assert.equal((await call('/me', 'GET', undefined, second.token)).data.nickname, '新昵称');
  await call('/auth/logout', 'POST', {}, first.token);
  assert.equal((await call('/me', 'GET', undefined, first.token)).status, 401);
  assert.equal((await call('/me', 'GET', undefined, second.token)).status, 200);
  store.db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal((await call('/me', 'GET', undefined, second.token)).status, 401);
});
test('sharing, editing, owner isolation, duplicate review updates, and aggregate ratings', async (t) => {
  const { login, call } = await fixture(t),
    author = await login(),
    reader = await login('reader'),
    third = await login('third');
  const created = await call('/slides', 'POST', { ...sample, creatorId: reader.user.id }, author.token);
  assert.equal(created.status, 201);
  assert.equal(created.data.creatorId, author.user.id);
  const id = created.data.id,
    route = '/slides/' + id;
  assert.equal((await call(route, 'PUT', { ...sample, title: '篡改别人的地点' }, reader.token)).status, 403);
  assert.equal((await call(route, 'DELETE', undefined, reader.token)).status, 403);
  assert.equal(
    (await call(route + '/reviews', 'PUT', { rating: 5, content: '自己给自己好评' }, author.token)).status,
    403,
  );
  await call(route + '/reviews', 'PUT', { rating: 5, content: '一次很愉快的体验' }, reader.token);
  await call(route + '/reviews', 'PUT', { rating: 2, content: '补充体验需要维护' }, reader.token);
  let detail = (await call(route)).data;
  assert.equal(detail.reviewCount, 1);
  assert.equal(detail.rating, 2);
  await call(route + '/reviews', 'PUT', { rating: 5, content: '周末游玩很愉快呀' }, third.token);
  detail = (await call(route)).data;
  assert.equal(detail.reviewCount, 2);
  assert.equal(detail.rating, 3.5);
  const changed = await call(route, 'PUT', { ...sample, title: '树下的新滑梯' }, author.token);
  assert.equal(changed.data.title, '树下的新滑梯');
  assert.equal((await call(route, 'GET', undefined, reader.token)).data.myReview.rating, 2);
  await call(route + '/reviews', 'DELETE', undefined, reader.token);
  detail = (await call(route)).data;
  assert.equal(detail.reviewCount, 1);
  assert.equal(detail.rating, 5);
});
test('concurrent review retries count once and favorites are idempotent', async (t) => {
  const { login, call } = await fixture(t),
    author = await login(),
    reader = await login('reader');
  const id = (await call('/slides', 'POST', sample, author.token)).data.id;
  const route = '/slides/' + id;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(route + '/reviews', 'PUT', { rating: 4, content: '同一个用户重复提交' }, reader.token),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await call(route)).data.reviewCount, 1);
  await call(route + '/favorite', 'PUT', {}, reader.token);
  await call(route + '/favorite', 'PUT', {}, reader.token);
  assert.equal((await call('/me', 'GET', undefined, reader.token)).data.favorites, 1);
  assert.equal((await call('/slides?scope=favorites', 'GET', undefined, author.token)).data.total, 0);
  assert.equal((await call('/slides?scope=favorites', 'GET', undefined, reader.token)).data.total, 1);
  await call(route + '/favorite', 'DELETE', undefined, reader.token);
  assert.equal((await call('/me', 'GET', undefined, reader.token)).data.favorites, 0);
});
test('nearby lookup, international date line, literal search, filters and pagination', async (t) => {
  const { login, call } = await fixture(t),
    author = await login();
  for (const data of [
    sample,
    { ...sample, title: '收费的室内滑梯', cost: '收费', type: '室内乐园' },
    { ...sample, title: '很远的滑滑梯', latitude: 40, longitude: 116 },
    { ...sample, title: '日期线附近滑梯', latitude: 0, longitude: -179.99 },
  ])
    assert.equal((await call('/slides', 'POST', data, author.token)).status, 201);
  let result = await call('/slides?latitude=31.23&longitude=121.47&radius=2&sort=distance');
  assert.equal(result.data.total, 2);
  assert.equal(result.data.items[0].distance, 0);
  assert.equal((await call('/slides?latitude=0&longitude=179.99&radius=5')).data.total, 1);
  assert.equal((await call('/slides?cost=' + encodeURIComponent('收费'))).data.total, 1);
  assert.equal((await call('/slides?q=' + encodeURIComponent('远的'))).data.total, 1);
  assert.equal((await call('/slides?q=' + encodeURIComponent("%' OR 1=1 --"))).data.total, 0);
  result = await call('/slides?limit=2');
  assert.equal(result.data.nextOffset, 2);
  const second = await call('/slides?limit=2&offset=2');
  assert.equal(second.data.nextOffset, null);
  assert.ok(second.data.items.every((a) => !result.data.items.some((b) => a.id === b.id)));
  for (const query of [
    'latitude=31',
    'latitude=x&longitude=10',
    'offset=1.2',
    'limit=10000',
    'scope=admin',
    'sort=injected',
    'radius=0',
  ])
    assert.equal((await call('/slides?' + query)).status, 400, query);
});
test('content-check failure leaves no user content written', async (t) => {
  const { login, call, store } = await fixture(t, {
      moderate: async () => {
        throw new HttpError(503, '检查服务不可用');
      },
    }),
    author = await login();
  assert.equal((await call('/slides', 'POST', sample, author.token)).status, 503);
  assert.equal((await call('/slides')).data.total, 0);
  assert.equal((await call('/me', 'PATCH', { nickname: '不应保存的昵称' }, author.token)).status, 503);
  assert.equal(store.me(author.user.id).nickname, '滑梯探索者');
});
test('reporting, moderation visibility, and cascading owner deletion', async (t) => {
  const { login, call, store } = await fixture(t),
    author = await login(),
    reader = await login('reader');
  const id = (await call('/slides', 'POST', sample, author.token)).data.id,
    route = '/slides/' + id;
  await call(route + '/reviews', 'PUT', { rating: 3, content: '记录一下到访体验' }, reader.token);
  await call(route + '/favorite', 'PUT', {}, reader.token);
  await call(route + '/report', 'POST', { reason: '设施已拆除，请核实' }, reader.token);
  await call(route + '/report', 'POST', { reason: '再次确认设施已拆除' }, reader.token);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM reports').get().n, 1);
  store.db.prepare('UPDATE slides SET hidden=1 WHERE id=?').run(id);
  assert.equal((await call(route)).status, 404);
  assert.equal((await call(route + '/reviews')).status, 404);
  assert.equal((await call('/slides')).data.total, 0);
  assert.equal((await call('/me', 'GET', undefined, reader.token)).data.favorites, 0);
  store.db.prepare('UPDATE slides SET hidden=0 WHERE id=?').run(id);
  await call(route, 'DELETE', undefined, author.token);
  for (const table of ['slides', 'reviews', 'favorites', 'reports'])
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0);
});
test('SQLite survives restart without leaking across AppIDs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'slide-map-test-')),
    filename = path.join(dir, 'test.sqlite');
  try {
    let store = createStore(filename);
    const a = store.login('openid', 'app-one'),
      b = store.login('openid', 'app-two');
    assert.notEqual(a.user.id, b.user.id);
    store.createSlide(a.user.id, sample);
    store.close();
    store = createStore(filename);
    assert.equal(store.list({}).total, 1);
    assert.equal(store.authenticate(a.token).id, a.user.id);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('WeChat exchange and moderation redact upstream errors and fail closed', async () => {
  let count = 0;
  const wechat = createWechat({
    appid: 'test',
    secret: 'do-not-leak',
    fetchImpl: async (url, options) => {
      const u = new URL(url);
      if (u.pathname === '/sns/jscode2session')
        return { ok: true, json: async () => ({ openid: 'wx-user', session_key: 'secret-session' }) };
      if (u.pathname === '/cgi-bin/token')
        return { ok: true, json: async () => ({ access_token: 'token', expires_in: 7200 }) };
      assert.equal(JSON.parse(options.body).openid, 'wx-user');
      count++;
      return {
        ok: true,
        json: async () => ({ errcode: 0, result: { suggest: count === 1 ? 'pass' : 'review' } }),
      };
    },
  });
  assert.equal(await wechat.login('code'), 'wx-user');
  await wechat.moderate('wx-user', '正常文本');
  await assert.rejects(
    () => wechat.moderate('wx-user', '待审核文本'),
    (e) => e.status === 422,
  );
  const failed = createWechat({
    appid: 'test',
    secret: 'do-not-leak',
    fetchImpl: async () => {
      throw new Error('do-not-leak');
    },
  });
  await assert.rejects(
    () => failed.login('code'),
    (e) => e.status === 503 && !e.message.includes('do-not-leak'),
  );
  const unknown = createWechat({
    appid: 'test',
    secret: 'do-not-leak',
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(
    () => unknown.moderate('wx-user', '文本'),
    (e) => e.status === 503,
  );
});

test('photos are decoded, stripped of metadata, owner-bound and private until published', async (t) => {
  const sharp = require('sharp');
  const { call, login, base, store } = await fixture(t);
  const author = await login(),
    reader = await login('reader');
  const image = await sharp({ create: { width: 900, height: 500, channels: 3, background: '#205b46' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'must be stripped' } })
    .toBuffer();
  const upload = async (body, token = author.token, type = 'application/octet-stream') =>
    fetch(base + '/photos', {
      method: 'POST',
      headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body,
    });
  assert.equal((await upload(image, null)).status, 401);
  assert.equal((await upload(image, author.token, 'text/html')).status, 415);
  assert.equal((await upload(Buffer.from('<svg onload="alert(1)"></svg>'))).status, 400);
  assert.equal((await upload(Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
  const response = await upload(image);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await fetch(base + '/photos/' + id)).status, 404);
  assert.equal((await call('/slides', 'POST', { ...sample, photos: [id] }, reader.token)).status, 400);
  const travel = {
    photos: [id],
    amenities: ['座椅少', '可骑车'],
    parking: '停车收费',
    parkingAddress: '公园南门停车场',
    parkingLocation: { latitude: 31.23, longitude: 121.47 },
    traffic: '地铁站步行十分钟\n从南门进入',
  };
  const created = await call('/slides', 'POST', { ...sample, ...travel }, author.token);
  assert.equal(created.status, 201);
  for (const [key, value] of Object.entries(travel)) assert.deepEqual(created.data[key], value);
  const published = await fetch(base + '/photos/' + id);
  assert.equal(published.status, 200);
  assert.equal(published.headers.get('content-type'), 'image/jpeg');
  const metadata = await sharp(Buffer.from(await published.arrayBuffer())).metadata();
  assert.equal(metadata.width, 750);
  assert.equal(metadata.exif, undefined);
  store.db.prepare('UPDATE slides SET hidden=1 WHERE id=?').run(created.data.id);
  assert.equal((await fetch(base + '/photos/' + id)).status, 404);
  store.db.prepare('UPDATE slides SET hidden=0 WHERE id=?').run(created.data.id);
  await call('/slides/' + created.data.id, 'PUT', { ...sample, photos: [] }, author.token);
  assert.equal((await fetch(base + '/photos/' + id)).status, 404);
});

test('rejected photos never enter storage, and travel/photo validation is enforced', async (t) => {
  const sharp = require('sharp');
  const { login, base, store } = await fixture(t, {
    moderateImage: async () => {
      throw new HttpError(422, '照片不通过');
    },
  });
  const author = await login();
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const response = await fetch(base + '/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + author.token },
    body: image,
  });
  assert.equal(response.status, 422);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM photos').get().n, 0);
  for (const invalid of [
    { parking: '随便停车' },
    { amenities: ['座椅多', '座椅少'] },
    { traffic: '字'.repeat(501) },
    { photos: ['../../secret'] },
    { photos: Array(7).fill('a'.repeat(32)) },
    { parkingLocation: { latitude: 100, longitude: 0 } },
  ])
    assert.throws(() => slideInput({ ...sample, ...invalid }));
});

test('old database upgrade preserves users, shares and sessions across repeated starts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'slide-map-upgrade-'));
  const filename = path.join(dir, 'test.sqlite');
  let store;
  try {
    store = createStore(filename);
    const user = store.login('upgrade', 'app');
    const slide = store.createSlide(user.user.id, sample);
    // Recreate the released schema by removing only the newly added columns.
    store.db.exec(
      'ALTER TABLE slides DROP COLUMN travel; ALTER TABLE slides DROP COLUMN photos; DROP TABLE photos',
    );
    store.close();
    for (let i = 0; i < 2; i++) {
      store = createStore(filename);
      assert.equal(store.authenticate(user.token).id, user.user.id);
      const migrated = store.detail(slide.id);
      assert.equal(migrated.title, sample.title);
      assert.deepEqual(migrated.photos, []);
      assert.equal(migrated.traffic, '');
      store.close();
      store = null;
    }
  } finally {
    if (store) store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
