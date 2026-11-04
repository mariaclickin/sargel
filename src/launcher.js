'use strict';
/**
 * Launchers — buttons / keyboard keys that open things:
 *   web   → a URL in the default browser, or a specific Chrome profile (with or without a URL)
 *   app   → an installed program ("appid:<id>" on Windows, a path, or "name:<Name>" resolved at run time)
 *   path  → a folder or file
 *   copy  → copy a field from the sidebar (handled in main.js)
 */
const { shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

class LaunchError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function chromeUserDataDir() {
  if (isWin) return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(os.homedir(), '.config', 'google-chrome');
}

function chromeExe() {
  if (isWin) {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      const p = path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  if (isMac) return fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app' : null;
  return 'google-chrome';
}

/** [{dir, name, email}] — from Chrome's "Local State" file */
function chromeProfiles() {
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(chromeUserDataDir(), 'Local State'), 'utf8'));
    const cache = (ls.profile && ls.profile.info_cache) || {};
    return Object.entries(cache).map(([dir, p]) => ({ dir, name: p.name || dir, email: p.user_name || '' }))
      .sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : a.dir.localeCompare(b.dir, 'en', { numeric: true })));
  } catch {
    return [];
  }
}

function safeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(u)) return `https://${u}`;
  throw new LaunchError('BAD_URL');
}

function detached(cmd, args) {
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  p.on('error', () => {});
  p.unref();
}

async function openWeb(url, profile) {
  const u = safeUrl(url);
  if (!profile) {
    if (!u) throw new LaunchError('BAD_URL');
    await shell.openExternal(u);
    return;
  }
  if (!/^[\w .-]{1,64}$/.test(profile)) throw new LaunchError('BAD_INPUT');
  const exe = chromeExe();
  if (!exe) throw new LaunchError('NO_CHROME');
  const args = [`--profile-directory=${profile}`];
  if (u) args.push(u);
  if (isMac) detached('open', ['-na', exe, '--args', ...args]);
  else detached(exe, args);
}

let appsCache = null;
let appsCacheAt = 0;

/** Installed apps: [{name, target}] — Windows: Start menu (incl. Store apps), Mac: /Applications */
function listApps() {
  if (appsCache && Date.now() - appsCacheAt < 10 * 60 * 1000) return Promise.resolve(appsCache);
  return new Promise((resolve) => {
    if (isWin) {
      const cmd = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
        let list = [];
        if (!err) {
          try {
            const j = JSON.parse(out);
            list = (Array.isArray(j) ? j : [j])
              .filter((a) => a && a.Name && a.AppID && !/uninstall|הסר|readme|help|documentation/i.test(a.Name))
              .map((a) => ({ name: a.Name, target: `appid:${a.AppID}` }));
          } catch { /* ignore */ }
        }
        done(list);
      });
    } else if (isMac) {
      const out = [];
      for (const dir of ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]) {
        try {
          for (const f of fs.readdirSync(dir)) if (f.endsWith('.app')) out.push({ name: f.slice(0, -4), target: path.join(dir, f) });
        } catch { /* ignore */ }
      }
      done(out);
    } else {
      done([]);
    }
    function done(list) {
      const seen = new Set();
      appsCache = list.filter((a) => (seen.has(a.name) ? false : seen.add(a.name))).sort((a, b) => a.name.localeCompare(b.name, 'he'));
      appsCacheAt = Date.now();
      resolve(appsCache);
    }
  });
}

async function findApp(name) {
  const n = String(name).toLowerCase();
  const apps = await listApps();
  return apps.find((a) => a.name.toLowerCase() === n) || null;
}

async function openTarget(target) {
  if (target.startsWith('appid:')) {
    if (!isWin) throw new LaunchError('NOT_INSTALLED');
    const id = target.slice(6);
    if (!/^[^"<>|\r\n]{1,300}$/.test(id)) throw new LaunchError('BAD_INPUT');
    detached('explorer.exe', [`shell:AppsFolder\\${id}`]);
    return;
  }
  if (!fs.existsSync(target)) throw new LaunchError('NOT_FOUND');
  const err = await shell.openPath(target);
  if (err) throw new LaunchError('LAUNCH_FAILED', err);
}

/** Returns {fallback:true} when an app wasn't installed and its fallback URL was opened instead */
async function openApp(l) {
  let target = String(l.target || '');
  if (target.startsWith('name:')) {
    const app = await findApp(target.slice(5));
    if (!app) {
      if (l.url) { await openWeb(l.url, l.profile || ''); return { fallback: true }; }
      throw new LaunchError('NOT_INSTALLED');
    }
    target = app.target;
  }
  try {
    await openTarget(target);
  } catch (e) {
    if (l.url) { await openWeb(l.url, l.profile || ''); return { fallback: true }; }
    throw e;
  }
  return {};
}

async function openPath(p) {
  p = String(p || '');
  if (!p || !fs.existsSync(p)) throw new LaunchError('NOT_FOUND');
  const err = await shell.openPath(p);
  if (err) throw new LaunchError('LAUNCH_FAILED', err);
}

/** Suggested starter buttons: Chrome profiles with a signed-in account (max 3) + Claude + ChatGPT */
function suggestedLaunchers() {
  const now = Date.now();
  const out = [];
  const profiles = chromeProfiles().filter((p) => p.email).slice(0, 3);
  const nameCount = {};
  for (const p of chromeProfiles()) nameCount[p.name] = (nameCount[p.name] || 0) + 1;
  const colors = ['blue', 'pink', 'green'];
  profiles.forEach((p, i) => {
    const domainLike = /\.[a-z]{2,}$/i.test(p.name);
    const title = nameCount[p.name] === 1 && !domainLike ? p.name : p.email.split('@')[0];
    out.push({ key: String(i + 1), title, icon: 'chrome', color: colors[i], type: 'web', url: '', profile: p.dir, target: '' });
  });
  out.push({ key: String(out.length + 1), title: 'Claude', icon: 'sparkle', color: 'coral', type: 'app', target: 'name:Claude', url: 'https://claude.ai', profile: '' });
  out.push({ key: String(out.length + 1), title: 'ChatGPT', icon: 'chat', color: 'gray', type: 'app', target: 'name:ChatGPT', url: 'https://chatgpt.com', profile: '' });
  return out.map((l, i) => ({ ...l, order: i, updatedAt: now }));
}

module.exports = { chromeProfiles, listApps, openWeb, openApp, openPath, suggestedLaunchers, LaunchError };
