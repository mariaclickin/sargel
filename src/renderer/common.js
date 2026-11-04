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
};

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
};
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
