/* ============================================================
   EduFlow · Teacher Dashboard — front-end application
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

const state = {
  me: null,
  timetable: null,
  subjects: [],
  teachers: [],
  requests: [],
  covers: [],
  stats: null,
  view: 'overview',
  editing: null,    // admin timetable being edited (unsaved)
  ttClass: null,    // admin timetable: currently edited class
  reqTab: 'pending',
  reqPrefill: null,  // { day, period, reason } — pre-fill the request form from a class call
  callTimer: null,   // auto-dismiss timer for the class-call banner
  messages: [],      // admin <-> teacher direct messages (realtime)
  signal: {          // ESP32 signal monitor
    history: [],     // newest first
    senders: [],     // senderID → class mapping (admin configurable)
    masterLastSeen: null,
    active: null,    // signal currently flashing on the indicator
    timer: null,
    streamOpen: false,
  },
};

let signalStream = null; // EventSource for the ESP32 signal feed

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  swap: '<path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  pencil: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 12v4c0 1.5 2.7 2.5 6 2.5s6-1 6-2.5v-4"/><line x1="22" y1="9" x2="22" y2="15"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  chev: '<polyline points="9 18 15 12 9 6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
};

function icon(name, size = 18, stroke = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) +
      ' · ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function todayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ------------------------------------------------------------
   API + toasts + modals
   ------------------------------------------------------------ */

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the server. Is it running?');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(msg, type = 'success', ms = 3400) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ic = type === 'success' ? 'check' : type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'info';
  el.innerHTML = `${icon(ic, 17)}<div>${esc(msg)}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, ms);
}

function openModal(html, maxWidth) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-close="1"><div class="modal" style="${maxWidth ? `max-width:${maxWidth}px` : ''}">${html}</div></div>`;
  root.querySelector('[data-close]').addEventListener('click', (e) => {
    if (e.target.dataset.close) closeModal();
  });
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', onModalKey);
  return root.querySelector('.modal');
}

function onModalKey(e) {
  if (e.key === 'Escape') closeModal();
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  document.removeEventListener('keydown', onModalKey);
}

function confirmModal({ title, body, confirmText = 'Confirm', danger = false, onConfirm }) {
  const btnClass = danger ? 'btn-danger' : 'btn-primary';
  openModal(`
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      <div style="font-size:13.5px;color:#475569;line-height:1.6">${body || ''}</div>
      <div class="row-flex" style="justify-content:flex-end;margin-top:20px;gap:10px">
        <button class="btn btn-secondary" data-cancel type="button">Cancel</button>
        <button class="btn ${btnClass}" data-yes type="button">${esc(confirmText)}</button>
      </div>
    </div>`);
  const m = $('#modal-root .modal');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-yes]').addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

/* ------------------------------------------------------------
   Boot / auth
   ------------------------------------------------------------ */

async function boot() {
  try {
    state.me = (await api('/api/me')).user;
  } catch (e) {
    renderLogin();
    return;
  }
  await loadData();
  renderApp();
}

async function loadData() {
  try {
    const [tt, reqs, msgs] = await Promise.all([api('/api/timetable'), api('/api/requests'), api('/api/messages')]);
    state.timetable = tt.timetable;
    state.subjects = (tt.timetable && tt.timetable.subjects) || [];
    state.requests = reqs.requests;
    state.messages = (msgs && msgs.messages) || [];
    // Signal monitor state (senders config + history) so the page renders
    // correctly before the first SSE 'state' frame arrives.
    try {
      const sig = await api('/api/signal/history');
      state.signal.senders = sig.senders || [];
      state.signal.history = sig.history || [];
      state.signal.masterLastSeen = (sig.master && sig.master.lastSeenAt) || null;
    } catch (e) { /* signal monitor optional */ }
    if (state.me.role === 'admin') {
      const [teachers, stats] = await Promise.all([api('/api/teachers'), api('/api/stats')]);
      state.teachers = teachers.teachers;
      state.stats = stats.stats;
    } else {
      state.stats = null;
      // Cover duties are requests by OTHER teachers assigned to me —
      // they come from /api/covers, not from my own request list.
      state.covers = (await api('/api/covers')).covers;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function refresh() {
  await loadData();
  renderApp();
}

function renderApp() {
  if (!state.me) return;
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  renderSidebar();
  renderTopbar();
  renderContent();
  ensureSignalStream();
  ensureDataStream();
}

function showView(v) {
  state.view = v;
  renderApp();
}

/* ------------------------------------------------------------
   Login
   ------------------------------------------------------------ */

function renderLogin() {
  const v = $('#login-view');
  v.classList.remove('hidden');
  $('#app-view').classList.add('hidden');
  v.innerHTML = `
  <div class="login-wrap">
    <div class="login-hero">
      <div class="brand"><span class="brand-badge">${icon('cap', 22)}</span> EduFlow</div>
      <h1>Teacher management,<br/><span class="grad">made effortless.</span></h1>
      <p class="lead">One dashboard for the whole staff — timetables, substitution requests and automatic cover assignment, all in one place.</p>
      <div class="login-feats">
        <div class="login-feat"><span class="ico">${icon('book', 17)}</span><div><b>Excel timetable upload</b><span>Drop your weekly timetable and every teacher sees their own schedule instantly.</span></div></div>
        <div class="login-feat"><span class="ico">${icon('swap', 17)}</span><div><b>Smart substitution</b><span>Request a period off — the system auto-assigns the best free teacher when the admin approves.</span></div></div>
        <div class="login-feat"><span class="ico">${icon('shield', 17)}</span><div><b>Role-based access</b><span>Admins manage staff &amp; approvals; teachers get their personal dashboard.</span></div></div>
      </div>
    </div>
    <div class="login-panel">
      <div class="login-card">
        <h2>Welcome back</h2>
        <p class="sub">Sign in to continue to your dashboard.</p>
        <div class="form-error" id="login-error"></div>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="l-username">Username</label>
            <div class="input-with-icon">${icon('user', 17)}<input id="l-username" name="username" autocomplete="username" placeholder="e.g. admin" required /></div>
          </div>
          <div class="field">
            <label for="l-password">Password</label>
            <div class="input-with-icon">
              ${icon('lock', 17)}
              <input id="l-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required style="padding-right:40px" />
              <button type="button" id="l-eye" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#94a3b8;cursor:pointer;display:grid;place-items:center;padding:4px">${icon('eye', 16)}</button>
            </div>
          </div>
          <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;padding:12px" id="l-submit">Sign in</button>
        </form>
        <p class="sub" style="margin:16px 0 0;text-align:center">First run? The initial account is <b>admin</b> / <b>admin123</b>.</p>
      </div>
    </div>
  </div>`;

  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await doLogin();
  });

  const eye = $('#l-eye');
  eye.addEventListener('click', () => {
    const p = $('#l-password');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    eye.innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
  });

  setTimeout(() => $('#l-username').focus(), 120);
}

async function doLogin() {
  const errBox = $('#login-error');
  const btn = $('#l-submit');
  errBox.classList.remove('show');
  const username = $('#l-username').value.trim();
  const password = $('#l-password').value;
  if (!username || !password) {
    errBox.textContent = 'Please enter your username and password.';
    errBox.classList.add('show');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    state.me = res.user;
    await loadData();
    renderApp();
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Sign in';
  }
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  if (signalStream) { signalStream.close(); signalStream = null; }
  if (dataStream) { dataStream.close(); dataStream = null; }
  state.signal.streamOpen = false;
  state.me = null;
  renderLogin();
}

/* ------------------------------------------------------------
   Shell: sidebar + topbar
   ------------------------------------------------------------ */

function renderSidebar() {
  const me = state.me;
  const isAdmin = me.role === 'admin';
  const pending = isAdmin
    ? (state.stats ? state.stats.pending + state.stats.needsAssignment : 0)
    : state.requests.filter((r) => r.status === 'pending').length;
  const covers = coversForMe().length;
  const unread = (state.messages || []).filter((m) => m.toId === me.id && !m.readAt).length;

  // Signal Monitor is admin-only (the class-call alerts still reach teachers
  // via the SSE stream even though the monitor page itself is hidden).
  const teacherNav = [
    { id: 'overview', label: 'Dashboard', ic: 'grid' },
    { id: 'timetable', label: 'My Timetable', ic: 'book' },
    { id: 'requests', label: 'Requests', ic: 'list', count: pending },
    { id: 'covers', label: 'Cover Duties', ic: 'repeat', count: covers },
    { id: 'messages', label: 'Messages', ic: 'inbox', count: unread },
  ];
  const adminNav = [
    { id: 'overview', label: 'Dashboard', ic: 'grid', count: pending },
    { id: 'teachers', label: 'Teachers', ic: 'users' },
    { id: 'timetable', label: 'Timetable', ic: 'book' },
    { id: 'requests', label: 'Requests', ic: 'list', count: pending },
    { id: 'messages', label: 'Messages', ic: 'inbox', count: unread },
    { id: 'signals', label: 'Signal Monitor', ic: 'radio' },
  ];
  const nav = isAdmin ? adminNav : teacherNav;

  const sb = $('#sidebar');
  sb.innerHTML = `
    <div class="sidebar-brand"><span class="brand-badge">${icon('cap', 20)}</span> EduFlow</div>
    <nav class="sidebar-nav">
      <div class="nav-label">${isAdmin ? 'Admin Panel' : 'My Workspace'}</div>
      ${nav.map((n) => `
        <button class="nav-item ${state.view === n.id ? 'active' : ''}" data-nav="${n.id}" type="button">
          ${icon(n.ic, 17)}
          <span>${n.label}</span>
          ${n.count ? `<span class="nav-count">${n.count}</span>` : ''}
        </button>`).join('')}
    </nav>
    <div class="sidebar-user">
      <div class="avatar" style="background:linear-gradient(135deg,#818cf8,#c084fc)">${initials(me.name)}</div>
      <div>
        <div class="uname">${esc(me.name)}</div>
        <div class="urole">${isAdmin ? 'Administrator' : 'Teacher · ' + esc(me.subject || '')}</div>
      </div>
      <button class="logout-btn" data-logout title="Sign out" type="button">${icon('logout', 17)}</button>
    </div>`;

  $$('[data-nav]', sb).forEach((b) => b.addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('show');
    showView(b.dataset.nav);
  }));
  $('[data-logout]', sb).addEventListener('click', doLogout);
}

