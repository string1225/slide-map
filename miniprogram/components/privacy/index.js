Component({
  data: { visible: false },
  methods: {
    request(resolve) {
      if (this.resolvePrivacy) this.resolvePrivacy({ event: 'disagree' });
      this.resolvePrivacy = resolve;
      this.setData({ visible: true });
    },
    agree() {
      if (this.resolvePrivacy) this.resolvePrivacy({ event: 'agree', buttonId: 'agree-privacy' });
      this.resolvePrivacy = null;
      this.setData({ visible: false });
    },
    reject() {
      if (this.resolvePrivacy) this.resolvePrivacy({ event: 'disagree' });
      this.resolvePrivacy = null;
      this.setData({ visible: false });
    },
    open() {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: '/pages/privacy/index' }) });
    },
  },
  lifetimes: {
    detached() {
      if (this.resolvePrivacy) this.resolvePrivacy({ event: 'disagree' });
    },
  },
});
