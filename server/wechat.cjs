const { HttpError } = require('./store.cjs');
function createWechat({ appid, secret, fetchImpl = fetch }) {
  let cachedToken,
    tokenUntil = 0,
    tokenRequest;
  async function call(path, query, body) {
    const url = new URL(path, 'https://api.weixin.qq.com');
    url.search = new URLSearchParams(query).toString();
    try {
      const res = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error();
      return await res.json();
    } catch {
      throw new HttpError(503, '微信服务暂不可用，请稍后重试', 'WECHAT_UNAVAILABLE');
    }
  }
  async function accessToken() {
    if (cachedToken && Date.now() < tokenUntil) return cachedToken;
    if (!tokenRequest)
      tokenRequest = (async () => {
        const data = await call('/cgi-bin/token', { grant_type: 'client_credential', appid, secret });
        if (!data.access_token || data.errcode) throw new HttpError(503, '内容检查暂不可用，请稍后重试');
        cachedToken = data.access_token;
        tokenUntil = Date.now() + Math.max(0, data.expires_in - 120) * 1000;
        return cachedToken;
      })().finally(() => {
        tokenRequest = null;
      });
    return tokenRequest;
  }
  return {
    async login(code) {
      const data = await call('/sns/jscode2session', {
        appid,
        secret,
        js_code: code,
        grant_type: 'authorization_code',
      });
      if (data.errcode || typeof data.openid !== 'string' || !data.openid || !data.session_key)
        throw new HttpError(401, '微信登录失败，请重新登录', 'WECHAT_LOGIN_FAILED');
      return data.openid;
    },
    async moderate(openid, content, scene = 2) {
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        data = await call(
          '/wxa/msg_sec_check',
          { access_token: await accessToken() },
          { version: 2, openid, scene, content },
        );
        if (![40001, 40014, 42001].includes(data.errcode)) break;
        tokenUntil = 0;
      }
      if (data.errcode === 87014 || (data.result && data.result.suggest !== 'pass'))
        throw new HttpError(422, '内容未通过检查，请调整后再提交', 'CONTENT_REJECTED');
      if (data.errcode || data.result?.suggest !== 'pass')
        throw new HttpError(503, '内容检查暂不可用，请稍后重试', 'MODERATION_UNAVAILABLE');
    },
  };
}
module.exports = { createWechat };
