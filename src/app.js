'use strict';

/* =========================================================
   Planner — 3 levels of planning + focus tools
   1. Tasks      (Trello-like board + Eisenhower matrix)
   2. Habits     (21-day challenges, shown every day)
   3. Projects   (Gantt chart; its tasks also appear on the board)
   + Pomodoro timer on the Today dashboard
   Runs as the desktop app (Electron) or as a phone web app
   served by the desktop app over the home Wi-Fi.
   ========================================================= */

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isMobile = () => window.innerWidth <= 760;
const fmtClock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;

const D = {
  today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
  num(s) { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); },
  str(n) { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; },
  add(s, n) { return D.str(D.num(s) + n); },
  diff(a, b) { return D.num(b) - D.num(a); },
  dow(s) { return new Date(D.num(s) * 864e5).getUTCDay(); },
  fmt(s, o = { month: 'short', day: 'numeric' }) { return new Date(D.num(s) * 864e5).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' }); },
  rel(s) {
    const n = D.diff(D.today(), s);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return D.fmt(s);
  },
  ok(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); },
  monthEnd(s) { const [y, m] = s.split('-').map(Number); return D.str(Math.round(Date.UTC(y, m, 0) / 864e5)); },
};

/** Small per-device preferences (not synced). */
const pref = {
  get(k, d) { try { const v = localStorage.getItem('planner-pref-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('planner-pref-' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];
const PRIORITY = {
  none: { label: 'No priority', color: '', rank: 0 },
  low: { label: 'Low', color: '#10b981', rank: 1 },
  medium: { label: 'Medium', color: '#f59e0b', rank: 2 },
  high: { label: 'High', color: '#ef4444', rank: 3 },
};
const QUADS = {
  do: { n: 1, label: 'Do first', hint: 'Urgent & important', color: '#ef4444', empty: 'Nothing urgent and important right now.' },
  plan: { n: 2, label: 'Schedule', hint: 'Important, not urgent', color: '#6366f1', empty: 'Important goals to plan a time for.' },
  delegate: { n: 3, label: 'Delegate', hint: 'Urgent, not important', color: '#f59e0b', empty: 'Things someone else could do.' },
  drop: { n: 4, label: 'Eliminate', hint: 'Not urgent, not important', color: '#64748b', empty: 'Things to drop or do much later.' },
};
const QUAD_RANK = { do: 0, plan: 1, delegate: 2, '': 3, drop: 4 };
const quadRank = (t) => QUAD_RANK[QUADS[t.quadrant] ? t.quadrant : ''];
const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const ZOOM = { day: 38, week: 15, month: 5 };
const ROW = 42;
const leftW = () => (isMobile() ? 150 : 350);
const ITEM_KEYS = ['tasks', 'habits', 'projects', 'sessions'];

const ICON = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  habits: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  projects: '<path d="M3 3v18h18"/><rect x="7" y="6" width="8" height="3" rx="1"/><rect x="11" y="11" width="9" height="3" rx="1"/><rect x="6" y="16" width="6" height="3" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  flame: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/>',
  timer: '<circle cx="12" cy="14" r="8"/><path d="M12 10v4l2.5 2M9 2h6M12 2v4"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  skip: '<path d="M5 5v14l10-7z"/><path d="M19 5v14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  matrix: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  wifioff: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M19 12.9a10 10 0 0 0-2.2-1.6"/><path d="M12 20h.01"/>',
};
const ic = (name, cls = '') => `<span class="ic ${cls}"><svg viewBox="0 0 24 24">${ICON[name] || ''}</svg></span>`;

/* =========================================================
   Storage & sync
   desktop: Electron main process (window.api)
   server:  phone/browser talking to the desktop app over Wi-Fi
   local:   plain browser storage (dev preview)
   ========================================================= */
const hasApi = typeof window.api === 'object' && window.api !== null;
const LS_KEY = 'planner-data';
const CACHE_KEY = 'planner-cache';
const KEY_LS = 'planner-key';
let mode = hasApi ? 'desktop' : 'local';
let serverRev = 0;
let syncStatus = 'ok';

let state = null;
let changeId = 0;
let savedId = 0;
let saveTimer = null;
let saving = false;
let pendingRemote = null;

function accessKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch { return ''; } }

async function apiCall(method, url, body) {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Key': accessKey() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 429) {
    const e = new Error('auth');
    e.auth = true;
    try { e.message = (await res.json()).error || 'auth'; } catch { /* ignore */ }
    throw e;
  }
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

function cacheLocal() {
  if (mode !== 'server') return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

async function loadData() {
  if (mode === 'desktop') return { data: await window.api.load() };
  if (location.protocol.startsWith('http')) {
    const m = location.hash.match(/key=([A-Za-z0-9]+)/);
    if (m) {
      try { localStorage.setItem(KEY_LS, m[1].toUpperCase()); } catch { /* ignore */ }
      history.replaceState(null, '', location.pathname + location.search);
    }
    try {
      const r = await apiCall('GET', '/api/data');
      mode = 'server';
      serverRev = r.rev;
      return { data: r.data };
    } catch (e) {
      if (e.auth) { mode = 'server'; return { auth: true, message: accessKey() ? e.message : '' }; }
      if (!e.status) {
        // network problem: use the last copy we had, and keep trying
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { /* ignore */ }
        if (cached) { mode = 'server'; syncStatus = 'offline'; return { data: cached }; }
      }
      // no Planner server here (e.g. preview) → browser storage
    }
  }
  try { return { data: JSON.parse(localStorage.getItem(LS_KEY) || 'null') }; } catch { return { data: null }; }
}

/* ----- change tracking: stamp updatedAt on changed items, remember deletions ----- */
let snap = new Map();
let snapCols = '';
let snapSettings = '';
const itemSig = (x) => { const { updatedAt, ...rest } = x; return JSON.stringify(rest); };

function resetSnapshot() {
  snap = new Map();
  ITEM_KEYS.forEach((k) => state[k].forEach((x) => snap.set(x.id, itemSig(x))));
  snapCols = JSON.stringify(state.columns);
  snapSettings = itemSig(state.settings);
}

function stampChanges() {
  const now = Date.now();
  const seen = new Set();
  ITEM_KEYS.forEach((k) => state[k].forEach((x) => {
    seen.add(x.id);
    const sig = itemSig(x);
    if (snap.get(x.id) !== sig) { x.updatedAt = now; snap.set(x.id, sig); }
  }));
  for (const id of [...snap.keys()]) {
    if (!seen.has(id)) { state.deleted[id] = now; snap.delete(id); }
  }
  const cs = JSON.stringify(state.columns);
  if (cs !== snapCols) { state.columnsUpdatedAt = now; snapCols = cs; }
  const ss = itemSig(state.settings);
  if (ss !== snapSettings) { state.settings.updatedAt = now; snapSettings = ss; }
}

function persist() {
  changeId++;
  scheduleSave(250);
}
function scheduleSave(ms) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, ms);
}
function commit() { persist(); render(); }

async function saveNow() {
  if (!state || changeId === savedId) return;
  if (saving) { scheduleSave(300); return; }
  saving = true;
  const id = changeId;
  stampChanges();
  try {
    let r = null;
    if (mode === 'desktop') {
      r = await window.api.save(state);
    } else if (mode === 'server') {
      cacheLocal();
      r = await apiCall('PUT', '/api/data', { data: state });
      serverRev = r.rev;
      setSync('ok');
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
    savedId = Math.max(savedId, id);
    if (r && r.changed && r.data) receiveRemote(r.data);
  } catch (e) {
    console.error(e);
    if (mode === 'server') { setSync(e.auth ? 'auth' : 'offline'); scheduleSave(5000); } else toast('Could not save your data!');
  } finally {
    saving = false;
  }
}

window.addEventListener('beforeunload', () => {
  if (!state || changeId === savedId) return;
  stampChanges();
  if (mode === 'desktop') window.api.saveSync(state);
  else if (mode === 'server') cacheLocal();
  else { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ } }
});

/** Data changed on the other device. Apply it when we are not in the middle of something. */
function receiveRemote(data) {
  if (changeId !== savedId) return; // our own pending save will merge both
  if (isBusy()) { pendingRemote = data; return; }
  adopt(data);
}
function adopt(data) {
  const n = normalize(data);
  pendingRemote = null;
  if (!n) return;
  state = n;
  resetSnapshot();
  cacheLocal();
  render();
  console.log('Planner: applied changes from the other device');
}
function isBusy() {
  const a = document.activeElement;
  return !!drag || ganttDragging || !!ui.addingIn
    || !!(a && a.closest && a.closest('#main') && a.matches('input, textarea, select'));
}
setInterval(() => {
  if (pendingRemote && !isBusy() && changeId === savedId) adopt(pendingRemote);
}, 1500);

if (hasApi && window.api.onDataChanged) window.api.onDataChanged((d) => receiveRemote(d));

async function poll() {
  if (mode !== 'server' || !state || document.hidden) return;
  if (changeId !== savedId) { saveNow(); return; }
  try {
    const r = await apiCall('GET', '/api/data?rev=' + serverRev);
    setSync('ok');
    if (!r.unchanged) { serverRev = r.rev; receiveRemote(r.data); }
  } catch (e) {
    setSync(e.auth ? 'auth' : 'offline');
  }
}
setInterval(poll, 4000);
document.addEventListener('visibilitychange', poll);
window.addEventListener('online', poll);

function setSync(s) {
  syncStatus = s;
  const el = $('#sync-pill');
  if (!el) return;
  el.hidden = s === 'ok';
  if (s === 'offline') el.innerHTML = `${ic('wifioff', 'sm')} Offline — changes will sync when your PC is reachable`;
  if (s === 'auth') el.innerHTML = `${ic('phone', 'sm')} Access code needed — tap here`;
}

/* ---------------- model ---------------- */
function defaultPomo() { return { focus: 25, short: 5, long: 15, every: 4, autoStart: false }; }

function defaultState() {
  return {
    version: 2,
    columns: [
      { id: 'todo', title: 'To Do', role: 'todo' },
      { id: 'doing', title: 'In Progress', role: 'doing' },
      { id: 'done', title: 'Done', role: 'done' },
    ],
    tasks: [],
    habits: [],
    projects: [],
    sessions: [],
    deleted: {},
    settings: { theme: 'system', showHabitsOnBoard: true, ganttZoom: 'day', pomo: defaultPomo() },
  };
}

function makeTask(x) {
  return {
    id: uid(), title: '', desc: '', columnId: 'todo', order: 0, priority: 'none', quadrant: null,
    due: null, projectId: null, start: null, end: null, progress: 0, deps: [], pomodoros: 0,
    doneAt: null, createdAt: Date.now(), ...x,
  };
}

function normalize(src) {
  if (!src || typeof src !== 'object' || !Array.isArray(src.tasks)) return null;
  const s = JSON.parse(JSON.stringify(src));
  const base = defaultState();
  s.version = 2;
  s.columns = Array.isArray(s.columns) && s.columns.length ? s.columns : base.columns;
  if (!s.columns.some((c) => c.role === 'done')) s.columns.push({ id: 'done-' + uid(), title: 'Done', role: 'done' });
  s.habits = Array.isArray(s.habits) ? s.habits : [];
  s.projects = Array.isArray(s.projects) ? s.projects : [];
  s.sessions = Array.isArray(s.sessions) ? s.sessions.filter((x) => x && x.id) : [];
  s.deleted = s.deleted && typeof s.deleted === 'object' ? s.deleted : {};
  const old = Date.now() - 120 * 864e5;
  Object.keys(s.deleted).forEach((id) => { if (s.deleted[id] < old) delete s.deleted[id]; });
  s.settings = { ...base.settings, ...(s.settings || {}) };
  s.settings.pomo = { ...defaultPomo(), ...(s.settings.pomo || {}) };
  const colIds = new Set(s.columns.map((c) => c.id));
  const projIds = new Set(s.projects.map((p) => p.id));
  s.tasks = s.tasks.filter((t) => t && t.id).map((t) => {
    const n = makeTask(t);
    if (!colIds.has(n.columnId)) n.columnId = s.columns[0].id;
    if (n.projectId && !projIds.has(n.projectId)) n.projectId = null;
    if (n.projectId) {
      if (!D.ok(n.start)) n.start = D.today();
      if (!D.ok(n.end) || n.end < n.start) n.end = n.start;
    }
    if (!QUADS[n.quadrant]) n.quadrant = null;
    n.deps = Array.isArray(n.deps) ? n.deps : [];
    return n;
  });
  s.habits.forEach((h) => {
    h.checks = h.checks && typeof h.checks === 'object' ? h.checks : {};
    h.length = clamp(parseInt(h.length, 10) || 21, 1, 365);
    if (!D.ok(h.startDate)) h.startDate = D.today();
    h.color = h.color || COLORS[0];
  });
  return s;
}

function seedState() {
  const s = defaultState();
  const t = D.today();
  const now = Date.now();
  const pid = uid();
  s.projects.push({ id: pid, name: 'Website launch', desc: 'Example project — edit or delete it.', color: '#6366f1', createdAt: now });
  const a = makeTask({ title: 'Design mockups', projectId: pid, start: D.add(t, -4), end: D.add(t, -1), progress: 100, columnId: 'done', doneAt: D.add(t, -1), order: 0 });
  const b = makeTask({ title: 'Write page content', projectId: pid, start: D.add(t, -2), end: D.add(t, 2), progress: 40, columnId: 'doing', order: 0, priority: 'medium', quadrant: 'do' });
  const c = makeTask({ title: 'Build the pages', projectId: pid, start: D.add(t, 1), end: D.add(t, 6), columnId: 'todo', order: 0, deps: [a.id], quadrant: 'plan' });
  const d = makeTask({ title: 'Test & publish', projectId: pid, start: D.add(t, 7), end: D.add(t, 8), columnId: 'todo', order: 1, deps: [b.id, c.id], priority: 'high', quadrant: 'plan' });
  [a, b, c, d].forEach((x) => { x.due = x.end; });
  s.tasks.push(a, b, c, d,
    makeTask({ title: 'Buy groceries', due: t, columnId: 'todo', order: 2, priority: 'medium', quadrant: 'delegate' }),
    makeTask({ title: 'Call the bank', due: D.add(t, 1), columnId: 'todo', order: 3, priority: 'high', quadrant: 'do' }),
    makeTask({ title: 'Sort old emails', columnId: 'todo', order: 4 }),
    makeTask({ title: 'Read 20 pages', columnId: 'doing', order: 1, priority: 'low', desc: 'Any book you like.', quadrant: 'plan' }),
  );
  const checks = {};
  [-5, -4, -2, -1].forEach((n) => { checks[D.add(t, n)] = true; });
  s.habits.push(
    { id: uid(), title: 'Drink 2L of water', desc: '', color: '#0ea5e9', startDate: D.add(t, -5), length: 21, checks, createdAt: now },
    { id: uid(), title: 'Morning walk — 20 minutes', desc: '', color: '#10b981', startDate: t, length: 21, checks: {}, createdAt: now + 1 },
  );
  return s;
}

const task = (id) => state.tasks.find((t) => t.id === id);
const habit = (id) => state.habits.find((h) => h.id === id);
const project = (id) => state.projects.find((p) => p.id === id);
const column = (id) => state.columns.find((c) => c.id === id);
const doneCol = () => state.columns.find((c) => c.role === 'done');
const todoCol = () => state.columns.find((c) => c.role === 'todo') || state.columns.find((c) => c.role !== 'done');
const doingCol = () => state.columns.find((c) => c.role === 'doing') || todoCol();
const isDone = (t) => t.columnId === doneCol().id;
const progressOf = (t) => (isDone(t) ? 100 : clamp(t.progress || 0, 0, 99));

function colTasks(colId) {
  return state.tasks.filter((t) => t.columnId === colId).sort((a, b) => a.order - b.order);
}
function nextOrder(colId) {
  const l = colTasks(colId);
  return l.length ? l[l.length - 1].order + 1 : 0;
}
function firstOrder(colId) {
  const l = colTasks(colId);
  return l.length ? l[0].order - 1 : 0;
}

/** Move a task to a column and keep project progress / done date in sync. */
function setTaskColumn(t, colId) {
  const wasDone = isDone(t);
  t.columnId = colId;
  const nowDone = isDone(t);
  if (nowDone && !wasDone) {
    t.doneAt = D.today();
    if (t.projectId) t.progress = 100;
  } else if (!nowDone && wasDone) {
    t.doneAt = null;
    if (t.projectId && t.progress >= 100) t.progress = column(colId)?.role === 'doing' ? 50 : 0;
  }
}

/** Change project-task progress; moves the card to the matching list. */
function setTaskProgress(t, p) {
  t.progress = clamp(Math.round(p), 0, 100);
  if (t.progress === 100 && !isDone(t)) {
    t.columnId = doneCol().id; t.order = firstOrder(t.columnId); t.doneAt = D.today();
  } else if (t.progress < 100 && isDone(t)) {
    const c = t.progress > 0 ? doingCol() : todoCol();
    t.columnId = c.id; t.order = nextOrder(c.id); t.doneAt = null;
  } else if (t.progress > 0 && t.columnId === todoCol().id && doingCol() !== todoCol()) {
    t.columnId = doingCol().id; t.order = nextOrder(t.columnId);
  }
}

function toggleDone(t) {
  if (!t) return;
  if (isDone(t)) {
    const c = t.projectId && t.progress > 0 && t.progress < 100 ? doingCol() : todoCol();
    setTaskColumn(t, c.id);
    t.order = nextOrder(c.id);
  } else {
    const c = doneCol();
    const order = firstOrder(c.id);
    setTaskColumn(t, c.id);
    t.order = order;
  }
}

function moveTask(id, colId, beforeId) {
  const t = task(id);
  if (!t) return;
  const list = colTasks(colId).filter((x) => x.id !== id);
  let i = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length;
  if (i < 0) i = list.length;
  list.splice(i, 0, t);
  if (t.columnId !== colId) setTaskColumn(t, colId);
  list.forEach((x, n) => { x.order = n; });
}

function cleanDeps() {
  state.tasks.forEach((t) => {
    if (!t.projectId) { if (t.deps.length) t.deps = []; return; }
    const keep = (t.deps || []).filter((d) => d !== t.id && task(d)?.projectId === t.projectId);
    if (keep.length !== t.deps.length) t.deps = keep;
  });
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  cleanDeps();
}

/* habits */
const habitEnd = (h) => D.add(h.startDate, h.length - 1);
function habitStatus(h, t = D.today()) {
  if (t < h.startDate) return 'upcoming';
  if (t > habitEnd(h)) return 'completed';
  return 'active';
}
function habitDoneCount(h) {
  let n = 0;
  for (let i = 0; i < h.length; i++) if (h.checks[D.add(h.startDate, i)]) n++;
  return n;
}
function habitStreak(h) {
  const t = D.today();
  let d = h.checks[t] ? t : D.add(t, -1);
  if (d > habitEnd(h)) d = habitEnd(h);
  let n = 0;
  while (d >= h.startDate && h.checks[d]) { n++; d = D.add(d, -1); }
  return n;
}
function toggleHabit(h, date) {
  if (!h || date < h.startDate || date > habitEnd(h) || date > D.today()) return;
  if (h.checks[date]) delete h.checks[date];
  else h.checks[date] = true;
}
const activeHabits = () => state.habits.filter((h) => habitStatus(h) === 'active')
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

/* projects */
function projectTasks(pid) {
  return state.tasks.filter((t) => t.projectId === pid)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || (a.createdAt || 0) - (b.createdAt || 0));
}
function projectStats(pid) {
  const ts = projectTasks(pid);
  if (!ts.length) return { count: 0, done: 0, progress: 0, start: null, end: null };
  let w = 0; let sum = 0; let start = ts[0].start; let end = ts[0].end;
  ts.forEach((t) => {
    const len = D.diff(t.start, t.end) + 1;
    w += len; sum += len * progressOf(t);
    if (t.start < start) start = t.start;
    if (t.end > end) end = t.end;
  });
  return { count: ts.length, done: ts.filter(isDone).length, progress: Math.round(sum / w), start, end };
}

