const api = require('../../lib/api');
const { presentSlide, reviewInput } = require('../../lib/domain');
const config = require('../../config');
Page({
  data: {
    mapKey: config.tencentMapKey,
    slide: null,
    reviews: [],
    nextOffset: null,
    loading: true,
    error: '',
    rating: 5,
    content: '',
    busy: false,
    stars: [1, 2, 3, 4, 5],
  },
  onLoad(options) {
    this.id = Number(options.id);
  },
  onShow() {
    if (this.id) this.load();
    else this.setData({ loading: false, error: '滑梯地址无效' });
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const slide = presentSlide(await api.request('/slides/' + this.id));
      this.setData({
        slide,
        rating: slide.myReview?.rating || 5,
        content: slide.myReview?.content || '',
        markers: [
          {
            id: slide.id,
            latitude: slide.latitude,
            longitude: slide.longitude,
            iconPath: '/assets/marker.png',
            width: 38,
            height: 46,
          },
        ],
      });
      await this.loadReviews();
    } catch (error) {
      this.setData({ error: error.message, slide: null });
    } finally {
      this.setData({ loading: false });
    }
  },
  async loadReviews(more = false) {
    const result = await api.request(
      '/slides/' + this.id + '/reviews?' + api.query({ offset: more ? this.data.nextOffset : 0 }),
    );
    const items = result.items.map((r) => ({
      ...r,
      dateLabel: new Date(r.updatedAt).toLocaleDateString('zh-CN'),
      starLabel: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating),
    }));
    this.setData({ reviews: (more ? this.data.reviews : []).concat(items), nextOffset: result.nextOffset });
  },
  async more() {
    if (this.loadingMore || this.data.nextOffset === null) return;
    this.loadingMore = true;
    try {
      await this.loadReviews(true);
    } catch (error) {
      api.toast(error);
    } finally {
      this.loadingMore = false;
    }
  },
  navigate() {
    api.navigate(this.data.slide).catch(api.toast);
  },
  async favorite() {
    if (this.favoriting) return;
    this.favoriting = true;
    try {
      await api.ensureLogin();
      const slide = await api.request('/slides/' + this.id);
      await api.request('/slides/' + this.id + '/favorite', slide.isFavorite ? 'DELETE' : 'PUT');
      this.setData({ 'slide.isFavorite': !slide.isFavorite });
    } catch (error) {
      api.toast(error);
    } finally {
      this.favoriting = false;
    }
  },
  star(e) {
    this.setData({ rating: Number(e.currentTarget.dataset.value) });
  },
  content(e) {
    this.setData({ content: e.detail.value });
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const input = reviewInput(this.data);
      await api.ensureLogin();
      const slide = await api.request('/slides/' + this.id + '/reviews', 'PUT', input);
      this.setData({ slide: presentSlide(slide) });
      await this.loadReviews();
      wx.showToast({ title: '评价已保存', icon: 'success' });
    } catch (error) {
      api.toast(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async removeReview() {
    try {
      if (
        !(await api.invoke('showModal', { title: '删除我的评价？', content: '评分也会同时移除。' })).confirm
      )
        return;
      await api.request('/slides/' + this.id + '/reviews', 'DELETE');
      await this.load();
    } catch (error) {
      api.toast(error);
    }
  },
  edit() {
    wx.setStorageSync('slide-map-edit', this.id);
    wx.switchTab({ url: '/pages/publish/index' });
  },
  async remove() {
    try {
      if (
        !(
          await api.invoke('showModal', {
            title: '删除这座滑梯？',
            content: '关联的评价和收藏会一并删除，此操作不可撤销。',
            confirmText: '删除',
            confirmColor: '#a64535',
          })
        ).confirm
      )
        return;
      await api.request('/slides/' + this.id, 'DELETE');
      wx.switchTab({ url: '/pages/explore/index' });
    } catch (error) {
      api.toast(error);
    }
  },
  async report() {
    try {
      await api.ensureLogin();
      const reasons = ['位置不准确，无法找到', '设施已拆除或暂停开放', '信息失实或存在不当内容'];
      const choice = await api.invoke('showActionSheet', { itemList: reasons });
      await api.request('/slides/' + this.id + '/report', 'POST', { reason: reasons[choice.tapIndex] });
      wx.showToast({ title: '反馈已收到', icon: 'success' });
    } catch (error) {
      if (!/cancel/.test(error.errMsg || '')) api.toast(error);
    }
  },
  retry() {
    this.load();
  },
  onShareAppMessage() {
    return {
      title: this.data.slide ? this.data.slide.title + ' · 一起去滑滑梯！' : '滑滑梯地图',
      path: '/pages/detail/index?id=' + this.id,
    };
  },
});
