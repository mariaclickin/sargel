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
const { Activity, combine, stats, dateKey } = require('./activity');

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
let quickWin = null;
let toastWin = null;
let toastTimer = null;
let tray = null;
let quitting = false;
let hotkeyOk = true;
let launcherHotkeyOk = true;
let quickHotkeyOk = true;
let blockHotkeyOk = true;
let activity = null;
let screenLocked = false;
let clipTimer = null;
let saveChain = Promise.resolve();

const mkState = () => ({ expanded: false, pinned: false, hold: false, explicitOpen: false, insideSince: 0, outsideSince: 0 });
const state = mkState(); // purple sidebar
const tstate = mkState(); // green tracker panel
let tracker = null;

/** the two edge drawers that share the hover / slide-out behaviour */
function drawers() {
  return [
    { kind: 'sidebar', win: sidebar, st: state },
    { kind: 'tracker', win: tracker, st: tstate },
  ];
}
const drawerByKind = (kind) => drawers().find((d) => d.kind === kind);
const anyExpanded = () => drawers().some((d) => d.st.expanded);
function reshowDrawers() {
  if (sidebar) sidebar.showInactive();
  if (tracker && cfg.get('trackerEnabled') !== false) tracker.showInactive();
}
const drawerBySender = (sender) => drawers().find((d) => d.win && !d.win.isDestroyed() && d.win.webContents === sender) || drawers()[0];
const vaults = { personal: null, team: null };

const uid = () => crypto.randomUUID();

// ───────────────────────── single instance ─────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setExpanded(true, { explicit: true, focus: true }));
  app.whenReady().then(boot);
}

/** pause a running TIME BLOCK right now (app closing / computer sleeping), writing synchronously */
function pauseBlockNow() {
  const v = vaults.personal;
  if (v && v.unlocked) {
    try { if (endRunning(v)) v._write(v.data); } catch { /* ignore */ }
  } else {
    pendingStopAt = Date.now();
  }
}

app.on('before-quit', () => {
  quitting = true;
  pauseBlockNow();
  try { syncActivityToVault(); if (activity) { activity.s.lastAlive = Date.now(); activity.dirty = true; activity.save(); } } catch { /* ignore */ }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* tray app — keep running */ });

// ───────────────────────── geometry ─────────────────────────
function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function collapsedBounds(kind = 'sidebar') {
  const wa = workArea();
  let y = Math.round(wa.y + (wa.height - HANDLE.h) * clamp(cfg.get('handleY'), 0, 1));
  if (kind === 'tracker') {
    // right below the sidebar handle; above it if there's no room
    y = y + HANDLE.h + 10 + HANDLE.h <= wa.y + wa.height ? y + HANDLE.h + 10 : y - HANDLE.h - 10;
  }
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
  for (const d of drawers()) {
    if (!d.win || d.win.isDestroyed()) continue;
    d.win.setBounds(d.st.expanded ? expandedBounds() : collapsedBounds(d.kind));
  }
}

function createTracker() {
  tracker = new BrowserWindow({
    ...collapsedBounds('tracker'),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, acceptFirstMouse: true,
    backgroundColor: '#00000000', title: 'הסרגל — המעקב', webPreferences,
  });
  tracker.setAlwaysOnTop(true, 'floating');
  if (isMac) tracker.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  tracker.loadFile(path.join(RENDERER, 'tracker.html'));
  tracker.once('ready-to-show', () => { if (cfg.get('trackerEnabled') !== false) tracker.showInactive(); });
  tracker.on('close', (e) => { if (!quitting) e.preventDefault(); });
  tracker.on('blur', () => { if (!tstate.pinned) tstate.explicitOpen = false; });
  tracker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tracker.webContents.on('will-navigate', (e) => e.preventDefault());
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
  if (isMac && !anyExpanded()) {
    app.hide();
    setTimeout(reshowDrawers, 80);
  }
}

function toggleKeys() {
  if (keysWin && keysWin.isVisible() && keysWin.isFocused()) hideKeys();
  else showKeys();
}

/* quick note window (Ctrl+Shift+Y) */
function createQuick() {
  quickWin = new BrowserWindow({
    width: 440, height: 300, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    hasShadow: false, show: false, backgroundColor: '#00000000', title: 'הסרגל — פתק מהיר', webPreferences,
  });
  quickWin.setAlwaysOnTop(true, 'pop-up-menu');
  if (isMac) quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quickWin.loadFile(path.join(RENDERER, 'quicknote.html'));
  quickWin.on('blur', () => hideQuick());
  quickWin.on('close', (e) => { if (!quitting) { e.preventDefault(); hideQuick(); } });
  quickWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  quickWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showQuick() {
  if (!quickWin) return;
  hideSearch();
  hideKeys();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w] = quickWin.getSize();
  quickWin.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + wa.height * 0.2));
  quickWin.webContents.send('quick:open', publicState());
  quickWin.show();
  quickWin.focus();
}

function hideQuick() {
  if (!quickWin || !quickWin.isVisible()) return;
  quickWin.hide();
  if (isMac && !anyExpanded()) {
    app.hide();
    setTimeout(reshowDrawers, 80);
  }
}

