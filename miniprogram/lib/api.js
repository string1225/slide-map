const config = require('../config');
const KEY = 'slide-map-session';
let loginPromise;
function session() {
  const value = wx.getStorageSync(KEY);
  if (!value || value.expiresAt <= Date.now()) {
    wx.removeStorageSync(KEY);
    return null;
  }
  return value;
}
function clearSession() {
  wx.removeStorageSync(KEY);
}
function request(path, method = 'GET', data, retry = true) {
  const saved = session();
  return new Promise((resolve, reject) =>
    wx.request({
      url: config.apiBase + path,
      method,
      data,
      timeout: 15000,
      header: {
        'content-type': 'application/json',
        ...(saved ? { Authorization: 'Bearer ' + saved.token } : {}),
      },
      success(res) {
        if (res.statusCode === 401) {
          clearSession();
          if (saved && method === 'GET' && retry && !path.startsWith('/me') && !path.includes('scope='))
            return request(path, method, data, false).then(resolve, reject);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else {
          const error = new Error(res.data.message || '服务暂不可用');
          error.status = res.statusCode;
          reject(error);
        }
      },
      fail() {
        reject(new Error('连接失败，请检查网络后重试'));
      },
    }),
  );
}
function invoke(name, options = {}) {
  return new Promise((resolve, reject) => wx[name]({ ...options, success: resolve, fail: reject }));
}
async function privacy() {
  if (wx.requirePrivacyAuthorize) await invoke('requirePrivacyAuthorize');
}
async function ensureLogin() {
  if (session()) return session().user;
  if (!loginPromise)
    loginPromise = (async () => {
      const consent = await invoke('showModal', {
        title: '登录滑滑梯地图',
        content:
          '登录后将记录你的微信身份标识和昵称，用于关联分享、收藏与评价。点击同意即表示同意「我的」页面中的隐私说明。',
        confirmText: '同意并登录',
      });
      if (!consent.confirm) throw new Error('已取消登录');
      await privacy();
      const login = await invoke('login');
      const value = await request('/auth/wechat', 'POST', { code: login.code, acceptedPrivacy: true });
      wx.setStorageSync(KEY, value);
      return value.user;
    })().finally(() => {
      loginPromise = null;
    });
  return loginPromise;
}
function query(values) {
  return Object.keys(values)
    .filter((key) => values[key] !== undefined && values[key] !== null && values[key] !== '')
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(values[key]))
    .join('&');
}
function toast(error) {
  wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none', duration: 2800 });
}
async function location(name, options) {
  try {
    await privacy();
    return await invoke(name, options);
  } catch (error) {
    if (/cancel|disagree/.test(error.errMsg || '')) return null;
    if (/auth deny|auth denied|authorize/.test(error.errMsg || '')) {
      const result = await invoke('showModal', {
        title: '需要位置权限',
        content: '开启位置权限后可查找附近滑梯，也可以继续浏览和搜索其他地点。',
        confirmText: '去设置',
      });
      if (result.confirm) await invoke('openSetting');
      return null;
    }
    throw new Error('暂时无法获取位置，请稍后重试');
  }
}
async function navigate(slide) {
  await location('openLocation', {
    latitude: slide.latitude,
    longitude: slide.longitude,
    name: slide.title,
    address: slide.address,
    scale: 17,
  });
}
module.exports = {
  request,
  session,
  clearSession,
  invoke,
  privacy,
  ensureLogin,
  query,
  toast,
  location,
  navigate,
};
