const api = require('../../lib/api');
const { TYPES, AGES, COSTS, AMENITIES, slideInput } = require('../../lib/domain');
const blank = () => ({
  title: '',
  address: '',
  description: '',
  latitude: null,
  longitude: null,
  type: TYPES[1],
  ageBand: AGES[0],
  cost: COSTS[0],
  openingHours: '',
  amenities: [],
});
Page({
  data: {
    form: blank(),
    types: TYPES.slice(1),
    ages: AGES,
    costs: COSTS,
    amenities: AMENITIES.map((label) => ({ label, selected: false })),
    busy: false,
    error: '',
    editingId: null,
  },
  async onShow() {
    const id = wx.getStorageSync('slide-map-edit');
    if (id) {
      wx.removeStorageSync('slide-map-edit');
      try {
        const slide = await api.request('/slides/' + id);
        if (!slide.isOwner) throw new Error('只能编辑自己的分享');
        this.setData({ form: slide, editingId: id });
        this.syncAmenities();
      } catch (error) {
        api.toast(error);
      }
    } else if (!this.restored && !this.data.editingId) {
      this.restored = true;
      const draft = wx.getStorageSync('slide-map-draft');
      if (draft) {
        this.setData({ form: { ...blank(), ...draft } });
        this.syncAmenities();
      }
    }
  },
  onHide() {
    this.saveDraft();
  },
  saveDraft() {
    if (!this.data.editingId) wx.setStorageSync('slide-map-draft', this.data.form);
  },
  syncAmenities() {
    this.setData({
      amenities: AMENITIES.map((label) => ({ label, selected: this.data.form.amenities.includes(label) })),
    });
  },
  input(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
    this.saveDraft();
  },
  select(e) {
    const field = e.currentTarget.dataset.field,
      values = { type: this.data.types, ageBand: this.data.ages, cost: this.data.costs };
    this.setData({ ['form.' + field]: values[field][Number(e.detail.value)] });
    this.saveDraft();
  },
  amenity(e) {
    const label = e.currentTarget.dataset.value,
      current = this.data.form.amenities;
    this.setData({
      'form.amenities': current.includes(label) ? current.filter((a) => a !== label) : current.concat(label),
    });
    this.syncAmenities();
    this.saveDraft();
  },
  async choose() {
    try {
      const place = await api.location(
        'chooseLocation',
        this.data.form.latitude === null
          ? {}
          : { latitude: this.data.form.latitude, longitude: this.data.form.longitude },
      );
      if (!place) return;
      this.setData({
        'form.latitude': place.latitude,
        'form.longitude': place.longitude,
        'form.address': place.address || place.name,
        'form.title': this.data.form.title || place.name,
      });
      this.saveDraft();
    } catch (error) {
      api.toast(error);
    }
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const input = slideInput(this.data.form);
      await api.ensureLogin();
      const id = this.data.editingId;
      const slide = await api.request(id ? '/slides/' + id : '/slides', id ? 'PUT' : 'POST', input);
      wx.removeStorageSync('slide-map-draft');
      this.setData({ form: blank(), editingId: null });
      this.syncAmenities();
      wx.showToast({ title: id ? '已更新' : '已分享，感谢你！', icon: 'success' });
      wx.navigateTo({ url: '/pages/detail/index?id=' + slide.id });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  cancelEdit() {
    this.setData({ form: blank(), editingId: null, error: '' });
    this.syncAmenities();
  },
});