function viewTitle() {
  const titles = {
    overview: ['Dashboard', 'Your workspace at a glance'],
    timetable: [state.me.role === 'admin' ? 'Timetable' : 'My Timetable', state.me.role === 'admin' ? 'Manage the weekly timetable' : 'Your weekly schedule'],
    teachers: ['Teachers', 'Manage teaching staff'],
    requests: ['Requests', state.me.role === 'admin' ? 'Substitution requests from teachers' : 'Request time off & track status'],
    covers: ['Cover Duties', 'Periods you are assigned to cover'],
    messages: ['Messages', 'Direct messages between staff'],
    signals: ['ESP32 Signal Monitor', 'Live signal feed from the ESP32 Master board'],
  };
  return titles[state.view] || titles.overview;
}

function renderTopbar() {
  const me = state.me;
  const isAdmin = me.role === 'admin';
  const pending = isAdmin
    ? (state.stats ? state.stats.pending + state.stats.needsAssignment : 0)
    : state.requests.filter((r) => r.status === 'pending').length;
  const [title, sub] = viewTitle();
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const tb = $('#topbar');
  tb.innerHTML = `
    <button class="burger" id="burger" type="button" aria-label="Menu">${icon('list', 19)}</button>
    <div>
      <h2>${esc(title)}</h2>
      <div class="crumb">${esc(sub)}</div>
    </div>
    <div class="topbar-right">
      <span class="topbar-date">${icon('calendar', 14)} ${esc(dateStr)}</span>
      <button class="icon-btn" id="bell" type="button" title="Notifications">${icon('bell', 18)}${pending ? `<span class="dot">${pending > 9 ? '9+' : pending}</span>` : ''}</button>
      <div class="avatar">${initials(me.name)}</div>
    </div>`;

  $('#burger').addEventListener('click', () => {
    const sb = $('#sidebar');
    const ov = $('#sidebar-overlay');
    sb.classList.toggle('open');
    ov.classList.toggle('show', sb.classList.contains('open'));
  });
  $('#sidebar-overlay').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('show');
  });
  $('#bell').addEventListener('click', () => {
    if (state.view === 'requests') return;
    showView('requests');
    if (isAdmin) {
      state.reqTab = 'pending';
      renderContent();
    }
  });
}

/* ------------------------------------------------------------
   Content router
   ------------------------------------------------------------ */

function renderContent() {
  const c = $('#content');
  if (state.me.role === 'admin') {
    c.innerHTML = {
      overview: renderAdminOverview(),
      teachers: renderAdminTeachers(),
      timetable: renderAdminTimetable(),
      requests: renderAdminRequests(),
      messages: renderMessages(),
      signals: renderSignalMonitor(),
    }[state.view] || renderAdminOverview();
  } else {
    c.innerHTML = {
      overview: renderTeacherOverview(),
      timetable: renderTeacherTimetable(),
      requests: renderTeacherRequests(),
      covers: renderTeacherCovers(),
      messages: renderMessages(),
    }[state.view] || renderTeacherOverview();
  }
  bindContent();
}

/* ------------------------------------------------------------
   Shared bits
   ------------------------------------------------------------ */

function badgeFor(status) {
  const map = {
    pending: ['badge-pending', 'Pending', 'warn'],
    approved: ['badge-approved', 'Approved', 'success'],
    denied: ['badge-denied', 'Denied', 'danger'],
    cancelled: ['badge-denied', 'Cancelled', 'danger'],
    'needs-assignment': ['badge-needs', 'Needs assignment', 'info'],
  };
  const [cls, label] = map[status] || ['badge-pending', status];
  return `<span class="badge ${cls}"><span class="bd-dot"></span>${label}</span>`;
}

function cellFor(cls, day, period) {
  const tt = state.timetable;
  return ((tt.slots[cls] || {})[day] || {})[period] || {};
}

/** All cells of the current teacher: { cls, day, period, subject }. */
function myCells() {
  const me = state.me;
  const tt = state.timetable;
  const out = [];
  (tt.classes || []).forEach((cls) =>
    (tt.days || []).forEach((d) =>
      (tt.periods || []).forEach((p) => {
        const c = cellFor(cls, d, p);
        if (c.teacher && c.teacher.toLowerCase() === me.name.toLowerCase()) {
          out.push({ cls, day: d, period: p, subject: c.subject || '' });
        }
      })
    )
  );
  return out;
}

function myCellAt(day, period) {
  return myCells().filter((c) => c.day === day && c.period === period);
}

function coversForMe() {
  return state.covers || [];
}

/* ------------------------------------------------------------
   ESP32 SIGNAL MONITOR
   ------------------------------------------------------------ */

/** Local wall-clock time, e.g. 13:25:04. */
function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
  } catch (e) {
    return '';
  }
}

/** Master counts as ONLINE when the SSE stream is up AND we heard from it < 60 s ago. */
// The four ESP8266 D1 Mini sender boards (senderID 1-4) the Master listens to.
const SIGNAL_SENDER_IDS = [1, 2, 3, 4];

// Cycle badge colors so history rows are easy to tell apart per sender.
const SIGNAL_BADGES = ['badge-approved', 'badge-needs', 'badge-pending'];
function signalBadgeClass(id) {
  return SIGNAL_BADGES[(id - 1) % SIGNAL_BADGES.length];
}

function signalMasterOnline() {
  const s = state.signal;
  if (!s.streamOpen || !s.masterLastSeen) return false;
  return Date.now() - new Date(s.masterLastSeen).getTime() < 60000;
}

function sigIndicatorHtml(sig) {
  if (sig.className && !sig.period) {
    return `<div class="sig-ind-big ready">NO CLASS NOW</div>
      <div class="sig-ind-from">CLASS ${esc(sig.className)}</div>
      <div class="sig-ind-time">${esc(fmtTime(sig.receivedAt))}</div>`;
  }
  if (sig.className) {
    return `<div class="sig-ind-big">TEACHER ABSENT</div>
      <div class="sig-ind-from">CLASS ${esc(sig.className)}</div>
      <div class="sig-ind-time">${esc(fmtTime(sig.receivedAt))}</div>`;
  }
  return `<div class="sig-ind-big">SIGNAL RECEIVED</div>
    <div class="sig-ind-from">FROM: ${esc(sig.sender)}</div>
    <div class="sig-ind-time">${esc(fmtTime(sig.receivedAt))}</div>`;
}

function sigReadyHtml() {
  return `<div class="sig-ind-big ready">READY</div>
    <div class="sig-ind-sub">Waiting for signal…</div>`;
}

function sigHistoryRow(h) {
  const noClass = h.className && !h.period;
  // Resolve the teacher live from the current timetable, so the Message
  // button appears whenever a teacher is scheduled for that class/day/period
  // (even if the signal was recorded before that teacher was registered).
  const liveCell = (!noClass && h.className && h.day && h.period) ? cellFor(h.className, h.day, h.period) : null;
  const teacher = (liveCell && liveCell.teacher) ? liveCell.teacher : (h.teacher || '');
  const main = noClass ? 'No class now' : (h.className ? 'Teacher absent' : h.sender);
  const classCtx = h.className
    ? `<div class="cell-sub" style="margin-top:3px">${esc(h.className)}${h.period ? ' · ' + esc(h.period.split(' · ')[0]) : ' · no class at this time'}${teacher ? ' · ' + esc(teacher) : ''}</div>`
    : '';
  const msgBtn = teacher
    ? `<button class="btn btn-secondary btn-sm" data-action="msg-teacher" data-name="${esc(teacher)}" data-sender="${h.senderID}" title="Message ${esc(teacher)}">${icon('send', 12)} Message</button>`
    : '';
  return `<tr>
    <td><div class="cell-main">${esc(fmtTime(h.receivedAt))}</div><div class="cell-sub">${esc(fmtDate(h.receivedAt))}</div></td>
    <td><span class="badge ${signalBadgeClass(h.senderID)}"><span class="bd-dot"></span>${esc(main)}</span>${classCtx}</td>
    <td><span class="mono">${esc(h.message)}</span></td>
    <td><div class="actions">${msgBtn}</div></td>
  </tr>`;
}

function sigHistoryHtml(history) {
  // Always render the tbody so live updates can swap rows in without a full re-render.
  const rows = history.length
    ? history.map(sigHistoryRow).join('')
    : `<tr><td colspan="4"><div class="empty-state" style="padding:34px 22px;border:none;box-shadow:none"><div class="big-ico">${icon('radio', 26)}</div><h3 style="margin-bottom:4px">No signals yet</h3><p>Signals forwarded by the ESP32 Master will appear here in real time.</p></div></td></tr>`;
  return `<div class="table-wrap" style="border:none;box-shadow:none;border-radius:0;border-top:1px solid var(--border)">
    <table class="data">
      <thead><tr><th>Time</th><th>Sender</th><th>Message</th><th>Actions</th></tr></thead>
      <tbody id="sig-history-body">${rows}</tbody>
    </table>
  </div>`;
}

