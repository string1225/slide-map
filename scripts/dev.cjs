const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createStore } = require('../server/store.cjs');
const { createApi } = require('../server/service.cjs');
const { seed } = require('./seed.cjs');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const store = createStore(path.join(root, 'data/demo.sqlite'));
seed(store);
const webRoot = path.join(root, 'web');
const staticHandler = async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
  const file =
    pathname === '/assets/logo.png'
      ? path.join(root, 'assets/logo.png')
      : files[pathname]
        ? path.join(webRoot, files[pathname])
        : null;
  if (!file) return false;
  res.writeHead(200, {
    'Content-Type': pathname.endsWith('.png')
      ? 'image/png'
      : pathname.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : pathname.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(fs.readFileSync(file));
  return true;
};
const server = createApi({
  store,
  appid: 'demo',
  demo: true,
  staticHandler,
  wechat: {
    login: async () => {
      throw new Error('Use demo login');
    },
    moderate: async () => {},
  },
});
let backend;
const port = Number(process.env.DEV_PORT || 5186);
server.on('error', (error) => {
  console.error('演示服务启动失败：' + error.code + '，可通过 DEV_PORT 指定空闲端口。');
  if (backend) backend.kill();
  store.close();
  process.exit(1);
});
server.listen(port, '127.0.0.1', async () => {
  console.log('浏览器交互演示：http://127.0.0.1:' + port + '（独立虚构数据，不是真实地图）');
  if (fs.existsSync(path.join(root, 'server/.env'))) {
    let existing;
    try {
      existing = await fetch('http://127.0.0.1:3042/api/health', { signal: AbortSignal.timeout(1000) }).then(
        (r) => r.json(),
      );
    } catch {}
    if (existing?.service === 'slide-map' && !existing.demo)
      console.log('复用本机已启动的滑滑梯地图 API：3042');
    else
      backend = spawn(process.execPath, ['--env-file=server/.env', 'server/index.cjs'], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
      });
  } else console.log('真实微信登录需复制 server/.env.example 为 server/.env 并配置独立 AppID / AppSecret。');
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (backend) backend.kill();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