/* today */
function todayData() {
  const t = D.today();
  const hs = activeHabits();
  const open = state.tasks.filter((x) => !isDone(x));
  const doing = doingCol();
  const simple = open
    .filter((x) => !x.projectId && ((x.due && x.due <= t) || (!x.due && x.columnId === doing.id && doing.role === 'doing')))
    .sort((a, b) => quadRank(a) - quadRank(b) || (a.due || '9999').localeCompare(b.due || '9999') || PRIORITY[b.priority].rank - PRIORITY[a.priority].rank);
  const proj = open.filter((x) => x.projectId && x.start <= t).sort((a, b) => quadRank(a) - quadRank(b) || a.end.localeCompare(b.end));
  const doneToday = state.tasks.filter((x) => isDone(x) && x.doneAt === t);
  const week = D.add(t, 7);
  const upcoming = open
    .filter((x) => (x.projectId ? x.start > t && x.start <= week : x.due && x.due > t && x.due <= week))
    .sort((a, b) => (a.projectId ? a.start : a.due).localeCompare(b.projectId ? b.start : b.due));
  const hDone = hs.filter((h) => h.checks[t]).length;
  const total = hs.length + simple.length + proj.length + doneToday.length;
  const done = hDone + doneToday.length;
  return { hs, hDone, simple, proj, doneToday, upcoming, total, done, left: total - done };
}

/* =========================================================
   Pomodoro (timer state is per device)
   ========================================================= */
const POMO_LS = 'planner-pomo';
const pomo = (() => {
  try {
    const p = JSON.parse(localStorage.getItem(POMO_LS) || 'null');
    if (p && MODE_LABEL[p.mode]) return p;
  } catch { /* ignore */ }
  return { mode: 'focus', running: false, endsAt: 0, left: null, taskId: '', count: 0 };
})();
function savePomo() { try { localStorage.setItem(POMO_LS, JSON.stringify(pomo)); } catch { /* ignore */ } }
const pomoCfg = () => state.settings.pomo;
function modeSeconds(m) {
  const c = pomoCfg();
  return 60 * clamp(Number(m === 'focus' ? c.focus : m === 'short' ? c.short : c.long) || 1, 1, 600);
}
function pomoLeft() {
  const total = modeSeconds(pomo.mode);
  if (pomo.running) return clamp(Math.ceil((pomo.endsAt - Date.now()) / 1000), 0, total);
  return pomo.left == null ? total : clamp(pomo.left, 0, total);
}
function pomoStart() {
  if (pomo.running) return;
  const left = pomoLeft();
  pomo.running = true;
  pomo.endsAt = Date.now() + left * 1000;
  pomo.left = null;
  savePomo();
  ensureAudio();
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch { /* ignore */ }
  }
  updatePomoUI();
}
function pomoPause() {
  if (!pomo.running) return;
  pomo.left = pomoLeft();
  pomo.running = false;
  savePomo();
  updatePomoUI();
}
function pomoReset() {
  pomo.running = false;
  pomo.left = null;
  savePomo();
  updatePomoUI();
}
function pomoSetMode(m) {
  pomo.mode = m;
  pomo.running = false;
  pomo.left = null;
  savePomo();
  if (ui.view === 'today') renderMain();
  updatePomoUI();
}
function pomoFinish(completed) {
  const finished = pomo.mode;
  if (finished === 'focus' && completed) {
    const t = pomo.taskId && task(pomo.taskId);
    state.sessions.push({ id: uid(), date: D.today(), minutes: pomoCfg().focus, taskId: t ? t.id : null, at: Date.now() });
    if (t) t.pomodoros = (t.pomodoros || 0) + 1;
    // keep the focus log small
    if (state.sessions.length > 3000) state.sessions = state.sessions.slice(-3000);
    pomo.count = (pomo.count || 0) + 1;
    persist();
  }
  let next = 'focus';
  if (finished === 'focus') next = pomo.count > 0 && pomo.count % pomoCfg().every === 0 ? 'long' : 'short';
  pomo.mode = next;
  pomo.running = false;
  pomo.left = null;
  if (completed && pomoCfg().autoStart) {
    pomo.running = true;
    pomo.endsAt = Date.now() + modeSeconds(next) * 1000;
  }
  savePomo();
  if (completed) {
    const msg = finished === 'focus' ? `Focus done! Time for a ${next === 'long' ? 'long' : 'short'} break.` : 'Break is over. Ready to focus?';
    chime();
    toast(msg);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Planner · Pomodoro', { body: msg, icon: 'icon.png', silent: true }); } catch { /* ignore */ }
    }
  }
  if (isBusy()) { renderSidebar(); updatePomoUI(); } else render();
}

let audioCtx = null;
function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}
function chime() {
  ensureAudio();
  if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch { /* ignore */ } }
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  [[0, 784], [0.22, 988], [0.44, 1175]].forEach(([d, f]) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.7);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 0.75);
  });
}

function updatePomoUI() {
  if (!state) return;
  const left = pomoLeft();
  const total = modeSeconds(pomo.mode);
  const txt = fmtClock(left);
  const el = $('#pomo-time');
  if (el) el.textContent = txt;
  const ring = $('#pomo-ring');
  if (ring) ring.style.setProperty('--p', String(Math.round((1 - left / total) * 1000) / 10));
  const tg = $('#pomo-toggle');
  if (tg) tg.innerHTML = pomo.running ? `${ic('pause')} Pause` : `${ic('play')} ${left < total ? 'Resume' : 'Start'}`;
  const fl = $('#pomo-float');
  const active = pomo.running || left < total;
  if (fl) {
    fl.hidden = !(active && ui.view !== 'today');
    if (!fl.hidden) {
      fl.innerHTML = `<span class="pf-dot ${pomo.mode}"></span><b>${txt}</b><span>${MODE_LABEL[pomo.mode]}</span>
        <button class="icon-btn" data-action="pomo-toggle" title="${pomo.running ? 'Pause' : 'Resume'}">${ic(pomo.running ? 'pause' : 'play')}</button>`;
    }
  }
  document.title = pomo.running ? `${txt} · ${MODE_LABEL[pomo.mode]} — Planner` : 'Planner';
}

