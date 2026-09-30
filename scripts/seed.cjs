function seed(store) {
  if (store.db.prepare('SELECT COUNT(*) AS n FROM slides').get().n) return;
  const author = store.login('demo-author', 'demo').user;
  store.updateProfile(author.id, '周末散步的人');
  const neighbors = [
    ['demo-explorer', '小叶子'],
    ['demo-neighbor', '公园观察员'],
  ].map(([openid, name]) => {
    const u = store.login(openid, 'demo').user;
    store.updateProfile(u.id, name);
    return u;
  });
  const samples = [
    [
      '树荫里的波浪滑梯',
      '演示 · 上海中心区域 A 点',
      31.232,
      121.47,
      '公园滑梯',
      '3–6岁',
      '免费',
      '一座藏在树荫下的黄色波浪滑梯，旁边有座椅，适合周末慢慢玩。此信息为虚构演示，请勿据此前往。',
      ['有遮阴', '有座椅', '软质地面'],
    ],
    [
      '小小探险家的秘密基地',
      '演示 · 上海中心区域 B 点',
      31.225,
      121.479,
      '社区滑梯',
      '1–3岁',
      '免费',
      '低矮的组合滑梯，落地处有软垫，家长可以在旁陪同。此信息为虚构演示，请勿据此前往。',
      ['软质地面', '有座椅'],
    ],
    [
      '雨天也能玩的彩虹乐园',
      '演示 · 上海中心区域 C 点',
      31.238,
      121.484,
      '室内乐园',
      '全年龄',
      '收费',
      '室内组合滑梯，进场前需要换袜子。开放时间与收费以现场为准。此信息为虚构演示，请勿据此前往。',
      ['有卫生间', '有停车位'],
    ],
    [
      '草地旁的旋转滑梯',
      '演示 · 上海中心区域 D 点',
      31.22,
      121.466,
      '公园滑梯',
      '6岁以上',
      '免费',
      '旋转滑梯与攀爬架相连，附近有开阔草坪。此信息为虚构演示，请勿据此前往。',
      ['有卫生间', '有座椅'],
    ],
  ];
  samples.forEach((a, i) => {
    const [title, address, latitude, longitude, type, ageBand, cost, description, amenities] = a;
    const s = store.createSlide(author.id, {
      title,
      address,
      latitude,
      longitude,
      type,
      ageBand,
      cost,
      description,
      amenities,
      openingHours: '演示 · 09:00–18:00',
    });
    neighbors.forEach((u, j) =>
      store.review(s.id, u.id, {
        rating: (i + j) % 3 === 0 ? 4 : 5,
        content: '演示评价：孩子玩得很开心，推荐在家长陪同下游玩。',
      }),
    );
  });
}
module.exports = { seed };
