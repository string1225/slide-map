const api = require('../../lib/api');
const { presentSlide } = require('../../lib/domain');
Page({
  data: {
    user: null,
    nickname: '',
    scope: 'favorites',
    items: [],
    nextOffset: null,
    loading: false,
    error: '',
    busy: false,
  },
  onShow() {
    this.load();
  },
  async load(more = false) {
    if (!api.session()) {
      this.setData({ user: null, items: [], nextOffset: null, loading: false });
      return;
    }
    const sequence = (this.sequence = (this.sequence || 0) + 1);
    this.setData({ loading: true, error: '' });
    try {
      const user = await api.request('/me');
      const result = await api.request(
        '/slides?' + api.query({ scope: this.data.scope, offset: more ? this.data.nextOffset : 0 }),
      );
      if (sequence !== this.sequence) return;
      this.setData({
        user,
        nickname: user.nickname,
        items: (more ? this.data.items : []).concat(result.items.map(presentSlide)),
        nextOffset: result.nextOffset,
      });
    } catch (error) {
      if (sequence === this.sequence)
        this.setData({ error: error.message, ...(!api.session() ? { user: null, items: [] } : {}) });
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  async login() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await api.ensureLogin();
      await this.load();
    } catch (error) {
      this.setData({ error: api.message(error) });
      api.toast(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  input(e) {
    this.setData({ nickname: e.detail.value });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const user = await api.request('/me', 'PATCH', { nickname: this.data.nickname });
      this.setData({ user, nickname: user.nickname });
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    } catch (error) {
      this.setData({ error: api.message(error) });
      api.toast(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  tab(e) {
    this.setData({ scope: e.currentTarget.dataset.value });
    this.load();
  },
  more() {
    if (!this.data.loading && this.data.nextOffset !== null) this.load(true);
  },
  detail(e) {
    wx.navigateTo({ url: '/pages/detail/index?id=' + e.currentTarget.dataset.id });
  },
  privacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },
  async logout() {
    try {
      await api.request('/auth/logout', 'POST', {});
      api.clearSession();
      this.setData({ user: null, items: [], nickname: '', error: '' });
    } catch (error) {
      if (error.status === 401) {
        api.clearSession();
        this.load();
      } else api.toast(error);
    }
  },
  retry() {
    if (api.session()) this.load();
    else this.login();
  },
});
