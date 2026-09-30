const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const host = process.env.SLIDE_MAP_SSH_HOST || 'aliyun-139';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host)) throw new Error('Invalid SSH host');
const release = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const staging = `/home/junte/.cache/slide-map-${release}`;
const archive = path.join(root, 'artifacts', `slide-map-${release}.tgz`);
function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: root,
    windowsHide: true,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
}
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, 'server/.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
if (env.WECHAT_APPID !== project.appid || !/^[a-f0-9]{32}$/.test(env.WECHAT_APP_SECRET || ''))
  throw new Error('Configure this AppID and its server-only AppSecret in server/.env');
// Transfer credentials through SSH stdin only, never in an archive or command argument.
const environment = `WECHAT_APPID=${env.WECHAT_APPID}\nWECHAT_APP_SECRET=${env.WECHAT_APP_SECRET}\nSLIDE_MAP_DB=/var/lib/slide-map/slide-map.sqlite\nPORT=3042\nTRUST_PROXY=1\n`;
run(
  'ssh',
  [
    '-o',
    'BatchMode=yes',
    host,
    "sudo -n sh -c 'umask 077; install -d -m 700 /etc/slide-map; if [ -f /etc/slide-map/server.env ]; then cp -p /etc/slide-map/server.env /etc/slide-map/server.env.previous; fi; cat > /etc/slide-map/server.env.next; chmod 600 /etc/slide-map/server.env.next; mv /etc/slide-map/server.env.next /etc/slide-map/server.env'",
  ],
  environment,
);
fs.mkdirSync(path.dirname(archive), { recursive: true });
run('tar', [
  '-czf',
  archive,
  'package.json',
  'miniprogram/lib/domain.js',
  'server/index.cjs',
  'server/service.cjs',
  'server/store.cjs',
  'server/wechat.cjs',
  'scripts/moderate.cjs',
  'deploy/slide-map.service',
  'deploy/slide-map-location.conf',
]);
run('ssh', ['-o', 'BatchMode=yes', host, `install -d -m 700 ${staging}`]);
run('scp', ['-q', archive, `${host}:${staging}/release.tgz`]);
// Keep remote shell scripts LF-only even with Windows Git checkout settings.
const installScript = fs.readFileSync(path.join(root, 'deploy/install.sh'), 'utf8').replace(/\r\n/g, '\n');
run(
  'ssh',
  ['-o', 'BatchMode=yes', host, `cat > ${staging}/install.sh && bash -n ${staging}/install.sh`],
  installScript,
);
run('ssh', [
  '-o',
  'BatchMode=yes',
  host,
  `sudo -n bash ${staging}/install.sh ${release} ${staging}/release.tgz`,
]);
console.log('API: https://www.sunny-string.cn/wechat/slide-map/api/health');
