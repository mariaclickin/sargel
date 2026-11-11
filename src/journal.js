'use strict';
/**
 * "Journal" tab (pink panel): books + reading log, workouts, learning, important dates, quotes.
 * Pure data helpers — the vault lives in main.js.
 */
const crypto = require('crypto');

const uid = () => crypto.randomUUID();
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const int = (v, a, b) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : a; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLORS = new Set(['purple', 'blue', 'green', 'amber', 'coral', 'red', 'pink', 'gray', '']);

const CLEAN = {
  books(d) {
    const pages = int(d.pages, 0, 10000);
    return {
      title: str(d.title, 120).trim() || 'ספר',
      author: str(d.author, 80).trim(),
      status: ['want', 'reading', 'done'].includes(d.status) ? d.status : 'reading',
      pages,
      page: int(d.page, 0, pages || 10000),
      rating: int(d.rating, 0, 5),
      color: COLORS.has(d.color) ? d.color : 'pink',
      startedAt: Number(d.startedAt) || 0,
      finishedAt: Number(d.finishedAt) || 0,
    };
  },
  workouts(d) {
    return { date: DATE_RE.test(d.date || '') ? d.date : '', type: str(d.type, 40).trim() || 'אימון', minutes: int(d.minutes, 0, 600) };
  },
  courses(d) {
    const total = int(d.total, 1, 2000);
    return {
      title: str(d.title, 120).trim() || 'למידה',
      kind: ['course', 'language', 'other'].includes(d.kind) ? d.kind : 'course',
      total,
      done: int(d.done, 0, total),
      current: str(d.current, 120).trim(),
      blockId: str(d.blockId, 64),
      status: d.status === 'done' ? 'done' : 'active',
      color: COLORS.has(d.color) ? d.color : 'purple',
      startedAt: Number(d.startedAt) || 0,
    };
  },
  jdates(d) {
    return {
      title: str(d.title, 80).trim() || 'תאריך',
      emoji: str(d.emoji, 8),
      md: /^\d{2}-\d{2}$/.test(d.md || '') ? d.md : '01-01',
      year: /^\d{4}$/.test(String(d.year || '')) ? String(d.year) : '',
      yearly: d.yearly !== false,
      remind: int(d.remind, 0, 60),
    };
  },
  quotes(d) {
    return {
      text: str(d.text, 600).trim(),
      source: str(d.source, 140).trim(),
      category: str(d.category, 30).trim() || 'כללי',
      fav: !!d.fav,
      bookId: str(d.bookId, 64),
      page: d.page ? int(d.page, 0, 10000) : 0,
      starter: !!d.starter,
    };
  },
  jset(d) {
    return {
      workoutTarget: int(d.workoutTarget, 1, 14),
      learnWeeklyMin: int(d.learnWeeklyMin, 15, 3000),
      readGoalYear: int(d.readGoalYear, 0, 500),
      quoteRotate: ['open', 'day', 'hour'].includes(d.quoteRotate) ? d.quoteRotate : 'open',
      workoutTypes: Array.isArray(d.workoutTypes) ? d.workoutTypes.map((x) => str(x, 30).trim()).filter(Boolean).slice(0, 12) : ['פילאטיס', 'הליכה', 'חדר כושר'],
    };
  },
};

const JSET_DEFAULT = { workoutTarget: 3, learnWeeklyMin: 120, readGoalYear: 12, quoteRotate: 'open', workoutTypes: ['פילאטיס', 'הליכה', 'חדר כושר'] };

const STARTER_QUOTES = [
  ['צעד קטן כל יום עדיף על קפיצה גדולה פעם בשנה.', '', 'מוטיבציה'],
  ['לא צריך להיות מוכנה כדי להתחיל — צריך להתחיל כדי להיות מוכנה.', '', 'מוטיבציה'],
  ['מה שמודדים — משתפר.', '', 'עבודה'],
  ['התקדמות, לא שלמות.', '', 'מוטיבציה'],
  ['כל ההתחלות קשות.', 'פתגם', 'מוטיבציה'],
  ['אם אין אני לי, מי לי?', 'הלל הזקן', 'אישי'],
  ['המשימה הכי קשה של היום — קודם.', '', 'עבודה'],
  ['פוקוס זה לדעת למה להגיד לא.', '', 'עבודה'],
  ['עדיף גמור מאשר מושלם.', '', 'עבודה'],
  ['הפסקה היא חלק מהעבודה, לא בריחה ממנה.', '', 'רוגע'],
  ['כשאת עייפה — תנוחי, לא תוותרי.', '', 'רוגע'],
  ['דברים גדולים נבנים מימים רגילים.', '', 'מוטיבציה'],
  ['מה שתעשי היום יחסוך לך מחר.', '', 'עבודה'],
  ['אל תשווי את הפרק הראשון שלך לפרק העשרים של מישהו אחר.', '', 'אישי'],
  ['שתי דקות? תעשי עכשיו.', '', 'עבודה'],
  ['סדר על השולחן, סדר בראש.', '', 'עבודה'],
  ['לנשום. זה רק יום עבודה.', '', 'רוגע'],
  ['ההרגל עושה את רוב העבודה.', '', 'מוטיבציה'],
  ['לקוח מרוצה מתחיל בפרט קטן שמישהו לא שכח.', '', 'עבודה'],
  ['שאלה טובה שווה חצי תשובה.', '', 'עבודה'],
  ['מי שמתמידה — מגיעה.', '', 'מוטיבציה'],
  ['לא כל יום מושלם, אבל בכל יום יש משהו טוב.', '', 'אישי'],
  ['תני לעצמך קרדיט על מה שכבר עשית.', '', 'אישי'],
  ['אין קיצורי דרך למקום ששווה להגיע אליו.', '', 'מוטיבציה'],
  ['קצב איטי עדיין מקדם.', '', 'מוטיבציה'],
  ['השקט הוא כלי עבודה.', '', 'רוגע'],
  ['לסיים משימה אחת עדיף מלהתחיל חמש.', '', 'עבודה'],
  ['היום הוא הזדמנות להיות טובה יותר מאתמול.', '', 'אישי'],
  ['מה שלא מתוזמן — לא קורה.', '', 'עבודה'],
  ['גם מנוחה היא התקדמות.', '', 'רוגע'],
];

function starterQuotes() {
  const now = Date.now();
  return STARTER_QUOTES.map(([text, source, category], i) => ({ id: uid(), text, source, category, fav: false, bookId: '', page: 0, starter: true, createdAt: now - i, updatedAt: now }));
}

/** next occurrence of an important date, and days until it (0 = today) */
function nextOccurrence(d, today = new Date()) {
  const [m, day] = d.md.split('-').map(Number);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let y = d.yearly || !d.year ? today.getFullYear() : Number(d.year);
  let when = new Date(y, m - 1, day);
  if (d.yearly || !d.year) { if (when < t0) { y += 1; when = new Date(y, m - 1, day); } }
  return { when, days: Math.round((when - t0) / 864e5) };
}

module.exports = { CLEAN, JSET_DEFAULT, starterQuotes, nextOccurrence, uid };
