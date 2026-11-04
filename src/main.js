'use strict';
const {
  app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu,
  clipboard, shell, dialog, nativeImage, nativeTheme, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Vault, VaultError } = require('./vault');
const { Config, DEFAULTS } = require('./config');
const launcher = require('./launcher');

if (process.env.SARGEL_USER_DATA) app.setPath('userData', process.env.SARGEL_USER_DATA);

const isMac = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', 'assets');
const RENDERER = path.join(__dirname, 'renderer');
const HANDLE = { w: 22, h: 104 };
const FILE_NAMES = { personal: 'sargel-personal.sargel', team: 'sargel-team.sargel' };
const MIN_PASSWORD = 8;

let cfg;
let sidebar = null;
let searchWin = null;
let keysWin = null;
let tray = null;
let quitting = false;
let hotkeyOk = true;
let launcherHotkeyOk = true;
let clipTimer = null;
let saveChain = Promise.resolve();

const state = {
  expanded: false,
  pinned: false,
  hold: false,
  explicitOpen: false,
  insideSince: 0,
  outsideSince: 0,
};
const vaults = { personal: null, team: null };

const uid = () => crypto.randomUUID();

// ───────────────────────── single instance ─────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setExpanded(true, { explicit: true, focus: true }));
  app.whenReady().then(boot);
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* tray app — keep running */ });

// ───────────────────────── geometry ─────────────────────────
function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function collapsedBounds() {
  const wa = workArea();
  const y = Math.round(wa.y + (wa.height - HANDLE.h) * clamp(cfg.get('handleY'), 0, 1));
  const x = cfg.get('side') === 'left' ? wa.x : wa.x + wa.width - HANDLE.w;
  return { x, y, width: HANDLE.w, height: HANDLE.h };
}

function expandedBounds() {
  const wa = workArea();
  const w = clamp(cfg.get('width'), 300, 600);
  const x = cfg.get('side') === 'left' ? wa.x : wa.x + wa.width - w;
  return { x, y: wa.y, width: w, height: wa.height };
}

function clamp(v, a, b) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : a;
}

function reposition() {
  if (!sidebar || sidebar.isDestroyed()) return;
  sidebar.setBounds(state.expanded ? expandedBounds() : collapsedBounds());
}

// ───────────────────────── windows ─────────────────────────
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
};

function createSidebar() {
  sidebar = new BrowserWindow({
    ...collapsedBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    title: 'הסרגל',
    webPreferences,
  });
  sidebar.setAlwaysOnTop(true, 'floating');
  if (isMac) sidebar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  sidebar.loadFile(path.join(RENDERER, 'sidebar.html'));
  sidebar.once('ready-to-show', () => {
    sidebar.showInactive();
    if (!cfg.get('personalPath')) setExpanded(true, { explicit: true, focus: true });
  });
  sidebar.on('close', (e) => { if (!quitting) e.preventDefault(); });
  sidebar.on('blur', () => { if (!state.pinned) state.explicitOpen = false; });
  sidebar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  sidebar.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createSearch() {
  searchWin = new BrowserWindow({
    width: 640,
    height: 470,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'הסרגל — חיפוש',
    webPreferences,
  });
  searchWin.setAlwaysOnTop(true, 'pop-up-menu');
  if (isMac) searchWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  searchWin.loadFile(path.join(RENDERER, 'search.html'));
  searchWin.on('blur', () => hideSearch());
  searchWin.on('close', (e) => { if (!quitting) { e.preventDefault(); hideSearch(); } });
  searchWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  searchWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createKeys() {
  keysWin = new BrowserWindow({
    width: 820,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'הסרגל — מקלדת קיצורים',
    webPreferences,
  });
  keysWin.setAlwaysOnTop(true, 'pop-up-menu');
  if (isMac) keysWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  keysWin.loadFile(path.join(RENDERER, 'keys.html'));
  keysWin.on('blur', () => hideKeys());
  keysWin.on('close', (e) => { if (!quitting) { e.preventDefault(); hideKeys(); } });
  keysWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  keysWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showKeys() {
  if (!keysWin) return;
  hideSearch();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = keysWin.getSize();
  keysWin.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + (wa.height - h) / 2.4));
  keysWin.webContents.send('keys:open', publicState());
  keysWin.show();
  keysWin.focus();
}

function hideKeys() {
  if (!keysWin || !keysWin.isVisible()) return;
  keysWin.hide();
  if (isMac && !state.expanded) {
    app.hide();
    setTimeout(() => sidebar && sidebar.showInactive(), 80);
  }
}

function toggleKeys() {
  if (keysWin && keysWin.isVisible() && keysWin.isFocused()) hideKeys();
  else showKeys();
}

function setExpanded(v, opts = {}) {
  if (!sidebar || sidebar.isDestroyed()) return;
  state.insideSince = 0;
  state.outsideSince = 0;
  if (v && opts.explicit) state.explicitOpen = true;
  if (state.expanded === v) {
    if (v && opts.focus) sidebar.focus();
    return;
  }
  state.expanded = v;
  if (v) {
    sidebar.setBounds(expandedBounds());
    sidebar.webContents.send('ui:expanded', true);
    if (opts.focus) sidebar.focus();
  } else {
    sidebar.webContents.send('ui:expanded', false);
    if (sidebar.isFocused()) sidebar.blur();
    sidebar.setBounds(collapsedBounds());
  }
}

/** Poll the cursor: hover the handle → open; leave the panel → close. Works the same on Windows and Mac. */
function tick() {
  if (!sidebar || sidebar.isDestroyed() || !sidebar.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = sidebar.getBounds();
  const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  const now = Date.now();
  if (!state.expanded) {
    if (inside) {
      if (!state.insideSince) state.insideSince = now;
      if (now - state.insideSince >= 160) setExpanded(true);
    } else {
      state.insideSince = 0;
    }
    return;
  }
  if (inside) {
    state.outsideSince = 0;
    state.explicitOpen = false;
    return;
  }
  if (state.pinned || state.hold || state.explicitOpen) {
    state.outsideSince = 0;
    return;
  }
  if (!state.outsideSince) state.outsideSince = now;
  if (now - state.outsideSince >= 650) setExpanded(false);
}

function showSearch() {
  if (!searchWin) return;
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = d.workArea;
  const [w, h] = searchWin.getSize();
  searchWin.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + wa.height * 0.16));
  searchWin.webContents.send('search:open', publicState());
  searchWin.show();
  searchWin.focus();
}

