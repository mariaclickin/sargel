'use strict';
/* Shared helpers for the sidebar and the quick-search window */
const api = window.sargel;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function rid() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function normalizeUrl(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v)) return `https://${v}`;
  return '';
}

const ICONS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M17 6l3 3"/><path d="M14.5 8.5l2 2"/>',
  text: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  stack: '<rect x="4" y="3.5" width="16" height="5" rx="1.8"/><rect x="4" y="10" width="16" height="5" rx="1.8"/><rect x="4" y="16.5" width="16" height="4" rx="1.8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
  pin: '<path d="M12 16v6"/><path d="M8.5 3h7l-1 5.5 3.5 4v1.5H6V12.5l3.5-4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".6"/><circle cx="15" cy="15" r=".6"/><circle cx="15" cy="9" r=".6"/><circle cx="9" cy="15" r=".6"/>',
  save: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  checklist: '<path d="M4 6l1.5 1.5L8 5"/><path d="M4 12l1.5 1.5L8 11"/><path d="M4 18l1.5 1.5L8 17"/><path d="M11 6h9M11 12h9M11 18h9"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M4 18V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8z"/><path d="M8 9h8M8 12h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  mappin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 13h3"/>',
  chrome: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5h8.2M8.97 13.75L4.9 6.6M15.03 13.75L11 20.9"/>',
  sparkle: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 16h5"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  checkbox: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="3.5"/>',
  minus: '<path d="M5 12h14"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  rotate: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
};

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const hmToMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + m; };
const fmtMin = (min) => `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function whenText(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `היום ${t}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `אתמול ${t}`;
  return `${d.getDate()}.${d.getMonth() + 1} ${t}`;
}

/* item / launcher colors — one mid-tone per hue works on light and dark panels */
const COLORS = {
  purple: ['סגול', '#7F77DD'],
  blue: ['כחול', '#378ADD'],
  green: ['ירוק', '#5E9A24'],
  amber: ['צהוב', '#C98314'],
  coral: ['כתום', '#D85A30'],
  red: ['אדום', '#E24B4A'],
  pink: ['ורוד', '#D4537E'],
  gray: ['אפור', '#888780'],
};
const ITEM_ICONS = ['text', 'mail', 'send', 'file', 'edit', 'checklist', 'phone', 'chat', 'user', 'users', 'idcard', 'key', 'lock', 'link',
  'globe', 'star', 'flag', 'bolt', 'calendar', 'clock', 'briefcase', 'cash', 'tag', 'home', 'heart', 'mappin', 'folder', 'sparkle'];
const LAUNCH_ICONS = ['chrome', 'globe', 'mail', 'sparkle', 'chat', 'apps', 'folder', 'file', 'copy', 'user', 'users', 'briefcase',
  'calendar', 'checklist', 'phone', 'star', 'bolt', 'heart', 'home', 'cash', 'key', 'link', 'send', 'play', 'pause', 'clock'];

/** inline style for a colored icon tile */
function tileStyle(color) {
  const c = COLORS[color];
  return c ? `style="background:${c[1]}26;color:${c[1]}"` : '';
}

const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/** physical key → our key name (works the same with a Hebrew or English layout) */
function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  return null;
}

/** visual keyboard; launchers are shown on their keys */
function keyboardHTML(launchers, selected) {
  const byKey = new Map(launchers.filter((l) => l.key).map((l) => [l.key, l]));
  return `<div class="kbd">${KEY_ROWS.map((row, ri) => `
    <div class="kbd-row" style="padding-inline-start:${ri * 22}px">${[...row].map((k) => {
      const l = byKey.get(k);
      return `<button class="key ${l ? 'on' : ''} ${k === selected ? 'sel' : ''}" data-key="${k}" ${l ? tileStyle(l.color) : ''} title="${l ? esc(l.title) : 'מקש פנוי — לחיצה מגדירה'}">
        <span class="kcap">${k}</span>${l ? `${icon(l.icon || 'bolt')}<span class="klabel">${esc(l.title)}</span>` : ''}</button>`;
    }).join('')}</div>`).join('')}</div>`;
}

