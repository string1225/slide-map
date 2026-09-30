const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const types = ['全部', '公园滑梯', '社区滑梯', '室内乐园', '其他'];
const state = {
  items: [],
  type: '全部',
  free: false,
  q: '',
  sort: 'rating',
  scope: '',
  selected: null,
  session: JSON.parse(localStorage.getItem('slide-demo-session') || 'null'),
};
let requestVersion = 0,
  detailVersion = 0;
async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.session ? { Authorization: 'Bearer ' + state.session.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      state.session = null;
      localStorage.removeItem('slide-demo-session');
      account();
    }
    throw new Error(data.message || '请求失败');
  }
  return data;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}
function modal(html) {
  $('#modal-body').innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
}
function close() {
  detailVersion++;
  $('#modal').close();
}
function account() {
  $('#account-name').textContent = state.session?.user.nickname || '你好，探索者';
}
async function login(persona = 'explorer') {
  state.session = null;
  localStorage.removeItem('slide-demo-session');
  state.session = await api('/auth/demo', 'POST', { persona });
  localStorage.setItem('slide-demo-session', JSON.stringify(state.session));
  account();
  toast('已进入本机演示账号');
}
async function ensureLogin() {
  if (!state.session) await login();
}
function rating(s) {
  return s.reviewCount ? Number(s.rating).toFixed(1) : '暂无';
}
function tags(s) {
  return [s.type, s.ageBand, s.cost].map((t) => `<span class="tag">${escape(t)}</span>`).join('');
}
async function load() {
  const version = ++requestVersion;
  $('#list').innerHTML = '<div class="empty">正在寻找快乐…</div>';
  try {
    const query = new URLSearchParams({ sort: state.sort, limit: '100' });
    if (state.q) query.set('q', state.q);
    if (state.type !== '全部') query.set('type', state.type);
    if (state.free) query.set('cost', '免费');
    if (state.scope) query.set('scope', state.scope);
    const result = await api('/slides?' + query);
    if (version !== requestVersion) return;
    state.items = result.items;
    if (!state.items.some((s) => s.id === state.selected)) state.selected = state.items[0]?.id;
    $('#count').textContent = result.total;
    render();
  } catch (error) {
    if (version === requestVersion)
      $('#list').innerHTML =
        `<div class="empty error">${escape(error.message)}<br><button data-action="reload">重新加载</button></div>`;
  }
}
function render() {
  $('#filters').innerHTML = types
    .map(
      (t) =>
        `<button class="filter ${state.type === t ? 'active' : ''}" data-action="type" data-value="${t}">${t}</button>`,
    )
    .join('');
  $('#list').innerHTML =
    state.items
      .map(
        (s) =>
          `<article class="place ${state.selected === s.id ? 'selected' : ''}" data-action="detail" data-id="${s.id}" tabindex="0" role="button" aria-label="查看${escape(s.title)}"><div class="place-top"><div class="place-art">${s.type === '室内乐园' ? '⌂' : '↝'}</div><div><h3>${escape(s.title)}</h3><span class="rating">★ ${rating(s)}<small>${s.reviewCount} 条评价</small></span></div></div><div class="address">⌾ ${escape(s.address)}</div><div class="tags">${tags(s)}</div><div class="place-bottom"><span>${escape(s.creatorName)} 分享</span><span>看看详情 ↗</span></div></article>`,
      )
      .join('') || '<div class="empty">这里的快乐，还等你发现。<br>换个关键词试试，或分享一座滑梯。</div>';
  $('#markers').innerHTML = state.items
    .map((s, i) => {
      const x = Math.max(14, Math.min(84, 20 + (s.longitude - 121.46) * 2200)),
        y = Math.max(27, Math.min(70, 72 - (s.latitude - 31.22) * 2200));
      return `<button class="marker ${s.id === state.selected ? 'selected' : ''}" data-action="select" data-id="${s.id}" style="left:${x}%;top:${y}%" aria-label="地图标记：${escape(s.title)}"><span>↝</span><div class="tooltip">${escape(s.title)}　★ ${rating(s)}</div></button>`;
    })
    .join('');
}
async function detail(id) {
  const version = ++detailVersion;
  const [s, reviews] = await Promise.all([api('/slides/' + id), api('/slides/' + id + '/reviews?limit=100')]);
  if (version !== detailVersion) return;
  state.selected = id;
  render();
  modal(
    `<div class="eyebrow">A PLACE FOR LITTLE ADVENTURES</div><h2>${escape(s.title)}</h2><p>${escape(s.address)}</p><div class="tags">${tags(s)}<span class="tag">★ ${rating(s)} · ${s.reviewCount} 条评价</span></div><div class="actions"><button class="primary" data-action="navigate">↗ 一键导航</button><button class="ghost" data-action="favorite" data-id="${id}" data-enabled="${!s.isFavorite}">${s.isFavorite ? '♥ 已收藏' : '♡ 收藏'}</button></div><div class="hint">这是虚构演示地点。真实小程序中点击「一键导航」会打开微信地图并选择路线。</div><div class="info-grid"><div><small>适合年龄</small>${escape(s.ageBand)}</div><div><small>开放时间</small>${escape(s.openingHours)}</div></div><h3>关于这座滑梯</h3><div class="description">${escape(s.description)}</div><p class="muted">${escape(s.creatorName)} · ${new Date(s.createdAt).toLocaleDateString()}</p>${s.isOwner ? `<div class="actions"><button class="ghost" data-action="edit" data-id="${id}">编辑分享</button><button class="danger" data-action="delete" data-id="${id}">删除分享</button></div>` : ''}<h3>大家的体验 · ${s.reviewCount}</h3>${reviews.items.map((r) => `<div class="review"><div class="review-head"><strong>${escape(r.nickname)}</strong><span class="rating">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span></div><p>${escape(r.content)}</p></div>`).join('') || '<p>还没有评价，期待你的第一次探访。</p>'}${!s.isOwner ? `<form id="review-form" data-id="${id}"><h3>${s.myReview ? '更新我的评价' : '你玩得开心吗？'}</h3><div class="stars-input">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}" ${n === (s.myReview?.rating || 5) ? 'checked' : ''}>${n}★</label>`).join('')}</div><label class="field">分享真实体验<textarea name="content" minlength="5" maxlength="500" required placeholder="给下一个家庭一点参考（至少5个字）">${escape(s.myReview?.content || '')}</textarea></label><button class="primary full">${s.myReview ? '更新评价' : '提交评分与评价'}</button>${s.myReview ? `<button type="button" class="ghost full" data-action="delete-review" data-id="${id}">删除我的评价</button>` : ''}</form>` : '<div class="hint">这是你分享的滑梯，期待其他探索者来评分。</div>'}<div class="actions"><button class="ghost" data-action="report" data-id="${id}">反馈地点信息</button></div>`,
  );
}
function selectOptions(values, current) {
  return values.map((v) => `<option ${v === current ? 'selected' : ''}>${escape(v)}</option>`).join('');
}
async function publish(id) {
  const s = id
    ? await api('/slides/' + id)
    : {
        title: '',
        address: '',
        description: '',
        latitude: 31.23,
        longitude: 121.474,
        type: types[1],
        ageBand: '全年龄',
        cost: '免费',
        openingHours: '',
      };
  modal(
    `<div class="eyebrow">SHARE A LITTLE JOY</div><h2>${id ? '更新这份快乐' : '好玩的滑梯，值得被找到。'}</h2><p>留下准确位置，让下一位探索者少走弯路。</p><div class="hint">浏览器使用独立演示账号与数据。正式小程序可直接在腾讯地图上选点。</div><form id="publish-form" data-id="${id || ''}"><label class="field">滑梯名称 *<input name="title" minlength="2" maxlength="40" required value="${escape(s.title)}" placeholder="例如：树荫里的波浪滑梯"></label><label class="field">详细地址 *<input name="address" minlength="2" maxlength="160" required value="${escape(s.address)}" placeholder="演示地点地址"></label><div class="form-row"><label class="field">纬度（GCJ-02）<input name="latitude" type="number" min="-90" max="90" step="any" required value="${s.latitude}"></label><label class="field">经度（GCJ-02）<input name="longitude" type="number" min="-180" max="180" step="any" required value="${s.longitude}"></label></div><div class="form-row"><label class="field">场地类型<select name="type">${selectOptions(types.slice(1), s.type)}</select></label><label class="field">适合年龄<select name="ageBand">${selectOptions(['全年龄', '1–3岁', '3–6岁', '6岁以上'], s.ageBand)}</select></label></div><div class="form-row"><label class="field">收费情况<select name="cost">${selectOptions(['免费', '收费'], s.cost)}</select></label><label class="field">开放时间<input name="openingHours" maxlength="80" value="${escape(s.openingHours)}" placeholder="以现场公示为准"></label></div><label class="field">分享你的发现 *<textarea name="description" minlength="5" maxlength="1000" required placeholder="滑梯是什么样的？有什么到访小贴士？">${escape(s.description)}</textarea></label><button class="primary full">${id ? '保存更新' : '＋ 把快乐标在地图上'}</button></form>`,
  );
  $('#publish-form').dataset.amenities = JSON.stringify(s.amenities || []);
}
async function profile() {
  const me = state.session ? await api('/me') : null;
  modal(
    `<div class="profile-name"><img src="/assets/logo.png" class="brand-preview" alt="滑滑梯地图"><div><div class="eyebrow">MY LITTLE ADVENTURES</div><h2>${escape(me?.nickname || '你好，探索者')}</h2></div></div><p>收藏快乐，分享发现。</p><div class="hint">本地演示无需真实微信登录。可切换两个独立账号验证分享归属、评分与收藏。正式小程序通过 wx.login 识别微信身份。</div><div class="profile-options"><button class="primary" data-action="login" data-persona="explorer">体验账号：小叶子</button><button class="ghost" data-action="login" data-persona="neighbor">体验账号：邻居</button></div>${me ? `<div class="info-grid"><div><small>我的分享</small>${me.shares}</div><div><small>我的评价 / 收藏</small>${me.reviews} / ${me.favorites}</div></div><form id="profile-form"><label class="field">公开昵称<input name="nickname" minlength="2" maxlength="24" required value="${escape(me.nickname)}"></label><button class="primary full">保存昵称</button></form><div class="actions"><button class="ghost" data-action="logout">退出演示账号</button></div>` : ''}`,
  );
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action,
    id = Number(button.dataset.id);
  button.disabled = true;
  try {
    if (action === 'close') close();
    else if (action === 'reload') await load();
    else if (action === 'scope') {
      if (button.dataset.scope) await ensureLogin();
      state.scope = button.dataset.scope;
      document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n === button));
      await load();
    } else if (action === 'type') {
      state.type = button.dataset.value;
      await load();
    } else if (action === 'free') {
      state.free = !state.free;
      button.classList.toggle('on', state.free);
      button.innerHTML = '免费开放 ' + (state.free ? '✓' : '○');
      await load();
    } else if (action === 'sort') {
      state.sort = state.sort === 'rating' ? 'newest' : 'rating';
      button.textContent = (state.sort === 'rating' ? '评分优先' : '最新分享') + ' ⇅';
      await load();
    } else if (action === 'select') {
      state.selected = id;
      render();
      $('#list .selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (action === 'detail') await detail(id);
    else if (action === 'publish') await publish();
    else if (action === 'edit') await publish(id);
    else if (action === 'navigate') toast('虚构地点不提供导航；正式小程序会打开微信地图');
    else if (action === 'favorite') {
      await ensureLogin();
      await api('/slides/' + id + '/favorite', button.dataset.enabled === 'true' ? 'PUT' : 'DELETE', {});
      await detail(id);
    } else if (action === 'delete') {
      if (confirm('删除此分享及关联评价、收藏？')) {
        await api('/slides/' + id, 'DELETE');
        close();
        await load();
        toast('已删除分享');
      }
    } else if (action === 'delete-review') {
      await api('/slides/' + id + '/reviews', 'DELETE');
      await detail(id);
      await load();
      toast('已删除评价');
    } else if (action === 'report') {
      await ensureLogin();
      await api('/slides/' + id + '/report', 'POST', { reason: '演示反馈：地点信息需要核实' });
      toast('反馈已收到');
    } else if (action === 'profile') await profile();
    else if (action === 'login') {
      await login(button.dataset.persona);
      await profile();
      await load();
    } else if (action === 'logout') {
      await api('/auth/logout', 'POST', {});
      state.session = null;
      localStorage.removeItem('slide-demo-session');
      account();
      close();
      state.scope = '';
      document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', !n.dataset.scope));
      await load();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target,
    values = Object.fromEntries(new FormData(form)),
    button = form.querySelector('button[type="submit"],button:not([type])');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (form.id === 'search-form') {
      state.q = values.q.trim();
      await load();
    } else if (form.id === 'publish-form') {
      await ensureLogin();
      const id = form.dataset.id,
        s = await api(id ? '/slides/' + id : '/slides', id ? 'PUT' : 'POST', {
          ...values,
          latitude: Number(values.latitude),
          longitude: Number(values.longitude),
          amenities: JSON.parse(form.dataset.amenities),
        });
      await load();
      await detail(s.id);
      toast(id ? '分享已更新' : '已把快乐标在地图上');
    } else if (form.id === 'review-form') {
      await ensureLogin();
      await api('/slides/' + form.dataset.id + '/reviews', 'PUT', {
        rating: Number(values.rating),
        content: values.content,
      });
      await detail(Number(form.dataset.id));
      await load();
      toast('评分与评价已保存');
    } else if (form.id === 'profile-form') {
      const me = await api('/me', 'PATCH', values);
      state.session.user = me;
      localStorage.setItem('slide-demo-session', JSON.stringify(state.session));
      account();
      toast('昵称已更新');
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-action]')) {
    e.preventDefault();
    e.target.click();
  }
});
$('#modal').addEventListener('cancel', () => detailVersion++);
account();
render();
load();