setInterval(() => {
  if (!state || !pomo.running) return;
  if (Date.now() - pomo.endsAt > 3600e3) { pomoReset(); return; } // timer ended long ago (app was closed)
  if (pomoLeft() <= 0) pomoFinish(true);
  else updatePomoUI();
}, 500);

/* ---------------- UI state ---------------- */
const ui = {
  view: 'today',
  projectId: null,
  filter: 'all',
  filterProject: '',
  search: '',
  addingIn: null,
  showAllDone: false,
  boardMode: pref.get('boardMode', 'lists'),
  matrixDoing: pref.get('matrixDoing', false),
};
let lastViewKey = '';
let ganttScrolledFor = null;
let ganttGeom = null;
let ganttDragging = false;

/* ---------------- rendering ---------------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme = t === 'system' ? (mq.matches ? 'dark' : 'light') : t;
}
mq.addEventListener('change', () => state && applyTheme());

function render() {
  if (!state) return;
  applyTheme();
  renderSidebar();
  renderMain();
  updatePomoUI();
}

function renderSidebar() {
  const td = todayData();
  const nav = [
    ['today', 'today', 'Today', 'Dashboard & Pomodoro', td.left],
    ['board', 'board', 'Tasks', 'Level 1 · board & matrix', 0],
    ['habits', 'habits', 'Habits', 'Level 2 · 21-day habits', 0],
    ['projects', 'projects', 'Projects', 'Level 3 · Gantt plans', 0],
  ];
  const themeIcon = { system: 'monitor', light: 'sun', dark: 'moon' }[state.settings.theme];
  $('#sidebar').innerHTML = `
    <div class="brand">
      <div class="logo">${ic('check')}</div>
      <div><div class="brand-name">Planner</div><div class="brand-sub">Tasks · Habits · Projects</div></div>
    </div>
    <nav class="nav">
      ${nav.map(([view, icon, label, hint, badge]) => `
        <button class="nav-item ${ui.view === view && !(view === 'projects' && ui.projectId) ? 'active' : ''}" data-action="nav" data-view="${view}">
          ${ic(icon)}
          <span class="nav-text"><span class="nav-label">${label}</span><span class="nav-hint">${hint}</span></span>
          ${badge ? `<span class="badge">${badge}</span>` : ''}
        </button>`).join('')}
    </nav>
    <div class="side-section">
      <div class="side-title">Projects <button class="icon-btn" data-action="new-project" title="New project">${ic('plus', 'sm')}</button></div>
      ${state.projects.length ? state.projects.map((p) => `
        <button class="side-project ${ui.view === 'projects' && ui.projectId === p.id ? 'active' : ''}" data-action="open-project" data-id="${p.id}">
          <span class="dot" style="--c:${p.color}"></span><span class="name">${esc(p.name)}</span><span class="pct">${projectStats(p.id).progress}%</span>
        </button>`).join('') : '<div class="side-empty">No projects yet</div>'}
    </div>
    <div class="side-footer">
      ${hasApi ? `<button class="side-btn" data-action="phone">${ic('phone')} Phone app</button>` : ''}
      <button class="side-btn" data-action="theme">${ic(themeIcon)} Theme: ${cap(state.settings.theme)}</button>
      <button class="side-btn" data-action="export">${ic('download')} Export backup</button>
      <button class="side-btn" data-action="import">${ic('upload')} Import backup</button>
      <div class="side-note">${mode === 'server' ? 'Synced with Planner on your PC.' : 'Saved automatically on this computer.'}</div>
    </div>`;
}

function renderMain() {
  if (!state) return;
  const main = $('#main');
  const key = ui.view + ':' + (ui.projectId || '') + ':' + ui.boardMode;
  const same = key === lastViewKey;
  lastViewKey = key;
  const keep = {};
  $$('[data-keep-scroll]', main).forEach((el) => { keep[el.dataset.keepScroll] = [el.scrollLeft, el.scrollTop]; });
  const mainTop = main.scrollTop;

  let html;
  if (ui.view === 'board') html = viewBoard();
  else if (ui.view === 'habits') html = viewHabits();
  else if (ui.view === 'projects') {
    const p = ui.projectId && project(ui.projectId);
    if (ui.projectId && !p) ui.projectId = null;
    html = p ? viewGantt(p) : viewProjects();
  } else html = viewToday();
  main.innerHTML = html;

  if (same) {
    main.scrollTop = mainTop;
    $$('[data-keep-scroll]', main).forEach((el) => {
      const k = keep[el.dataset.keepScroll];
      if (k) { el.scrollLeft = k[0]; el.scrollTop = k[1]; }
    });
  } else {
    main.scrollTop = 0;
  }
  afterRender();
}

function afterRender() {
  if (ui.view === 'board' && ui.addingIn) {
    const ta = $(`.add-card-form[data-col="${ui.addingIn}"] textarea`);
    if (ta) ta.focus();
  }
  if (ui.view === 'projects' && ui.projectId && ganttGeom) {
    bindGantt();
    if (ganttScrolledFor !== ui.projectId) {
      ganttScrolledFor = ui.projectId;
      scrollGanttToToday();
    }
  }
  updatePomoUI();
}

const emptyState = (icon, title, text, button) => `
  <div class="empty">${ic(icon)}<h3>${title}</h3><p>${text}</p>${button || ''}</div>`;

const prioDot = (t) => (t.priority && t.priority !== 'none'
  ? `<span class="pdot" style="background:${PRIORITY[t.priority].color}" title="${PRIORITY[t.priority].label} priority"></span>` : '');

const quadTag = (t) => (QUADS[t.quadrant]
  ? `<span class="qtag" style="--q:${QUADS[t.quadrant].color}" title="${QUADS[t.quadrant].hint}">${QUADS[t.quadrant].label}</span>` : '');

/* ---------- Today ---------- */
function viewToday() {
  const t = D.today();
  const td = todayData();
  const pct = td.total ? Math.round((td.done / td.total) * 100) : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const panel = (icon, color, title, hint, count, body) => `
    <section class="panel">
      <header class="panel-head">
        <span class="panel-ic ${color}">${ic(icon)}</span>
        <div><h2>${title}</h2><div class="panel-hint">${hint}</div></div>
        <span class="spacer"></span>${count}
      </header>
      <div class="panel-body">${body}</div>
    </section>`;

  const habitsBody = td.hs.length ? td.hs.map(habitRow).join('')
    : `<div class="panel-empty">No active habit. <a data-action="new-habit">Start a 21-day habit</a></div>`;
  const tasksBody = td.simple.length ? td.simple.map(taskRow).join('')
    : `<div class="panel-empty">Nothing due today. Add one above, or plan tasks on the <a data-action="nav" data-view="board">board</a>.</div>`;
  const projBody = td.proj.length ? td.proj.map(taskRow).join('')
    : `<div class="panel-empty">No project task scheduled for today. <a data-action="nav" data-view="projects">Open projects</a></div>`;
  const upBody = td.upcoming.length ? td.upcoming.map(taskRow).join('')
    : '<div class="panel-empty">Nothing planned for the next 7 days.</div>';
  const doneList = ui.showAllDone ? td.doneToday : td.doneToday.slice(0, 4);
  const doneBody = td.doneToday.length
    ? doneList.map(taskRow).join('') + (td.doneToday.length > 4 ? `<button class="more-link" data-action="toggle-all-done">${ui.showAllDone ? 'Show less' : `Show all ${td.doneToday.length}`}</button>` : '')
    : '<div class="panel-empty">Tasks you finish today will show here.</div>';

  return `
  <div class="page">
    <header class="page-head today-head">
      <div>
        <div class="eyebrow">${D.fmt(t, { weekday: 'long' })}</div>
        <h1>${D.fmt(t, { month: 'long', day: 'numeric', year: 'numeric' })}</h1>
        <p class="muted">${greet}! ${td.left ? `You have <b>${plural(td.left, 'thing')}</b> left to do today.` : td.total ? 'Everything is done for today. Great job!' : 'Your day is free.'}</p>
      </div>
      <div class="ring-wrap">
        <div class="ring-text"><b>${td.done} / ${td.total}</b><br>done today</div>
        <div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
      </div>
    </header>
    <form class="quick-add" data-form="quick-today">
      ${ic('plus')}
      <input name="title" placeholder="Add a task for today… (press Enter)" autocomplete="off">
      <button class="btn primary" type="submit">Add</button>
    </form>
    <div class="today-grid">
      ${pomoPanel()}
      ${panel('habits', '', 'Habits', 'Every day until the 21 days are done', `<span class="count">${td.hDone}/${td.hs.length}</span>`, habitsBody)}
      ${panel('task', 'orange', 'Tasks', 'Due today, late, or in progress', `<span class="count">${td.simple.length}</span>`, tasksBody)}
      ${panel('projects', 'green', 'Project tasks', 'From your Gantt plans, scheduled now', `<span class="count">${td.proj.length}</span>`, projBody)}
      ${panel('calendar', 'gray', 'Next 7 days', 'Coming up soon', `<span class="count">${td.upcoming.length}</span>`, upBody)}
      ${panel('check', 'green', 'Completed today', 'Nice work', `<span class="count">${td.doneToday.length}</span>`, doneBody)}
    </div>
  </div>`;
}

function pomoPanel() {
  const t = D.today();
  const left = pomoLeft();
  const total = modeSeconds(pomo.mode);
  const c = pomoCfg();
  const sess = state.sessions.filter((s) => s.date === t);
  const mins = sess.reduce((a, s) => a + (s.minutes || 0), 0);
  const td = todayData();
  const todayIds = new Set([...td.simple, ...td.proj].map((x) => x.id));
  const open = state.tasks.filter((x) => !isDone(x))
    .sort((a, b) => (todayIds.has(b.id) - todayIds.has(a.id)) || quadRank(a) - quadRank(b) || a.title.localeCompare(b.title))
    .slice(0, 80);
  const opts = open.map((x) => `<option value="${x.id}" ${x.id === pomo.taskId ? 'selected' : ''}>${todayIds.has(x.id) ? '★ ' : ''}${esc(x.title)}</option>`).join('');
  return `
    <section class="panel pomo-panel mode-${pomo.mode}">
      <header class="panel-head">
        <span class="panel-ic red">${ic('timer')}</span>
        <div><h2>Pomodoro</h2><div class="panel-hint">${c.focus} min focus · ${c.short} min break · long break every ${c.every}</div></div>
        <span class="spacer"></span>
        <button class="icon-btn" data-action="pomo-settings" title="Timer settings">${ic('gear')}</button>
      </header>
      <div class="pomo-body">
        <div class="seg pomo-modes">${Object.keys(MODE_LABEL).map((m) => `<button class="${pomo.mode === m ? 'on' : ''}" data-action="pomo-mode" data-mode="${m}">${MODE_LABEL[m]}</button>`).join('')}</div>
        <div class="pomo-ring" id="pomo-ring" style="--p:${Math.round((1 - left / total) * 1000) / 10}">
          <div><div class="pomo-time" id="pomo-time">${fmtClock(left)}</div><div class="pomo-label">${MODE_LABEL[pomo.mode]}</div></div>
        </div>
        <div class="pomo-controls">
          <button class="icon-btn round" data-action="pomo-reset" title="Reset">${ic('reset')}</button>
          <button class="btn primary pomo-main" id="pomo-toggle" data-action="pomo-toggle">${pomo.running ? `${ic('pause')} Pause` : `${ic('play')} ${left < total ? 'Resume' : 'Start'}`}</button>
          <button class="icon-btn round" data-action="pomo-skip" title="Skip to next">${ic('skip')}</button>
        </div>
        <label class="pomo-task"><span>Working on</span>
          <select class="input" data-change="pomo-task"><option value="">— No task —</option>${opts}</select>
        </label>
        <div class="pomo-stats">
          ${sess.length ? `<span class="tomatoes">${sess.slice(0, 12).map(() => '<i></i>').join('')}</span>` : ''}
          <span><b>${sess.length}</b> ${sess.length === 1 ? 'session' : 'sessions'} · <b>${mins}</b> min focused today</span>
        </div>
      </div>
    </section>`;
}

function habitRow(h) {
  const t = D.today();
  const on = !!h.checks[t];
  const day = D.diff(h.startDate, t) + 1;
  const streak = habitStreak(h);
  const dots = h.length <= 31 ? `<div class="dots">${Array.from({ length: h.length }, (_, i) => {
    const d = D.add(h.startDate, i);
    return `<i class="${h.checks[d] ? 'on' : d < t ? 'miss' : d === t ? 'now' : ''}"></i>`;
  }).join('')}</div>` : '';
  return `
    <div class="row ${on ? 'done' : ''}" style="--c:${h.color}">
      <button class="check habit ${on ? 'on' : ''}" data-action="habit-today" data-id="${h.id}" title="${on ? 'Undo' : 'Mark done for today'}">${ic('check')}</button>
      <div class="row-main" data-action="nav" data-view="habits">
        <div class="row-title">${esc(h.title)}</div>
        <div class="row-sub">Day ${day} of ${h.length}${streak ? ` &nbsp;·&nbsp; <span class="streak">${ic('flame')} ${streak}-day streak</span>` : ''}</div>
      </div>
      ${dots}
    </div>`;
}

