const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
function page(name, api, wx = {}) {
  const filename = path.resolve('miniprogram/pages/' + name + '/index.js'),
    local = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    require: (p) => (p === '../../lib/api' ? api : p === '../../config' ? { tencentMapKey: '' } : local(p)),
    wx,
    console,
    Date,
  });
  definition.setData = function (values) {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.');
      let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = value;
    }
  };
  return definition;
}
test('out-of-order map requests cannot replace newer filter results', async () => {
  const pending = [];
  const p = page('explore', {
    request: () => new Promise((resolve) => pending.push(resolve)),
    query: () => '',
  });
  const first = p.load(),
    second = p.load();
  const slide = {
    id: 2,
    title: 'new',
    amenities: [],
    createdAt: 0,
    reviewCount: 0,
    latitude: 0,
    longitude: 0,
  };
  pending[1]({ items: [slide], total: 1, nextOffset: null });
  await second;
  pending[0]({ items: [{ ...slide, id: 1 }], total: 1, nextOffset: null });
  await first;
  assert.equal(p.data.items[0].id, 2);
  assert.equal(p.data.loading, false);
});
test('failed publication retains the draft and re-enables the submit button', async () => {
  const p = page(
    'publish',
    {
      ensureLogin: async () => {},
      request: async () => {
        throw new Error('网络中断');
      },
    },
    { setStorageSync() {} },
  );
  p.data.form = {
    title: '草地里的小滑梯',
    address: '公园入口左侧',
    description: '很适合小朋友游玩的滑梯',
    latitude: 31,
    longitude: 121,
    type: '公园滑梯',
    ageBand: '全年龄',
    cost: '免费',
    amenities: [],
    openingHours: '',
  };
  await p.submit();
  assert.equal(p.data.form.title, '草地里的小滑梯');
  assert.equal(p.data.error, '网络中断');
  assert.equal(p.data.busy, false);
});
test('location denial and cancellation preserve browsing', async () => {
  const p = page('explore', {
    location: async () => null,
    toast: () => {
      throw new Error('should not toast cancel');
    },
  });
  await p.locate();
  assert.equal(p.data.latitude, 31.2304);
  assert.equal(p.data.located, false);
});
test('native map drag and scale events expose search-this-area', () => {
  const p = page('explore', {});
  p.region({ type: 'regionchange', detail: { type: 'end', causedBy: 'drag' } });
  assert.equal(p.data.areaChanged, true);
  p.data.areaChanged = false;
  p.region({ type: 'end', causedBy: 'scale' });
  assert.equal(p.data.areaChanged, true);
  p.data.areaChanged = false;
  p.region({ type: 'regionchange', detail: { type: 'end', causedBy: 'update' } });
  assert.equal(p.data.areaChanged, false);
});
test('published tabs and page bundles exist and permissions are declared', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json'));
  for (const p of app.pages)
    for (const ext of ['js', 'json', 'wxml', 'wxss'])
      assert.ok(fs.existsSync('miniprogram/' + p + '.' + ext), p + '.' + ext);
  assert.deepEqual(app.requiredPrivateInfos, ['getLocation', 'chooseLocation']);
  for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath));
  assert.ok(!fs.readFileSync('miniprogram/lib/api.js', 'utf8').includes('APP_SECRET'));
});
