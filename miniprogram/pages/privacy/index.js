const config = require('../../config');
Page({
  data: { supportEmail: config.supportEmail },
  open() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '请在小程序后台配置隐私保护指引', icon: 'none' }),
    });
  },
});