function taskRow(x) {
  const t = D.today();
  const p = x.projectId && project(x.projectId);
  const done = isDone(x);
  let sub;
  if (p) {
    const len = D.diff(x.start, x.end) + 1;
    if (done) sub = `Done · ${D.fmt(x.start)} – ${D.fmt(x.end)}`;
    else if (x.end < t) sub = `<span class="late">Late by ${plural(D.diff(x.end, t), 'day')}</span>`;
    else if (x.start > t) sub = `Starts ${D.rel(x.start)} · ${plural(len, 'day')}`;
    else sub = `Day ${D.diff(x.start, t) + 1} of ${len} · ends ${D.rel(x.end)}`;
  } else if (x.due) {
    if (!done && x.due < t) sub = `<span class="late">Late · was due ${D.fmt(x.due)}</span>`;
    else sub = x.due === t ? 'Due today' : `Due ${D.rel(x.due)}`;
  } else {
    sub = esc(column(x.columnId)?.title || '');
  }
  const prog = progressOf(x);
  return `
    <div class="row ${done ? 'done' : ''}">
      <button class="check ${done ? 'on' : ''}" data-action="toggle-done" data-id="${x.id}" title="${done ? 'Mark as not done' : 'Mark as done'}">${ic('check')}</button>
      <div class="row-main" data-action="open-task" data-id="${x.id}">
        <div class="row-title">${prioDot(x)}${esc(x.title)}</div>
        <div class="row-sub">${quadTag(x)}${p ? `<span class="tag" style="--c:${p.color}">${esc(p.name)}</span>` : ''}${sub}${x.pomodoros ? ` · ${x.pomodoros} 🍅` : ''}</div>
      </div>
      ${p ? `<div class="mini-prog" title="${prog}% done"><span style="width:${prog}%;background:${p.color}"></span></div>` : ''}
      ${done ? '' : `<button class="icon-btn focus-btn" data-action="pomo-focus" data-id="${x.id}" title="Focus on this task (Pomodoro)">${ic('timer')}</button>`}
    </div>`;
}

