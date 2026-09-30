const api = require('../../lib/api');
const { TYPES, presentSlide, distanceKm } = require('../../lib/domain');
const config = require('../../config');
Page({
  data: {
    mapKey: config.tencentMapKey,
    types: TYPES,
    type: '全部',
    query: '',
    free: false,
    sort: 'distance',
    view: 'map',
    latitude: 31.2304,
    longitude: 121.4737,
    radius: 10,
    located: false,
    items: [],
    markers: [],
    total: 0,
    nextOffset: null,
    loading: false,
    error: '',
    selected: null,
    areaChanged: false,
  },
  onShow() {
    this.load();
  },
  onUnload() {
    this.sequence = (this.sequence || 0) + 1;
  },
  onReady() {
    this.map = wx.createMapContext('slides-map', this);
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load(more = false) {
    if (more && (this.data.loading || this.data.nextOffset === null)) return;
    const sequence = (this.sequence = (this.sequence || 0) + 1);
    this.setData({ loading: true, error: '' });
    try {
      const d = this.data;
      const result = await api.request(
        '/slides?' +
          api.query({
            q: d.query,
            type: d.type === '全部' ? undefined : d.type,
            cost: d.free ? '免费' : undefined,
            sort: d.sort,
            latitude: d.query ? undefined : d.latitude,
            longitude: d.query ? undefined : d.longitude,
            radius: d.radius,
            offset: more ? d.nextOffset : 0,
            limit: 30,
          }),
      );
      if (sequence !== this.sequence) return;
      const items = (more ? d.items : []).concat(result.items.map(presentSlide));
      this.setData({
        items,
        total: result.total,
        nextOffset: result.nextOffset,
        selected: items[0] || null,
        areaChanged: false,
        markers: items.map((s) => ({
          id: s.id,
          latitude: s.latitude,
          longitude: s.longitude,
          iconPath: '/assets/marker.png',
          width: 38,
          height: 46,
          callout: {
            content: s.title,
            display: 'BYCLICK',
            padding: 10,
            borderRadius: 8,
            color: '#205b46',
            fontSize: 13,
          },
        })),
      });
      if (d.query && items.length && this.map)
        this.map.includePoints({
          points: items.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
          padding: [50, 40, 60, 40],
        });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ error: error.message });
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  retry() {
    this.load();
  },
  more() {
    this.load(true);
  },
  input(e) {
    this.setData({ query: e.detail.value });
  },
  search() {
    this.load();
  },
  type(e) {
    this.setData({ type: e.currentTarget.dataset.value });
    this.load();
  },
  free() {
    this.setData({ free: !this.data.free });
    this.load();
  },
  toggleView() {
    this.setData({ view: this.data.view === 'map' ? 'list' : 'map' });
  },
  sort() {
    this.setData({ sort: this.data.sort === 'rating' ? 'distance' : 'rating' });
    this.load();
  },
  marker(e) {
    this.setData({ selected: this.data.items.find((s) => s.id === e.detail.markerId) || null });
  },
  detail(e) {
    const id = e.currentTarget.dataset.id || e.detail.markerId;
    wx.navigateTo({ url: '/pages/detail/index?id=' + id });
  },
  async locate() {
    try {
      const point = await api.location('getLocation', { type: 'gcj02' });
      if (!point) return;
      this.setData({
        latitude: point.latitude,
        longitude: point.longitude,
        located: true,
        query: '',
        radius: 10,
      });
      await this.load();
    } catch (error) {
      api.toast(error);
    }
  },
  region(e) {
    const detail = e.detail || e;
    if ((detail.type || e.type) === 'end' && ['drag', 'scale'].includes(detail.causedBy || e.causedBy))
      this.setData({ areaChanged: true });
  },
  searchArea() {
    if (!this.map) return;
    this.map.getCenterLocation({
      success: (point) => {
        this.map.getRegion({
          success: (region) => {
            const radius = Math.max(
              0.2,
              Math.min(
                100,
                distanceKm(
                  point.latitude,
                  point.longitude,
                  region.northeast.latitude,
                  region.northeast.longitude,
                ),
              ),
            );
            this.setData({ latitude: point.latitude, longitude: point.longitude, radius, query: '' });
            this.load();
          },
          fail: () => {
            this.setData({ latitude: point.latitude, longitude: point.longitude, query: '' });
            this.load();
          },
        });
      },
    });
  },
  navigate() {
    if (this.data.selected) api.navigate(this.data.selected).catch(api.toast);
  },
  publish() {
    wx.switchTab({ url: '/pages/publish/index' });
  },
  onShareAppMessage() {
    return { title: '滑滑梯地图 · 一起发现下一处快乐', path: '/pages/explore/index' };
  },
});
