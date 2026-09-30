const http = require('node:http');
const { readPhoto } = require('./photos.cjs');
const { HttpError } = require('./store.cjs');
const {
  TYPES,
  COSTS,
  ValidationError,
  text,
  coordinates,
  slideInput,
  reviewInput,
} = require('../miniprogram/lib/domain');
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json'))
    throw new HttpError(415, '请使用 JSON 请求');
  if (Number(req.headers['content-length']) > 16384) throw new HttpError(413, '请求内容过大');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new HttpError(413, '请求内容过大');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
}
function number(value, min, max, defaultValue) {
  if (value == null) return defaultValue;
  if (value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max)
    throw new HttpError(400, '查询参数无效');
  return Number(value);
}
function pagination(search) {
  const offset = number(search.get('offset'), 0, 100000, 0),
    limit = number(search.get('limit'), 1, 100, 20);
  if (!Number.isInteger(offset) || !Number.isInteger(limit)) throw new HttpError(400, '分页参数无效');
  return { offset, limit };
}
function createApi({ store, wechat, appid, demo = false, trustedProxy = false, staticHandler }) {
  const windows = new Map();
  function rate(key, max) {
    const now = Date.now();
    for (const [id, bucket] of windows) if (bucket.until <= now) windows.delete(id);
    const bucket = windows.get(key) || { count: 0, until: now + 60000 };
    windows.set(key, bucket);
    if (++bucket.count > max) throw new HttpError(429, '操作太频繁，请稍后再试', 'RATE_LIMITED');
  }
  const send = (res, status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'),
        path = url.pathname,
        method = req.method;
      if (demo && !['localhost', '127.0.0.1'].includes(new URL('http://' + req.headers.host).hostname))
        throw new HttpError(403, '演示服务仅供本机使用');
      if (!path.startsWith('/api/')) {
        if (staticHandler && (await staticHandler(req, res))) return;
        throw new HttpError(404, '页面不存在');
      }
      const ip = trustedProxy
        ? String(req.headers['x-real-ip'] || req.socket.remoteAddress)
        : req.socket.remoteAddress;
      rate(`all:${ip}`, 240);
      if (path === '/api/health' && method === 'GET')
        return send(res, 200, { ok: true, service: 'slide-map', demo });
      if (path === '/api/auth/wechat' && method === 'POST') {
        rate(`login:${ip}`, 20);
        const body = await readBody(req);
        if (body.acceptedPrivacy !== true) throw new HttpError(400, '请先阅读并同意隐私说明');
        const code = text(body.code, '登录凭证', 4, 256);
        const openid = await wechat.login(code);
        return send(res, 200, store.login(openid, appid));
      }
      if (path === '/api/auth/demo' && method === 'POST' && demo) {
        rate(`login:${ip}`, 20);
        const body = await readBody(req);
        if (!['explorer', 'neighbor'].includes(body.persona)) throw new HttpError(400, '演示角色无效');
        return send(res, 200, store.login(`demo-${body.persona}`, 'demo'));
      }
      const token = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      const user = token && store.authenticate(token);
      if (req.headers.authorization && !user)
        throw new HttpError(401, '登录已过期，请重新登录', 'UNAUTHORIZED');
      const auth = () => {
        if (!user) throw new HttpError(401, '请先登录后再操作', 'UNAUTHORIZED');
        return user.id;
      };
      if (!['GET', 'HEAD'].includes(method)) {
        auth();
        rate(`write:${user.id}`, 30);
      }
      if (path === '/api/photos' && method === 'POST') {
        rate(`photo:${user.id}`, 12);
        const photo = await readPhoto(req);
        await wechat.moderateImage(photo);
        return send(res, 201, store.savePhoto(user.id, photo));
      }
      const photoMatch = /^\/api\/photos\/([a-f0-9]{32})$/.exec(path);
      if (photoMatch && method === 'GET') {
        const photo = store.photo(photoMatch[1]);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': photo.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        return res.end(photo);
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        store.logout(token);
        return send(res, 200, { ok: true });
      }
      if (path === '/api/me' && method === 'GET') return send(res, 200, store.me(auth()));
      if (path === '/api/me' && method === 'PATCH') {
        const nickname = text((await readBody(req)).nickname, '昵称', 2, 24);
        await wechat.moderate(user.openid, nickname, 1);
        return send(res, 200, store.updateProfile(user.id, nickname));
      }
      if (path === '/api/slides' && method === 'GET') {
        const s = url.searchParams,
          latitude = number(s.get('latitude'), -90, 90),
          longitude = number(s.get('longitude'), -180, 180);
        if ((latitude == null) !== (longitude == null)) throw new HttpError(400, '经纬度需要同时提供');
        if (latitude != null) coordinates(latitude, longitude);
        const type = s.get('type') || undefined,
          cost = s.get('cost') || undefined,
          scope = s.get('scope') || undefined,
          sort = s.get('sort') || 'newest';
        if (
          (type && !TYPES.slice(1).includes(type)) ||
          (cost && !COSTS.includes(cost)) ||
          (scope && !['shares', 'reviews', 'favorites'].includes(scope)) ||
          !['newest', 'distance', 'rating'].includes(sort)
        )
          throw new HttpError(400, '筛选条件无效');
        if (scope) auth();
        return send(
          res,
          200,
          store.list({
            latitude,
            longitude,
            radius: number(s.get('radius'), 0.1, 100, 10),
            q: text(s.get('q') || '', '搜索词', 0, 80),
            type,
            cost,
            scope,
            uid: user?.id,
            sort,
            ...pagination(s),
          }),
        );
      }
      if (path === '/api/slides' && method === 'POST') {
        const input = slideInput(await readBody(req));
        await wechat.moderate(
          user.openid,
          `${input.title}\n${input.address}\n${input.description}\n${input.openingHours}\n${input.traffic}\n${input.parkingAddress}`,
        );
        return send(res, 201, store.createSlide(user.id, input));
      }
      const match = /^\/api\/slides\/([1-9]\d{0,9})(?:\/(reviews|favorite|report))?$/.exec(path);
      if (!match) throw new HttpError(404, '接口不存在');
      const id = Number(match[1]),
        action = match[2];
      if (!action) {
        if (method === 'GET') return send(res, 200, store.detail(id, user?.id));
        if (method === 'PUT') {
          if (!store.detail(id, user.id).isOwner) throw new HttpError(403, '只能管理自己分享的滑梯');
          const input = slideInput(await readBody(req));
          await wechat.moderate(
            user.openid,
            `${input.title}\n${input.address}\n${input.description}\n${input.openingHours}\n${input.traffic}\n${input.parkingAddress}`,
          );
          return send(res, 200, store.updateSlide(id, user.id, input));
        }
        if (method === 'DELETE') {
          store.deleteSlide(id, user.id);
          return send(res, 200, { ok: true });
        }
      }
      if (action === 'reviews') {
        if (method === 'GET') {
          const p = pagination(url.searchParams);
          return send(res, 200, store.reviews(id, p.offset, p.limit));
        }
        if (method === 'PUT') {
          if (store.detail(id, user.id).isOwner) throw new HttpError(403, '不能给自己分享的滑梯评分');
          const input = reviewInput(await readBody(req));
          await wechat.moderate(user.openid, input.content);
          return send(res, 200, store.review(id, user.id, input));
        }
        if (method === 'DELETE') {
          store.deleteReview(id, user.id);
          return send(res, 200, { ok: true });
        }
      }
      if (action === 'favorite' && ['PUT', 'DELETE'].includes(method)) {
        store.favorite(id, user.id, method === 'PUT');
        return send(res, 200, { ok: true });
      }
      if (action === 'report' && method === 'POST') {
        const reason = text((await readBody(req)).reason, '反馈原因', 5, 300);
        store.report(id, user.id, reason);
        return send(res, 201, { ok: true });
      }
      throw new HttpError(405, '不支持此操作');
    } catch (error) {
      const known = error instanceof HttpError || error instanceof ValidationError;
      if (!known) console.error('API failed:', error.name); // Do not log tokens, upstream URLs, or submitted content.
      send(res, error instanceof ValidationError ? 400 : known ? error.status : 500, {
        error: error.code || 'REQUEST_FAILED',
        message: known ? error.message : '服务暂不可用，请稍后再试',
      });
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  return server;
}
module.exports = { createApi };