/* ---------- Board ---------- */
function viewBoard() {
  const f = ui.filter;
  const matrix = ui.boardMode === 'matrix';
  return `
  <div class="page board-page ${matrix ? 'is-matrix' : ''}">
    <header class="page-head">
      <div>
        <div class="eyebrow">Level 1 · Tasks</div>
        <h1>${matrix ? 'Eisenhower matrix' : 'Tasks board'}</h1>
        <p class="muted">${matrix
    ? 'Sort your To Do tasks by <b>urgent</b> and <b>important</b>. Drag a card into a box (or open it and pick a box).'
    : 'All your tasks in one place. Drag cards between lists. Project tasks from your Gantt charts show here too.'}</p>
      </div>
      <div class="toolbar">
        <div class="seg">
          <button class="${!matrix ? 'on' : ''}" data-action="board-mode" data-mode="lists">${ic('board', 'sm')} Lists</button>
          <button class="${matrix ? 'on' : ''}" data-action="board-mode" data-mode="matrix">${ic('matrix', 'sm')} Eisenhower</button>
        </div>
        <div class="seg">
          <button class="${f === 'all' ? 'on' : ''}" data-action="filter" data-filter="all">All</button>
          <button class="${f === 'simple' ? 'on' : ''}" data-action="filter" data-filter="simple">Simple</button>
          <button class="${f === 'projects' ? 'on' : ''}" data-action="filter" data-filter="projects">Projects</button>
        </div>
        <select class="select-sm" data-change="filter-project" title="Filter by project">
          <option value="">Any project</option>
          ${state.projects.map((p) => `<option value="${p.id}" ${ui.filterProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <label class="search">${ic('search', 'sm')}<input id="board-search" placeholder="Search tasks" value="${esc(ui.search)}" autocomplete="off"></label>
        ${matrix
    ? `<label class="toggle"><input type="checkbox" data-change="matrix-doing" ${ui.matrixDoing ? 'checked' : ''}> Include In Progress</label>`
    : `<label class="toggle"><input type="checkbox" data-change="habits-on-board" ${state.settings.showHabitsOnBoard ? 'checked' : ''}> Show habits</label>`}
        <button class="btn primary" data-action="new-task">${ic('plus')} New task</button>
      </div>
    </header>
    <div class="${matrix ? 'matrix-host' : 'board'}" id="board" data-keep-scroll="board">${boardBody()}</div>
  </div>`;
}

function boardBody() {
  return ui.boardMode === 'matrix' ? matrixHtml() : boardColumns();
}

function matchesFilter(t) {
  if (ui.filter === 'simple' && t.projectId) return false;
  if (ui.filter === 'projects' && !t.projectId) return false;
  if (ui.filterProject && t.projectId !== ui.filterProject) return false;
  if (ui.search) {
    const q = ui.search.toLowerCase();
    const p = t.projectId && project(t.projectId);
    const hay = `${t.title} ${t.desc || ''} ${p ? p.name : ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function boardColumns() {
  let html = '';
  if (state.settings.showHabitsOnBoard && ui.filter !== 'projects' && !ui.filterProject) {
    const hs = activeHabits();
    const t = D.today();
    html += `
      <div class="column habit-col">
        <div class="col-head">
          <span class="col-title" data-action="nav" data-view="habits">${ic('habits')} Today's habits</span>
          <span class="col-count">${hs.filter((h) => h.checks[t]).length}/${hs.length}</span>
          <button class="icon-btn" data-action="new-habit" title="New habit">${ic('plus')}</button>
        </div>
        <div class="col-cards">
          ${hs.length ? hs.map(boardHabitCard).join('') : '<div class="empty-col">No active habits.<br><a data-action="new-habit">Start a 21-day habit</a></div>'}
        </div>
        <div class="col-foot"></div>
      </div>`;
  }
  for (const c of state.columns) {
    const ts = colTasks(c.id).filter(matchesFilter);
    const adding = ui.addingIn === c.id;
    html += `
      <div class="column" data-col-id="${c.id}">
        <div class="col-head">
          <span class="col-title" data-action="edit-column" data-id="${c.id}" title="Click to rename">${esc(c.title)}</span>
          <span class="col-count">${ts.length}</span>
          <button class="icon-btn" data-action="edit-column" data-id="${c.id}" title="List options">${ic('more')}</button>
        </div>
        <div class="col-cards" data-col="${c.id}">${ts.map((t) => cardHtml(t)).join('')}</div>
        <div class="col-foot">
          ${adding ? `
            <form class="add-card-form" data-form="add-card" data-col="${c.id}">
              <textarea name="title" placeholder="Enter a title for this card…"></textarea>
              <div class="row-actions">
                <button class="btn primary" type="submit">Add card</button>
                <button class="icon-btn" type="button" data-action="cancel-add-card" title="Cancel">${ic('x')}</button>
              </div>
            </form>` : `<button class="add-card" data-action="add-card" data-col="${c.id}">${ic('plus', 'sm')} Add a card</button>`}
        </div>
      </div>`;
  }
  html += '<button class="add-list" data-action="new-column">+ Add another list</button>';
  return html;
}

function matrixTasks() {
  const todo = todoCol().id;
  const doing = doingCol().id;
  return state.tasks.filter((t) => !isDone(t) && (t.columnId === todo || (ui.matrixDoing && t.columnId === doing)) && matchesFilter(t));
}

function matrixHtml() {
  const by = { do: [], plan: [], delegate: [], drop: [], none: [] };
  matrixTasks().forEach((t) => by[QUADS[t.quadrant] ? t.quadrant : 'none'].push(t));
  const sortKey = (t) => t.end || t.due || '9999';
  Object.values(by).forEach((l) => l.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || PRIORITY[b.priority].rank - PRIORITY[a.priority].rank));
  const quad = (k) => {
    const q = QUADS[k];
    return `
      <div class="quad" data-quad="${k}" style="--q:${q.color}">
        <div class="quad-head">
          <span class="quad-num">${q.n}</span>
          <div><b>${q.label}</b><small>${q.hint}</small></div>
          <span class="spacer"></span><span class="col-count">${by[k].length}</span>
        </div>
        <div class="quad-cards">${by[k].map((t) => cardHtml(t, true)).join('') || `<div class="quad-empty">${q.empty}</div>`}</div>
        <form class="quad-add" data-form="quad-add" data-q="${k}"><input name="title" placeholder="+ Add a task to “${q.label}”" autocomplete="off"></form>
      </div>`;
  };
  return `
    <div class="matrix-layout">
      <div class="matrix">
        <div class="mx-corner"></div>
        <div class="mx-axis top">Urgent</div>
        <div class="mx-axis top">Not urgent</div>
        <div class="mx-axis side">Important</div>
        ${quad('do')}${quad('plan')}
        <div class="mx-axis side">Not important</div>
        ${quad('delegate')}${quad('drop')}
      </div>
      <aside class="mx-tray" data-quad="none">
        <div class="quad-head">
          <span class="quad-num gray">?</span>
          <div><b>Not sorted yet</b><small>To Do tasks without a box</small></div>
          <span class="spacer"></span><span class="col-count">${by.none.length}</span>
        </div>
        <div class="quad-cards">${by.none.map((t) => cardHtml(t, true)).join('') || '<div class="quad-empty">All your To Do tasks are sorted. Well done!</div>'}</div>
      </aside>
    </div>`;
}

function boardHabitCard(h) {
  const t = D.today();
  const on = !!h.checks[t];
  const day = D.diff(h.startDate, t) + 1;
  const streak = habitStreak(h);
  return `
    <div class="card habit-card-sm ${on ? 'is-done' : ''}" style="--c:${h.color}" data-action="edit-habit" data-id="${h.id}">
      <div class="hc-row">
        <button class="check habit ${on ? 'on' : ''}" data-action="habit-today" data-id="${h.id}" title="${on ? 'Undo' : 'Mark done for today'}">${ic('check')}</button>
        <div class="hc-main">
          <div class="card-title">${esc(h.title)}</div>
          <div class="card-sub">Day ${day} of ${h.length}${streak ? ` · <span class="streak">${ic('flame')} ${streak}</span>` : ''}</div>
        </div>
      </div>
      <div class="progress"><span style="width:${Math.round((habitDoneCount(h) / h.length) * 100)}%"></span></div>
    </div>`;
}

function cardHtml(t, inMatrix = false) {
  const p = t.projectId && project(t.projectId);
  const today = D.today();
  const done = isDone(t);
  const chips = [];
  if (p) {
    const late = !done && t.end < today;
    chips.push(`<span class="chip ${late ? 'overdue' : done ? 'done' : t.start <= today ? 'today' : ''}">${ic('calendar')} ${D.fmt(t.start)} – ${D.fmt(t.end)}</span>`);
  } else if (t.due) {
    const cls = done ? 'done' : t.due < today ? 'overdue' : t.due === today ? 'today' : '';
    chips.push(`<span class="chip ${cls}">${ic('clock')} ${cap(D.rel(t.due))}</span>`);
  }
  if (inMatrix && t.columnId !== todoCol().id) chips.push(`<span class="chip">${esc(column(t.columnId)?.title || '')}</span>`);
  if (t.pomodoros) chips.push(`<span class="chip" title="${plural(t.pomodoros, 'focus session')}">${ic('timer')} ${t.pomodoros}</span>`);
  if (t.desc) chips.push(`<span class="chip" title="Has a description">${ic('text')}</span>`);
  if (t.deps && t.deps.length) chips.push(`<span class="chip" title="Waits for ${plural(t.deps.length, 'task')}">${ic('link')} ${t.deps.length}</span>`);
  const labels = [];
  if (t.priority && t.priority !== 'none') labels.push(`<span class="label" style="background:${PRIORITY[t.priority].color}">${PRIORITY[t.priority].label}</span>`);
  if (!inMatrix && QUADS[t.quadrant]) labels.push(`<span class="label" style="background:${QUADS[t.quadrant].color}" title="${QUADS[t.quadrant].hint}">${QUADS[t.quadrant].label}</span>`);
  const prog = progressOf(t);
  return `
    <div class="card ${done ? 'is-done' : ''}" draggable="true" data-id="${t.id}" data-action="open-task">
      ${labels.length ? `<div class="card-labels">${labels.join('')}</div>` : ''}
      ${p ? `<div class="card-project"><span class="tag" style="--c:${p.color}">${esc(p.name)}</span></div>` : ''}
      <button class="check sm card-check ${done ? 'on' : ''}" data-action="toggle-done" data-id="${t.id}" title="${done ? 'Mark as not done' : 'Mark as done'}">${ic('check')}</button>
      <div class="card-title">${esc(t.title)}</div>
      ${chips.length ? `<div class="card-meta">${chips.join('')}</div>` : ''}
      ${p ? `<div class="progress" style="--c:${p.color}" title="${prog}% done"><span style="width:${prog}%"></span></div>` : ''}
    </div>`;
}

/* ---------- Habits ---------- */
function viewHabits() {
  const groups = { active: [], upcoming: [], completed: [] };
  state.habits.forEach((h) => groups[habitStatus(h)].push(h));
  const section = (title, list) => (list.length
    ? `<h2 class="sec-title">${title} <span class="count">${list.length}</span></h2><div class="habit-grid">${list.map(habitCard).join('')}</div>` : '');
  return `
  <div class="page">
    <header class="page-head">
      <div>
        <div class="eyebrow">Level 2 · Habits</div>
        <h1>21-day habits</h1>
        <p class="muted">Do it every day for 21 days to build the habit. Active habits show up in <b>Today</b> and on the <b>board</b> every day.</p>
      </div>
      <button class="btn primary" data-action="new-habit">${ic('plus')} New habit</button>
    </header>
    ${state.habits.length ? `
      <div class="habit-legend">
        <span><i style="background:var(--accent)"></i>Done</span>
        <span><i style="background:var(--danger-soft)"></i>Missed</span>
        <span><i style="border:2px solid var(--accent)"></i>Today</span>
        <span>Click a past day to fix it.</span>
      </div>
      ${section('Active', groups.active)}${section('Starting soon', groups.upcoming)}${section('Finished', groups.completed)}`
    : emptyState('habits', 'No habits yet', 'Pick something small you want to do every day — like reading 10 pages or a 20-minute walk — and keep it for 21 days.',
      `<button class="btn primary" data-action="new-habit">${ic('plus')} Start a 21-day habit</button>`)}
  </div>`;
}

function habitCard(h) {
  const t = D.today();
  const st = habitStatus(h);
  const day = clamp(D.diff(h.startDate, t) + 1, 0, h.length);
  const done = habitDoneCount(h);
  const streak = habitStreak(h);
  const pct = Math.round((done / h.length) * 100);
  const cells = Array.from({ length: h.length }, (_, i) => {
    const d = D.add(h.startDate, i);
    const on = !!h.checks[d];
    const cls = on ? 'done' : d < t ? 'missed' : '';
    const label = `Day ${i + 1} · ${D.fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}`;
    return d <= t
      ? `<button class="h-cell ${cls} ${d === t ? 'today' : ''}" data-action="habit-cell" data-id="${h.id}" data-date="${d}" title="${label}">${on ? ic('check') : i + 1}</button>`
      : `<button class="h-cell" disabled title="${label}">${i + 1}</button>`;
  }).join('');
  let status;
  if (st === 'active') status = `Day ${day} of ${h.length} · ends ${D.fmt(habitEnd(h))}`;
  else if (st === 'upcoming') status = `Starts ${D.rel(h.startDate)}`;
  else status = `Finished ${D.fmt(habitEnd(h))} · ${done}/${h.length} days`;
  let action = '';
  if (st === 'active') {
    action = h.checks[t]
      ? `<button class="btn success block" data-action="habit-today" data-id="${h.id}">${ic('check')} Done for today</button>`
      : `<button class="btn primary block" data-action="habit-today" data-id="${h.id}">Mark today as done</button>`;
  } else if (st === 'completed') {
    action = `<button class="btn block" data-action="restart-habit" data-id="${h.id}">${ic('habits')} Start another ${h.length} days</button>`;
  }
  return `
    <div class="habit-card" style="--c:${h.color}">
      <div class="habit-top">
        <div class="habit-icon">${ic('habits')}</div>
        <div class="habit-titles"><div class="habit-title" title="${esc(h.title)}">${esc(h.title)}</div><div class="habit-sub">${status}</div></div>
        <button class="icon-btn" data-action="edit-habit" data-id="${h.id}" title="Edit habit">${ic('edit')}</button>
      </div>
      <div class="habit-stats">
        <div><b>${done}</b><span>days done</span></div>
        <div><b>${streak}</b><span>day streak</span></div>
        <div><b>${pct}%</b><span>complete</span></div>
      </div>
      <div class="h-grid">${cells}</div>
      ${action}
    </div>`;
}

/* ---------- Projects ---------- */
function viewProjects() {
  return `
  <div class="page">
    <header class="page-head">
      <div>
        <div class="eyebrow">Level 3 · Projects</div>
        <h1>Projects</h1>
        <p class="muted">Plan big goals on a Gantt chart. Every project task also shows on the <b>board</b> and in <b>Today</b> when it is scheduled.</p>
      </div>
      <button class="btn primary" data-action="new-project">${ic('plus')} New project</button>
    </header>
    ${state.projects.length ? `<div class="project-grid">${state.projects.map(projectCard).join('')}</div>`
    : emptyState('projects', 'No projects yet', 'A project is a bigger goal split into tasks with start and end dates, shown on a Gantt chart.',
      `<button class="btn primary" data-action="new-project">${ic('plus')} Create a project</button>`)}
  </div>`;
}

function projectCard(p) {
  const s = projectStats(p.id);
  const next = projectTasks(p.id).find((t) => !isDone(t));
  return `
    <div class="project-card" style="--c:${p.color}" data-action="open-project" data-id="${p.id}">
      <div class="pc-top"><span class="dot" style="--c:${p.color}"></span><h3>${esc(p.name)}</h3></div>
      ${p.desc ? `<p class="pc-desc">${esc(p.desc)}</p>` : ''}
      <div class="pc-dates">${ic('calendar')} ${s.start ? `${D.fmt(s.start)} → ${D.fmt(s.end)}` : 'No tasks yet'}</div>
      <div class="progress"><span style="width:${s.progress}%"></span></div>
      <div class="pc-foot"><span>${s.done}/${s.count} tasks done</span><b>${s.progress}%</b></div>
      ${next ? `<div class="pc-next">Next: <b>${esc(next.title)}</b> · ${D.fmt(next.start)}</div>` : ''}
    </div>`;
}

/* ---------- Gantt ---------- */
function viewGantt(p) {
  const ts = projectTasks(p.id);
  const s = projectStats(p.id);
  const zoom = state.settings.ganttZoom in ZOOM ? state.settings.ganttZoom : 'day';
  const LW = leftW();
  const header = `
    <header class="page-head">
      <div>
        <button class="link-btn" data-action="nav" data-view="projects">${ic('back')} All projects</button>
        <h1><span class="title-dot" style="background:${p.color}"></span>${esc(p.name)}</h1>
        <p class="muted">${p.desc ? esc(p.desc) + ' · ' : ''}${s.done}/${s.count} tasks done · ${s.progress}% complete${s.start ? ` · ${D.fmt(s.start)} → ${D.fmt(s.end)}` : ''}</p>
      </div>
      <div class="toolbar">
        <div class="seg">${Object.keys(ZOOM).map((z) => `<button class="${zoom === z ? 'on' : ''}" data-action="zoom" data-zoom="${z}">${cap(z)}</button>`).join('')}</div>
        <button class="btn" data-action="gantt-today">Today</button>
        <button class="btn" data-action="edit-project" data-id="${p.id}">${ic('edit')} Edit</button>
        <button class="btn primary" data-action="new-task" data-project="${p.id}">${ic('plus')} Add task</button>
      </div>
    </header>`;

  if (!ts.length) {
    ganttGeom = null;
    return `<div class="page">${header}
      <div class="gantt-wrap"><div class="gantt-empty">${emptyState('projects', 'No tasks in this project', 'Add tasks with a start and end date. They will appear as bars here, and on your board.',
        `<button class="btn primary" data-action="new-task" data-project="${p.id}">${ic('plus')} Add the first task</button>`)}</div></div></div>`;
  }

  const today = D.today();
  const dayW = ZOOM[zoom];
  let min = today;
  let max = today;
  ts.forEach((t) => { if (t.start < min) min = t.start; if (t.end > max) max = t.end; });
  let start = D.add(min, zoom === 'day' ? -3 : -7);
  if (zoom !== 'day') start = D.add(start, -((D.dow(start) + 6) % 7)); // align to Monday
  let end = D.add(max, zoom === 'day' ? 14 : zoom === 'week' ? 35 : 90);
  const minDays = Math.ceil(1400 / dayW);
  if (D.diff(start, end) + 1 < minDays) end = D.add(start, minDays - 1);
  const days = D.diff(start, end) + 1;
  const W = days * dayW;
  const H = ts.length * ROW;
  ganttGeom = { start, dayW, W, H };

  let months = '';
  let cur = start;
  while (cur <= end) {
    const me = D.monthEnd(cur) < end ? D.monthEnd(cur) : end;
    const n = D.diff(cur, me) + 1;
    const w = n * dayW;
    const label = w > 90 ? D.fmt(cur, { month: 'long', year: 'numeric' }) : w > 34 ? D.fmt(cur, { month: 'short' }) : '';
    months += `<div class="g-month" style="width:${w}px"><span style="left:${LW + 8}px">${label}</span></div>`;
    cur = D.add(me, 1);
  }
  let dayCells = '';
  let bg = '';
  for (let i = 0; i < days; i++) {
    const d = D.add(start, i);
    const dow = D.dow(d);
    const we = dow === 0 || dow === 6;
    let label = '';
    if (zoom === 'day') label = String(Number(d.slice(8)));
    else if (zoom === 'week' && dow === 1) label = D.fmt(d, { month: 'short', day: 'numeric' });
    if (d === today && label) label = `<span>${label}</span>`;
    dayCells += `<div class="g-day ${we ? 'we' : ''} ${d === today ? 'today' : ''}" style="width:${dayW}px">${label}</div>`;
    if (we && zoom !== 'month') bg += `<div class="g-we" style="left:${i * dayW}px;width:${dayW}px"></div>`;
  }

  const gridStep = zoom === 'day' ? dayW : dayW * 7;
  const bodyStyle = `width:${W}px;height:${H}px;background-image:linear-gradient(to right, var(--grid) 1px, transparent 1px),linear-gradient(to top, var(--grid) 1px, transparent 1px);background-size:${gridStep}px 100%, 100% ${ROW}px`;

  const rowsLeft = ts.map((t) => {
    const done = isDone(t);
    return `
      <div class="g-row-l ${done ? 'done' : ''}" data-action="open-task" data-id="${t.id}" title="${esc(t.title)}">
        <button class="check sm ${done ? 'on' : ''}" data-action="toggle-done" data-id="${t.id}" title="${done ? 'Mark as not done' : 'Mark as done'}">${ic('check')}</button>
        <span class="g-name">${prioDot(t)}${esc(t.title)}</span>
        <span class="g-date">${D.fmt(t.start)}</span>
        <span class="g-date">${D.fmt(t.end)}</span>
        <span class="g-pct">${progressOf(t)}%</span>
      </div>`;
  }).join('');

  const bars = ts.map((t, i) => {
    const x = D.diff(start, t.start) * dayW;
    const w = (D.diff(t.start, t.end) + 1) * dayW;
    const done = isDone(t);
    const late = !done && t.end < today;
    const inside = w >= 110;
    return `
      <div class="g-bar ${late ? 'late' : ''}" data-bar="${t.id}" style="left:${x}px;top:${i * ROW + 8}px;width:${w}px;--c:${p.color}" title="${esc(t.title)} · ${D.fmt(t.start)} – ${D.fmt(t.end)} · ${progressOf(t)}%">
        <div class="g-prog" style="width:${progressOf(t)}%"></div>
        <span class="g-handle l" data-handle="l"></span>
        ${inside ? `<span class="g-label">${done ? ic('check') : ''}${esc(t.title)}</span>` : ''}
        <span class="g-handle r" data-handle="r"></span>
      </div>
      ${inside ? '' : `<div class="g-label-out" data-label-for="${t.id}" style="left:${x + w + 8}px;top:${i * ROW + 8}px">${esc(t.title)}</div>`}`;
  }).join('');

  const idx = new Map(ts.map((t, i) => [t.id, i]));
  let paths = '';
  ts.forEach((t, i) => {
    (t.deps || []).forEach((did) => {
      const j = idx.get(did);
      if (j === undefined) return;
      const d = ts[j];
      const x1 = (D.diff(start, d.end) + 1) * dayW;
      const y1 = j * ROW + ROW / 2;
      const x2 = D.diff(start, t.start) * dayW;
      const y2 = i * ROW + ROW / 2;
      const bad = t.start <= d.end;
      let path;
      if (x2 - x1 >= 18) path = `M${x1} ${y1} H${x1 + 9} V${y2} H${x2 - 1}`;
      else {
        const ym = j < i ? i * ROW + 3 : (i + 1) * ROW - 3;
        path = `M${x1} ${y1} H${x1 + 9} V${ym} H${x2 - 12} V${y2} H${x2 - 1}`;
      }
      paths += `<path d="${path}" class="${bad ? 'bad' : ''}" marker-end="url(#${bad ? 'arr-bad' : 'arr'})"/>`;
    });
  });
  const svg = `
    <svg class="g-deps" width="${W}" height="${H}">
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker>
        <marker id="arr-bad" class="bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker>
      </defs>${paths}
    </svg>`;

  const todayLine = today >= start && today <= end ? `<div class="g-today-line" style="left:${(D.diff(start, today) + 0.5) * dayW}px"></div>` : '';

  return `
  <div class="page">
    ${header}
    <div class="gantt-wrap">
      <div class="gantt-scroll" id="gantt-scroll" data-keep-scroll="gantt">
        <div class="g-inner" style="width:${LW + W}px">
          <div class="g-header-row" style="width:${LW + W}px">
            <div class="g-corner" style="width:${LW}px"><span></span><span>Task</span><span class="g-date">Start</span><span class="g-date">End</span><span style="text-align:right">Done</span></div>
            <div class="g-head" style="width:${W}px"><div class="g-months">${months}</div><div class="g-days">${dayCells}</div></div>
          </div>
          <div class="g-content-row" style="width:${LW + W}px">
            <div class="g-left" style="width:${LW}px">${rowsLeft}</div>
            <div class="g-body" id="g-body" style="${bodyStyle}">${bg}${todayLine}${svg}${bars}</div>
          </div>
        </div>
      </div>
    </div>
    <p class="hint">Drag a bar to move it · drag its left or right edge to change dates · click a bar to edit. Arrows show "waits for" links (red = dates conflict).</p>
  </div>`;
}

function scrollGanttToToday() {
  const sc = $('#gantt-scroll');
  if (!sc || !ganttGeom) return;
  sc.scrollLeft = Math.max(0, (D.diff(ganttGeom.start, D.today()) - 3) * ganttGeom.dayW);
}

function bindGantt() {
  const body = $('#g-body');
  if (!body || !ganttGeom) return;
  const { dayW } = ganttGeom;
  body.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.g-bar');
    if (!bar || e.button !== 0) return;
    const t = task(bar.dataset.bar);
    if (!t) return;
    e.preventDefault();
    const handle = e.target.dataset.handle;
    const dragMode = handle === 'l' ? 'l' : handle === 'r' ? 'r' : 'move';
    const sx = e.clientX;
    const len = D.diff(t.start, t.end);
    const outLabel = $(`[data-label-for="${t.id}"]`, body);
    let dd = 0;
    let moved = false;
    ganttDragging = true;
    const tip = document.createElement('div');
    tip.className = 'g-tip';
    bar.setPointerCapture(e.pointerId);

    const calc = () => {
      let s = t.start; let en = t.end;
      if (dragMode === 'move') { s = D.add(t.start, dd); en = D.add(t.end, dd); }
      else if (dragMode === 'r') en = D.add(t.end, Math.max(dd, -len));
      else s = D.add(t.start, Math.min(dd, len));
      return [s, en];
    };
    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; bar.classList.add('dragging'); body.appendChild(tip); }
      dd = Math.round(dx / dayW);
      const [s, en] = calc();
      const l = D.diff(ganttGeom.start, s) * dayW;
      const w = (D.diff(s, en) + 1) * dayW;
      bar.style.left = l + 'px';
      bar.style.width = w + 'px';
      if (outLabel) outLabel.style.left = (l + w + 8) + 'px';
      tip.textContent = `${D.fmt(s)} → ${D.fmt(en)} · ${plural(D.diff(s, en) + 1, 'day')}`;
      tip.style.left = l + 'px';
      tip.style.top = (parseFloat(bar.style.top) - 6) + 'px';
    };
    const onUp = () => {
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
      tip.remove();
      ganttDragging = false;
      if (!moved) { openTaskModal(t.id); return; }
      const [s, en] = calc();
      if (s !== t.start || en !== t.end) {
        t.start = s; t.end = en; t.due = en;
        commit();
      } else {
        renderMain();
      }
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);
  });
}

