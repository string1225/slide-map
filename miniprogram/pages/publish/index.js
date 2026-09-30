const api = require('../../lib/api');
const { TYPES, AGES, COSTS, AMENITIES, PARKING, slideInput } = require('../../lib/domain');
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
  photos: [],
  parking: '',
  parkingAddress: '',
  parkingLocation: null,
  traffic: '',
});
Page({
  data: {
    form: blank(),
    types: TYPES.slice(1),
    ages: AGES,
    costs: COSTS,
    parkingOptions: PARKING,
    photos: [],
    loggedIn: false,
    photoBusy: false,
    amenities: AMENITIES.map((label) => ({ label, selected: false })),
    busy: false,
    error: '',
    editingId: null,
  },
  async onShow() {
    this.setData({ loggedIn: !!api.session() });
    const id = wx.getStorageSync('slide-map-edit');
    if (id) {
      wx.removeStorageSync('slide-map-edit');
      try {
        const slide = await api.request('/slides/' + id);
        if (!slide.isOwner) throw new Error('只能编辑自己的分享');
        this.setData({
          form: slide,
          photos: slide.photos.map((id) => ({ id, path: api.photoUrl(id) })),
          editingId: id,
        });
        this.syncAmenities();
      } catch (error) {
        api.toast(error);
      }
    } else if (!this.restored && !this.data.editingId) {
      this.restored = true;
      const draft = wx.getStorageSync('slide-map-draft');
      if (draft) {
        this.setData({ form: { ...blank(), ...draft }, photos: draft.photoFiles || [] });
        this.syncAmenities();
      }
    }
  },
  onHide() {
    this.saveDraft();
  },
  saveDraft() {
    if (!this.data.editingId)
      wx.setStorageSync('slide-map-draft', { ...this.data.form, photoFiles: this.data.photos });
  },
  syncAmenities() {
    this.setData({
      amenities: AMENITIES.map((label) => ({ label, selected: this.data.form.amenities.includes(label) })),
    });
  },
  input(e) {
    if (this.data.busy) return;
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
    if (e.currentTarget.dataset.field === 'parkingAddress') this.setData({ 'form.parkingLocation': null });
    this.saveDraft();
  },
  select(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field,
      values = { type: this.data.types, ageBand: this.data.ages, cost: this.data.costs };
    this.setData({ ['form.' + field]: values[field][Number(e.detail.value)] });
    this.saveDraft();
  },
  amenity(e) {
    if (this.data.busy) return;
    const label = e.currentTarget.dataset.value,
      current = this.data.form.amenities.filter(
        (a) =>
          !(
            (label === '座椅多' && a === '座椅少') ||
            (label === '座椅少' && a === '座椅多') ||
            a === '有座椅'
          ),
      );
    this.setData({
      'form.amenities': current.includes(label) ? current.filter((a) => a !== label) : current.concat(label),
    });
    this.syncAmenities();
    this.saveDraft();
  },
  parking(e) {
    if (this.data.busy) return;
    const value = e.currentTarget.dataset.value;
    this.setData({ 'form.parking': this.data.form.parking === value ? '' : value });
    this.saveDraft();
  },
  async chooseParking() {
    if (this.data.busy) return;
    try {
      const point =
        this.data.form.parkingLocation ||
        (this.data.form.latitude !== null
          ? { latitude: this.data.form.latitude, longitude: this.data.form.longitude }
          : {});
      const place = await api.location('chooseLocation', point);
      if (!place) return;
      this.setData({
        'form.parkingAddress': [place.name, place.address].filter(Boolean).join(' · ').slice(0, 160),
        'form.parkingLocation': { latitude: place.latitude, longitude: place.longitude },
      });
      this.saveDraft();
    } catch (error) {
      api.toast(error);
    }
  },
  async addPhotos() {
    if (this.data.photoBusy || this.data.busy || this.data.photos.length >= 6) return;
    this.setData({ photoBusy: true, error: '' });
    try {
      await api.privacy();
      const result = await api.invoke('chooseMedia', {
        count: 6 - this.data.photos.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });
      for (const file of result.tempFiles) {
        if (this.data.photos.length >= 6) break;
        if (file.size > 8 * 1024 * 1024) throw new Error('请选择8MB以内的照片');
        const saved = await new Promise((resolve, reject) =>
          wx
            .getFileSystemManager()
            .saveFile({ tempFilePath: file.tempFilePath, success: resolve, fail: reject }),
        );
        this.setData({ photos: this.data.photos.concat({ path: saved.savedFilePath }) });
        this.saveDraft();
      }
    } catch (error) {
      if (!/cancel/.test(error.errMsg || '')) this.setData({ error: api.message(error) });
    } finally {
      this.setData({ photoBusy: false });
    }
  },
  previewPhoto(e) {
    wx.previewImage({
      urls: this.data.photos.map((p) => p.path),
      current: this.data.photos[Number(e.currentTarget.dataset.index)].path,
    });
  },
  removePhoto(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget.dataset.index);
    const photo = this.data.photos[index];
    if (photo.path && !/^https?:/.test(photo.path))
      wx.getFileSystemManager().removeSavedFile({ filePath: photo.path });
    this.setData({ photos: this.data.photos.filter((p, i) => i !== index) });
    this.saveDraft();
  },
  async choose() {
    if (this.data.busy) return;
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
    if (this.data.busy || this.data.photoBusy) return;
    this.setData({ busy: true, error: '' });
    try {
      await api.ensureLogin();
      this.setData({ loggedIn: true });
      const input = slideInput({ ...this.data.form, photos: [] });
      if (this.data.photos.length > 6) throw new Error('最多上传6张照片');
      for (let i = 0; i < this.data.photos.length; i++) {
        const photo = this.data.photos[i];
        if (!photo.id) {
          const result = await api.uploadPhoto(photo.path);
          const photos = this.data.photos.slice();
          photos[i] = { ...photo, id: result.id };
          this.setData({ photos });
          this.saveDraft();
        }
      }
      input.photos = this.data.photos.map((p) => p.id);
      const id = this.data.editingId;
      const slide = await api.request(id ? '/slides/' + id : '/slides', id ? 'PUT' : 'POST', input);
      wx.removeStorageSync('slide-map-draft');
      for (const photo of this.data.photos)
        if (!/^https?:/.test(photo.path)) wx.getFileSystemManager().removeSavedFile({ filePath: photo.path });
      this.setData({ form: blank(), photos: [], editingId: null });
      this.syncAmenities();
      wx.showToast({ title: id ? '已更新' : '已分享，感谢你！', icon: 'success' });
      wx.navigateTo({ url: '/pages/detail/index?id=' + slide.id });
    } catch (error) {
      this.setData({ error: api.message(error), loggedIn: !!api.session() });
      this.saveDraft();
    } finally {
      this.setData({ busy: false });
    }
  },
  cancelEdit() {
    if (this.data.busy) return;
    for (const photo of this.data.photos)
      if (!/^https?:/.test(photo.path)) wx.getFileSystemManager().removeSavedFile({ filePath: photo.path });
    this.setData({ form: blank(), photos: [], editingId: null, error: '' });
    this.syncAmenities();
  },
});
