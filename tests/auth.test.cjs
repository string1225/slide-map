const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function client(overrides = {}, initial) {
  let saved = initial;
  const wx = {
    getStorageSync: () => saved,
    setStorageSync: (key, value) => {
      saved = value;
    },
    removeStorageSync: () => {
      saved = null;
    },
    ...overrides,
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('miniprogram/lib/api.js', 'utf8'), {
    wx,
    module,
    require: () => ({ apiBase: 'https://example.com/api' }),
  });
  return module.exports;
}
const session = { token: 'a'.repeat(43), expiresAt: Date.now() + 3600000, user: { id: 'old' } };
test('GET omits undefined data and reports native domain/TLS/timeout errors', async () => {
  const api = client({
    request(options) {
      assert.ok(!Object.hasOwn(options, 'data'));
      options.success({ statusCode: 200, data: { ok: true } });
    },
  });
  assert.equal((await api.request('/health')).ok, true);
  for (const [errMsg, expected] of [
    ['request:fail url not in domain list', /合法域名/],
    ['request:fail SSL certificate invalid', /安全连接/],
    ['request:fail timeout', /超时/],
  ]) {
    const failing = client({
      request(options) {
        options.fail({ errMsg });
      },
    });
    await assert.rejects(failing.request('/slides'), expected);
  }
});
test('expired remote sessions prompt login once, without requiring location/photo privacy permission', async () => {
  let modals = 0,
    logins = 0;
  const api = client(
    {
      request(options) {
        if (options.url.endsWith('/me'))
          return options.success({ statusCode: 401, data: { message: '登录过期' } });
        assert.equal(options.data.code, 'valid-code');
        assert.equal(options.data.acceptedPrivacy, true);
        assert.equal(options.header.Authorization, undefined);
        options.success({ statusCode: 200, data: { ...session, user: { id: 'new' } } });
      },
      showModal(options) {
        modals++;
        options.success({ confirm: true });
      },
      login(options) {
        logins++;
        options.success({ code: 'valid-code' });
      },
      requirePrivacyAuthorize() {
        assert.fail('login does not require media/location authorization');
      },
    },
    session,
  );
  const users = await Promise.all([api.ensureLogin(), api.ensureLogin()]);
  assert.deepEqual(
    users.map((u) => u.id),
    ['new', 'new'],
  );
  assert.equal(modals, 1);
  assert.equal(logins, 1);
  assert.equal(api.session().user.id, 'new');
});
test('cancelled login and native login failures have actionable messages', async () => {
  const cancelled = client({
    showModal(o) {
      o.success({ confirm: false });
    },
    login() {
      assert.fail('cancelled');
    },
  });
  await assert.rejects(cancelled.ensureLogin(), /取消/);
  const failed = client({
    showModal(o) {
      o.success({ confirm: true });
    },
    login(o) {
      o.fail({ errMsg: 'login:fail service unavailable' });
    },
  });
  await assert.rejects(failed.ensureLogin(), /微信登录暂不可用/);
});
test('stale sessions retry public reads anonymously, but never duplicate write requests', async () => {
  let reads = 0,
    writes = 0;
  const api = client(
    {
      request(o) {
        if (++reads === 1) o.success({ statusCode: 401, data: {} });
        else {
          assert.equal(o.header.Authorization, undefined);
          o.success({ statusCode: 200, data: [] });
        }
      },
    },
    session,
  );
  await api.request('/slides');
  assert.equal(reads, 2);
  const writer = client(
    {
      request(o) {
        writes++;
        o.success({ statusCode: 401, data: { message: '登录过期' } });
      },
    },
    session,
  );
  await assert.rejects(writer.request('/slides', 'POST', {}), (e) => e.status === 401);
  assert.equal(writes, 1);
});