/* ---------------- modals ---------------- */
let confirmResolve = null;

function openModal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  if (isMobile()) return; // don't pop the phone keyboard up straight away
  const f = m.querySelector('[autofocus]') || m.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea');
  if (f) { f.focus(); if (f.value && f.select && f.tagName === 'INPUT' && f.type === 'text') f.select(); }
}
function closeModal() {
  const m = $('#modal');
  m.hidden = true;
  m.innerHTML = '';
  if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
}
function confirmBox(title, text, ok = 'Delete') {
  openModal(`
    <div class="modal-head"><h3>${esc(title)}</h3></div>
    <p>${esc(text)}</p>
    <div class="modal-actions"><span class="spacer"></span>
      <button class="btn" data-action="confirm-no">Cancel</button>
      <button class="btn danger solid" data-action="confirm-yes" autofocus>${esc(ok)}</button>
    </div>`, 'small');
  return new Promise((res) => { confirmResolve = res; });
}

const modalHead = (title) => `<div class="modal-head"><h3>${title}</h3><button type="button" class="icon-btn" data-action="modal-close" title="Close">${ic('x')}</button></div>`;
const swatches = (sel) => `<div class="swatches">${COLORS.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === sel ? 'checked' : ''}><span></span></label>`).join('')}</div>`;

function depsHtml(projectId, selfId, selected) {
  const list = projectId ? projectTasks(projectId).filter((t) => t.id !== selfId) : [];
  if (!list.length) return '<div class="none">No other tasks in this project yet.</div>';
  return list.map((t) => `
    <label><input type="checkbox" name="deps" value="${t.id}" ${selected.includes(t.id) ? 'checked' : ''}>
      <span>${esc(t.title)}</span><span class="spacer"></span><small class="muted">${D.fmt(t.start)} – ${D.fmt(t.end)}</small></label>`).join('');
}

function quadPicker(sel) {
  const items = [...Object.entries(QUADS), ['', { label: 'Not sorted', hint: 'Not in the matrix yet', color: 'var(--text-3)' }]];
  return `<div class="qpick">${items.map(([k, q]) => `
    <label class="qp" style="--q:${q.color}" title="${q.hint}">
      <input type="radio" name="quadrant" value="${k}" ${(sel || '') === k ? 'checked' : ''}>
      <span>${k ? `<i></i>${q.n}. ` : ''}${q.label}</span>
    </label>`).join('')}</div>`;
}

function openTaskModal(id, preset = {}) {
  const t = id ? task(id) : null;
  if (id && !t) return;
  const today = D.today();
  let v;
  if (t) v = { ...t };
  else {
    const pid = preset.projectId || '';
    let start = today;
    if (pid) {
      const ts = projectTasks(pid);
      if (ts.length) { const lastEnd = ts.reduce((m, x) => (x.end > m ? x.end : m), ts[0].end); start = D.add(lastEnd, 1); }
    }
    v = makeTask({ columnId: preset.columnId || todoCol().id, projectId: pid || null, due: preset.due || null, start, end: D.add(start, 2), quadrant: preset.quadrant || null });
  }
  const isProj = !!v.projectId;
  const start = v.start || v.due || today;
  const end = v.end && v.end >= start ? v.end : D.add(start, 2);
  const firstProject = state.projects[0];
  const projectId = v.projectId || (firstProject ? firstProject.id : '');
  openModal(`
    <form data-form="task" data-id="${t ? t.id : ''}" class="${isProj ? 'is-project' : ''}">
      ${modalHead(t ? 'Edit task' : 'New task')}
      <label class="field"><span>Title</span><input type="text" name="title" required value="${esc(v.title)}" autofocus placeholder="What needs to be done?"></label>
      <div class="type-switch">
        <label class="type-opt"><input type="radio" name="kind" value="simple" ${!isProj ? 'checked' : ''} data-change="task-kind">
          <span><b>Simple task</b><small>A to-do with an optional due date</small></span></label>
        <label class="type-opt"><input type="radio" name="kind" value="project" ${isProj ? 'checked' : ''} ${state.projects.length ? '' : 'disabled'} data-change="task-kind">
          <span><b>Project task</b><small>${state.projects.length ? 'Has start & end dates on a Gantt chart' : 'Create a project first'}</small></span></label>
      </div>
      <div class="project-only">
        <div class="grid2">
          <label class="field"><span>Project</span><select name="projectId" data-change="task-project">
            ${state.projects.map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></label>
          <label class="field"><span>Done</span><div class="range-row"><input type="range" name="progress" min="0" max="100" step="5" value="${progressOf(v)}"><output id="prog-out">${progressOf(v)}%</output></div></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Start date</span><input type="date" name="start" value="${start}"></label>
          <label class="field"><span>End date</span><input type="date" name="end" value="${end}"></label>
        </div>
        <div class="field"><span>Waits for (must finish before this task starts)</span><div class="deps-box" id="deps-box">${depsHtml(projectId, v.id, v.deps || [])}</div></div>
      </div>
      <div class="field"><span>Eisenhower matrix</span>${quadPicker(v.quadrant)}</div>
      <div class="grid2">
        <label class="field"><span>List</span><select name="columnId">
          ${state.columns.map((c) => `<option value="${c.id}" ${c.id === v.columnId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Priority</span><select name="priority">
          ${Object.entries(PRIORITY).map(([k, p]) => `<option value="${k}" ${k === (v.priority || 'none') ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select></label>
      </div>
      <div class="simple-only">
        <label class="field"><span>Due date</span><input type="date" name="due" value="${!isProj && v.due ? v.due : ''}"></label>
      </div>
      <label class="field"><span>Description</span><textarea name="desc" rows="3" placeholder="Add more details…">${esc(v.desc)}</textarea></label>
      ${t && t.pomodoros ? `<p class="muted small">${ic('timer', 'sm')} ${plural(t.pomodoros, 'focus session')} spent on this task.</p>` : ''}
      <div class="modal-actions">
        ${t ? `<button type="button" class="btn danger ghost" data-action="delete-task" data-id="${t.id}">${ic('trash')} Delete</button>` : ''}
        ${t && !isDone(t) ? `<button type="button" class="btn ghost" data-action="pomo-focus" data-id="${t.id}">${ic('timer')} Focus</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="modal-close">Cancel</button>
        <button type="submit" class="btn primary">${t ? 'Save' : 'Create task'}</button>
      </div>
    </form>`);
}

function openHabitModal(id) {
  const h = id ? habit(id) : null;
  const v = h || { title: '', desc: '', startDate: D.today(), length: 21, color: COLORS[state.habits.length % COLORS.length] };
  const lengths = [7, 14, 21, 30, 40, 66];
  if (!lengths.includes(v.length)) lengths.push(v.length);
  openModal(`
    <form data-form="habit" data-id="${h ? h.id : ''}">
      ${modalHead(h ? 'Edit habit' : 'New 21-day habit')}
      <label class="field"><span>Habit</span><input type="text" name="title" required value="${esc(v.title)}" autofocus placeholder="e.g. Read 10 pages, Drink 2L of water"></label>
      <div class="grid2">
        <label class="field"><span>Start date</span><input type="date" name="startDate" required value="${v.startDate}"></label>
        <label class="field"><span>Length</span><select name="length">
          ${lengths.sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === v.length ? 'selected' : ''}>${n} days${n === 21 ? ' (recommended)' : ''}</option>`).join('')}
        </select></label>
      </div>
      <div class="field"><span>Color</span>${swatches(v.color)}</div>
      <label class="field"><span>Notes</span><textarea name="desc" rows="2" placeholder="Why does this habit matter to you?">${esc(v.desc || '')}</textarea></label>
      <div class="modal-actions">
        ${h ? `<button type="button" class="btn danger ghost" data-action="delete-habit" data-id="${h.id}">${ic('trash')} Delete</button>
               <button type="button" class="btn ghost" data-action="restart-habit" data-id="${h.id}">${ic('habits')} Restart</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="modal-close">Cancel</button>
        <button type="submit" class="btn primary">${h ? 'Save' : 'Start habit'}</button>
      </div>
    </form>`);
}

function openProjectModal(id) {
  const p = id ? project(id) : null;
  const v = p || { name: '', desc: '', color: COLORS[(state.projects.length + 2) % COLORS.length] };
  openModal(`
    <form data-form="project" data-id="${p ? p.id : ''}">
      ${modalHead(p ? 'Edit project' : 'New project')}
      <label class="field"><span>Project name</span><input type="text" name="name" required value="${esc(v.name)}" autofocus placeholder="e.g. Move to a new flat"></label>
      <label class="field"><span>Description</span><textarea name="desc" rows="2" placeholder="What is the goal?">${esc(v.desc || '')}</textarea></label>
      <div class="field"><span>Color</span>${swatches(v.color)}</div>
      <div class="modal-actions">
        ${p ? `<button type="button" class="btn danger ghost" data-action="delete-project" data-id="${p.id}">${ic('trash')} Delete project</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="modal-close">Cancel</button>
        <button type="submit" class="btn primary">${p ? 'Save' : 'Create project'}</button>
      </div>
    </form>`, 'small');
}

function openColumnModal(id) {
  const c = id ? column(id) : null;
  const canDelete = c && c.role !== 'done' && state.columns.length > 1;
  openModal(`
    <form data-form="column" data-id="${c ? c.id : ''}">
      ${modalHead(c ? 'Edit list' : 'New list')}
      <label class="field"><span>List name</span><input type="text" name="title" required value="${esc(c ? c.title : '')}" autofocus placeholder="e.g. Waiting"></label>
      ${c && c.role === 'done' ? '<p>Cards moved to this list count as finished.</p>' : ''}
      <div class="modal-actions">
        ${canDelete ? `<button type="button" class="btn danger ghost" data-action="delete-column" data-id="${c.id}">${ic('trash')} Delete list</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="modal-close">Cancel</button>
        <button type="submit" class="btn primary">${c ? 'Save' : 'Add list'}</button>
      </div>
    </form>`, 'small');
}

function openPomoSettings() {
  const c = pomoCfg();
  openModal(`
    <form data-form="pomo-settings">
      ${modalHead('Pomodoro settings')}
      <div class="grid2">
        <label class="field"><span>Focus (minutes)</span><input type="number" name="focus" min="1" max="180" value="${c.focus}"></label>
        <label class="field"><span>Short break (minutes)</span><input type="number" name="short" min="1" max="60" value="${c.short}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Long break (minutes)</span><input type="number" name="long" min="1" max="120" value="${c.long}"></label>
        <label class="field"><span>Long break after</span><select name="every">
          ${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === Number(c.every) ? 'selected' : ''}>${n} focus sessions</option>`).join('')}
        </select></label>
      </div>
      <label class="toggle"><input type="checkbox" name="autoStart" ${c.autoStart ? 'checked' : ''}> Start the next timer automatically</label>
      <div class="modal-actions" style="margin-top:16px">
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="modal-close">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`, 'small');
}

/* ----- phone access (desktop only) ----- */
async function openPhoneModal(fresh) {
  if (!hasApi) return;
  openModal(`${modalHead('Phone app')}<div id="phone-body"><p>Loading…</p></div>`);
  renderPhoneBody(await window.api.phoneStatus(!!fresh));
}

function renderPhoneBody(st) {
  const box = $('#phone-body');
  if (!box) return;
  const first = st.urls[0];
  let inner;
  if (st.enabled && st.running && first) {
    inner = `
      ${first.profile === 'Public' ? `
        <div class="warn-box">
          <b>Windows blocks the phone on this Wi-Fi.</b> Your Wi-Fi “${esc(first.name)}” is set to <b>Public network</b>.
          For your home Wi-Fi, open Wi-Fi settings → your network → <b>Network profile type</b> → choose <b>Private</b>.
          <div><button class="btn" data-action="wifi-settings">Open Wi-Fi settings</button>
          <button class="btn ghost" data-action="phone-recheck">Check again</button></div>
        </div>` : ''}
      <div class="phone-box">
        ${first.qr ? `<img src="${first.qr}" alt="QR code to open Planner on your phone">` : ''}
        <div>
          <ol class="phone-steps">
            <li>Connect your phone to the <b>same Wi-Fi</b> as this PC.</li>
            <li>Scan the QR code with the phone camera, or type the address below.</li>
            <li>In the phone browser menu, tap <b>Add to Home screen</b>.</li>
          </ol>
          <div class="field" style="margin-top:12px"><span>Address</span><div class="phone-url">${esc(first.short)}</div></div>
          <div class="field"><span>Access code</span><div class="code">${esc(st.key)}</div></div>
        </div>
      </div>
      ${st.urls.length > 1 ? `<details class="note"><summary>Other addresses of this PC</summary>${st.urls.slice(1).map((u) => `<div>${esc(u.name)}: <b>${esc(u.short)}</b></div>`).join('')}</details>` : ''}
      <p class="note">If Windows asks about the firewall, click <b>Allow</b> for <b>Private networks</b>. Planner must stay open on this PC for the phone to sync.
        To use it outside home, install the free <b>Tailscale</b> app on the PC and the phone.</p>
      <div class="modal-actions">
        <button class="btn ghost" data-action="phone-new-key">${ic('reset')} New access code</button>
        <span class="spacer"></span>
        <button class="btn primary" data-action="modal-close">Done</button>
      </div>`;
  } else if (st.enabled && !st.running) {
    inner = `<p class="late">Could not start phone sharing: ${esc(st.error || 'unknown error')}</p>`;
  } else if (st.enabled) {
    inner = '<p class="late">This PC is not connected to any network. Connect it to your Wi-Fi first.</p>';
  } else {
    inner = `<p>Turn this on to use Planner on your phone. Your phone and this PC must be on the <b>same Wi-Fi</b>.
      Tasks, habits, projects and focus sessions stay in sync on both.</p>`;
  }
  box.innerHTML = `
    <label class="switch-row"><span>${ic('phone')} Share Planner on my Wi-Fi</span><input type="checkbox" data-change="phone-enable" ${st.enabled ? 'checked' : ''}></label>
    ${inner}`;
}

/* ----- phone: access code screen ----- */
function showAccessScreen(message) {
  $('#sidebar').innerHTML = '';
  $('#main').innerHTML = `
    <div class="access">
      <div class="logo">${ic('check')}</div>
      <h1>Planner</h1>
      <p class="muted">Enter the access code shown on your PC<br>(Planner → <b>Phone app</b>).</p>
      <form data-form="access">
        <input class="input code-input" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE">
        <button class="btn primary block" type="submit">Connect</button>
      </form>
      ${message ? `<p class="late">${esc(message)}</p>` : ''}
    </div>`;
}

/* ---------------- form handlers ---------------- */
const forms = {
  'quick-today'(f) {
    const title = String(new FormData(f).get('title') || '').trim();
    if (!title) return;
    const c = todoCol();
    state.tasks.push(makeTask({ title, due: D.today(), columnId: c.id, order: nextOrder(c.id) }));
    commit();
    toast('Task added for today');
    const input = $('.quick-add input');
    if (input) input.focus();
  },

  'add-card'(f) {
    const title = String(new FormData(f).get('title') || '').trim();
    const colId = f.dataset.col;
    if (!title) return;
    const nt = makeTask({ title, columnId: colId, order: nextOrder(colId) });
    if (column(colId)?.role === 'done') nt.doneAt = D.today();
    if (ui.filterProject) {
      nt.projectId = ui.filterProject; nt.start = D.today(); nt.end = D.add(nt.start, 2); nt.due = nt.end;
    }
    state.tasks.push(nt);
    commit();
    const list = $(`.col-cards[data-col="${colId}"]`);
    if (list) list.scrollTop = list.scrollHeight;
  },

  'quad-add'(f) {
    const title = String(new FormData(f).get('title') || '').trim();
    if (!title) return;
    const c = todoCol();
    const nt = makeTask({ title, columnId: c.id, order: nextOrder(c.id), quadrant: f.dataset.q });
    if (ui.filterProject) {
      nt.projectId = ui.filterProject; nt.start = D.today(); nt.end = D.add(nt.start, 2); nt.due = nt.end;
    }
    state.tasks.push(nt);
    commit();
    const input = $(`.quad-add[data-q="${f.dataset.q}"] input`);
    if (input) input.focus();
  },

  task(f) {
    const fd = new FormData(f);
    const title = String(fd.get('title') || '').trim();
    if (!title) return;
    const kindProject = fd.get('kind') === 'project' && fd.get('projectId');
    let t = f.dataset.id ? task(f.dataset.id) : null;
    const isNew = !t;
    if (isNew) t = makeTask({});
    const oldCol = t.columnId;
    const oldProgress = t.progress;
    t.title = title;
    t.desc = String(fd.get('desc') || '').trim();
    t.priority = String(fd.get('priority') || 'none');
    t.quadrant = QUADS[fd.get('quadrant')] ? String(fd.get('quadrant')) : null;
    let newProgress = t.progress;
    if (kindProject) {
      t.projectId = String(fd.get('projectId'));
      const s = D.ok(fd.get('start')) ? fd.get('start') : D.today();
      let e = D.ok(fd.get('end')) ? fd.get('end') : s;
      if (e < s) e = s;
      t.start = s; t.end = e; t.due = e;
      t.deps = fd.getAll('deps').map(String);
      newProgress = clamp(parseInt(fd.get('progress'), 10) || 0, 0, 100);
    } else {
      t.projectId = null; t.start = null; t.end = null; t.deps = []; t.progress = 0;
      t.due = D.ok(fd.get('due')) ? fd.get('due') : null;
    }
    const newCol = String(fd.get('columnId') || todoCol().id);
    if (isNew) {
      t.columnId = todoCol().id;
      t.order = nextOrder(newCol);
      state.tasks.push(t);
      setTaskColumn(t, newCol);
      if (kindProject && !isDone(t)) setTaskProgress(t, newProgress);
    } else if (newCol !== oldCol) {
      setTaskColumn(t, newCol);
      t.order = isDone(t) ? firstOrder(newCol) : nextOrder(newCol);
    } else if (kindProject && newProgress !== oldProgress) {
      setTaskProgress(t, newProgress);
    } else if (kindProject) {
      t.progress = newProgress;
    }
    cleanDeps();
    closeModal();
    commit();
  },

  habit(f) {
    const fd = new FormData(f);
    const title = String(fd.get('title') || '').trim();
    if (!title) return;
    let h = f.dataset.id ? habit(f.dataset.id) : null;
    if (!h) {
      h = { id: uid(), checks: {}, createdAt: Date.now() };
      state.habits.push(h);
    }
    h.title = title;
    h.desc = String(fd.get('desc') || '').trim();
    h.startDate = D.ok(fd.get('startDate')) ? fd.get('startDate') : D.today();
    h.length = clamp(parseInt(fd.get('length'), 10) || 21, 1, 365);
    h.color = String(fd.get('color') || COLORS[0]);
    closeModal();
    commit();
  },

  project(f) {
    const fd = new FormData(f);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    let p = f.dataset.id ? project(f.dataset.id) : null;
    const isNew = !p;
    if (!p) {
      p = { id: uid(), createdAt: Date.now() };
      state.projects.push(p);
    }
    p.name = name;
    p.desc = String(fd.get('desc') || '').trim();
    p.color = String(fd.get('color') || COLORS[0]);
    closeModal();
    if (isNew) { ui.view = 'projects'; ui.projectId = p.id; }
    commit();
  },

  column(f) {
    const title = String(new FormData(f).get('title') || '').trim();
    if (!title) return;
    const c = f.dataset.id ? column(f.dataset.id) : null;
    if (c) c.title = title;
    else {
      const i = state.columns.findIndex((x) => x.role === 'done');
      state.columns.splice(i < 0 ? state.columns.length : i, 0, { id: 'col-' + uid(), title });
    }
    closeModal();
    commit();
  },

  'pomo-settings'(f) {
    const fd = new FormData(f);
    const num = (k, max, d) => clamp(parseInt(fd.get(k), 10) || d, 1, max);
    state.settings.pomo = {
      focus: num('focus', 180, 25),
      short: num('short', 60, 5),
      long: num('long', 120, 15),
      every: num('every', 10, 4),
      autoStart: fd.get('autoStart') === 'on',
    };
    if (!pomo.running) pomo.left = null;
    savePomo();
    closeModal();
    commit();
  },

  access(f) {
    const code = String(new FormData(f).get('code') || '').trim().toUpperCase();
    if (!code) return;
    try { localStorage.setItem(KEY_LS, code); } catch { /* ignore */ }
    init();
  },
};

/* ---------------- click actions ---------------- */
const actions = {
  nav(el) {
    ui.view = el.dataset.view;
    ui.projectId = null;
    ui.addingIn = null;
    render();
  },
  'open-project'(el) {
    ui.view = 'projects';
    ui.projectId = el.dataset.id;
    render();
  },
  'new-task'(el) {
    const preset = {};
    if (el.dataset.project) preset.projectId = el.dataset.project;
    else if (ui.view === 'board' && ui.filterProject) preset.projectId = ui.filterProject;
    if (ui.view === 'today') preset.due = D.today();
    openTaskModal(null, preset);
  },
  'open-task'(el) { openTaskModal(el.dataset.id); },
  'toggle-done'(el) {
    const t = task(el.dataset.id);
    const wasDone = t && isDone(t);
    toggleDone(t);
    commit();
    if (t && !wasDone) toast(`Done: ${t.title}`);
  },
  async 'delete-task'(el) {
    const t = task(el.dataset.id);
    if (!t) return;
    if (await confirmBox('Delete task?', `"${t.title}" will be deleted for good.`)) {
      deleteTask(t.id);
      closeModal();
      commit();
    }
  },
  'add-card'(el) { ui.addingIn = el.dataset.col; renderMain(); },
  'cancel-add-card'() { ui.addingIn = null; renderMain(); },
  filter(el) { ui.filter = el.dataset.filter; renderMain(); },
  'board-mode'(el) {
    ui.boardMode = el.dataset.mode === 'matrix' ? 'matrix' : 'lists';
    pref.set('boardMode', ui.boardMode);
    ui.addingIn = null;
    renderMain();
  },
  'new-column'() { openColumnModal(); },
  'edit-column'(el) { openColumnModal(el.dataset.id); },
  async 'delete-column'(el) {
    const c = column(el.dataset.id);
    if (!c) return;
    const n = colTasks(c.id).length;
    const ok = await confirmBox('Delete list?', n ? `"${c.title}" has ${plural(n, 'card')}. They will move to another list.` : `Delete the list "${c.title}"?`);
    if (!ok) return;
    state.columns = state.columns.filter((x) => x.id !== c.id);
    const target = todoCol() || state.columns[0];
    state.tasks.filter((t) => t.columnId === c.id).forEach((t) => { t.columnId = target.id; t.order = nextOrder(target.id); });
    closeModal();
    commit();
  },
  'new-habit'() { openHabitModal(); },
  'edit-habit'(el) { openHabitModal(el.dataset.id); },
  'habit-today'(el) {
    const h = habit(el.dataset.id);
    if (!h) return;
    toggleHabit(h, D.today());
    commit();
    if (h.checks[D.today()]) {
      const n = habitDoneCount(h);
      toast(n >= h.length ? `Amazing! You finished all ${h.length} days of "${h.title}"!` : `Habit done for today · ${n}/${h.length} days`);
    }
  },
  'habit-cell'(el) { toggleHabit(habit(el.dataset.id), el.dataset.date); commit(); },
  async 'restart-habit'(el) {
    const h = habit(el.dataset.id);
    if (!h) return;
    const ok = await confirmBox('Restart habit?', `"${h.title}" will start again today for ${h.length} days. Past check marks will be cleared.`, 'Restart');
    if (!ok) return;
    h.startDate = D.today();
    h.checks = {};
    closeModal();
    commit();
  },
  async 'delete-habit'(el) {
    const h = habit(el.dataset.id);
    if (!h) return;
    if (await confirmBox('Delete habit?', `"${h.title}" and its history will be deleted for good.`)) {
      state.habits = state.habits.filter((x) => x.id !== h.id);
      closeModal();
      commit();
    }
  },
  'new-project'() { openProjectModal(); },
  'edit-project'(el) { openProjectModal(el.dataset.id); },
  async 'delete-project'(el) {
    const p = project(el.dataset.id);
    if (!p) return;
    const n = projectTasks(p.id).length;
    if (!(await confirmBox('Delete project?', `"${p.name}" and its ${plural(n, 'task')} will be deleted for good.`))) return;
    state.tasks = state.tasks.filter((t) => t.projectId !== p.id);
    state.projects = state.projects.filter((x) => x.id !== p.id);
    if (ui.projectId === p.id) ui.projectId = null;
    if (ui.filterProject === p.id) ui.filterProject = '';
    cleanDeps();
    closeModal();
    commit();
  },
  zoom(el) {
    state.settings.ganttZoom = el.dataset.zoom;
    persist();
    ganttScrolledFor = null;
    renderMain();
  },
  'gantt-today'() { scrollGanttToToday(); },
  theme() {
    const order = ['system', 'light', 'dark'];
    state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    commit();
  },
  async export() {
    if (hasApi) {
      const p = await window.api.exportData(state);
      if (p) toast('Backup saved');
    } else {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `planner-backup-${D.today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  },
  async import() {
    if (hasApi) importData(await window.api.importData());
    else $('#import-file').click();
  },
  'toggle-all-done'() { ui.showAllDone = !ui.showAllDone; renderMain(); },
  'modal-close'() { closeModal(); },
  'confirm-yes'() {
    const r = confirmResolve;
    confirmResolve = null;
    closeModal();
    if (r) r(true);
  },
  'confirm-no'() { closeModal(); },

  /* pomodoro */
  'pomo-toggle'() { if (pomo.running) pomoPause(); else pomoStart(); },
  'pomo-reset'() { pomoReset(); },
  'pomo-skip'() { pomoFinish(false); },
  'pomo-mode'(el) { pomoSetMode(el.dataset.mode); },
  'pomo-settings'() { openPomoSettings(); },
  'pomo-focus'(el) {
    const t = task(el.dataset.id);
    if (!t) return;
    closeModal();
    pomo.taskId = t.id;
    if (!(pomo.running && pomo.mode === 'focus')) {
      pomo.mode = 'focus';
      pomo.running = false;
      pomo.left = null;
      pomoStart();
    }
    savePomo();
    ui.view = 'today';
    ui.projectId = null;
    render();
    $('#main').scrollTop = 0;
    toast(`Focus: ${t.title}`);
  },

  /* phone */
  phone() { openPhoneModal(); },
  'phone-recheck'() { openPhoneModal(true); },
  'wifi-settings'() { if (hasApi) window.api.openWifiSettings(); },
  async 'phone-new-key'() {
    const ok = await confirmBox('New access code?', 'Phones that are already connected will need to enter the new code.', 'Change code');
    if (!ok) return;
    await window.api.phoneNewKey();
    openPhoneModal();
  },
  'sync-pill'() {
    if (syncStatus === 'auth') showAccessScreen('');
    else poll();
  },
};

async function importData(data) {
  if (!data) return;
  if (data.__error) { toast(data.__error); return; }
  const n = normalize(data);
  if (!n) { toast('This file is not a valid Planner backup.'); return; }
  const ok = await confirmBox('Import backup?', `This replaces everything with the backup (${plural(n.tasks.length, 'task')}, ${plural(n.habits.length, 'habit')}, ${plural(n.projects.length, 'project')}).`, 'Import');
  if (!ok) return;
  // Mark everything not in the backup as deleted and the backup as newest, so the phone follows too
  const now = Date.now();
  const keep = new Set(ITEM_KEYS.flatMap((k) => n[k].map((x) => x.id)));
  ITEM_KEYS.forEach((k) => state[k].forEach((x) => { if (!keep.has(x.id)) n.deleted[x.id] = now; }));
  ITEM_KEYS.forEach((k) => n[k].forEach((x) => { x.updatedAt = now; delete n.deleted[x.id]; }));
  n.columnsUpdatedAt = now;
  n.settings.updatedAt = now;
  state = n;
  resetSnapshot();
  ui.projectId = null;
  ui.filterProject = '';
  changeId++;
  scheduleSave(50);
  render();
  toast('Backup imported');
}

/* ---------------- global events ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el, e);
});

$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

document.addEventListener('submit', (e) => {
  const f = e.target;
  const kind = f.dataset && f.dataset.form;
  if (!kind || !forms[kind]) return;
  e.preventDefault();
  forms[kind](f);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file') {
    const file = el.files && el.files[0];
    if (!file) return;
    file.text().then((txt) => {
      try { importData(JSON.parse(txt)); } catch { toast('This file is not a valid Planner backup.'); }
    });
    el.value = '';
    return;
  }
  switch (el.dataset.change) {
    case 'filter-project': ui.filterProject = el.value; renderMain(); break;
    case 'habits-on-board': state.settings.showHabitsOnBoard = el.checked; commit(); break;
    case 'matrix-doing': ui.matrixDoing = el.checked; pref.set('matrixDoing', el.checked); renderMain(); break;
    case 'task-kind': el.form.classList.toggle('is-project', el.value === 'project'); break;
    case 'task-project': {
      const f = el.form;
      const sel = $$('input[name="deps"]:checked', f).map((x) => x.value);
      $('#deps-box').innerHTML = depsHtml(el.value, f.dataset.id, sel);
      break;
    }
    case 'pomo-task': pomo.taskId = el.value; savePomo(); el.blur(); break;
    case 'phone-enable':
      el.disabled = true;
      window.api.phoneSet(el.checked).then(renderPhoneBody);
      break;
    default:
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'board-search') {
    ui.search = el.value;
    $('#board').innerHTML = boardBody();
  } else if (el.name === 'progress' && el.type === 'range') {
    const out = $('#prog-out');
    if (out) out.textContent = el.value + '%';
  }
});

document.addEventListener('keydown', (e) => {
  if (!state) return;
  const modalOpen = !$('#modal').hidden;
  if (e.key === 'Escape') {
    if (modalOpen) closeModal();
    else if (ui.addingIn) { ui.addingIn = null; renderMain(); }
    return;
  }
  if (e.target.matches && e.target.matches('.add-card-form textarea') && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.target.form.requestSubmit();
    return;
  }
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if (typing || modalOpen) return;
  if (e.ctrlKey && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    ui.view = ['today', 'board', 'habits', 'projects'][Number(e.key) - 1];
    ui.projectId = null;
    render();
    return;
  }
  if (e.key === ' ' && ui.view === 'today') {
    e.preventDefault();
    actions['pomo-toggle']();
    return;
  }
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (ui.view === 'habits') openHabitModal();
    else if (ui.view === 'projects' && !ui.projectId) openProjectModal();
    else actions['new-task']({ dataset: { project: ui.projectId || '' } });
  }
});

/* drag & drop for board cards (lists and Eisenhower boxes) */
let drag = null;
let ph = null;
function removePlaceholder() { if (ph && ph.parentElement) ph.remove(); }
function clearDropMarks() { $$('.drop-over').forEach((x) => x.classList.remove('drop-over')); }

document.addEventListener('dragstart', (e) => {
  const card = e.target.closest && e.target.closest('.card[data-id][draggable="true"]');
  if (!card) return;
  drag = { id: card.dataset.id, el: card, h: card.offsetHeight };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.id);
  setTimeout(() => card.classList.add('dragging'), 0);
});
document.addEventListener('dragend', () => {
  if (drag) drag.el.classList.remove('dragging');
  drag = null;
  removePlaceholder();
  clearDropMarks();
});
document.addEventListener('dragover', (e) => {
  if (!drag || !e.target.closest) return;
  const zone = e.target.closest('.quad[data-quad], .mx-tray[data-quad]');
  if (zone) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!zone.classList.contains('drop-over')) { clearDropMarks(); zone.classList.add('drop-over'); }
    return;
  }
  const colEl = e.target.closest('.column[data-col-id]');
  if (!colEl) return;
  const list = colEl.querySelector('.col-cards');
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (!ph) { ph = document.createElement('div'); ph.className = 'placeholder'; }
  ph.style.height = drag.h + 'px';
  const cards = $$('.card[data-id]:not(.dragging)', list);
  const after = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
  if (after) { if (ph.nextElementSibling !== after) list.insertBefore(ph, after); }
  else if (list.lastElementChild !== ph) list.appendChild(ph);
});
document.addEventListener('drop', (e) => {
  if (!drag || !e.target.closest) return;
  const zone = e.target.closest('.quad[data-quad], .mx-tray[data-quad]');
  if (zone) {
    e.preventDefault();
    const t = task(drag.id);
    drag = null;
    clearDropMarks();
    if (t) {
      const q = zone.dataset.quad;
      t.quadrant = QUADS[q] ? q : null;
      commit();
    }
    return;
  }
  const colEl = e.target.closest('.column[data-col-id]');
  if (!colEl) return;
  e.preventDefault();
  const list = colEl.querySelector('.col-cards');
  let next = ph && ph.parentElement === list ? ph.nextElementSibling : null;
  while (next && (!next.dataset.id || next.classList.contains('dragging'))) next = next.nextElementSibling;
  const id = drag.id;
  drag = null;
  removePlaceholder();
  moveTask(id, list.dataset.col, next ? next.dataset.id : null);
  commit();
});

