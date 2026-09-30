App({
  onLaunch() {
    if (wx.onNeedPrivacyAuthorization)
      wx.onNeedPrivacyAuthorization((resolve) => {
        const pages = getCurrentPages(),
          page = pages[pages.length - 1];
        const dialog = page && page.selectComponent('#privacy');
        if (dialog) dialog.request(resolve);
        else resolve({ event: 'disagree' });
      });
  },
});
