const config = require('../config');
const KEY = 'slide-map-session';
let loginPromise;
function session() {
  const value = wx.getStorageSync(KEY);
  if (
    !value ||
    !/^[a-zA-Z0-9_-]{43}$/.test(value.token || '') ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now()
  ) {
    wx.removeStorageSync(KEY);
    return null;
  }
  return value;
}
function clearSession() {
  wx.removeStorageSync(KEY);
}
function message(error) {
  const detail = error.errMsg || error.message || '';
  if (/url not in domain list|domain.*(list|白名单)|合法域名/i.test(detail))
    return '服务域名尚未配置，请联系管理员在微信后台添加 request 合法域名';
  if (/ssl|certificate|cert_|tls/i.test(detail)) return '安全连接失败，请稍后重试或联系管理员';
  if (/timeout/i.test(detail)) return '连接超时，请检查网络后重试';
  if (/cancel|disagree/i.test(detail)) return '已取消操作，内容已保留';
  if (/login:fail/i.test(detail)) return '微信登录暂不可用，请重新进入小程序后再试';
  if (/privacy/i.test(detail)) return '请先同意微信隐私授权后再继续';
  if (/no such file|not found|readFile:fail/i.test(detail)) return '本机照片已失效，请移除后重新添加';
  if (/saveFile:fail|maximum size|quota/i.test(detail)) return '照片保存失败，本机空间不足，请减少照片后重试';
  return error.message || '连接失败，请检查网络后重试';
}
function request(path, method = 'GET', data, retry = true, binary = false) {
  const saved = session();
  return new Promise((resolve, reject) =>
    wx.request({
      url: config.apiBase + path,
      method,
      ...(data === undefined ? {} : { data }),
      timeout: binary ? 60000 : 20000,
      header: {
        'content-type': binary ? 'application/octet-stream' : 'application/json',
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
          const error = new Error(res.data?.message || '服务暂不可用，请稍后重试');
          error.status = res.statusCode;
          reject(error);
        }
      },
      fail(error) {
        reject(new Error(message(error)));
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
  if (!loginPromise)
    loginPromise = (async () => {
      if (session()) {
        try {
          return await request('/me');
        } catch (error) {
          if (error.status !== 401) throw error;
        }
      }
      const consent = await invoke('showModal', {
        title: '登录滑滑梯地图',
        content:
          '登录后将记录你的微信身份标识和昵称，用于关联分享、收藏与评价。点击同意即表示同意「我的」页面中的隐私说明。',
        confirmText: '同意并登录',
      });
      if (!consent.confirm) throw new Error('已取消登录');
      const login = await invoke('login');
      if (!login.code) throw new Error('未获取到微信登录凭证，请重新登录');
      const value = await request('/auth/wechat', 'POST', { code: login.code, acceptedPrivacy: true });
      wx.setStorageSync(KEY, value);
      return value.user;
    })()
      .catch((error) => {
        throw Object.assign(new Error(message(error)), { status: error.status });
      })
      .finally(() => {
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
  wx.showToast({ title: message(error), icon: 'none', duration: 2800 });
}
const photoUrl = (id) => config.apiBase + '/photos/' + id;
async function uploadPhoto(filePath) {
  const file = await new Promise((resolve, reject) =>
    wx.getFileSystemManager().readFile({ filePath, success: resolve, fail: reject }),
  );
  return request('/photos', 'POST', file.data, false, true);
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
  message,
  photoUrl,
  uploadPhoto,
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