/* toast */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* refresh when the day changes (habits & today list move on) */
let lastDay = D.today();
function checkNewDay() {
  if (state && D.today() !== lastDay) { lastDay = D.today(); render(); }
}
setInterval(checkNewDay, 30000);
window.addEventListener('focus', checkNewDay);

/* re-layout when switching between phone and desktop sizes */
let lastMobile = isMobile();
window.addEventListener('resize', () => {
  const m = isMobile();
  if (m !== lastMobile) { lastMobile = m; if (state) renderMain(); }
});

/* test hook used by automated screenshots */
window.__test = {
  go(v) {
    closeModal();
    if (v === 'gantt') { ui.view = 'projects'; ui.projectId = state.projects[0] ? state.projects[0].id : null; }
    else if (v === 'matrix') { ui.view = 'board'; ui.boardMode = 'matrix'; ui.projectId = null; }
    else if (v === 'phone') { openPhoneModal(); return; }
    else { ui.view = v; ui.projectId = null; if (v === 'board') ui.boardMode = 'lists'; }
    render();
  },
};

/* ---------------- start ---------------- */
async function init() {
  let r;
  try { r = await loadData(); } catch (e) { console.error(e); r = { data: null }; }
  if (r.auth) { showAccessScreen(r.message); return; }
  state = normalize(r.data);
  const fresh = !state;
  if (fresh) state = seedState();
  resetSnapshot();
  if (fresh) persist();
  cacheLocal();
  setSync(syncStatus);
  render();
  console.log('Planner ready, mode=' + mode);
}
init();