function hideSearch() {
  if (!searchWin || !searchWin.isVisible()) return;
  searchWin.hide();
  if (isMac && !state.expanded) {
    // hand focus back to the app the user was in
    app.hide();
    setTimeout(() => sidebar && sidebar.showInactive(), 80);
  }
}

function toggleSearch() {
  if (searchWin && searchWin.isVisible() && searchWin.isFocused()) hideSearch();
  else showSearch();
}

// ───────────────────────── tray ─────────────────────────
function createTray() {
  const img = isMac
    ? nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  if (isMac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('הסרגל');
  rebuildTrayMenu();
  if (!isMac) tray.on('click', () => setExpanded(true, { explicit: true, focus: true }));
}

function rebuildTrayMenu() {
  if (!tray) return;
  const hk = prettyHotkey(cfg.get('hotkey'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתיחת הסרגל', click: () => setExpanded(true, { explicit: true, focus: true }) },
    { label: `חיפוש מהיר${hk ? `   (${hk})` : ''}`, click: () => showSearch() },
    { label: `מקלדת קיצורים${cfg.get('launcherHotkey') ? `   (${prettyHotkey(cfg.get('launcherHotkey'))})` : ''}`, click: () => showKeys() },
    { type: 'separator' },
    { label: 'נעילה', click: () => lockAll() },
    {
      label: 'הפעלה אוטומטית עם המחשב',
      type: 'checkbox',
      checked: !!cfg.get('launchAtLogin'),
      click: (mi) => applyConfig({ launchAtLogin: mi.checked }),
    },
    { type: 'separator' },
    { label: 'יציאה מהסרגל', click: () => { quitting = true; app.quit(); } },
  ]));
}

