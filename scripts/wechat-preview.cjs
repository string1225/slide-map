const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = process.env.WECHAT_DEVTOOLS_CLI || 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
if (!fs.existsSync(cli)) throw new Error('Set WECHAT_DEVTOOLS_CLI to the WeChat Developer Tools CLI path');
const config = require(path.join(root, 'dist/wechat/config.js'));
if (!config.apiBase.startsWith('https://'))
  throw new Error('手机预览需要 HTTPS API，请先部署后端并修改 config.local.json 后重新构建');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const output = path.join(root, 'artifacts', `wechat-preview-${stamp}.jpg`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const args = [
  'preview',
  '--project',
  path.join(root, 'dist'),
  '--qr-format',
  'image',
  '--qr-output',
  output,
  '--info-output',
  path.join(root, 'artifacts', 'wechat-preview.json'),
];
// Use exactly the runtime and entry point called by the official cli.bat.
// Argument arrays preserve Windows paths with spaces and Chinese characters.
const bundledNode = path.join(path.dirname(cli), 'node.exe');
const cliScript = path.join(path.dirname(cli), 'cli.js');
if (!fs.existsSync(bundledNode) || !fs.existsSync(cliScript))
  throw new Error('找不到微信开发者工具配套的 Node 运行时或 CLI');
const result = spawnSync(bundledNode, [cliScript, ...args], {
  cwd: root,
  windowsHide: true,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('微信预览失败，请检查开发者工具登录和 AppID 权限');
if (!fs.existsSync(output)) throw new Error('预览工具未生成二维码；请检查上方微信接口提示');
fs.copyFileSync(output, path.join(root, 'artifacts', 'wechat-preview.jpg'));
console.log('Preview QR: ' + output);
