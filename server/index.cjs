const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { createStore } = require('./store.cjs');
const { createApi } = require('./service.cjs');
const { createWechat } = require('./wechat.cjs');
const appid = process.env.WECHAT_APPID,
  secret = process.env.WECHAT_APP_SECRET;
if (!/^wx[0-9a-f]{16}$/.test(appid || '') || !/^[0-9a-f]{32}$/.test(secret || ''))
  throw new Error('请在服务端环境中配置独立小程序的 WECHAT_APPID 和 WECHAT_APP_SECRET');
const filename = path.resolve(process.env.SLIDE_MAP_DB || 'data/slide-map.sqlite');
mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
const store = createStore(filename),
  server = createApi({
    store,
    appid,
    wechat: createWechat({ appid, secret }),
    trustedProxy: process.env.TRUST_PROXY === '1',
  });
server.listen(Number(process.env.PORT || 3042), '127.0.0.1', () =>
  console.log('Slide Map API listening on http://127.0.0.1:3042'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