function sigSenderCard(id) {
  const s = state.signal;
  const last = s.history.find((h) => h.senderID === id);
  const active = !!last && (Date.now() - new Date(last.receivedAt).getTime() < 60000);
  const count = s.history.filter((h) => h.senderID === id).length;
  const cfg = (s.senders || []).find((x) => x.senderID === id) || { senderID: id, className: '' };
  const classes = (state.timetable && state.timetable.classes) || [];
  const isAdmin = state.me && state.me.role === 'admin';
  const noClassNow = active && last && last.className && !last.period;
  const statusText = cfg.className ? (active ? (noClassNow ? 'No class now' : 'Teacher absent') : 'No signal yet') : (active ? 'Active' : 'Idle');
  return `
    <div class="card card-pad sig-card">
      <div class="row-flex" style="margin-bottom:6px">
        <div class="sig-sender-title" id="sig-sender-${id}-title">${icon('radio', 16)} ${cfg.className ? 'Class ' + esc(cfg.className) : 'SENDER ' + id}</div>
        <span class="spacer"></span>
        <span class="sig-dot ${active ? 'on' : ''}" id="sig-sender-${id}-dot"></span>
      </div>
      <div class="sig-sender-status" id="sig-sender-${id}-status">${statusText}</div>
      ${isAdmin ? `
        <div class="field" style="margin-top:12px">
          <label style="font-size:12px">D1 Mini installed in class</label>
          <select class="sig-sender-class" data-sender="${id}">
            <option value="">— Not assigned —</option>
            ${classes.map((c) => `<option value="${esc(c)}" ${cfg.className === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>` : `
        <div class="sig-last" style="margin-top:10px" id="sig-sender-${id}-class">${cfg.className ? 'Installed in <b>' + esc(cfg.className) + '</b>' : 'Class not assigned'}</div>`}
      <div class="sig-last" id="sig-sender-${id}-last">${last ? 'Last signal · ' + fmtTime(last.receivedAt) : 'No signal yet'}</div>
      <div class="muted small" style="margin-top:2px">${count} signal${count === 1 ? '' : 's'} received</div>
    </div>`;
}

function renderSignalMonitor() {
  const s = state.signal;
  const online = signalMasterOnline();
  return `
    <div class="page-head">
      <div><h1>ESP32 Signal Monitor</h1><div class="sub">Live feed from the ESP32 Master — signals push here in real time via Server-Sent Events.</div></div>
      ${state.me.role === 'admin' ? `<button class="btn btn-secondary" data-action="clear-signals">${icon('trash', 15)} Clear history</button>` : ''}
    </div>

    <div class="sig-grid">
      <div class="card card-pad sig-card">
        <div class="card-title">Master ESP32</div>
        <div class="card-sub" style="margin-bottom:12px">Connection to the Master board</div>
        <div class="sig-pill ${online ? 'on' : 'off'}" id="sig-master-pill">${online ? 'ONLINE' : 'OFFLINE'}</div>
        <div class="sig-last" id="sig-master-last">${s.masterLastSeen ? 'Last contact · ' + fmtTime(s.masterLastSeen) : 'No contact yet'}</div>
      </div>
      <div class="card card-pad sig-card">
        <div class="card-title">Active signal</div>
        <div class="card-sub" style="margin-bottom:12px">Mirrors the Master LCD — resets to READY after 2 seconds</div>
        <div class="sig-indicator ${s.active ? 'active' : ''}" id="sig-indicator">${s.active ? sigIndicatorHtml(s.active) : sigReadyHtml()}</div>
      </div>
    </div>

    <div class="sig-grid" style="margin-top:16px">
      ${SIGNAL_SENDER_IDS.map(sigSenderCard).join('')}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-pad" style="padding-bottom:0">
        <div class="row-flex" style="margin-bottom:12px">
          <div><div class="card-title">Signal history</div><div class="card-sub">Newest first · kept until cleared</div></div>
          <span class="spacer"></span>
          <span class="muted small" id="sig-count">${s.history.length} signal${s.history.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${sigHistoryHtml(s.history)}
    </div>`;
}

/** Patch the live DOM (indicator, pills, sender cards, history) without a full re-render. */
function updateSignalUi() {
  const s = state.signal;
  const online = signalMasterOnline();
  const pill = $('#sig-master-pill');
  if (pill) {
    pill.className = 'sig-pill ' + (online ? 'on' : 'off');
    pill.textContent = online ? 'ONLINE' : 'OFFLINE';
  }
  const last = $('#sig-master-last');
  if (last) last.textContent = s.masterLastSeen ? 'Last contact · ' + fmtTime(s.masterLastSeen) : 'No contact yet';

  const ind = $('#sig-indicator');
  if (ind) {
    ind.className = 'sig-indicator' + (s.active ? ' active' : '');
    ind.innerHTML = s.active ? sigIndicatorHtml(s.active) : sigReadyHtml();
  }

  SIGNAL_SENDER_IDS.forEach((id) => {
    const lastSig = s.history.find((h) => h.senderID === id);
    const act = !!lastSig && (Date.now() - new Date(lastSig.receivedAt).getTime() < 60000);
    const cfg = (s.senders || []).find((x) => x.senderID === id);
    const clsName = (cfg && cfg.className) || '';
    const dot = $('#sig-sender-' + id + '-dot');
    if (dot) dot.className = 'sig-dot' + (act ? ' on' : '');
    const titleEl = $('#sig-sender-' + id + '-title');
    if (titleEl) titleEl.innerHTML = `${icon('radio', 16)} ${clsName ? 'Class ' + esc(clsName) : 'SENDER ' + id}`;
    const st = $('#sig-sender-' + id + '-status');
    if (st) st.textContent = clsName ? (act ? (lastSig && lastSig.className && !lastSig.period ? 'No class now' : 'Teacher absent') : 'No signal yet') : (act ? 'Active' : 'Idle');
    const l = $('#sig-sender-' + id + '-last');
    if (l) l.textContent = lastSig ? 'Last signal · ' + fmtTime(lastSig.receivedAt) : 'No signal yet';
    const clsLbl = $('#sig-sender-' + id + '-class');
    if (clsLbl) clsLbl.innerHTML = cfg && cfg.className ? 'Installed in <b>' + esc(cfg.className) + '</b>' : 'Class not assigned';
  });

  const cnt = $('#sig-count');
  if (cnt) cnt.textContent = s.history.length + ' signal' + (s.history.length === 1 ? '' : 's');
  const body = $('#sig-history-body');
  if (body) body.innerHTML = s.history.map(sigHistoryRow).join('');
}

/** Show a signal on the indicator for exactly 2 s (matching the Master LCD), then back to READY. */
function flashSignal(sig) {
  const s = state.signal;
  s.active = sig;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.active = null;
    updateSignalUi();
  }, 2000);
  updateSignalUi();
  toast(sig.className && !sig.period ? `No class now in ${sig.className} — signal received.` : sig.className ? `Teacher absent in ${sig.className}!` : `Signal received from ${sig.sender}!`, 'info', 2000);
  // Class-based flow: if this signal is for the logged-in teacher's class,
  // raise a persistent "go to your class" alert with a request-arrangement action.
  if (sig.className && sig.teacher && state.me && state.me.role === 'teacher') {
    if (sig.teacher.toLowerCase() === state.me.name.toLowerCase()) showClassCall(sig);
  }
}

/** Persistent alert telling a teacher their class has no teacher (sender button pressed). */
function showClassCall(sig) {
  closeClassCall();
  const root = $('#class-call-root');
  root.innerHTML = `
    <div class="class-call" id="class-call">
      <div class="class-call-ico">${icon('alert', 20)}</div>
      <div class="class-call-body">
        <div class="class-call-title">Your class is waiting!</div>
        <div class="class-call-sub">${esc(sig.className)}${sig.period ? ' · ' + esc(sig.period.split(' · ')[0]) : ''}${sig.subject ? ' · ' + esc(sig.subject) : ''} — no teacher has arrived yet.</div>
      </div>
      <div class="class-call-actions">
        <button class="btn btn-primary btn-sm" data-call-action="dismiss" type="button">${icon('check', 14)} Go to class</button>
        <button class="btn btn-secondary btn-sm" data-call-action="request" type="button">${icon('swap', 14)} Request arrangement</button>
      </div>
    </div>`;
  const onAction = (e) => {
    const act = e.target.closest('[data-call-action]');
    if (!act) return;
    if (act.dataset.callAction === 'request') {
      closeClassCall();
      state.reqSenderId = sig.senderID; // remember which classroom sender started this
      state.reqPrefill = { day: sig.day, period: sig.period, reason: `No teacher arrived in ${sig.className}${sig.subject ? ' (' + sig.subject + ')' : ''} — please arrange coverage.` };
      showView('requests');
      toast('Request form pre-filled from the class call.', 'info');
    } else {
      closeClassCall();
    }
  };
  root.querySelector('[data-call-action="dismiss"]').addEventListener('click', onAction);
  root.querySelector('[data-call-action="request"]').addEventListener('click', onAction);
  if (state.callTimer) clearTimeout(state.callTimer);
  state.callTimer = setTimeout(closeClassCall, 30000); // auto-dismiss after 30 s
}

function closeClassCall() {
  const root = $('#class-call-root');
  if (root) root.innerHTML = '';
  if (state.callTimer) { clearTimeout(state.callTimer); state.callTimer = null; }
}

/**
 * Open the SSE feed to the server. EventSource reconnects automatically,
 * so a dropped connection is recovered without any polling on our side.
 */
function ensureSignalStream() {
  if (signalStream || typeof EventSource === 'undefined') return;
  signalStream = new EventSource('/api/signal/stream');

  signalStream.addEventListener('state', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.signal.history = data.history || [];
      state.signal.senders = data.senders || [];
      state.signal.masterLastSeen = (data.master && data.master.lastSeenAt) || null;
      state.signal.streamOpen = true;
      updateSignalUi();
    } catch (err) { /* ignore malformed frame */ }
  });

  signalStream.addEventListener('signal', (e) => {
    try {
      const data = JSON.parse(e.data);
      const sig = data.signal;
      if (!sig) return;
      state.signal.history = [sig, ...state.signal.history];
      state.signal.masterLastSeen = sig.receivedAt;
      flashSignal(sig);
    } catch (err) { /* ignore malformed frame */ }
  });

  signalStream.addEventListener('clear', () => {
    state.signal.history = [];
    updateSignalUi();
  });

  signalStream.onopen = () => { state.signal.streamOpen = true; updateSignalUi(); };
  signalStream.onerror = () => { state.signal.streamOpen = false; updateSignalUi(); };

  // Re-evaluate ONLINE/OFFLINE + sender activity every 5 s (master goes
  // OFFLINE when no contact arrives within the 60 s window).
  setInterval(updateSignalUi, 5000);
}

async function clearSignalHistory() {
  confirmModal({
    title: 'Clear signal history?',
    body: 'Remove all received signals from the monitor history? The history is kept until you clear it.',
    confirmText: 'Clear history',
    danger: true,
    onConfirm: async () => {
      try {
        await api('/api/signal/history', { method: 'DELETE' });
        state.signal.history = [];
        updateSignalUi();
        toast('Signal history cleared.');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  });
}

/* ------------------------------------------------------------
   MESSAGES (admin <-> teacher, realtime)
   ------------------------------------------------------------ */

function unreadCount() {
  const me = state.me;
  if (!me) return 0;
  return (state.messages || []).filter((m) => m.toId === me.id && !m.readAt).length;
}

/** Group my messages into conversations with each other person. */
function messageThreads() {
  const me = state.me;
  const threads = new Map();
  (state.messages || []).forEach((m) => {
    const otherId = m.fromId === me.id ? m.toId : m.fromId;
    const otherName = m.fromId === me.id ? m.toName : m.fromName;
    if (!threads.has(otherId)) threads.set(otherId, { otherId, otherName, messages: [] });
    threads.get(otherId).messages.push(m);
  });
  return [...threads.values()];
}

function renderMessages() {
  // Mark my incoming messages as read (optimistically + persisted in the background)
  const unread = (state.messages || []).filter((m) => m.toId === state.me.id && !m.readAt);
  if (unread.length) {
    unread.forEach((m) => { m.readAt = new Date().toISOString(); });
    api('/api/messages/read', { method: 'POST' }).catch(() => {});
    refreshChrome();
  }
  const threads = messageThreads();
  return `
    <div class="page-head">
      <div><h1>Messages</h1><div class="sub">Direct messages between staff — new ones arrive in real time.</div></div>
      ${state.me.role === 'admin' ? `<button class="btn btn-primary" data-action="new-message">${icon('plus', 16)} New message</button>` : ''}
    </div>
    ${threads.length ? `
      <div class="stack" style="max-width:760px">
        ${threads.map((t) => `
          <div class="card card-pad">
            <div class="row-flex" style="margin-bottom:8px;gap:10px">
              <div class="avatar" style="width:30px;height:30px;font-size:10.5px">${initials(t.otherName)}</div>
              <b>${esc(t.otherName)}</b>
            </div>
            <div class="msg-thread">
              ${t.messages.slice().reverse().map((m) => `
                <div class="msg ${m.fromId === state.me.id ? 'me' : ''}">
                  <div class="msg-text">${esc(m.text)}</div>
                  <div class="msg-meta">${esc(fmtDate(m.createdAt))}</div>
                </div>`).join('')}
            </div>
            <form class="msg-form" data-thread="${esc(t.otherId)}">
              <input name="text" placeholder="Reply to ${esc(t.otherName.split(' ')[0])}…" maxlength="1000" required />
              <button class="btn btn-primary btn-sm" type="submit">${icon('send', 13)} Send</button>
            </form>
          </div>`).join('')}
      </div>` : `
      <div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('inbox', 26)}</div><h3 style="margin-bottom:4px">No messages yet</h3><p>Messages you send or receive will appear here — admins can message a teacher straight from the Signal Monitor or the Teachers page.</p></div></div>`}`;
}

/** Modal: admin composes a message to one teacher (senderID = show it on that sender's LCD too). */
function newMessageModal(prefillName, senderID) {
  const candidates = state.teachers || [];
  const prefill = prefillName ? candidates.find((t) => t.name.toLowerCase() === prefillName.toLowerCase()) : null;
  openModal(`
    <div class="modal-head"><h3>New message</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      ${senderID ? `<div class="info-box info" style="margin-bottom:12px">${icon('info', 16)}<div>This message will also appear on <b>Sender ${senderID}</b>'s classroom LCD.</div></div>` : ''}
      <form id="new-msg-form" novalidate>
        <div class="field"><label>To</label>
          <select name="toId" required>
            ${candidates.map((t) => `<option value="${esc(t.id)}" ${prefill && prefill.id === t.id ? 'selected' : ''}>${esc(t.name)}${t.subject ? ' · ' + esc(t.subject) : ''}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Message</label><textarea name="text" placeholder="Type your message…" maxlength="1000" required></textarea></div>
        <div class="row-flex" style="justify-content:flex-end;margin-top:16px;gap:10px">
          <button class="btn btn-secondary" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit">${icon('send', 14)} Send</button>
        </div>
      </form>
    </div>`);
  const m = $('#modal-root .modal');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#new-msg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim();
    if (!text) return toast('Write a message first.', 'warn');
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const res = await api('/api/messages', { method: 'POST', body: { toId: f.toId.value, text, senderID } });
      state.messages = [res.message, ...(state.messages || [])];
      closeModal();
      toast(`Message sent to ${res.message.toName}.`);
      renderContent();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------
   REALTIME — authenticated SSE (requests, covers, messages, stats)
   ------------------------------------------------------------ */

let dataStream = null; // EventSource for the authenticated data feed

function ensureDataStream() {
  if (dataStream || typeof EventSource === 'undefined') return;
  dataStream = new EventSource('/api/stream');
  dataStream.addEventListener('data', (e) => {
    try { applyRealtime(JSON.parse(e.data)); } catch (err) { /* ignore malformed frame */ }
  });
  // EventSource reconnects automatically — nothing else to do.
}

function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Update sidebar/topbar badges + counts without touching the page body. */
function refreshChrome() {
  renderSidebar();
  renderTopbar();
}

/** Merge a server snapshot into state, toast new items, re-render when safe. */
function applyRealtime(d) {
  if (!state.me || !d) return;
  const prevReqs = state.requests || [];
  const prevCovers = state.covers || [];
  const prevMsgs = state.messages || [];

  if (Array.isArray(d.requests)) {
    const fresh = d.requests.filter((r) => !prevReqs.some((x) => x.id === r.id));
    fresh.forEach((r) => {
      if (state.me.role === 'admin' && r.status === 'pending') {
        toast(`New request from ${r.teacherName} — ${r.day} · ${r.period.split(' · ')[0]}`, 'info');
      } else if (r.teacherId === state.me.id) {
        if (r.status === 'approved') toast(`Request approved — ${r.assignedName ? 'covered by ' + r.assignedName : 'cover arranged'}.`, 'success');
        if (r.status === 'denied') toast(`Request denied — ${r.adminNote || 'see details'}.`, 'warn');
        if (r.status === 'needs-assignment') toast('Request needs manual assignment — the admin is arranging cover.', 'info');
      }
    });
    state.requests = d.requests;
  }
  if (d.stats) state.stats = d.stats;
  if (Array.isArray(d.covers)) {
    const fresh = d.covers.filter((c) => !prevCovers.some((x) => x.id === c.id));
    fresh.forEach((c) => toast(`New cover duty: ${c.day} · ${c.period.split(' · ')[0]} — covering for ${c.teacherName}`, 'info'));
    state.covers = d.covers;
  }
  if (Array.isArray(d.messages)) {
    const fresh = d.messages.filter((m) => !prevMsgs.some((x) => x.id === m.id) && m.toId === state.me.id);
    fresh.forEach((m) => toast(`Message from ${m.fromName}`, 'info'));
    state.messages = d.messages;
  }
  if (d.timetable) {
    state.timetable = d.timetable;
    state.subjects = (d.timetable.subjects || []).slice();
  }

  refreshChrome();
  // Don't wipe an in-progress form or the admin's unsaved timetable edits.
  const editingTimetable = state.me.role === 'admin' && state.view === 'timetable' && state.editing;
  if (!editingTimetable && !isTyping()) renderContent();
}

/* ------------------------------------------------------------
   TEACHER — overview
   ------------------------------------------------------------ */

function renderTeacherOverview() {
  const me = state.me;
  const tt = state.timetable;
  if (!tt || !tt.days.length || !tt.classes.length) {
    return `<div class="page-head"><div><h1>${greeting()}, ${esc(me.name.split(' ')[0])} 👋</h1><div class="sub">Welcome back!</div></div></div>
    <div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('book', 26)}</div><h3 style="margin-bottom:4px">No timetable yet</h3><p>The admin hasn't set up the timetable yet. Once they do, your schedule and substitution requests will appear here.</p></div></div>`;
  }
  const day = todayName();
  const my = myCells();
  const todayPeriods = my.filter((c) => c.day === day);
  const covers = coversForMe();
  const myReqs = state.requests.slice(0, 3);

  return `
    <div class="page-head">
      <div>
        <h1>${greeting()}, ${esc(me.name.split(' ')[0])} 👋</h1>
        <div class="sub">${esc(day)} · ${esc(me.subject || 'Teaching')} · ${esc(me.email || '')}</div>
      </div>
      <button class="btn btn-primary" data-action="goto-requests">${icon('swap', 16)} Request substitution</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-ico indigo">${icon('clock', 21)}</div><div><div class="num">${todayPeriods.length}</div><div class="lbl">Classes today</div></div></div>
      <div class="stat-card"><div class="stat-ico sky">${icon('book', 21)}</div><div><div class="num">${my.length}</div><div class="lbl">Periods / week</div></div></div>
      <div class="stat-card"><div class="stat-ico amber">${icon('list', 21)}</div><div><div class="num">${state.requests.filter((r) => r.status === 'pending').length}</div><div class="lbl">Pending requests</div></div></div>
      <div class="stat-card"><div class="stat-ico green">${icon('repeat', 21)}</div><div><div class="num">${covers.length}</div><div class="lbl">Cover duties</div></div></div>
    </div>

    <div class="grid-2">
      <div class="card card-pad">
        <div class="row-flex" style="margin-bottom:14px">
          <div><div class="card-title">Today's schedule</div><div class="card-sub">${esc(day)}</div></div>
          <span class="spacer"></span>
          <button class="btn btn-secondary btn-sm" data-action="goto-timetable">Full week ${icon('chev', 13)}</button>
        </div>
        ${todayPeriods.length ? `
          <div class="stack">
            ${todayPeriods.map((c) => `
              <div class="req-item" style="align-items:center">
                <div class="req-ico">${icon('clock', 17)}</div>
                <div class="req-body"><div class="req-title">${esc(c.period)}</div><div class="req-meta">${esc(c.cls)} · ${esc(c.subject)}</div></div>
              </div>`).join('')}
          </div>` : `
          <div class="empty-state"><div class="big-ico">${icon('calendar', 24)}</div><p>No classes scheduled for ${esc(day)}. Enjoy the free periods!</p></div>`}
      </div>

      <div class="stack">
        <div class="card card-pad">
          <div class="row-flex" style="margin-bottom:12px">
            <div class="card-title">Cover duties</div>
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-sm" data-action="goto-covers">View all</button>
          </div>
          ${covers.length ? `
            <div class="stack">
              ${covers.slice(0, 3).map((r) => `
                <div class="req-item" style="align-items:center">
                  <div class="req-ico" style="background:var(--success-soft);color:var(--success)">${icon('swap', 17)}</div>
                  <div class="req-body">
                    <div class="req-title">${esc(r.day)} · ${esc(r.period)}</div>
                    <div class="req-meta">Covering for ${esc(r.teacherName)}</div>
                  </div>
                  ${badgeFor('approved')}
                </div>`).join('')}
            </div>` : `
            <div class="empty-state"><div class="big-ico">${icon('repeat', 24)}</div><p>You have no cover duties right now.</p></div>`}
        </div>

        <div class="card card-pad">
          <div class="row-flex" style="margin-bottom:12px">
            <div class="card-title">Recent requests</div>
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-sm" data-action="goto-requests">All</button>
          </div>
          ${myReqs.length ? `
            <div class="stack">
              ${myReqs.map((r) => `
                <div class="req-item" style="align-items:center">
                  <div class="req-ico" style="${r.status === 'approved' ? 'background:var(--success-soft);color:var(--success)' : r.status === 'denied' ? 'background:var(--danger-soft);color:var(--danger)' : ''}">${icon('inbox', 17)}</div>
                  <div class="req-body">
                    <div class="req-title">${esc(r.day)} · ${esc(r.period.replace('Period ', 'P'))}</div>
                    <div class="req-meta">${esc(r.date || '')} · ${esc(r.reason)}</div>
                  </div>
                  ${badgeFor(r.status)}
                </div>`).join('')}
            </div>` : `
            <div class="empty-state"><div class="big-ico">${icon('inbox', 24)}</div><p>No substitution requests yet.</p></div>`}
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------
   TEACHER — timetable
   ------------------------------------------------------------ */

function renderTeacherTimetable() {
  const tt = state.timetable;
  const covers = coversForMe();
  const coverKey = (d, p) => covers.find((c) => c.day === d && c.period === p);

  if (!tt || !tt.days.length || !tt.classes.length) {
    return `<div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('book', 24)}</div><h3 style="margin-bottom:4px">No timetable yet</h3><p>The admin hasn't set up the timetable. Ask them to add one and your schedule will appear here.</p></div></div>`;
  }

  return `
    <div class="page-head">
      <div><h1>Weekly timetable</h1><div class="sub">Your classes across all sections — each chip shows the class and subject.</div></div>
    </div>
    <div class="tt-legend">
      <span class="item"><span class="swatch" style="background:linear-gradient(135deg,#4f46e5,#6366f1)"></span>My class</span>
      <span class="item"><span class="swatch" style="background:var(--success-soft);border:1px solid #a7f3d0"></span>I'm covering</span>
      <span class="item"><span class="swatch" style="background:var(--surface-2);border:1.5px dashed #cbd5e1"></span>Free period</span>
    </div>
    <div class="tt-scroll">
      <table class="tt">
        <thead><tr><th>Period</th>${tt.days.map((d) => `<th>${esc(d)}</th>`).join('')}</tr></thead>
        <tbody>
          ${tt.periods.map((p) => `
            <tr>
              <td class="period-cell">${esc(p)}</td>
              ${tt.days.map((d) => {
                const mine = myCellAt(d, p);
                const cv = coverKey(d, p);
                if (cv) {
                  return `<td><div class="slot cover"><span class="mini-tag">Cover</span>${esc(cv.teacherName)}</div></td>`;
                }
                if (mine.length) {
                  return `<td><div class="stack" style="gap:5px">${mine.map((c) => `<div class="slot mine">${esc(c.cls)} · ${esc(c.subject)}</div>`).join('')}</div></td>`;
                }
                return `<td><div class="slot free">Free</div></td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ------------------------------------------------------------
   TEACHER — requests (make + history)
   ------------------------------------------------------------ */

function renderTeacherRequests() {
  const tt = state.timetable;
  const noTt = !tt || !tt.days.length;

  return `
    <div class="page-head">
      <div><h1>Substitution requests</h1><div class="sub">Need a period covered? Request it and the admin will arrange cover.</div></div>
    </div>
    <div class="grid-2">
      <div>
        <div class="card card-pad">
          <div class="card-title" style="margin-bottom:4px">${icon('plus', 15)} New request</div>
          <div class="card-sub" style="margin-bottom:16px">Pick the period you need off and explain why.</div>
          ${noTt ? `<div class="info-box warn">${icon('alert', 16)}<div>The timetable hasn't been uploaded yet — you can't request a substitution until it is.</div></div>` : `
          <form id="req-form" novalidate>
            <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:12px">
              <div class="field"><label>Day</label>
                <select id="req-day" required>
                  ${tt.days.map((d) => `<option value="${esc(d)}" ${state.reqPrefill && state.reqPrefill.day === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Period</label>
                <select id="req-period" required>
                  ${tt.periods.map((p) => `<option value="${esc(p)}" ${state.reqPrefill && state.reqPrefill.period === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field"><label>Date (optional)</label><input type="date" id="req-date" value="${state.reqPrefill ? new Date().toISOString().slice(0, 10) : ''}" /></div>
            <div class="field"><label>Reason</label><textarea id="req-reason" placeholder="e.g. Medical appointment — need coverage for Grade 9A Mathematics." required>${state.reqPrefill ? esc(state.reqPrefill.reason) : ''}</textarea></div>
            <div id="req-hint" class="info-box info" style="margin-bottom:16px">${icon('info', 16)}<div>Loading schedule…</div></div>
            <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">${icon('swap', 16)} Submit request</button>
          </form>`}
        </div>
      </div>
      <div>
        <div class="card card-pad">
          <div class="card-title" style="margin-bottom:14px">Request history</div>
          ${state.requests.length ? `
            <div class="stack">
              ${state.requests.map((r) => `
                <div class="req-item">
                  <div class="req-ico" style="${r.status === 'approved' ? 'background:var(--success-soft);color:var(--success)' : r.status === 'denied' ? 'background:var(--danger-soft);color:var(--danger)' : ''}">${icon('inbox', 17)}</div>
                  <div class="req-body">
                    <div class="req-title">${esc(r.day)} · ${esc(r.period)} ${badgeFor(r.status)}</div>
                    <div class="req-meta">${r.date ? esc(r.date) + ' · ' : ''}Requested ${esc(fmtDate(r.createdAt))}</div>
                    <div class="req-reason">${esc(r.reason)}</div>
                    ${r.status === 'approved' && r.assignedName ? `<div class="req-note">Covered by <b>${esc(r.assignedName)}</b></div>` : ''}
                    ${r.adminNote ? `<div class="req-note">Admin: ${esc(r.adminNote)}</div>` : ''}
                  </div>
                </div>`).join('')}
            </div>` : `
            <div class="empty-state"><div class="big-ico">${icon('inbox', 24)}</div><p>No requests yet. Create your first one →</p></div>`}
        </div>
      </div>
    </div>`;
}

function bindReqForm() {
  const form = $('#req-form');
  if (!form) return;
  const reqSenderId = state.reqSenderId || null; // captured once, so it can't leak into later requests
  state.reqSenderId = null;
  const daySel = $('#req-day');
  const periodSel = $('#req-period');
  const hint = $('#req-hint');
  state.reqPrefill = null; // consumed once — the form has been rendered with it

  const updateHint = () => {
    const my = myCellAt(daySel.value, periodSel.value);
    if (my.length) {
      hint.className = 'info-box info';
      hint.innerHTML = `${icon('info', 16)}<div>You are scheduled for <b>${esc(periodSel.value)}</b> on <b>${esc(daySel.value)}</b> (${my.map((c) => esc(c.cls) + ' · ' + esc(c.subject)).join(', ')}). A free teacher will be found if the admin approves.</div>`;
    } else {
      hint.className = 'info-box warn';
      hint.innerHTML = `${icon('alert', 16)}<div>Heads up — you are <b>free</b> at this slot. You can still request, but cover won't be needed.</div>`;
    }
  };
  daySel.addEventListener('change', updateHint);
  periodSel.addEventListener('change', updateHint);
  updateHint();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      day: daySel.value,
      period: periodSel.value,
      date: $('#req-date').value,
      reason: $('#req-reason').value.trim(),
      senderID: reqSenderId,
    };
    if (!body.reason) return toast('Please describe the reason for the request.', 'warn');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/requests', { method: 'POST', body });
      toast('Request submitted — the admin will review it shortly.');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------
   TEACHER — cover duties
   ------------------------------------------------------------ */

function renderTeacherCovers() {
  const covers = coversForMe();
  return `
    <div class="page-head">
      <div><h1>Cover duties</h1><div class="sub">Periods the admin assigned you to cover for other teachers.</div></div>
    </div>
    ${covers.length ? `
      <div class="stack" style="max-width:760px">
        ${covers.map((r) => `
          <div class="req-item">
            <div class="req-ico" style="background:var(--success-soft);color:var(--success)">${icon('swap', 18)}</div>
            <div class="req-body">
              <div class="req-title">${esc(r.day)} · ${esc(r.period)} ${badgeFor('approved')}</div>
              <div class="req-meta">Covering for <b>${esc(r.teacherName)}</b>${r.date ? ' · ' + esc(r.date) : ''}</div>
              <div class="req-reason">${esc(r.reason)}</div>
            </div>
          </div>`).join('')}
      </div>` : `
      <div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('repeat', 26)}</div><h3 style="margin-bottom:4px">No cover duties</h3><p>When the admin approves another teacher's request and you're free, you'll be auto-assigned and it will show up here.</p></div></div>`}`;
}

/* ------------------------------------------------------------
   ADMIN — overview
   ------------------------------------------------------------ */

function renderAdminOverview() {
  const s = state.stats || { teachers: 0, classes: 0, pending: 0, needsAssignment: 0, approved: 0, denied: 0, covers: 0, totalPeriods: 0 };
  const pendingReqs = state.requests.filter((r) => r.status === 'pending');
  return `
    <div class="page-head">
      <div>
        <h1>Admin dashboard</h1>
        <div class="sub">${greeting()}, ${esc(state.me.name.split(' ')[0])} — here's what needs your attention.</div>
      </div>
      <button class="btn btn-primary" data-action="goto-register">${icon('plus', 16)} Register teacher</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-ico indigo">${icon('users', 21)}</div><div><div class="num">${s.teachers}</div><div class="lbl">Teachers</div></div></div>
      <div class="stat-card"><div class="stat-ico violet">${icon('cap', 21)}</div><div><div class="num">${s.classes}</div><div class="lbl">Classes</div></div></div>
      <div class="stat-card"><div class="stat-ico amber">${icon('inbox', 21)}</div><div><div class="num">${s.pending}</div><div class="lbl">Pending requests</div></div></div>
      <div class="stat-card"><div class="stat-ico sky">${icon('swap', 21)}</div><div><div class="num">${s.needsAssignment}</div><div class="lbl">Need assignment</div></div></div>
      <div class="stat-card"><div class="stat-ico green">${icon('shield', 21)}</div><div><div class="num">${s.covers}</div><div class="lbl">Covers arranged</div></div></div>
      <div class="stat-card"><div class="stat-ico sky">${icon('book', 21)}</div><div><div class="num">${s.totalPeriods}</div><div class="lbl">Class-periods / week</div></div></div>
    </div>

    <div class="card">
      <div class="card-pad" style="padding-bottom:0">
        <div class="row-flex" style="margin-bottom:12px">
          <div><div class="card-title">Pending substitution requests</div><div class="card-sub">Approve to auto-assign a free teacher, or deny.</div></div>
          <span class="spacer"></span>
          <button class="btn btn-secondary btn-sm" data-action="goto-requests">View all ${icon('chev', 13)}</button>
        </div>
      </div>
      ${pendingReqs.length ? `
        <div class="table-wrap" style="border:none;box-shadow:none;border-radius:0;border-top:1px solid var(--border)">
          <table class="data">
            <thead><tr><th>Teacher</th><th>Day</th><th>Period</th><th>Reason</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              ${pendingReqs.map((r) => `
                <tr>
                  <td><div class="cell-main">${esc(r.teacherName)}</div><div class="cell-sub">${r.date ? esc(r.date) : ''}</div></td>
                  <td>${esc(r.day)}</td>
                  <td>${esc(r.period)}</td>
                  <td style="max-width:280px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.reason)}">${esc(r.reason)}</div></td>
                  <td><div class="actions">
                    <button class="btn btn-success btn-sm" data-action="approve" data-id="${r.id}">${icon('check', 14)} Approve</button>
                    <button class="btn btn-danger btn-sm" data-action="deny" data-id="${r.id}">${icon('x', 14)}</button>
                  </div></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state"><div class="big-ico">${icon('check', 26)}</div><p>No pending requests — all caught up!</p></div>`}
    </div>`;
}

/* ------------------------------------------------------------
   ADMIN — teachers
   ------------------------------------------------------------ */

function renderAdminTeachers() {
  return `
    <div class="page-head">
      <div><h1>Teachers</h1><div class="sub">${state.teachers.length} registered · register new staff or run the one-click auto-setup.</div></div>
      <div class="row-flex">
        <button class="btn btn-secondary" data-action="setup-teachers">${icon('cap', 16)} Setup from timetable</button>
        <button class="btn btn-primary" data-action="register">${icon('plus', 16)} Register teacher</button>
      </div>
    </div>
    ${state.teachers.length ? `
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Teacher</th><th>Username</th><th>Subject</th><th>Email</th><th>Mobile</th><th>Added</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${state.teachers.map((t) => `
            <tr>
              <td><div class="row-flex" style="gap:10px"><div class="avatar" style="width:30px;height:30px;font-size:10.5px">${initials(t.name)}</div><div class="cell-main">${esc(t.name)}</div></div></td>
              <td><span class="mono">${esc(t.username)}</span></td>
              <td>${esc(t.subject || '—')}</td>
              <td>${esc(t.email || '—')}</td>
              <td>${esc(t.mobile || '—')}</td>
              <td class="muted">${esc(fmtDate(t.createdAt))}</td>
              <td><div class="actions">
                <button class="btn btn-ghost btn-sm" data-action="msg-teacher" data-name="${esc(t.name)}" title="Message ${esc(t.name)}">${icon('send', 13)}</button>
                <button class="btn btn-ghost btn-sm btn-call" data-action="test-call" data-id="${t.id}" data-name="${esc(t.name)}" title="Test call ${esc(t.name)}">${icon('phone', 13)} Call</button>
                <button class="btn btn-secondary btn-sm" data-action="edit-teacher" data-id="${t.id}">${icon('pencil', 13)} Edit</button>
                <button class="btn btn-ghost btn-sm" data-action="del-teacher" data-id="${t.id}" title="Delete">${icon('trash', 14)}</button>
              </div></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('users', 26)}</div><p>No teachers yet — click “Register teacher” to add the first one.</p></div></div>`}`;
}

/** One-click setup: rebuild weighted timetable + create ~24 teachers (password 1234). */
function setupTeachersModal() {
  confirmModal({
    title: 'Auto-setup teachers from timetable?',
    body: `This will <b>replace all current teacher accounts</b> and rebuild the timetable:
      <ul style="margin:10px 0 0 18px;padding:0;line-height:1.7">
        <li>Maths, English &amp; a science subject <b>every day</b> per class</li>
        <li>Minor subjects (SST, AI, …) a few times a week</li>
        <li><b>More teachers for important subjects</b> — ~24 accounts total</li>
        <li>Login: subject-based username (e.g. <code>mathematics</code>) · password <b>1234</b></li>
      </ul>`,
    confirmText: 'Run setup',
    onConfirm: async () => {
      try {
        const res = await api('/api/setup/teachers', { method: 'POST' });
        toast(`Setup complete — ${res.created} teachers created (password 1234).`);
        state.editing = null; // drop any unsaved timetable edits
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  });
}

function teacherModal(t) {
  const isEdit = !!t;
  openModal(`
    <div class="modal-head"><h3>${isEdit ? 'Edit teacher' : 'Register a new teacher'}</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      <form id="teacher-form" novalidate>
        <div class="field"><label>Full name</label><input name="name" value="${esc(t ? t.name : '')}" placeholder="e.g. Rohan Das" required /></div>
        <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Username</label><input name="username" value="${esc(t ? t.username : '')}" placeholder="e.g. rohan" required /></div>
          <div class="field"><label>Subject</label>
            <select name="subject" required>
              <option value="">— Select subject —</option>
              ${(state.subjects || []).map((s) => `<option value="${esc(s)}" ${t && t.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Email</label><input name="email" type="email" value="${esc(t ? t.email : '')}" placeholder="rohan@school.edu" /></div>
          <div class="field"><label>Mobile Number</label><input name="mobile" type="tel" value="${esc(t ? t.mobile : '8750441860')}" placeholder="e.g. 8750441860" /></div>
        </div>
        <div class="field"><label>Password ${isEdit ? '<span class="muted" style="font-weight:400">(leave blank to keep current)</span>' : ''}</label><input name="password" type="password" ${isEdit ? '' : 'required'} placeholder="${isEdit ? '••••••••' : 'min. 4 characters'}" /></div>
        <div class="row-flex" style="justify-content:flex-end;margin-top:18px;gap:10px">
          <button class="btn btn-secondary" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Register'}</button>
        </div>
      </form>
    </div>`);

  const m = $('#modal-root .modal');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.name.value.trim(),
      username: f.username.value.trim(),
      subject: f.subject.value.trim(),
      email: f.email.value.trim(),
      mobile: f.mobile.value.trim(),
    };
    if (f.password.value) body.password = f.password.value;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (isEdit) {
        await api(`/api/teachers/${t.id}`, { method: 'PUT', body });
        toast('Teacher updated.');
      } else {
        await api('/api/teachers', { method: 'POST', body });
        toast('Teacher registered — they can now log in.');
      }
      closeModal();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------
   ADMIN — timetable editor
   ------------------------------------------------------------ */

function renderAdminTimetable() {
  const tt = state.timetable;
  if (!tt || !tt.days.length || !tt.classes.length) {
    return `<div class="page-head"><div><h1>Timetable</h1><div class="sub">Class-wise timetable — edit subjects &amp; teachers per class.</div></div></div>
    <div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('book', 26)}</div><h3 style="margin-bottom:4px">No timetable loaded</h3><p>Upload an Excel file for a class to get started — or restart the server to restore the default classwise timetable.</p><div style="margin-top:14px"><button class="btn btn-primary" data-action="upload">${icon('upload', 16)} Upload Excel</button></div></div></div>`;
  }
  const editing = state.editing || rawFromResolved(tt);
  state.editing = editing;
  if (!state.ttClass || !editing.classes.includes(state.ttClass)) {
    state.ttClass = editing.classes[0];
  }
  const cls = state.ttClass;
  const subjects = state.subjects;

  return `
    <div class="page-head">
      <div><h1>Timetable</h1><div class="sub">Class-wise timetable — pick a class, then set the subject &amp; teacher per period. Teachers auto-match cells by subject.</div></div>
      <div class="row-flex">
        <button class="btn btn-secondary" data-action="edit-periods">${icon('clock', 16)} Edit times</button>
        <button class="btn btn-secondary" data-action="upload">${icon('upload', 16)} Upload Excel</button>
        <button class="btn btn-primary" data-action="save-tt">${icon('check', 16)} Save timetable</button>
      </div>
    </div>

    <div class="class-tabs" id="class-tabs">
      ${editing.classes.map((c) => `
        <button class="class-tab ${c === cls ? 'active' : ''}" data-class-tab="${esc(c)}" type="button">${esc(c)}
          ${c === cls ? `<span class="class-del" data-del-class="${esc(c)}" title="Remove class">${icon('x', 12)}</span>` : ''}
        </button>`).join('')}
      <span class="class-add">
        <input id="new-class" placeholder="Add class…" maxlength="12" />
        <button class="btn btn-secondary btn-sm" data-action="add-class" type="button">${icon('plus', 13)}</button>
      </span>
    </div>

    <div class="tt-legend">
      <span class="item"><span class="swatch" style="background:var(--primary-soft);border:1px solid var(--primary-2)"></span>Editing <b>${esc(cls)}</b> — subject first, teacher is auto-detected by subject</span>
    </div>

    <div class="tt-scroll" style="margin-bottom:16px">
      <table class="tt">
        <thead><tr><th>Period</th>${editing.days.map((d) => `<th>${esc(d)}</th>`).join('')}</tr></thead>
        <tbody>
          ${editing.periods.map((p) => `
            <tr>
              <td class="period-cell">${esc(p)}</td>
              ${editing.days.map((d) => {
                const cell = (editing.slots[cls] && editing.slots[cls][d] && editing.slots[cls][d][p]) || { subject: '', teacher: '' };
                return `<td>
                  <div class="tt-editor-cell">
                    <select class="cell-subject" data-day="${esc(d)}" data-period="${esc(p)}">
                      <option value="">— Subject —</option>
                      ${subjects.map((s) => `<option value="${esc(s)}" ${cell.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                    </select>
                    <select class="cell-teacher" data-day="${esc(d)}" data-period="${esc(p)}">${teacherOptionsHtml(cell.subject, cell.teacher)}</select>
                  </div>
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="row-flex">
      <button class="btn btn-ghost btn-sm" data-action="clear-tt">${icon('trash', 14)} Clear ${esc(cls)}</button>
      <span class="spacer"></span>
      <span class="muted small">${editing.classes.length} classes · ${editing.days.length} days × ${editing.periods.length} periods</span>
    </div>`;
}

/** Convert a resolved timetable (from the API) back to the raw editing shape. */
function rawFromResolved(tt) {
  const slots = {};
  (tt.classes || []).forEach((cls) => {
    slots[cls] = {};
    (tt.days || []).forEach((d) => {
      slots[cls][d] = {};
      (tt.periods || []).forEach((p) => {
        const c = ((tt.slots[cls] || {})[d] || {})[p] || {};
        slots[cls][d][p] = { subject: c.subject || '', teacher: c.explicit ? (c.teacher || '') : '' };
      });
    });
  });
  return { days: tt.days, periods: tt.periods, classes: tt.classes, slots };
}

/** Options for a cell's teacher dropdown, filtered by the cell's subject. */
function teacherOptionsHtml(subject, currentTeacher) {
  if (!subject) return `<option value="">Pick a subject first</option>`;
  const teachers = state.teachers.filter((t) => t.subject === subject);
  const autoLabel = teachers.length === 1
    ? `Auto · ${esc(teachers[0].name)}`
    : teachers.length > 1 ? `Auto · choose below (${teachers.length} teachers)` : 'No teacher for this subject yet';
  let html = `<option value="" ${currentTeacher === '' ? 'selected' : ''}>${autoLabel}</option>`;
  teachers.forEach((t) => {
    html += `<option value="${esc(t.name)}" ${currentTeacher === t.name ? 'selected' : ''}>${esc(t.name)}</option>`;
  });
  // Keep a cell's current (possibly unregistered, Excel-imported) teacher visible
  if (currentTeacher && !teachers.some((t) => t.name === currentTeacher)) {
    html += `<option value="${esc(currentTeacher)}" selected>${esc(currentTeacher)} (not registered)</option>`;
  }
  return html;
}

function bindAdminTimetable() {
  const c = $('#content');

  // class tabs
  $$('.class-tab', c).forEach((tab) => {
    tab.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-class]')) return;
      state.ttClass = tab.dataset.classTab;
      renderContent();
    });
  });

  // remove class
  $$('[data-del-class]', c).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cls = btn.dataset.delClass;
      confirmModal({
        title: 'Remove class?',
        body: `Remove <b>${esc(cls)}</b> and its whole timetable?`,
        confirmText: 'Remove',
        danger: true,
        onConfirm: () => {
          const editing = state.editing;
          editing.classes = editing.classes.filter((x) => x !== cls);
          delete editing.slots[cls];
          if (state.ttClass === cls) state.ttClass = editing.classes[0] || null;
          renderContent();
          toast('Class removed — click “Save timetable” to apply.', 'warn');
        },
      });
    });
  });

  // add class
  const addBtn = c.querySelector('[data-action="add-class"]');
  if (addBtn) {
    const input = $('#new-class');
    const doAdd = () => {
      const name = input.value.trim();
      if (!name) return toast('Enter a class name first.', 'warn');
      const editing = state.editing;
      if (editing.classes.includes(name)) return toast('That class already exists.', 'warn');
      editing.classes.push(name);
      editing.slots[name] = {};
      editing.days.forEach((d) => {
        editing.slots[name][d] = {};
        editing.periods.forEach((p) => { editing.slots[name][d][p] = { subject: '', teacher: '' }; });
      });
      state.ttClass = name;
      renderContent();
      toast(`Class ${esc(name)} added — click “Save timetable” to apply.`);
    };
    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  }

  // subject select → rebuild teacher options + reset to auto
  $$('.cell-subject', c).forEach((sel) => {
    sel.addEventListener('change', () => {
      const slots = state.editing.slots[state.ttClass];
      if (!slots) return;
      const cell = slots[sel.dataset.day][sel.dataset.period];
      cell.subject = sel.value;
      cell.teacher = '';
      const tSel = sel.closest('td').querySelector('.cell-teacher');
      if (tSel) tSel.innerHTML = teacherOptionsHtml(cell.subject, '');
    });
  });

  // teacher select
  $$('.cell-teacher', c).forEach((sel) => {
    sel.addEventListener('change', () => {
      const slots = state.editing.slots[state.ttClass];
      if (!slots) return;
      slots[sel.dataset.day][sel.dataset.period].teacher = sel.value;
    });
  });
}

/** Modal: change the period times (e.g. 08:00–08:45). Saves into state.editing. */
function editPeriodTimesModal() {
  const editing = state.editing || rawFromResolved(state.timetable);
  const rows = editing.periods.map((p, i) => {
    const m = String(p).match(/^(.*?)\s*·?\s*(\d{1,2}):(\d{2})\s*(?:–|-|to)\s*(\d{1,2}):(\d{2})/i);
    if (m) return { label: String(p), name: m[1].trim() || 'Period ' + (i + 1), start: m[2] + ':' + m[3], end: m[4] + ':' + m[5] };
    return { label: String(p), name: String(p).trim() || 'Period ' + (i + 1), start: '08:00', end: '08:45' };
  });
  openModal(`
    <div class="modal-head"><h3>Edit period times</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      <div style="font-size:13.5px;color:#475569;line-height:1.6;margin-bottom:14px">Change the start/end time of each period. These drive the ESP32 signal monitor's “current period” detection and show on every teacher's timetable.</div>
      <form id="period-times-form" novalidate>
        ${rows.map((r, i) => `
          <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;align-items:end">
            <div class="field" style="margin:0"><label>Period</label><input name="name-${i}" value="${esc(r.name)}" placeholder="Period ${i + 1}" /></div>
            <div class="field" style="margin:0"><label>Start</label><input type="time" name="start-${i}" value="${esc(r.start)}" required /></div>
            <div class="field" style="margin:0"><label>End</label><input type="time" name="end-${i}" value="${esc(r.end)}" required /></div>
          </div>`).join('')}
        <div class="row-flex" style="justify-content:flex-end;margin-top:16px;gap:10px">
          <button class="btn btn-secondary" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit">${icon('check', 15)} Apply times</button>
        </div>
      </form>
    </div>`);
  const m = $('#modal-root .modal');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#period-times-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const oldPeriods = rows.map((r) => r.label || '');
    const updated = rows.map((r, i) => {
      const name = f['name-' + i].value.trim() || r.name;
      const start = f['start-' + i].value;
      const end = f['end-' + i].value;
      return `${name} · ${start}–${end}`;
    });
    state.editing = state.editing || rawFromResolved(state.timetable);
    state.editing.periods = updated;
    // The period label is also the slot key — re-key every day so no cell is lost.
    state.editing.classes.forEach((cls) => {
      state.editing.days.forEach((d) => {
        const daySlots = (state.editing.slots[cls] || {})[d] || {};
        const remapped = {};
        updated.forEach((np, i) => {
          remapped[np] = daySlots[oldPeriods[i]] || { subject: '', teacher: '' };
        });
        state.editing.slots[cls][d] = remapped;
      });
    });
    closeModal();
    renderContent();
    toast('Period times updated — click “Save timetable” to apply.', 'warn');
  });
}

/* Excel upload modal + preview (imports into one class) */
function uploadModal() {
  const classes = state.editing && state.editing.classes.length ? state.editing.classes : (state.timetable.classes || []);
  openModal(`
    <div class="modal-head"><h3>Upload timetable for a class</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Import into class</label>
        <select id="uz-class">
          ${classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div class="upload-zone" id="uz">
        <div class="uz-ico">${icon('upload', 24)}</div>
        <b>Drop your Excel file here</b>
        <span>or click to browse · .xlsx / .csv · cells = teacher names (subject auto-detected)</span>
        <input type="file" id="uz-file" accept=".xlsx,.csv" style="display:none" />
      </div>
      <div id="uz-result" style="margin-top:16px"></div>
    </div>`);

  const zone = $('#uz');
  const input = $('#uz-file');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag');
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) handleUpload(input.files[0]);
  });
}

async function handleUpload(file) {
  const result = $('#uz-result');
  const clsSel = $('#uz-class');
  const cls = clsSel ? clsSel.value : (state.timetable.classes[0] || '9A');
  result.innerHTML = `<div class="info-box info">${icon('info', 16)}<div>Parsing <b>${esc(file.name)}</b> for class <b>${esc(cls)}</b>…</div></div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('className', cls);
  try {
    const res = await api('/api/timetable/upload', { method: 'POST', body: fd });
    result.innerHTML = `
      <div class="info-box success" style="margin-bottom:12px">${icon('check', 16)}<div>Read <b>${esc(res.source)}</b> — ${res.days.length} days × ${res.periods.length} periods for <b>${esc(res.targetClass)}</b>.</div></div>
      ${res.warnings.length ? `<div class="info-box warn" style="margin-bottom:12px">${icon('alert', 16)}<div>Unregistered teacher names (no subject detected): <b>${res.warnings.map(esc).join(', ')}</b></div></div>` : ''}
      <div class="tt-scroll" style="max-height:280px;overflow:auto">
        <table class="tt" style="min-width:0;width:100%">
          <thead><tr><th>Period</th>${res.days.map((d) => `<th>${esc(d)}</th>`).join('')}</tr></thead>
          <tbody>
            ${res.periods.map((p) => `<tr><td class="period-cell">${esc(p)}</td>${res.days.map((d) => {
              const cell = ((res.slots[res.targetClass] || {})[d] || {})[p] || { subject: '', teacher: '' };
              const label = cell.subject ? `${cell.subject}${cell.teacher ? ' · ' + cell.teacher : ''}` : (cell.teacher || 'Free');
              return `<td><div class="slot ${cell.subject ? 'other' : 'free'}">${esc(label)}</div></td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row-flex" style="justify-content:flex-end;margin-top:16px;gap:10px">
        <button class="btn btn-secondary" data-cancel type="button">Cancel</button>
        <button class="btn btn-primary" id="use-tt" type="button">${icon('check', 15)} Use for ${esc(res.targetClass)}</button>
      </div>`;
    result.querySelector('[data-cancel]').addEventListener('click', closeModal);
    result.querySelector('#use-tt').addEventListener('click', () => {
      const editing = state.editing || rawFromResolved(state.timetable);
      // Merge the week structure (union of labels) so other classes keep their cells
      res.days.forEach((d) => { if (!editing.days.includes(d)) editing.days.push(d); });
      res.periods.forEach((p) => { if (!editing.periods.includes(p)) editing.periods.push(p); });
      if (!editing.classes.includes(res.targetClass)) editing.classes.push(res.targetClass);
      editing.slots[res.targetClass] = res.slots[res.targetClass];
      state.editing = editing;
      state.ttClass = res.targetClass;
      closeModal();
      renderContent();
      toast(`Timetable loaded for ${esc(res.targetClass)} — click “Save timetable” to apply it.`);
    });
  } catch (err) {
    result.innerHTML = `<div class="info-box error">${icon('alert', 16)}<div>${esc(err.message)}</div></div>`;
  }
}

/* ------------------------------------------------------------
   ADMIN — requests
   ------------------------------------------------------------ */

function renderAdminRequests() {
  const s = state.stats || { pending: 0, needsAssignment: 0, approved: 0, denied: 0 };
  const tabs = [
    ['pending', 'Pending', s.pending],
    ['needs-assignment', 'Needs assignment', s.needsAssignment],
    ['approved', 'Approved', s.approved],
    ['denied', 'Denied', s.denied],
    ['all', 'All', state.requests.length],
  ];
  let list = state.requests;
  if (state.reqTab !== 'all') list = list.filter((r) => r.status === state.reqTab);

  return `
    <div class="page-head">
      <div><h1>Substitution requests</h1><div class="sub">Approve a request to auto-assign the best free teacher — if none is free, you'll pick manually.</div></div>
    </div>
    <div class="tabs">
      ${tabs.map(([id, label, count]) => `
        <button class="tab ${state.reqTab === id ? 'active' : ''}" data-tab="${id}" type="button">${label} <span class="tab-count">${count}</span></button>`).join('')}
    </div>
    ${list.length ? `
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Teacher</th><th>Day · Period</th><th>Date</th><th>Reason</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${list.map((r) => `
            <tr>
              <td><div class="cell-main">${esc(r.teacherName)}</div><div class="cell-sub">${esc(fmtDate(r.createdAt))}</div></td>
              <td><div class="cell-main">${esc(r.day)}</div><div class="cell-sub">${esc(r.period)}</div></td>
              <td>${r.date ? esc(r.date) : '<span class="muted">—</span>'}</td>
              <td style="max-width:260px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.reason)}">${esc(r.reason)}</div></td>
              <td>
                ${badgeFor(r.status)}
                ${r.assignedName && r.status === 'approved' ? `<div class="cell-sub" style="margin-top:3px">→ ${esc(r.assignedName)}</div>` : ''}
                ${r.adminNote ? `<div class="cell-sub" style="margin-top:3px;max-width:200px" title="${esc(r.adminNote)}">${esc(r.adminNote)}</div>` : ''}
              </td>
              <td><div class="actions">
                ${r.status === 'pending' ? `
                  <button class="btn btn-success btn-sm" data-action="approve" data-id="${r.id}">${icon('check', 14)} Approve</button>
                  <button class="btn btn-danger btn-sm" data-action="deny" data-id="${r.id}">${icon('x', 13)} Deny</button>` : ''}
                ${r.status === 'needs-assignment' ? `
                  <button class="btn btn-primary btn-sm" data-action="assign" data-id="${r.id}">${icon('swap', 13)} Assign teacher</button>` : ''}
              </div></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="card card-pad"><div class="empty-state"><div class="big-ico">${icon('inbox', 26)}</div><p>No requests in this view.</p></div></div>`}`;
}

async function approveRequest(id) {
  const btn = document.querySelector(`[data-action="approve"][data-id="${id}"]`);
  if (btn) btn.disabled = true;
  try {
    const res = await api(`/api/requests/${id}/action`, { method: 'POST', body: { action: 'approve' } });
    if (res.needsManual) {
      toast('No free teacher at that period — assign someone manually.', 'warn');
      assignModal(id);
    } else {
      toast(`Approved! ${res.assignee.name} was auto-assigned to cover.`);
      await refresh();
    }
  } catch (e) {
    toast(e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

function assignModal(id) {
  const r = state.requests.find((x) => x.id === id);
  if (!r) return;
  const candidates = state.teachers.filter((t) => t.name.toLowerCase() !== r.teacherName.toLowerCase());
  openModal(`
    <div class="modal-head"><h3>Assign cover teacher</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      <div class="info-box warn" style="margin-bottom:16px">${icon('alert', 16)}<div><b>${esc(r.teacherName)}</b> needs cover for <b>${esc(r.day)} · ${esc(r.period)}</b>. No teacher is free then — pick who should cover it.</div></div>
      <form id="assign-form">
        <div class="field"><label>Assign to</label>
          <select name="assignedTo" required>
            ${candidates.map((t) => `<option value="${t.id}">${esc(t.name)}${t.subject ? ' · ' + esc(t.subject) : ''}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Note (optional)</label><textarea name="note" placeholder="e.g. Swapped with Priya's free period"></textarea></div>
        <div class="row-flex" style="justify-content:flex-end;gap:10px;margin-top:16px">
          <button class="btn btn-secondary" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit">${icon('check', 15)} Assign & approve</button>
        </div>
      </form>
    </div>`);

  const m = $('#modal-root .modal');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#assign-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const res = await api(`/api/requests/${id}/action`, {
        method: 'POST',
        body: { action: 'approve', assignedTo: f.assignedTo.value, note: f.note.value.trim() },
      });
      closeModal();
      toast(`Assigned ${res.assignee.name} to cover this period.`);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

function denyModal(id) {
  const r = state.requests.find((x) => x.id === id);
  if (!r) return;
  openModal(`
    <div class="modal-head"><h3>Deny request</h3><button class="modal-close" type="button">${icon('x', 18)}</button></div>
    <div class="modal-body">
      <div style="font-size:13.5px;color:#475569;margin-bottom:14px">Denying <b>${esc(r.teacherName)}</b>'s request for <b>${esc(r.day)} · ${esc(r.period)}</b>. Add a note so they know why.</div>
      <form id="deny-form">
        <div class="field"><label>Note to teacher</label><textarea name="note" placeholder="e.g. No free teachers available that period — please reschedule."></textarea></div>
        <div class="row-flex" style="justify-content:flex-end;gap:10px;margin-top:16px">
          <button class="btn btn-secondary" type="button" data-cancel>Cancel</button>
          <button class="btn btn-danger" type="submit">${icon('x', 15)} Deny request</button>
        </div>
      </form>
    </div>`);
  const m = $('#modal-root .modal');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#deny-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api(`/api/requests/${id}/action`, { method: 'POST', body: { action: 'deny', note: f.note.value.trim() } });
      closeModal();
      toast('Request denied.', 'warn');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------
   Content event bindings
   ------------------------------------------------------------ */

function bindContent() {
  const c = $('#content');

  // request form (teacher)
  if (state.me.role !== 'admin' && state.view === 'requests') bindReqForm();

  // timetable editor live edits (admin)
  if (state.me.role === 'admin' && state.view === 'timetable') bindAdminTimetable();

  // delegated actions
  c.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = el.dataset.action;
      const id = el.dataset.id;

      if (action === 'goto-requests') return showView('requests');
      if (action === 'goto-timetable') return showView('timetable');
      if (action === 'goto-covers') return showView('covers');
      if (action === 'goto-register') return teacherModal(null);

      if (action === 'clear-signals') return clearSignalHistory();
      if (action === 'new-message') return newMessageModal(null);
      if (action === 'msg-teacher') return newMessageModal(el.dataset.name, el.dataset.sender ? Number(el.dataset.sender) : null);

      if (action === 'setup-teachers') return setupTeachersModal();
      if (action === 'register') return teacherModal(null);
      if (action === 'edit-teacher') {
        const t = state.teachers.find((x) => x.id === id);
        if (t) teacherModal(t);
        return;
      }
      if (action === 'del-teacher') {
        const t = state.teachers.find((x) => x.id === id);
        if (!t) return;
        return confirmModal({
          title: 'Delete teacher?',
          body: `Remove <b>${esc(t.name)}</b>? Their classes are cleared from the timetable and they can no longer log in.`,
          confirmText: 'Delete',
          danger: true,
          onConfirm: async () => {
            try {
              await api(`/api/teachers/${id}`, { method: 'DELETE' });
              toast('Teacher deleted.');
              await refresh();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
      }

      if (action === 'test-call') {
        const tName = el.dataset.name || '';
        confirmModal({
          title: 'Test call teacher?',
          body: `This will place a <b>Twilio voice call</b> to <b>${esc(tName)}</b> at their registered mobile number. The call says it's a test from EduFlow.`,
          confirmText: 'Call now',
          onConfirm: async () => {
            try {
              const res = await api('/api/call/test', { method: 'POST', body: { teacherId: id } });
              toast(`Call placed to ${esc(res.teacher)} (${esc(res.to)}) — SID: ${res.sid}`);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
        return;
      }

      if (action === 'edit-periods') return editPeriodTimesModal();
      if (action === 'upload') return uploadModal();

      if (action === 'save-tt') {
        const btn = el;
        btn.disabled = true;
        try {
          await api('/api/timetable', { method: 'POST', body: { timetable: state.editing } });
          state.timetable = JSON.parse(JSON.stringify(state.editing));
          state.editing = null;
          toast('Timetable saved — teachers can now see their updated schedule.');
          await loadData();
          renderContent();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
        return;
      }

      if (action === 'clear-tt') {
        return confirmModal({
          title: 'Clear class timetable?',
          body: `Every period of <b>${esc(state.ttClass)}</b> will be set to <b>free</b>. This affects the saved timetable only after you click “Save timetable”.`,
          confirmText: 'Clear',
          danger: true,
          onConfirm: async () => {
            const slots = state.editing.slots[state.ttClass] || {};
            state.editing.days.forEach((d) => {
              if (!slots[d]) slots[d] = {};
              state.editing.periods.forEach((p) => { slots[d][p] = { subject: '', teacher: '' }; });
            });
            renderContent();
            toast('Class cleared — click “Save timetable” to apply.', 'warn');
          },
        });
      }

      if (action === 'approve') return approveRequest(id);
      if (action === 'deny') return denyModal(id);
      if (action === 'assign') return assignModal(id);
    });
  });

  // tabs
  c.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.reqTab = tab.dataset.tab;
      renderContent();
    });
  });

  // admin: assign a sender (D1 Mini) to a class
  c.querySelectorAll('.sig-sender-class').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const senderID = Number(sel.dataset.sender);
      const className = sel.value;
      const btn = sel;
      btn.disabled = true;
      try {
        const res = await api('/api/signal/senders', { method: 'POST', body: { senderID, className } });
        state.signal.senders = res.state.senders || [];
        toast(className ? `Sender ${senderID} assigned to ${className}.` : `Sender ${senderID} unassigned.`);
        await loadData();
        renderContent();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // message reply forms (messages view)
  c.querySelectorAll('.msg-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[name=text]');
      const text = input.value.trim();
      if (!text) return;
      const btn = form.querySelector('[type=submit]');
      input.disabled = true;
      btn.disabled = true;
      try {
        const res = await api('/api/messages', { method: 'POST', body: { toId: form.dataset.thread, text } });
        state.messages = [res.message, ...(state.messages || [])];
        input.value = '';
        toast('Message sent.');
        renderContent();
      } catch (err) {
        toast(err.message, 'error');
      }
      input.disabled = false;
      btn.disabled = false;
    });
  });
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', boot);