/* small popup in the corner — hourly progress, water, end of day */
function createToast() {
  toastWin = new BrowserWindow({
    width: 360, height: 170, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    focusable: !isMac, hasShadow: false, show: false, backgroundColor: '#00000000', title: 'הסרגל', webPreferences,
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWin.loadFile(path.join(RENDERER, 'toast.html'));
  toastWin.on('close', (e) => { if (!quitting) { e.preventDefault(); toastWin.hide(); } });
  toastWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toastWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showToast(payload) {
  if (!toastWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const [w, h] = toastWin.getSize();
  const x = cfg.get('side') === 'left' ? wa.x + wa.width - w - 12 : wa.x + 12;
  toastWin.setPosition(Math.round(x), Math.round(wa.y + wa.height - h - 12));
  toastWin.webContents.send('toast:show', payload);
  toastWin.showInactive();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastWin && toastWin.hide(), payload.ttl || 30000);
}

function setExpanded(v, opts = {}, kind = 'sidebar') {
  const d = drawerByKind(kind);
  const { win, st } = d;
  if (!win || win.isDestroyed()) return;
  st.insideSince = 0;
  st.outsideSince = 0;
  if (v && opts.explicit) st.explicitOpen = true;
  if (st.expanded === v) {
    if (v && opts.focus) win.focus();
    return;
  }
  if (v) {
    // only one panel open at a time
    for (const o of drawers()) {
      if (o.kind !== kind && o.st.expanded) { o.st.pinned = false; setExpanded(false, {}, o.kind); }
    }
  }
  st.expanded = v;
  if (v) {
    win.setBounds(expandedBounds());
    win.moveTop();
    win.webContents.send('ui:expanded', true);
    if (opts.focus) win.focus();
  } else {
    win.webContents.send('ui:expanded', false);
    if (win.isFocused()) win.blur();
    win.setBounds(collapsedBounds(kind));
  }
}

/** Poll the cursor: hover a handle → open; leave the panel → close. Works the same on Windows and Mac. */
function tick() {
  const p = screen.getCursorScreenPoint();
  const now = Date.now();
  const list = drawers().filter((d) => d.win && !d.win.isDestroyed() && d.win.isVisible());
  const within = (b) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  const overOpen = list.some((d) => d.st.expanded && within(d.win.getBounds()));
  for (const { kind, win, st } of list) {
    const inside = within(win.getBounds());
    if (!st.expanded) {
      if (inside && !overOpen) {
        if (!st.insideSince) st.insideSince = now;
        if (now - st.insideSince >= 160) setExpanded(true, {}, kind);
      } else {
        st.insideSince = 0;
      }
      continue;
    }
    if (inside) {
      st.outsideSince = 0;
      st.explicitOpen = false;
      continue;
    }
    if (st.pinned || st.hold || st.explicitOpen) {
      st.outsideSince = 0;
      continue;
    }
    if (!st.outsideSince) st.outsideSince = now;
    if (now - st.outsideSince >= 650) setExpanded(false, {}, kind);
  }
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
  if (isMac && !anyExpanded()) {
    // hand focus back to the app the user was in
    app.hide();
    setTimeout(reshowDrawers, 80);
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
    { label: 'פתיחת המעקב', click: () => { if (cfg.get('trackerEnabled') === false) applyConfig({ trackerEnabled: true }); setExpanded(true, { explicit: true, focus: true }, 'tracker'); } },
    { label: `חיפוש מהיר${hk ? `   (${hk})` : ''}`, click: () => showSearch() },
    { label: `מקלדת קיצורים${cfg.get('launcherHotkey') ? `   (${prettyHotkey(cfg.get('launcherHotkey'))})` : ''}`, click: () => showKeys() },
    { label: `פתק מהיר${cfg.get('quickNoteHotkey') ? `   (${prettyHotkey(cfg.get('quickNoteHotkey'))})` : ''}`, click: () => showQuick() },
    { label: `TIME BLOCK: השהיה / המשך${cfg.get('blockHotkey') ? `   (${prettyHotkey(cfg.get('blockHotkey'))})` : ''}`, click: () => blockToggleWithToast() },
    { type: 'separator' },
    {
      label: 'מעקב שעות',
      type: 'checkbox',
      checked: !!cfg.get('trackEnabled'),
      click: (mi) => applyConfig({ trackEnabled: mi.checked }),
    },
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
  const q = cfg.get('quickNoteHotkey');
  quickHotkeyOk = q === cfg.get('hotkey') || q === cfg.get('launcherHotkey') ? false
    : reg(q, () => (quickWin && quickWin.isVisible() ? hideQuick() : showQuick()));
  const bk = cfg.get('blockHotkey');
  blockHotkeyOk = [cfg.get('hotkey'), cfg.get('launcherHotkey'), q].includes(bk) ? false
    : reg(bk, () => blockToggleWithToast());
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
  if (typeof patch.quickNoteHotkey === 'string' && patch.quickNoteHotkey.length < 80) clean.quickNoteHotkey = patch.quickNoteHotkey;
  if (typeof patch.blockHotkey === 'string' && patch.blockHotkey.length < 80) clean.blockHotkey = patch.blockHotkey;
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (hm.test(patch.workStart || '')) clean.workStart = patch.workStart;
  if (hm.test(patch.workEnd || '')) clean.workEnd = patch.workEnd;
  if (Array.isArray(patch.workDays)) clean.workDays = [...new Set(patch.workDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  for (const k of ['trackEnabled', 'hourlyNotify', 'waterReminder', 'trackerEnabled']) if (k in patch) clean[k] = !!patch[k];
  if ('breakMinutes' in patch) clean.breakMinutes = Math.round(clamp(patch.breakMinutes, 3, 60));
  if ('waterMinutes' in patch) clean.waterMinutes = Math.round(clamp(patch.waterMinutes, 15, 240));
  if ('waterGoal' in patch) clean.waterGoal = Math.round(clamp(patch.waterGoal, 1, 20));
  if ('autoLockMinutes' in patch) clean.autoLockMinutes = Math.round(clamp(patch.autoLockMinutes, 0, 1440));
  if ('launchAtLogin' in patch) clean.launchAtLogin = !!patch.launchAtLogin;
  if (['system', 'light', 'dark'].includes(patch.theme)) clean.theme = patch.theme;
  cfg.set(clean);
  if (['hotkey', 'launcherHotkey', 'quickNoteHotkey', 'blockHotkey'].some((k) => k in clean)) registerHotkey();
  if ('launchAtLogin' in clean) applyLogin();
  if ('theme' in clean) nativeTheme.themeSource = clean.theme;
  if ('trackerEnabled' in clean && tracker) {
    if (clean.trackerEnabled) tracker.showInactive();
    else { setExpanded(false, {}, 'tracker'); tracker.hide(); }
  }
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
  data.notes = p && p.unlocked ? p.data.notes.filter((n) => !n.deleted) : [];
  data.tracker = p && p.unlocked ? {
    sessions: p.data.sessions.filter((x) => !x.deleted),
    checks: p.data.tchecks.filter((x) => !x.deleted),
    jobs: p.data.jobs.filter((x) => !x.deleted),
    blocks: p.data.tblocks.filter((x) => !x.deleted),
    subs: p.data.tsubs.filter((x) => !x.deleted),
    active: trkActive(p),
  } : null;
  return {
    platform: process.platform,
    version: app.getVersion(),
    config: { ...cfg.data },
    hotkeyOk,
    hotkeyLabel: prettyHotkey(cfg.get('hotkey')),
    launcherHotkeyOk,
    launcherHotkeyLabel: prettyHotkey(cfg.get('launcherHotkey')),
    quickHotkeyOk,
    quickHotkeyLabel: prettyHotkey(cfg.get('quickNoteHotkey')),
    blockHotkeyOk,
    blockHotkeyLabel: prettyHotkey(cfg.get('blockHotkey')),
    vaults: { personal: info('personal'), team: info('team') },
    rememberTeam: !!(p && p.unlocked && p.data.settings.teamPassword),
    data,
    ui: { expanded: state.expanded, pinned: state.pinned, trackerExpanded: tstate.expanded, trackerPinned: tstate.pinned },
  };
}

function broadcast() {
  const s = publicState();
  for (const w of [sidebar, tracker, searchWin, keysWin, quickWin]) {
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
  else { await migratePersonal(); await autoUnlockTeam(); syncActivityToVault(); fixRunning(); carryChecks(); }
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
  syncActivityToVault();
  fixRunning();
  carryChecks();
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
const LAUNCH_TYPES = new Set(['web', 'app', 'path', 'copy', 'block']);
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
  const wasDone = !!(prev && !prev.deleted && prev.done);
  clean.done = 'done' in item ? !!item.done : wasDone;
  clean.doneAt = clean.done ? (wasDone ? prev.doneAt : now) : 0;
  const sameTab = prev && !prev.deleted && prev.tabId === tab.id;
  clean.order = sameTab ? prev.order : nextOrder(v.data.items.filter((x) => !x.deleted && x.tabId === tab.id));
  if (idx >= 0) v.data.items[idx] = clean; else v.data.items.push(clean);
  queueSave(vault);
  return { id };
}

function toggleDone({ vault, id }) {
  const v = requireVault(vault);
  const it = v.data.items.find((x) => x.id === id && !x.deleted);
  if (!it) throw new VaultError('NOT_FOUND');
  const now = Date.now();
  it.done = !it.done;
  it.doneAt = it.done ? now : 0;
  it.updatedAt = now;
  queueSave(vault);
  return { done: it.done };
}

/* notes (Keep-style cards) — personal vault */
function saveNote({ note: n }) {
  const v = requireVault('personal');
  if (!n || typeof n !== 'object') throw new VaultError('BAD_INPUT');
  const now = Date.now();
  const id = typeof n.id === 'string' && n.id ? n.id.slice(0, 64) : uid();
  const checks = Array.isArray(n.checks) ? n.checks.slice(0, 100).map((c) => ({
    id: typeof c.id === 'string' && c.id ? c.id.slice(0, 64) : uid(),
    text: str(c.text, 500),
    done: !!c.done,
  })) : [];
  const clean = {
    id,
    title: str(n.title, 200).trim(),
    text: str(n.text, 20000),
    checklist: !!n.checklist,
    checks,
    color: COLORS.has(n.color) ? n.color : '',
    pinned: !!n.pinned,
    updatedAt: now,
  };
  const idx = v.data.notes.findIndex((x) => x.id === id);
  clean.createdAt = idx >= 0 && v.data.notes[idx].createdAt ? v.data.notes[idx].createdAt : now;
  if (idx >= 0) v.data.notes[idx] = clean; else v.data.notes.push(clean);
  queueSave('personal');
  return { id };
}

function deleteNote({ id }) {
  const v = requireVault('personal');
  const now = Date.now();
  v.data.notes = v.data.notes.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  queueSave('personal');
}

/* ───────── tracker panel: TIME BLOCKS, daily checklist, jobs & leads ───────── */
const bootAt = Date.now();
let prevAlive = 0; // last time the previous run of the app was alive
let pendingStopAt = 0; // computer went to sleep while the vault was locked

function trkActive(v) {
  return v.data.tstate.find((x) => x.id === 'active' && !x.deleted) || null;
}

function setActive(v, patch) {
  const i = v.data.tstate.findIndex((x) => x.id === 'active');
  const doc = { id: 'active', name: '', blockId: '', subId: '', sessionId: '', ...(i >= 0 && !v.data.tstate[i].deleted ? v.data.tstate[i] : {}), ...patch, updatedAt: Date.now() };
  if (i >= 0) v.data.tstate[i] = doc; else v.data.tstate.push(doc);
}

const liveBlock = (v, id) => v.data.tblocks.find((b) => b.id === id && !b.deleted);
const liveSub = (v, id) => v.data.tsubs.find((s) => s.id === id && !s.deleted);

/** one-time: sessions from before blocks existed are grouped into a block per name */
function migrateBlocks(v) {
  let changed = false;
  const now = Date.now();
  const byName = new Map(v.data.tblocks.filter((b) => !b.deleted).map((b) => [b.name, b]));
  for (const s of v.data.sessions) {
    if (s.deleted || s.blockId) continue;
    let b = byName.get(s.name);
    if (!b) {
      b = { id: uid(), name: s.name, done: false, doneAt: 0, createdAt: s.start, order: 0, updatedAt: now };
      v.data.tblocks.push(b);
      byName.set(b.name, b);
    }
    s.blockId = b.id;
    s.subId = s.subId || '';
    s.updatedAt = now;
    changed = true;
  }
  const a = trkActive(v);
  if (a && a.name && !a.blockId && byName.get(a.name)) { setActive(v, { blockId: byName.get(a.name).id }); changed = true; }
  return changed;
}

function endRunning(v, at = Date.now()) {
  const a = trkActive(v);
  if (!a || !a.sessionId) return false;
  const s = v.data.sessions.find((x) => x.id === a.sessionId);
  if (s && !s.end) { s.end = Math.max(s.start, at); s.updatedAt = Date.now(); }
  setActive(v, { sessionId: '' });
  return true;
}

/** start (or continue) a block — optionally on one of its steps */
function startBlock({ blockId, subId, name }) {
  const v = requireVault('personal');
  const now = Date.now();
  let b = blockId ? liveBlock(v, blockId) : null;
  if (!b && name) {
    const n = str(name, 80).trim();
    if (!n) throw new VaultError('BAD_INPUT');
    b = v.data.tblocks.find((x) => !x.deleted && !x.done && x.name === n);
    if (!b) {
      b = { id: uid(), name: n, done: false, doneAt: 0, createdAt: now, order: nextOrder(v.data.tblocks.filter((x) => !x.deleted)), updatedAt: now };
      v.data.tblocks.push(b);
    }
  }
  if (!b) throw new VaultError('NOT_FOUND');
  if (b.done) { b.done = false; b.doneAt = 0; b.updatedAt = now; }
  const sub = subId ? liveSub(v, subId) : null;
  if (sub && sub.done) { sub.done = false; sub.doneAt = 0; sub.updatedAt = now; }
  endRunning(v);
  const s = { id: uid(), name: b.name, blockId: b.id, subId: sub ? sub.id : '', start: now, end: 0, machine: activity ? activity.machine : '', updatedAt: now };
  v.data.sessions.push(s);
  setActive(v, { name: b.name, blockId: b.id, subId: s.subId, sessionId: s.id });
  queueSave('personal');
  return { blockId: b.id };
}

function pauseBlock() {
  const v = requireVault('personal');
  if (endRunning(v)) queueSave('personal');
}

function resumeBlock() {
  const v = requireVault('personal');
  const a = trkActive(v);
  if (a && a.blockId && !a.sessionId) return startBlock({ blockId: a.blockId, subId: a.subId });
  return null;
}

function stopBlock() {
  const v = requireVault('personal');
  endRunning(v);
  setActive(v, { name: '', blockId: '', subId: '', sessionId: '' });
  queueSave('personal');
}

/**
 * Pause/resume from a hotkey or a launcher.
 * blockId empty → toggle the current block; blockId given → start that block (or pause it if it's the one running).
 * Returns {done:'paused'|'resumed'|'started'|'none', name, step}
 */
function blockAction(blockId = '') {
  const v = requireVault('personal');
  const a = trkActive(v);
  const names = () => {
    const now = trkActive(v);
    const b = now && liveBlock(v, now.blockId);
    const s = now && now.subId && liveSub(v, now.subId);
    return { name: b ? b.name : '', step: s ? s.text : '' };
  };
  if (blockId && !(a && a.blockId === blockId && a.sessionId)) {
    if (!liveBlock(v, blockId)) throw new VaultError('NOT_FOUND');
    startBlock({ blockId });
    return { done: 'started', ...names() };
  }
  if (a && a.sessionId) { const n = names(); pauseBlock(); return { done: 'paused', ...n }; }
  if (a && a.blockId && liveBlock(v, a.blockId)) { resumeBlock(); return { done: 'resumed', ...names() }; }
  return { done: 'none', name: '', step: '' };
}

function blockToggleWithToast(blockId = '') {
  let r;
  try {
    r = blockAction(blockId);
  } catch (e) {
    showToast({ kind: 'block', quiet: true, ttl: 3500, title: e.code === 'LOCKED' ? '🔒 הסרגל נעול' : 'לא הצלחתי', body: e.code === 'LOCKED' ? 'פותחים את הסרגל עם הסיסמה ואז אפשר להשהות ולהמשיך' : '' });
    return null;
  }
  const label = r.name ? `${r.name}${r.step ? ` › ${r.step}` : ''}` : '';
  const t = {
    paused: ['⏸ הושהה', label],
    resumed: ['▶ ממשיך', label],
    started: ['▶ התחלת', label],
    none: ['אין בלוק פתוח', 'מתחילים בלוק מהפאנל הוורוד (TIME BLOCKS)'],
  }[r.done];
  showToast({ kind: 'block', quiet: true, ttl: 2600, title: t[0], body: t[1] });
  return r;
}

function addBlock({ name }) {
  const v = requireVault('personal');
  const n = str(name, 80).trim();
  if (!n) throw new VaultError('BAD_INPUT');
  const now = Date.now();
  const b = { id: uid(), name: n, done: false, doneAt: 0, createdAt: now, order: nextOrder(v.data.tblocks.filter((x) => !x.deleted)), updatedAt: now };
  v.data.tblocks.push(b);
  queueSave('personal');
  return { id: b.id };
}

function renameBlock({ id, name }) {
  const v = requireVault('personal');
  const b = liveBlock(v, id);
  const n = str(name, 80).trim();
  if (!b || !n) throw new VaultError('BAD_INPUT');
  b.name = n;
  b.updatedAt = Date.now();
  const a = trkActive(v);
  if (a && a.blockId === id) setActive(v, { name: n });
  queueSave('personal');
}

function setBlockDone({ id, done }) {
  const v = requireVault('personal');
  const b = liveBlock(v, id);
  if (!b) throw new VaultError('NOT_FOUND');
  const a = trkActive(v);
  if (done && a && a.blockId === id) { endRunning(v); setActive(v, { name: '', blockId: '', subId: '', sessionId: '' }); }
  b.done = !!done;
  b.doneAt = done ? Date.now() : 0;
  b.updatedAt = Date.now();
  queueSave('personal');
}

/** deletes the block, its steps and all its recorded time */
function deleteBlock({ id }) {
  const v = requireVault('personal');
  const now = Date.now();
  const a = trkActive(v);
  if (a && a.blockId === id) { endRunning(v); setActive(v, { name: '', blockId: '', subId: '', sessionId: '' }); }
  const kill = (x) => ({ id: x.id, deleted: true, updatedAt: now });
  v.data.tblocks = v.data.tblocks.map((x) => (x.id === id ? kill(x) : x));
  v.data.tsubs = v.data.tsubs.map((x) => (x.blockId === id && !x.deleted ? kill(x) : x));
  v.data.sessions = v.data.sessions.map((x) => (x.blockId === id && !x.deleted ? kill(x) : x));
  queueSave('personal');
}

function addSub({ blockId, text }) {
  const v = requireVault('personal');
  const b = liveBlock(v, blockId);
  const t = str(text, 200).trim();
  if (!b || !t) throw new VaultError('BAD_INPUT');
  const now = Date.now();
  v.data.tsubs.push({ id: uid(), blockId, text: t, done: false, doneAt: 0, order: nextOrder(v.data.tsubs.filter((x) => !x.deleted && x.blockId === blockId)), updatedAt: now });
  if (b.done) { b.done = false; b.doneAt = 0; b.updatedAt = now; }
  queueSave('personal');
}

function toggleSub({ id }) {
  const v = requireVault('personal');
  const s = liveSub(v, id);
  if (!s) throw new VaultError('NOT_FOUND');
  s.done = !s.done;
  s.doneAt = s.done ? Date.now() : 0;
  s.updatedAt = Date.now();
  const a = trkActive(v);
  // finishing the step that's running: move on to the next open step (or the block itself)
  if (s.done && a && a.subId === id) {
    const next = v.data.tsubs.filter((x) => !x.deleted && !x.done && x.blockId === s.blockId).sort((p, q) => (p.order || 0) - (q.order || 0))[0];
    if (a.sessionId) {
      endRunning(v);
      queueSave('personal');
      return startBlock({ blockId: s.blockId, subId: next ? next.id : '' });
    }
    setActive(v, { subId: next ? next.id : '' });
  }
  queueSave('personal');
  return null;
}

function deleteSub({ id }) {
  const v = requireVault('personal');
  const now = Date.now();
  const a = trkActive(v);
  if (a && a.subId === id) {
    if (a.sessionId) { endRunning(v); }
    setActive(v, { subId: '' });
  }
  v.data.tsubs = v.data.tsubs.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  // the step's time stays on the block
  for (const s of v.data.sessions) if (!s.deleted && s.subId === id) { s.subId = ''; s.updatedAt = now; }
  queueSave('personal');
}

/** a block left running when the app closed / the computer slept is paused at that moment */
function fixRunning() {
  const v = vaults.personal;
  if (!v || !v.unlocked || !activity) return;
  if (migrateBlocks(v)) queueSave('personal');
  const a = trkActive(v);
  if (!a || !a.sessionId) { pendingStopAt = 0; return; }
  const s = v.data.sessions.find((x) => x.id === a.sessionId);
  if (!s || s.end) { setActive(v, { sessionId: '' }); queueSave('personal'); return; }
  if (s.machine && s.machine !== activity.machine) return; // running on another computer
  let stopAt = 0;
  if (s.start < bootAt) stopAt = Math.max(s.start, prevAlive || s.start);
  if (pendingStopAt && pendingStopAt > s.start) stopAt = stopAt ? Math.min(stopAt, pendingStopAt) : pendingStopAt;
  pendingStopAt = 0;
  if (stopAt) { endRunning(v, stopAt); queueSave('personal'); }
}

function addCheck({ text }) {
  const v = requireVault('personal');
  const t = str(text, 300).trim();
  if (!t) throw new VaultError('BAD_INPUT');
  const now = Date.now();
  v.data.tchecks.push({ id: uid(), text: t, done: false, doneAt: 0, date: dateKey(), carried: false, order: nextOrder(v.data.tchecks.filter((c) => !c.deleted)), updatedAt: now });
  queueSave('personal');
}

function toggleCheck({ id }) {
  const v = requireVault('personal');
  const c = v.data.tchecks.find((x) => x.id === id && !x.deleted);
  if (!c) throw new VaultError('NOT_FOUND');
  c.done = !c.done;
  c.doneAt = c.done ? Date.now() : 0;
  c.updatedAt = Date.now();
  queueSave('personal');
}

function deleteCheck({ id }) {
  const v = requireVault('personal');
  const now = Date.now();
  v.data.tchecks = v.data.tchecks.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  queueSave('personal');
}

/** unfinished checklist items from earlier days move to today */
function carryChecks() {
  const v = vaults.personal;
  if (!v || !v.unlocked) return;
  const today = dateKey();
  const now = Date.now();
  let moved = false;
  for (const c of v.data.tchecks) {
    if (c.deleted || c.done || !c.date || c.date >= today) continue;
    c.date = today;
    c.carried = true;
    c.updatedAt = now;
    moved = true;
  }
  if (moved) queueSave('personal');
}

const JOB_KINDS = new Set(['job', 'lead']);
function saveJob({ job: j }) {
  const v = requireVault('personal');
  if (!j || typeof j !== 'object') throw new VaultError('BAD_INPUT');
  const now = Date.now();
  const id = typeof j.id === 'string' && j.id ? j.id.slice(0, 64) : uid();
  const clean = {
    id,
    title: str(j.title, 200).trim() || 'ללא שם',
    kind: JOB_KINDS.has(j.kind) ? j.kind : 'job',
    status: Math.round(clamp(j.status, 0, 3)),
    due: /^\d{4}-\d{2}-\d{2}$/.test(j.due || '') ? j.due : '',
    note: str(j.note, 5000),
    updatedAt: now,
  };
  const i = v.data.jobs.findIndex((x) => x.id === id);
  clean.createdAt = i >= 0 && v.data.jobs[i].createdAt ? v.data.jobs[i].createdAt : now;
  if (i >= 0) v.data.jobs[i] = clean; else v.data.jobs.push(clean);
  queueSave('personal');
  return { id };
}

function deleteJob({ id }) {
  const v = requireVault('personal');
  const now = Date.now();
  v.data.jobs = v.data.jobs.map((x) => (x.id === id ? { id, deleted: true, updatedAt: now } : x));
  queueSave('personal');
}

/* ───────── activity tracking + reminders ───────── */
const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const fmtH = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

function activityTick() {
  if (!activity) return;
  activity.s.lastAlive = Date.now();
  activity.sample({
    enabled: !!cfg.get('trackEnabled'),
    idleSec: powerMonitor.getSystemIdleTime(),
    locked: screenLocked,
    breakMin: cfg.get('breakMinutes'),
  });
}

function syncActivityToVault() {
  const v = vaults.personal;
  if (!activity || !v || !v.unlocked) return;
  const list = v.data.days;
  let changed = false;
  for (const r of activity.records(14)) {
    const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0 && (list[i].updatedAt || 0) >= r.updatedAt) continue;
    if (i >= 0) list[i] = r; else list.push(r);
    changed = true;
  }
  const cut = dateKey(new Date(Date.now() - 120 * 864e5));
  const before = list.length;
  v.data.days = list.filter((d) => d.deleted || !d.date || d.date >= cut);
  if (changed || v.data.days.length !== before) queueSave('personal');
}

/** the day as seen from all computers: local + other machines' copies in the vault */
function dayView(key) {
  const lines = [activity.day(key).line];
  let water = activity.day(key).water || 0;
  const v = vaults.personal;
  if (v && v.unlocked) {
    for (const d of v.data.days) {
      if (d.deleted || d.date !== key || d.machine === activity.machine) continue;
      lines.push(d.line);
      water += d.water || 0;
    }
  }
  return { line: combine(lines), water };
}

function activitySummary() {
  const breakMin = cfg.get('breakMinutes');
  const now = new Date();
  const todayKey = dateKey(now);
  const today = dayView(todayKey);
  const week = [];
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay()); // Sunday
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = dateKey(d);
    const dv = k <= todayKey ? dayView(k) : { line: '', water: 0 };
    week.push({ date: k, dow: i, future: k > todayKey, active: dv.line ? stats(dv.line, breakMin).active : 0, water: dv.water });
  }
  const done = week.filter((d) => !d.future && d.active > 0 && d.date !== todayKey);
  return {
    enabled: !!cfg.get('trackEnabled'),
    breakMin,
    today: { date: todayKey, line: today.line, water: today.water, stats: stats(today.line, breakMin) },
    week,
    weekAvg: done.length ? Math.round(done.reduce((s, d) => s + d.active, 0) / done.length) : null,
  };
}

function remindersTick() {
  if (!activity || !cfg) return;
  carryChecks();
  const now = new Date();
  if (!(cfg.get('workDays') || []).includes(now.getDay())) return;
  const key = dateKey(now);
  const m = now.getHours() * 60 + now.getMinutes();
  const ws = hm(cfg.get('workStart'));
  const we = hm(cfg.get('workEnd'));
  const total = Math.max(1, Math.round((we - ws) / 60));
  const hourly = !!cfg.get('hourlyNotify');
  const water = !!cfg.get('waterReminder');
  const wm = cfg.get('waterMinutes');
  const waterWithHour = hourly && water && wm === 60;

  const events = [];
  if (hourly) for (let t = ws + 60; t <= we; t += 60) events.push({ id: `h${t}`, t, kind: t >= we ? 'end' : 'hour' });
  if (water && !waterWithHour) for (let t = ws + wm; t < we; t += wm) events.push({ id: `w${t}`, t, kind: 'water' });
  // due = time passed (shown up to 45 min late, e.g. after a break) and not shown yet
  const due = events.filter((e) => m >= e.t && m < e.t + 45 && !activity.wasNotified(key, e.id)).sort((a, b) => a.t - b.t);
  if (!due.length) return;
  // wait while the person is away — the reminder shows when they're back
  if (screenLocked || powerMonitor.getSystemIdleTime() >= cfg.get('breakMinutes') * 60) return;
  for (const e of due) activity.setNotified(key, e.id);
  const e = due[due.length - 1];
  const dv = dayView(key);
  const goal = cfg.get('waterGoal');
  let payload;
  if (e.kind === 'end') {
    const st = stats(dv.line, cfg.get('breakMinutes'));
    payload = {
      kind: 'end', title: 'סיימת את יום העבודה 🎉',
      body: `${cfg.get('trackEnabled') ? `${fmtH(st.active)} שעות פעילות · ` : ''}${dv.water} כוסות מים`,
      water: false,
    };
  } else if (e.kind === 'hour') {
    const h = Math.round((e.t - ws) / 60);
    payload = {
      kind: 'hour', title: `שעה ${h} מתוך ${total} הושלמה`,
      body: `${Math.round((h / total) * 100)}% מהיום · נשארו ${total - h} שעות`,
      water: waterWithHour, waterText: `💧 זמן לכוס מים · ${dv.water}/${goal} היום`,
    };
  } else {
    payload = { kind: 'water', title: 'זמן לכוס מים 💧', body: `${dv.water}/${goal} כוסות היום`, water: true };
  }
  showToast(payload);
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
    if (l.type === 'block') { blockToggleWithToast(l.target || ''); return { done: 'block' }; }
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
    const ok = [sidebar, tracker, searchWin, keysWin, quickWin, toastWin].some((w) => w && !w.isDestroyed() && w.webContents === e.sender);
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

  handle('ui:expand', ({ focus }, e) => setExpanded(true, { explicit: true, focus: !!focus }, drawerBySender(e.sender).kind));
  handle('ui:collapse', (_a, e) => { const d = drawerBySender(e.sender); d.st.explicitOpen = false; setExpanded(false, {}, d.kind); });
  handle('ui:pin', ({ pinned }, e) => { drawerBySender(e.sender).st.pinned = !!pinned; broadcast(); });
  handle('ui:hold', ({ hold }, e) => { drawerBySender(e.sender).st.hold = !!hold; });

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
  handle('data:toggleDone', (a) => toggleDone(a));
  handle('notes:save', (a) => saveNote(a));
  handle('notes:delete', (a) => deleteNote(a));
  handle('quick:hide', () => hideQuick());
  handle('quick:show', () => showQuick());

  handle('ui:openSidebar', () => setExpanded(true, { explicit: true, focus: true }, 'sidebar'));
  handle('trk:start', (a) => startBlock(a));
  handle('trk:pause', () => pauseBlock());
  handle('trk:resume', () => resumeBlock());
  handle('trk:stop', () => stopBlock());
  handle('trk:addBlock', (a) => addBlock(a));
  handle('trk:renameBlock', (a) => renameBlock(a));
  handle('trk:blockDone', (a) => setBlockDone(a));
  handle('trk:deleteBlock', (a) => deleteBlock(a));
  handle('trk:addSub', (a) => addSub(a));
  handle('trk:toggleSub', (a) => toggleSub(a));
  handle('trk:deleteSub', (a) => deleteSub(a));
  handle('trk:checkAdd', (a) => addCheck(a));
  handle('trk:checkToggle', (a) => toggleCheck(a));
  handle('trk:checkDelete', (a) => deleteCheck(a));
  handle('trk:jobSave', (a) => saveJob(a));
  handle('trk:jobDelete', (a) => deleteJob(a));

  handle('activity:get', () => ({ summary: activitySummary() }));
  handle('activity:water', ({ delta }) => {
    const n = activity.addWater(dateKey(), delta > 0 ? 1 : -1);
    activity.save();
    syncActivityToVault();
    return { water: n };
  });
  handle('activity:clear', () => {
    activity.clear();
    activity.save();
    const v = vaults.personal;
    if (v && v.unlocked) {
      const now = Date.now();
      v.data.days = v.data.days.map((d) => ({ id: d.id, deleted: true, updatedAt: now }));
      queueSave('personal');
    }
  });
  handle('toast:water', () => {
    activity.addWater(dateKey(), 1);
    activity.save();
    syncActivityToVault();
    if (toastWin) toastWin.hide();
    broadcast();
  });
  handle('toast:close', () => { if (toastWin) toastWin.hide(); });
  handle('toast:test', ({ kind }) => {
    if (kind === 'water') showToast({ kind: 'water', title: 'זמן לכוס מים 💧', body: 'כך תיראה התזכורת', water: true });
    else showToast({ kind: 'hour', title: 'שעה 3 מתוך 8 הושלמה', body: '37% מהיום · נשארו 5 שעות', water: !!cfg.get('waterReminder'), waterText: '💧 זמן לכוס מים' });
  });
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
  createTracker();
  createSearch();
  createKeys();
  createQuick();
  createToast();
  createTray();
  registerHotkey();
  applyLogin();

  activity = new Activity(path.join(app.getPath('userData'), 'activity.json'));
  prevAlive = activity.s.lastAlive || 0;
  sidebar.on('session-end', () => { pauseBlockNow(); activity.save(); }); // Windows shutdown / sign-out
  setInterval(tick, 80);
  setInterval(autoLockCheck, 15000);
  setInterval(() => { activityTick(); remindersTick(); }, 30000);
  setInterval(() => activity.save(), 5 * 60 * 1000);
  setInterval(syncActivityToVault, 10 * 60 * 1000);
  activityTick();
  powerMonitor.on('lock-screen', () => { screenLocked = true; activityTick(); lockAll(); });
  powerMonitor.on('unlock-screen', () => { screenLocked = false; });
  powerMonitor.on('suspend', () => { activityTick(); activity.save(); pauseBlockNow(); lockAll(); });
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  checkUpdates();

  if (process.env.SARGEL_SHOTS) {
    // development only: scripted screenshots of every screen
    require('./devshots')({
      app, state, tstate, tracker: () => tracker, vaults, setExpanded, trk: { startBlock, toggleSub, addSub, blockToggleWithToast, saveLauncher, runLauncher }, createVault, openVault, unlockPersonal, lockAll, showSearch, showKeys, broadcast,
      sidebar: () => sidebar, search: () => searchWin, keys: () => keysWin,
      quick: () => quickWin, toastWin: () => toastWin, showQuick, showToast, activity: () => activity,
    });
  }
}