function prettyHotkey(acc) {
  if (!acc) return '';
  return acc
    .replace('CommandOrControl', isMac ? 'Cmd' : 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Option', 'Alt');
}

// ───────────────────────── config ─────────────────────────
function registerHotkey() {
  globalShortcut.unregisterAll();
  const reg = (acc, fn) => {
    if (!acc) return true;
    try { return globalShortcut.register(acc, fn); } catch { return false; }
  };
  hotkeyOk = reg(cfg.get('hotkey'), toggleSearch);
  launcherHotkeyOk = cfg.get('launcherHotkey') === cfg.get('hotkey') ? false : reg(cfg.get('launcherHotkey'), toggleKeys);
}

function applyLogin() {
  if (!app.isPackaged) return; // don't register electron.exe during development
  try {
    app.setLoginItemSettings({ openAtLogin: !!cfg.get('launchAtLogin'), openAsHidden: true });
  } catch { /* ignore */ }
}

function applyConfig(patch) {
  const clean = {};
  if (patch.side === 'left' || patch.side === 'right') clean.side = patch.side;
  if ('handleY' in patch) clean.handleY = clamp(patch.handleY, 0, 1);
  if ('width' in patch) clean.width = Math.round(clamp(patch.width, 300, 600));
  if (typeof patch.hotkey === 'string' && patch.hotkey.length < 80) clean.hotkey = patch.hotkey;
  if (typeof patch.launcherHotkey === 'string' && patch.launcherHotkey.length < 80) clean.launcherHotkey = patch.launcherHotkey;
  if ('autoLockMinutes' in patch) clean.autoLockMinutes = Math.round(clamp(patch.autoLockMinutes, 0, 1440));
  if ('launchAtLogin' in patch) clean.launchAtLogin = !!patch.launchAtLogin;
  if (['system', 'light', 'dark'].includes(patch.theme)) clean.theme = patch.theme;
  cfg.set(clean);
  if ('hotkey' in clean || 'launcherHotkey' in clean) registerHotkey();
  if ('launchAtLogin' in clean) applyLogin();
  if ('theme' in clean) nativeTheme.themeSource = clean.theme;
  if ('side' in clean || 'handleY' in clean || 'width' in clean) reposition();
  rebuildTrayMenu();
  broadcast();
}

// ───────────────────────── vault helpers ─────────────────────────
function publicState() {
  const info = (name) => {
    const p = cfg.get(`${name}Path`);
    const v = vaults[name];
    return {
      configured: !!p,
      path: p || null,
      name: p ? path.basename(p) : null,
      exists: p ? fs.existsSync(p) : false,
      unlocked: !!(v && v.unlocked),
    };
  };
  const data = { tabs: [], items: [] };
  for (const name of ['personal', 'team']) {
    const v = vaults[name];
    if (!v || !v.unlocked) continue;
    for (const t of v.data.tabs) if (!t.deleted) data.tabs.push({ ...t, vault: name });
    for (const i of v.data.items) if (!i.deleted) data.items.push({ ...i, vault: name });
  }
  const p = vaults.personal;
  data.launchers = p && p.unlocked
    ? p.data.launchers.filter((l) => !l.deleted).sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];
  return {
    platform: process.platform,
    version: app.getVersion(),
    config: { ...cfg.data },
    hotkeyOk,
    hotkeyLabel: prettyHotkey(cfg.get('hotkey')),
    launcherHotkeyOk,
    launcherHotkeyLabel: prettyHotkey(cfg.get('launcherHotkey')),
    vaults: { personal: info('personal'), team: info('team') },
    rememberTeam: !!(p && p.unlocked && p.data.settings.teamPassword),
    data,
    ui: { expanded: state.expanded, pinned: state.pinned },
  };
}

function broadcast() {
  const s = publicState();
  for (const w of [sidebar, searchWin, keysWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('state', s);
  }
}

function notify(message, kind = 'ok') {
  if (sidebar && !sidebar.isDestroyed()) sidebar.webContents.send('toast', { message, kind });
}

function lockAll() {
  for (const name of ['personal', 'team']) if (vaults[name]) vaults[name].lock();
  if (clipTimer) { clearTimeout(clipTimer); clipTimer = null; }
  broadcast();
}

function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new VaultError('WEAK_PASSWORD');
}

function requireVault(name) {
  if (name !== 'personal' && name !== 'team') throw new VaultError('BAD_INPUT');
  const v = vaults[name];
  if (!v || !v.unlocked) throw new VaultError('LOCKED');
  return v;
}

function queueSave(name) {
  const v = vaults[name];
  saveChain = saveChain
    .then(() => (v && v.unlocked ? v.save() : null))
    .then(() => broadcast())
    .catch((err) => handleVaultError(name, err));
  return saveChain;
}

function handleVaultError(name, err) {
  if (err && err.code === 'WRONG_PASSWORD') {
    if (vaults[name]) vaults[name].lock();
    notify(name === 'team'
      ? 'סיסמת הצוות שונתה במחשב אחר — צריך להקליד אותה מחדש'
      : 'הסיסמה הראשית שונתה במחשב אחר — צריך להקליד אותה מחדש', 'warn');
    broadcast();
    return;
  }
  notify(`שגיאה בשמירה: ${err && err.message ? err.message : err}`, 'warn');
}

const watched = new Set();
function watch(name) {
  const file = cfg.get(`${name}Path`);
  if (!file || watched.has(file)) return;
  watched.add(file);
  fs.watchFile(file, { interval: 2000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    const v = vaults[name];
    if (!v || !v.unlocked || v.filePath !== file) return;
    saveChain = saveChain
      .then(() => v.pullExternal())
      .then((changed) => { if (changed) broadcast(); })
      .catch((err) => handleVaultError(name, err));
  });
}
function unwatch(file) {
  if (!file || !watched.has(file)) return;
  fs.unwatchFile(file);
  watched.delete(file);
}

