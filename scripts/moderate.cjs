const path = require('node:path');
const fs = require('node:fs');
const { createStore } = require('../server/store.cjs');
const filename = path.resolve(process.env.SLIDE_MAP_DB || 'data/slide-map.sqlite');
if (!fs.existsSync(filename)) throw new Error('数据库不存在，请先核对 SLIDE_MAP_DB');
const store = createStore(filename),
  [command, idArg] = process.argv.slice(2),
  id = Number(idArg);
try {
  if (command === 'reports')
    console.table(
      store.db
        .prepare(
          'SELECT r.id,r.slide_id,s.title,r.reason,r.resolved FROM reports r JOIN slides s ON s.id=r.slide_id ORDER BY r.id DESC LIMIT 100',
        )
        .all(),
    );
  else if (['hide', 'restore', 'resolve'].includes(command) && Number.isSafeInteger(id) && id > 0) {
    const result =
      command === 'resolve'
        ? store.db.prepare('UPDATE reports SET resolved=1 WHERE id=?').run(id)
        : store.db.prepare('UPDATE slides SET hidden=? WHERE id=?').run(command === 'hide' ? 1 : 0, id);
    console.log('更新记录数：' + result.changes);
  } else
    throw new Error(
      '用法：npm run moderate -- reports | hide <滑梯ID> | restore <滑梯ID> | resolve <举报ID>',
    );
} finally {
  store.close();
}
