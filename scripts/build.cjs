const fs = require('node:fs');
const path = require('node:path');
const { generateIcons } = require('./icons.cjs');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      fs.existsSync(path.join(root, 'config.local.json')) ? 'config.local.json' : 'config.example.json',
    ),
    'utf8',
  ),
);
if (!/^wx[0-9a-f]{16}$/.test(config.appid)) throw new Error('请配置有效的小程序 AppID');
const url = new URL(config.apiBase);
if (
  url.protocol !== 'https:' &&
  !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
)
  throw new Error('正式 API 必须使用 HTTPS');
if (url.username || url.password || url.search || url.hash)
  throw new Error('API 地址不能包含凭证、查询参数或 fragment');
// Only copy allowlisted client fields. Server secrets never enter the build.
const client = {
  apiBase: config.apiBase.replace(/\/$/, ''),
  supportEmail: config.supportEmail || '',
  tencentMapKey: config.tencentMapKey || '',
};
const out = path.join(root, 'dist/wechat');
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'miniprogram'), out, { recursive: true });
generateIcons(path.join(out, 'assets'));
fs.copyFileSync(path.join(root, 'assets/logo.png'), path.join(out, 'assets/logo.png'));
fs.writeFileSync(path.join(out, 'config.js'), 'module.exports = ' + JSON.stringify(client, null, 2) + ';\n');
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
fs.writeFileSync(
  path.join(root, 'dist/project.config.json'),
  JSON.stringify({ ...project, appid: config.appid, miniprogramRoot: 'wechat/' }, null, 2) + '\n',
);
console.log('已构建 dist/wechat。默认配置可导入仓库根目录；自定义 AppID 时导入 dist。');
if (url.protocol !== 'https:') console.log('当前 API 为本机地址，真机调试前请配置 HTTPS 服务地址。');