function backupDaily(name) {
  try {
    const v = vaults[name];
    if (!v || !fs.existsSync(v.filePath)) return;
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(v.filePath, '.sargel');
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `${base}-${day}.sargel`);
    if (!fs.existsSync(target)) fs.copyFileSync(v.filePath, target);
    const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}-`)).sort().reverse().slice(14);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  } catch { /* backups are best-effort */ }
}

// tabs every new sargel starts with (and older ones are migrated to, once)
const STARTER_TABS = [
  ['כללי', '📌'],
  ['מיילים', '✉️'],
  ['מאמרים', '📝'],
  ['משימות', '✅'],
  ['לקוחות', '👥'],
  ['גישות', '🔑'],
  ['קישורים', '🔗'],
];
const MIGRATION = 'v011';

function starterData() {
  const now = Date.now();
  const tabs = STARTER_TABS.map(([name, icon], order) => ({ id: uid(), name, icon, order, updatedAt: now }));
  const T = Object.fromEntries(tabs.map((t) => [t.name, t]));
  const f = (label, kind, value) => ({ id: uid(), label, kind, value });
  const items = [
    {
      id: uid(), tabId: T['מיילים'].id, order: 0, updatedAt: now, color: 'blue', icon: 'mail',
      title: 'דוגמה — לחיצה מעתיקה אותי',
      fields: [f('', 'text', 'שלום, תודה על פנייתך! נחזור אלייך בהקדם.')],
    },
    {
      id: uid(), tabId: T['לקוחות'].id, order: 0, updatedAt: now, color: 'purple', icon: 'user',
      title: 'לקוח לדוגמה',
      fields: [
        f('טלפון', 'text', '050-0000000'),
        f('מייל', 'text', 'client@example.com'),
        f('אתר', 'link', 'https://example.com'),
        f('סיסמה', 'secret', 'Example-Pass-123'),
      ],
    },
    {
      id: uid(), tabId: T['קישורים'].id, order: 0, updatedAt: now, color: 'green', icon: 'link',
      title: 'Google Drive',
      fields: [f('', 'link', 'https://drive.google.com')],
    },
  ];
  const launchers = launcher.suggestedLaunchers().map((l) => ({ id: uid(), ...l }));
  return { schema: 1, tabs, items, launchers, settings: { updatedAt: now, migrations: [MIGRATION] } };
}

/**
 * One-time upgrade of a sargel made with v0.1.0:
 * "נושאים ומיילים" → "מיילים", add כללי / מאמרים / משימות in the right order, and add starter buttons.
 */
async function migratePersonal() {
  const v = vaults.personal;
  if (!v || !v.unlocked) return;
  const s = v.data.settings || {};
  if (Array.isArray(s.migrations) && s.migrations.includes(MIGRATION)) return;
  const now = Date.now();
  const live = v.data.tabs.filter((t) => !t.deleted).sort((a, b) => (a.order || 0) - (b.order || 0));
  const old = live.find((t) => t.name === 'נושאים ומיילים');
  if (old && !live.some((t) => t.name === 'מיילים')) Object.assign(old, { name: 'מיילים', updatedAt: now });
  const byName = new Map(live.map((t) => [t.name, t]));
  const ordered = [];
  for (const [name, icon] of STARTER_TABS.slice(0, 4)) {
    let t = byName.get(name);
    if (!t) {
      t = { id: uid(), name, icon, order: 0, updatedAt: now };
      v.data.tabs.push(t);
    }
    ordered.push(t);
  }
  for (const t of live) if (!ordered.includes(t)) ordered.push(t);
  ordered.forEach((t, i) => { if (t.order !== i) { t.order = i; t.updatedAt = now; } });

  if (!v.data.launchers.some((l) => !l.deleted)) {
    for (const l of launcher.suggestedLaunchers()) v.data.launchers.push({ id: uid(), ...l });
  }
  v.data.settings = { ...s, migrations: [...(s.migrations || []), MIGRATION], updatedAt: now };
  await queueSave('personal');
}

function teamStarter() {
  const now = Date.now();
  return {
    schema: 1,
    tabs: [{ id: uid(), name: 'משותף לצוות', icon: '🤝', order: 100, updatedAt: now }],
    items: [],
    settings: { updatedAt: now },
  };
}

async function setRememberedTeamPassword(pw) {
  const p = vaults.personal;
  if (!p || !p.unlocked) return;
  const s = { ...p.data.settings, updatedAt: Date.now() };
  if (pw) s.teamPassword = pw; else delete s.teamPassword;
  p.data.settings = s;
  await queueSave('personal');
}

async function autoUnlockTeam() {
  const p = vaults.personal;
  const teamPath = cfg.get('teamPath');
  if (!p || !p.unlocked || !teamPath) return;
  if (vaults.team && vaults.team.unlocked) return;
  const pw = p.data.settings.teamPassword;
  if (!pw) return;
  const t = vaults.team && vaults.team.filePath === teamPath ? vaults.team : new Vault(teamPath);
  try {
    await t.unlock(pw);
    vaults.team = t;
    watch('team');
    backupDaily('team');
  } catch { /* stays locked — the UI offers to type it */ }
}

async function attachVault(which, v, password, remember) {
  const prev = vaults[which];
  if (prev && prev !== v) {
    prev.lock();
    if (prev.filePath !== v.filePath) unwatch(prev.filePath);
  }
  vaults[which] = v;
  cfg.set({ [`${which}Path`]: v.filePath });
  watch(which);
  backupDaily(which);
  if (which === 'team') await setRememberedTeamPassword(remember ? password : null);
  else { await migratePersonal(); await autoUnlockTeam(); }
  broadcast();
}

async function createVault(which, folder, password, remember) {
  checkNewPassword(password);
  if (typeof folder !== 'string' || !folder) throw new VaultError('BAD_INPUT');
  const file = path.join(folder, FILE_NAMES[which]);
  const v = await Vault.create(file, password, which === 'personal' ? starterData() : teamStarter());
  await attachVault(which, v, password, remember);
}

async function openVault(which, file, password, remember) {
  if (typeof file !== 'string' || !file) throw new VaultError('BAD_INPUT');
  const v = new Vault(file);
  await v.unlock(password);
  await attachVault(which, v, password, remember);
}

async function unlockPersonal(password) {
  const file = cfg.get('personalPath');
  if (!file) throw new VaultError('NOT_FOUND');
  const v = vaults.personal && vaults.personal.filePath === file ? vaults.personal : new Vault(file);
  await v.unlock(password);
  vaults.personal = v;
  watch('personal');
  backupDaily('personal');
  await migratePersonal();
  await autoUnlockTeam();
  broadcast();
}

function suggestFolders() {
  const out = [];
  const seen = new Set();
  const home = os.homedir();
  const add = (label, dir, synced = true) => {
    try {
      if (!fs.statSync(dir).isDirectory()) return;
    } catch { return; }
    const p = path.join(dir, 'Sargel');
    if (seen.has(p)) return;
    seen.add(p);
    out.push({ label, path: p, synced });
  };
  if (process.platform === 'win32') {
    for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      add('Google Drive', `${L}:\\My Drive`);
      add('Google Drive', `${L}:\\האחסון שלי`);
    }
    try {
      for (const d of fs.readdirSync(home)) if (/^OneDrive/i.test(d)) add(d.replace(/^OneDrive\s*-\s*/i, 'OneDrive · '), path.join(home, d));
    } catch { /* ignore */ }
    add('Dropbox', path.join(home, 'Dropbox'));
  } else if (isMac) {
    const cs = path.join(home, 'Library', 'CloudStorage');
    try {
      for (const d of fs.readdirSync(cs)) {
        if (d.startsWith('GoogleDrive')) {
          add('Google Drive', path.join(cs, d, 'My Drive'));
          add('Google Drive', path.join(cs, d, 'האחסון שלי'));
        } else if (d.startsWith('OneDrive')) add('OneDrive', path.join(cs, d));
        else if (d.startsWith('Dropbox')) add('Dropbox', path.join(cs, d));
      }
    } catch { /* ignore */ }
    add('Dropbox', path.join(home, 'Dropbox'));
  }
  add('מסמכים — במחשב הזה בלבד', app.getPath('documents'), false);
  return out;
}

// ───────────────────────── data operations ─────────────────────────
const KINDS = new Set(['text', 'link', 'secret']);
const COLORS = new Set(['purple', 'blue', 'green', 'amber', 'coral', 'red', 'pink', 'gray']);
const LAUNCH_TYPES = new Set(['web', 'app', 'path', 'copy']);
const KEY_RE = /^[0-9A-Z]$/;
const str = (v, max) => String(v == null ? '' : v).slice(0, max);

function cleanTab(t) {
  return { name: str(t.name, 60).trim() || 'טאב חדש', icon: str(t.icon, 16) };
}

function cleanFields(fields) {
  if (!Array.isArray(fields)) throw new VaultError('BAD_INPUT');
  return fields.slice(0, 40).map((f) => ({
    id: typeof f.id === 'string' && f.id ? f.id.slice(0, 64) : uid(),
    label: str(f.label, 100),
    kind: KINDS.has(f.kind) ? f.kind : 'text',
    value: str(f.value, 50000),
  }));
}

function nextOrder(list) {
  return list.reduce((m, x) => Math.max(m, Number(x.order) || 0), -1) + 1;
}

function saveTab({ vault, tab }) {
  const v = requireVault(vault);
  if (!tab || typeof tab !== 'object') throw new VaultError('BAD_INPUT');
  const now = Date.now();
  const clean = cleanTab(tab);
  const existing = tab.id && v.data.tabs.find((t) => t.id === tab.id && !t.deleted);
  if (existing) {
    Object.assign(existing, clean, { updatedAt: now });
    queueSave(vault);
    return { id: existing.id };
  }
  const allTabs = [...(vaults.personal?.data?.tabs || []), ...(vaults.team?.data?.tabs || [])].filter((t) => !t.deleted);
  const id = uid();
  v.data.tabs.push({ id, ...clean, order: nextOrder(allTabs), updatedAt: now });
  queueSave(vault);
  return { id };
}

function deleteTab({ vault, id }) {
  const v = requireVault(vault);
  const now = Date.now();
  const t = v.data.tabs.find((x) => x.id === id);
  if (!t) return;
  v.data.tabs = v.data.tabs.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  v.data.items = v.data.items.map((x) => (x.tabId === id && !x.deleted ? { id: x.id, deleted: true, updatedAt: now } : x));
  queueSave(vault);
}

function saveItem({ vault, item, fromVault }) {
  const v = requireVault(vault);
  if (!item || typeof item !== 'object') throw new VaultError('BAD_INPUT');
  const tab = v.data.tabs.find((t) => t.id === item.tabId && !t.deleted);
  if (!tab) throw new VaultError('BAD_INPUT', 'tab not found');
  const now = Date.now();
  const id = typeof item.id === 'string' && item.id ? item.id : uid();

  if (fromVault && fromVault !== vault) {
    const src = requireVault(fromVault);
    src.data.items = src.data.items.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
    queueSave(fromVault);
  }

  const clean = {
    id,
    tabId: tab.id,
    title: str(item.title, 200).trim(),
    fields: cleanFields(item.fields),
    color: COLORS.has(item.color) ? item.color : '',
    icon: /^[a-z]{1,24}$/.test(item.icon || '') ? item.icon : '',
    updatedAt: now,
  };
  const idx = v.data.items.findIndex((x) => x.id === id);
  const prev = idx >= 0 ? v.data.items[idx] : null;
  const sameTab = prev && !prev.deleted && prev.tabId === tab.id;
  clean.order = sameTab ? prev.order : nextOrder(v.data.items.filter((x) => !x.deleted && x.tabId === tab.id));
  if (idx >= 0) v.data.items[idx] = clean; else v.data.items.push(clean);
  queueSave(vault);
  return { id };
}

function deleteItem({ vault, id }) {
  const v = requireVault(vault);
  const now = Date.now();
  v.data.items = v.data.items.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  queueSave(vault);
}

function reorder({ entries }) {
  if (!Array.isArray(entries)) throw new VaultError('BAD_INPUT');
  const now = Date.now();
  const touched = new Set();
  for (const e of entries.slice(0, 2000)) {
    const v = vaults[e.vault];
    if (!v || !v.unlocked) continue;
    const list = e.kind === 'tabs' ? v.data.tabs : v.data.items;
    const x = list.find((y) => y.id === e.id && !y.deleted);
    if (!x || x.order === e.order) continue;
    x.order = Number(e.order) || 0;
    x.updatedAt = now;
    touched.add(e.vault);
  }
  for (const name of touched) queueSave(name);
}

function saveLauncher({ launcher: l }) {
  const v = requireVault('personal');
  if (!l || typeof l !== 'object' || !LAUNCH_TYPES.has(l.type)) throw new VaultError('BAD_INPUT');
  const now = Date.now();
  const id = typeof l.id === 'string' && l.id ? l.id.slice(0, 64) : uid();
  const key = KEY_RE.test(l.key || '') ? l.key : '';
  const clean = {
    id,
    key,
    title: str(l.title, 40).trim() || 'כפתור',
    icon: /^[a-z]{1,24}$/.test(l.icon || '') ? l.icon : 'bolt',
    color: COLORS.has(l.color) ? l.color : 'purple',
    type: l.type,
    url: str(l.url, 2000).trim(),
    profile: str(l.profile, 64),
    target: str(l.target, 1000),
    itemId: str(l.itemId, 64),
    fieldId: str(l.fieldId, 64),
    updatedAt: now,
  };
  const list = v.data.launchers;
  if (key) {
    for (const o of list) if (!o.deleted && o.id !== id && o.key === key) { o.key = ''; o.updatedAt = now; }
  }
  const idx = list.findIndex((x) => x.id === id);
  clean.order = idx >= 0 && !list[idx].deleted ? list[idx].order : nextOrder(list.filter((x) => !x.deleted));
  if (idx >= 0) list[idx] = clean; else list.push(clean);
  queueSave('personal');
  return { id };
}

function deleteLauncher({ id }) {
  const v = requireVault('personal');
  const now = Date.now();
  v.data.launchers = v.data.launchers.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  queueSave('personal');
}

function findField(itemId, fieldId) {
  for (const name of ['personal', 'team']) {
    const v = vaults[name];
    if (!v || !v.unlocked) continue;
    const it = v.data.items.find((i) => i.id === itemId && !i.deleted);
    if (!it) continue;
    const f = (it.fields || []).find((x) => x.id === fieldId) || (it.fields || [])[0];
    if (f) return f;
  }
  return null;
}

async function runLauncher({ id }) {
  const v = requireVault('personal');
  const l = v.data.launchers.find((x) => x.id === id && !x.deleted);
  if (!l) throw new VaultError('NOT_FOUND');
  try {
    if (l.type === 'web') { await launcher.openWeb(l.url, l.profile); return { done: 'opened' }; }
    if (l.type === 'app') { const r = await launcher.openApp(l); return { done: r.fallback ? 'fallback' : 'opened' }; }
    if (l.type === 'path') { await launcher.openPath(l.target); return { done: 'opened' }; }
    const f = findField(l.itemId, l.fieldId);
    if (!f) throw new VaultError('NOT_FOUND');
    copyText(f.value, f.kind === 'secret');
    return { done: 'copied', secret: f.kind === 'secret' };
  } catch (e) {
    throw new VaultError(e.code || 'LAUNCH_FAILED', e.message);
  }
}

function copyText(text, secret) {
  const value = String(text == null ? '' : text);
  clipboard.writeText(value);
  if (clipTimer) clearTimeout(clipTimer);
  clipTimer = null;
  if (secret) {
    clipTimer = setTimeout(() => {
      if (clipboard.readText() === value) clipboard.clear();
      clipTimer = null;
    }, 30000);
  }
}

function openExternal(url) {
  const u = String(url || '');
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(u)) throw new VaultError('BAD_INPUT');
  return shell.openExternal(u);
}

// ───────────────────────── IPC ─────────────────────────
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, arg) => {
    const ok = [sidebar, searchWin, keysWin].some((w) => w && !w.isDestroyed() && w.webContents === e.sender);
    if (!ok) return { ok: false, code: 'FORBIDDEN' };
    try {
      const r = await fn(arg || {}, e);
      return { ok: true, ...(r || {}) };
    } catch (err) {
      return { ok: false, code: err.code || 'ERROR', message: err.message };
    }
  });
}

function registerIpc() {
  handle('state:get', () => ({ state: publicState() }));

  handle('ui:expand', ({ focus }) => setExpanded(true, { explicit: true, focus: !!focus }));
  handle('ui:collapse', () => { state.explicitOpen = false; setExpanded(false); });
  handle('ui:pin', ({ pinned }) => { state.pinned = !!pinned; broadcast(); });
  handle('ui:hold', ({ hold }) => { state.hold = !!hold; });

  handle('vault:suggestFolders', () => ({ folders: suggestFolders() }));
  handle('vault:pickFolder', async (_a, e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    state.hold = true;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'בחירת תיקייה' });
    return { path: r.canceled ? null : r.filePaths[0] };
  });
  handle('vault:pickFile', async (_a, e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    state.hold = true;
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'בחירת קובץ סרגל',
      filters: [{ name: 'Sargel', extensions: ['sargel'] }],
    });
    return { path: r.canceled ? null : r.filePaths[0] };
  });
  handle('vault:create', async ({ which, folder, password, remember }) => {
    if (which !== 'personal' && which !== 'team') throw new VaultError('BAD_INPUT');
    if (which === 'team') requireVault('personal');
    await createVault(which, folder, password, !!remember);
  });
  handle('vault:open', async ({ which, file, password, remember }) => {
    if (which !== 'personal' && which !== 'team') throw new VaultError('BAD_INPUT');
    if (which === 'team') requireVault('personal');
    await openVault(which, file, password, !!remember);
  });
  handle('vault:unlock', async ({ password }) => unlockPersonal(password));
  handle('vault:unlockTeam', async ({ password, remember }) => {
    requireVault('personal');
    const file = cfg.get('teamPath');
    if (!file) throw new VaultError('NOT_FOUND');
    await openVault('team', file, password, !!remember);
  });
  handle('vault:lock', () => lockAll());
  handle('vault:disconnect', async ({ which }) => {
    if (which !== 'personal' && which !== 'team') throw new VaultError('BAD_INPUT');
    const v = vaults[which];
    if (which === 'team' && vaults.personal?.unlocked) await setRememberedTeamPassword(null);
    if (v) { v.lock(); unwatch(v.filePath); }
    vaults[which] = null;
    if (which === 'personal') {
      if (vaults.team) { vaults.team.lock(); unwatch(vaults.team.filePath); vaults.team = null; }
      cfg.set({ personalPath: null, teamPath: null });
    } else {
      cfg.set({ teamPath: null });
    }
    broadcast();
  });
  handle('vault:changePassword', async ({ which, current, next }) => {
    const v = requireVault(which);
    if (!v.checkPassword(current)) throw new VaultError('WRONG_PASSWORD');
    checkNewPassword(next);
    await (saveChain = saveChain.then(() => v.changePassword(next)));
    if (which === 'team' && vaults.personal?.data?.settings?.teamPassword) await setRememberedTeamPassword(next);
    broadcast();
  });
  handle('vault:backup', async ({ which }, e) => {
    const v = requireVault(which);
    const win = BrowserWindow.fromWebContents(e.sender);
    state.hold = true;
    const day = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, {
      title: 'שמירת גיבוי',
      defaultPath: path.join(app.getPath('documents'), `${path.basename(v.filePath, '.sargel')}-${day}.sargel`),
      filters: [{ name: 'Sargel', extensions: ['sargel'] }],
    });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.copyFileSync(v.filePath, r.filePath);
    return { saved: true };
  });
  handle('vault:reveal', ({ which }) => {
    const p = cfg.get(`${which}Path`);
    if (p) shell.showItemInFolder(p);
  });

  handle('data:saveTab', (a) => saveTab(a));
  handle('data:deleteTab', (a) => deleteTab(a));
  handle('data:saveItem', (a) => saveItem(a));
  handle('data:deleteItem', (a) => deleteItem(a));
  handle('data:reorder', (a) => reorder(a));

  handle('launch:save', (a) => saveLauncher(a));
  handle('launch:delete', (a) => deleteLauncher(a));
  handle('launch:run', (a) => runLauncher(a));
  handle('launch:chromeProfiles', () => ({ profiles: launcher.chromeProfiles() }));
  handle('launch:apps', async () => ({ apps: await launcher.listApps() }));
  handle('launch:pickPath', async ({ kind }, e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    state.hold = true;
    const r = await dialog.showOpenDialog(win, {
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      title: kind === 'folder' ? 'בחירת תיקייה' : 'בחירת קובץ או תוכנה',
    });
    return { path: r.canceled ? null : r.filePaths[0] };
  });
  handle('keys:show', () => showKeys());
  handle('keys:hide', () => hideKeys());
  handle('keys:openEditor', ({ key }) => {
    hideKeys();
    setExpanded(true, { explicit: true, focus: true });
    sidebar.webContents.send('ui:editLauncher', { key: KEY_RE.test(key || '') ? key : '' });
  });

  handle('clip:copy', ({ text, secret }) => copyText(text, !!secret));
  handle('shell:open', ({ url }) => openExternal(url));

  handle('config:set', ({ patch }) => applyConfig(patch || {}));
  handle('config:reset', () => applyConfig({ ...DEFAULTS, personalPath: undefined, teamPath: undefined }));

  handle('search:hide', () => hideSearch());
  handle('search:show', () => showSearch());
  handle('app:quit', () => { quitting = true; app.quit(); });
}

// ───────────────────────── auto lock & updates ─────────────────────────
function autoLockCheck() {
  const mins = Number(cfg.get('autoLockMinutes')) || 0;
  if (!mins) return;
  const anyOpen = ['personal', 'team'].some((n) => vaults[n] && vaults[n].unlocked);
  if (anyOpen && powerMonitor.getSystemIdleTime() >= mins * 60) lockAll();
}

function checkUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', () => notify('גרסה חדשה של הסרגל הורדה — היא תותקן ביציאה הבאה'));
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  } catch { /* no updater in dev */ }
}

// ───────────────────────── boot ─────────────────────────
async function boot() {
  if (isMac && app.dock) app.dock.hide();
  cfg = new Config(path.join(app.getPath('userData'), 'config.json'));
  nativeTheme.themeSource = cfg.get('theme') || 'system';

  if (cfg.get('personalPath')) { vaults.personal = new Vault(cfg.get('personalPath')); watch('personal'); }
  if (cfg.get('teamPath')) { vaults.team = new Vault(cfg.get('teamPath')); watch('team'); }

  registerIpc();
  createSidebar();
  createSearch();
  createKeys();
  createTray();
  registerHotkey();
  applyLogin();

  setInterval(tick, 80);
  setInterval(autoLockCheck, 15000);
  powerMonitor.on('lock-screen', lockAll);
  powerMonitor.on('suspend', lockAll);
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  checkUpdates();

  if (process.env.SARGEL_SHOTS) {
    // development only: scripted screenshots of every screen
    require('./devshots')({
      app, state, vaults, setExpanded, createVault, openVault, unlockPersonal, lockAll, showSearch, showKeys, broadcast,
      sidebar: () => sidebar, search: () => searchWin, keys: () => keysWin,
    });
  }
}
