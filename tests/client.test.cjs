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
      message: (error) => error.message,
      session: () => ({ user: {} }),
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

test('guest submission asks for login before validation and preserves entered content on cancellation', async () => {
  let logins = 0;
  const p = page(
    'publish',
    {
      ensureLogin: async () => {
        logins++;
        throw new Error('已取消登录');
      },
      message: (e) => e.message,
      session: () => null,
    },
    { setStorageSync() {} },
  );
  p.data.form.title = '写了一半的名字';
  await p.submit();
  assert.equal(logins, 1);
  assert.equal(p.data.error, '已取消登录');
  assert.equal(p.data.form.title, '写了一半的名字');
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.busy, false);
});

test('partial photo upload failure preserves draft and resumes without uploading successful photos again', async () => {
  const uploaded = [],
    drafts = [],
    posted = [];
  let fail = true;
  const p = page(
    'publish',
    {
      ensureLogin: async () => {},
      message: (e) => e.message,
      session: () => ({ user: {} }),
      uploadPhoto: async (file) => {
        uploaded.push(file);
        if (file === 'photo2' && fail) throw new Error('照片连接中断');
        return { id: (file === 'photo1' ? 'a' : 'b').repeat(32) };
      },
      request: async (path, method, input) => {
        posted.push(input);
        return { id: 3 };
      },
    },
    {
      setStorageSync: (key, value) => drafts.push(value),
      removeStorageSync() {},
      showToast() {},
      navigateTo() {},
      getFileSystemManager: () => ({ removeSavedFile() {} }),
    },
  );
  Object.assign(p.data.form, {
    title: '公园小滑梯',
    address: '公园东门',
    description: '这是一个测试介绍',
    latitude: 31,
    longitude: 121,
  });
  p.data.photos = [{ path: 'photo1' }, { path: 'photo2' }];
  await p.submit();
  assert.equal(p.data.error, '照片连接中断');
  assert.equal(p.data.photos[0].id, 'a'.repeat(32));
  assert.equal(posted.length, 0);
  assert.equal(drafts.at(-1).photoFiles.length, 2);
  fail = false;
  await p.submit();
  assert.deepEqual(uploaded, ['photo1', 'photo2', 'photo2']);
  assert.equal(posted.length, 1);
  assert.deepEqual(Array.from(posted[0].photos), ['a'.repeat(32), 'b'.repeat(32)]);
  assert.equal(p.data.photos.length, 0);
});

test('seating choices are exclusive; manual parking edits clear stale navigation coordinates', () => {
  const p = page('publish', {}, { setStorageSync() {} });
  p.amenity({ currentTarget: { dataset: { value: '座椅多' } } });
  p.amenity({ currentTarget: { dataset: { value: '座椅少' } } });
  p.amenity({ currentTarget: { dataset: { value: '可骑车' } } });
  assert.deepEqual(Array.from(p.data.form.amenities), ['座椅少', '可骑车']);
  p.data.form.parkingLocation = { latitude: 31, longitude: 121 };
  p.input({ currentTarget: { dataset: { field: 'parkingAddress' } }, detail: { value: '新的停车场' } });
  assert.equal(p.data.form.parkingLocation, null);
});