function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lgx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a06bff"/><stop offset="1" stop-color="#5a38ff"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#lgx)"/><rect x="13" y="15" width="38" height="10" rx="5" fill="#fff"/><rect x="13" y="28" width="38" height="10" rx="5" fill="#fff" fill-opacity=".8"/><rect x="13" y="41" width="38" height="10" rx="5" fill="#fff" fill-opacity=".55"/><circle cx="44" cy="20" r="2.4" fill="#6a45ff"/><circle cx="44" cy="33" r="2.4" fill="#6a45ff" fill-opacity=".8"/><circle cx="44" cy="46" r="2.4" fill="#6a45ff" fill-opacity=".6"/></svg>`;

const KIND_LABEL = { text: 'טקסט', link: 'קישור', secret: 'סיסמה' };
const KIND_ICON = { text: 'text', link: 'link', secret: 'key' };

const fieldsOf = (item) => (Array.isArray(item && item.fields) ? item.fields : []);

function preview(field) {
  if (!field) return '';
  if (field.kind === 'secret') return '••••••••••';
  return String(field.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const ERRORS = {
  WRONG_PASSWORD: 'הסיסמה לא נכונה',
  NOT_FOUND: 'הקובץ לא נמצא. אם הוא שמור בדרייב — צריך לוודא שהדרייב מסונכרן במחשב הזה.',
  NOT_A_VAULT: 'זה לא קובץ סרגל תקין',
  NEWER_VERSION: 'הקובץ נשמר בגרסה חדשה יותר של הסרגל — צריך לעדכן את התוכנה',
  EXISTS: 'בתיקייה הזו כבר יש קובץ סרגל. אפשר לפתוח אותו במקום ליצור חדש.',
  WEAK_PASSWORD: 'הסיסמה צריכה להיות באורך 8 תווים לפחות',
  READ_FAILED: 'לא הצלחתי לקרוא את הקובץ',
  LOCKED: 'הסרגל נעול',
  BAD_INPUT: 'משהו בנתונים לא תקין',
  BAD_URL: 'הכתובת לא תקינה — צריכה להתחיל ב-https://',
  NO_CHROME: 'לא מצאתי את כרום במחשב הזה',
  NOT_INSTALLED: 'התוכנה לא מותקנת במחשב הזה',
  LAUNCH_FAILED: 'לא הצלחתי לפתוח',
};

const LAUNCH_DONE = { opened: 'נפתח', fallback: 'התוכנה לא מותקנת — נפתח באתר', copied: 'הועתק', block: '' };
const errText = (r) => ERRORS[r && r.code] || (r && r.message) || 'משהו השתבש';

/* recently copied — shared between the windows through localStorage */
function recordRecent(key) {
  try {
    const r = JSON.parse(localStorage.getItem('recent') || '{}');
    r[key] = Date.now();
    const top = Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 60);
    localStorage.setItem('recent', JSON.stringify(Object.fromEntries(top)));
  } catch { /* ignore */ }
}
function recentMap() {
  try { return JSON.parse(localStorage.getItem('recent') || '{}'); } catch { return {}; }
}

/** Score an entry against a query. All words must match somewhere. */
function matchScore(parts, q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return 1;
  let score = 0;
  for (const t of toks) {
    let best = 0;
    for (const [text, w] of parts) {
      const s = String(text || '').toLowerCase();
      const i = s.indexOf(t);
      if (i < 0) continue;
      best = Math.max(best, w * (i === 0 ? 2 : 1));
    }
    if (!best) return 0;
    score += best;
  }
  return score;
}

function toast(message, kind = 'ok') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : 'warn')}<span>${esc(message)}</span>`;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), kind === 'ok' ? 1600 : 4200);
}

function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function strongPassword(len = 18) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_=+?';
  const b = new Uint32Array(len);
  crypto.getRandomValues(b);
  return [...b].map((x) => chars[x % chars.length]).join('');
}
