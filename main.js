'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, screen, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { mergeStates, sameContent } = require('./sync');

let QRCode = null;
try { QRCode = require('qrcode'); } catch { /* QR codes are optional */ }

// Optional: separate data folder (used for testing)
if (process.env.PLANNER_USER_DATA) app.setPath('userData', process.env.PLANNER_USER_DATA);

// Only one window at a time, so two copies never overwrite each other's data
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
const SRC = path.join(__dirname, 'src');
const dataFile = () => path.join(app.getPath('userData'), 'planner-data.json');
const winFile = () => path.join(app.getPath('userData'), 'window-state.json');
const phoneFile = () => path.join(app.getPath('userData'), 'phone-access.json');

function log(...args) {
  if (!process.env.PLANNER_LOG) return;
  try { fs.appendFileSync(process.env.PLANNER_LOG, `[${new Date().toISOString()}] ${args.join(' ')}\n`); } catch { /* ignore */ }
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSONAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '.bak'); } catch { /* backup is best effort */ }
  }
  fs.renameSync(tmp, file);
}

/* ================= Data (shared by the PC window and the phone) ================= */
let current; // undefined until first read
let rev = Date.now();

function getCurrent() {
  if (current === undefined) current = readJSON(dataFile()) ?? readJSON(dataFile() + '.bak');
  return current;
}

/** Merge a copy coming from the PC window or the phone, save it, and tell the other side. */
function commitData(incoming, fromPhone) {
  const base = getCurrent();
  const merged = base ? mergeStates(base, incoming) : incoming;
  writeJSONAtomic(dataFile(), merged);
  current = merged;
  rev += 1;
  const changed = !sameContent(merged, incoming);
  log('commit', fromPhone ? 'phone' : 'desktop', 'rev', rev, 'changed', changed, 'tasks', (merged.tasks || []).length);
  if (fromPhone && win && !win.isDestroyed()) win.webContents.send('data:changed', merged);
  return { rev, changed, data: changed ? merged : undefined };
}

/* ================= Window ================= */
function savedBounds() {
  const s = readJSON(winFile());
  if (!s) return {};
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width - 100 && s.y < a.y + a.height - 100);
  return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
}

function createWindow() {
  const s = savedBounds();
  win = new BrowserWindow({
    width: s.width || 1320,
    height: s.height || 860,
    x: s.x,
    y: s.y,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Planner',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8',
    icon: path.join(SRC, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep the Pomodoro timer exact when minimized
    },
  });

  if (s.maximized) win.maximize();
  if (!process.env.PLANNER_HIDDEN) win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e, level, message) => log('renderer:', (e && e.message) || message));

  win.on('close', () => {
    try {
      fs.writeFileSync(winFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch { /* ignore */ }
  });
  win.on('closed', () => { win = null; });

  win.loadFile(path.join(SRC, 'index.html'));

  // Test mode: take screenshots of every view, then quit
  if (process.env.PLANNER_SHOT_DIR) {
    win.webContents.once('did-finish-load', async () => {
      const dir = process.env.PLANNER_SHOT_DIR;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(Number(process.env.PLANNER_SHOT_WAIT) || 1200);
      // Show the app's own colors even when Windows uses a contrast theme
      if (process.env.PLANNER_SHOT_COLORS) await win.webContents.insertCSS('html { forced-color-adjust: none !important; } .nav-item.active { outline: none !important; }');
      const shoot = async (v, name = v) => {
        await win.webContents.executeJavaScript(`window.__test && window.__test.go(${JSON.stringify(v)})`);
        await wait(700);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
      };
      for (const v of ['today', 'board', 'matrix', 'habits', 'projects', 'gantt', 'phone']) await shoot(v);
      // Phone-size layout
      win.setMinimumSize(320, 480);
      win.setSize(400, 860);
      await wait(500);
      for (const v of ['today', 'matrix', 'habits']) await shoot(v, 'mobile-' + v);
      app.quit();
    });
  }
}

/* ================= Phone access (web app on the home Wi-Fi) ================= */
let phone = { enabled: false, port: 4747, key: '' };
let server = null;
let serverError = null;
const failures = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function newKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => chars[b % chars.length]).join('');
}

function loadPhoneCfg() {
  phone = { ...phone, ...(readJSON(phoneFile()) || {}) };
  if (!phone.key) {
    phone.key = newKey();
    savePhoneCfg();
  }
}
function savePhoneCfg() {
  try {
    fs.mkdirSync(path.dirname(phoneFile()), { recursive: true });
    fs.writeFileSync(phoneFile(), JSON.stringify(phone, null, 2));
  } catch { /* ignore */ }
}

function keyOk(k) {
  if (typeof k !== 'string' || !phone.key) return false;
  const a = Buffer.from(k.trim().toUpperCase());
  const b = Buffer.from(phone.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || '';
  const f = failures.get(ip) || { n: 0, t: 0 };
  if (f.n >= 10 && Date.now() - f.t < 60000) return sendJSON(res, 429, { error: 'Too many wrong codes. Wait one minute.' });
  if (!keyOk(req.headers['x-planner-key'])) {
    failures.set(ip, { n: f.n + 1, t: Date.now() });
    return sendJSON(res, 401, { error: 'Wrong access code' });
  }
  failures.delete(ip);

  if (url.pathname === '/api/data' && req.method === 'GET') {
    const since = Number(url.searchParams.get('rev'));
    if (since && since === rev) return sendJSON(res, 200, { rev, unchanged: true });
    return sendJSON(res, 200, { rev, data: getCurrent() });
  }
  if (url.pathname === '/api/data' && req.method === 'PUT') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'Bad data' }); }
    if (!body || !body.data || !Array.isArray(body.data.tasks)) return sendJSON(res, 400, { error: 'Bad data' });
    return sendJSON(res, 200, commitData(body.data, true));
  }
  return sendJSON(res, 404, { error: 'Not found' });
}

function handleStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const rel = path.normalize(p).replace(/^[/\\]+/, '');
  const file = path.join(SRC, rel);
  if (!file.startsWith(SRC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  });
}

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => { log('api error', e.message); sendJSON(res, 500, { error: 'Server error' }); });
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    handleStatic(req, res, url);
  } else {
    res.writeHead(405); res.end();
  }
}

function stopServer() {
  if (server) { server.close(); server = null; }
}

function startServer() {
  stopServer();
  serverError = null;
  const host = process.env.PLANNER_BIND || '0.0.0.0';
  return new Promise((resolve) => {
    const s = http.createServer(handle);
    s.once('error', (e) => {
      serverError = e.code === 'EADDRINUSE' ? `Port ${phone.port} is already used by another program.` : e.message;
      log('server error', serverError);
      resolve(false);
    });
    s.listen(phone.port, host, () => {
      server = s;
      log('server listening', host, phone.port);
      resolve(true);
    });
  });
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  const kind = (a) => {
    if (/^169\.254\./.test(a.address)) return 9; // no network
    if (/(vEthernet|Virtual|VMware|WSL|Hyper-V|Loopback|Bluetooth)/i.test(a.name) || /^192\.168\.(56|99)\./.test(a.address)) return 5; // virtual machines
    if (/(wi-?fi|wlan|wireless|sans fil)/i.test(a.name)) return 0; // Wi-Fi first: that's where the phone is
    if (/tailscale/i.test(a.name) || /^100\./.test(a.address)) return 2;
    return 1; // cable
  };
  const score = (a) => (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1
    : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3);
  return out.filter((a) => kind(a) < 9).sort((x, y) => kind(x) - kind(y) || score(x) - score(y));
}

/** Windows network profile per adapter ("Private" / "Public"). Public networks block the phone. */
function networkProfiles() {
  if (process.platform !== 'win32') return Promise.resolve({});
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + "|" + $_.NetworkCategory }'],
    { timeout: 8000, windowsHide: true }, (err, stdout) => {
      const map = {};
      if (!err) {
        String(stdout).split(/\r?\n/).forEach((line) => {
          const [alias, cat] = line.split('|');
          if (alias && cat) map[alias.trim()] = cat.trim();
        });
      }
      resolve(map);
    });
  });
}

let profileCache = { at: 0, map: {}, pending: null };
function getProfiles(fresh) {
  if (!fresh && Date.now() - profileCache.at < 30000) return Promise.resolve(profileCache.map);
  if (!profileCache.pending) {
    profileCache.pending = networkProfiles().then((map) => {
      profileCache = { at: Date.now(), map, pending: null };
      return map;
    });
  }
  return profileCache.pending;
}

async function phoneStatus(fresh) {
  const profiles = await getProfiles(fresh);
  const urls = await Promise.all(lanAddresses().map(async (a) => {
    const short = `http://${a.address}:${phone.port}`;
    const url = `${short}/#key=${phone.key}`;
    let qr = null;
    if (QRCode) { try { qr = await QRCode.toDataURL(url, { margin: 1, width: 240 }); } catch { /* ignore */ } }
    return { name: a.name, address: a.address, short, url, qr, profile: profiles[a.name] || null };
  }));
  return { enabled: phone.enabled, running: !!server, error: serverError, port: phone.port, key: phone.key, urls };
}

/* ================= IPC ================= */
ipcMain.handle('data:load', () => getCurrent());
ipcMain.handle('data:save', (_e, data) => commitData(data, false));
ipcMain.on('data:save-sync', (e, data) => {
  try {
    commitData(data, false);
    e.returnValue = true;
  } catch {
    e.returnValue = false;
  }
});

ipcMain.handle('data:export', async (_e, data) => {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export backup',
    defaultPath: path.join(app.getPath('documents'), `planner-backup-${stamp}.json`),
    filters: [{ name: 'Planner backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
});

ipcMain.handle('data:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import backup',
    filters: [{ name: 'Planner backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  try {
    return JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch {
    return { __error: 'This file is not a valid backup.' };
  }
});

ipcMain.handle('app:data-path', () => dataFile());

ipcMain.handle('phone:status', (_e, fresh) => phoneStatus(!!fresh));
ipcMain.handle('phone:set', async (_e, enabled) => {
  phone.enabled = !!enabled;
  savePhoneCfg();
  if (phone.enabled) await startServer();
  else stopServer();
  return phoneStatus();
});
ipcMain.handle('phone:wifi-settings', () => shell.openExternal('ms-settings:network-wifi'));
ipcMain.handle('phone:new-key', async () => {
  phone.key = newKey();
  savePhoneCfg();
  return phoneStatus();
});

/* ================= App lifecycle ================= */
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadPhoneCfg();
  if (process.env.PLANNER_PHONE) phone.enabled = true;
  if (phone.enabled) await startServer();
  getProfiles(); // warm up the network check for the Phone app window
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopServer);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
