'use strict';
/* "Journal" tab of the pink panel: 📚 books · 💪 workouts · 🎓 learning · 📅 dates · ✨ quotes
   Uses helpers from common.js and tracker.js (S, T, showModal, closeModal, hm, dk, todayKey…) */

let jmode = 'books';
let bookFilter = 'reading';
let quoteCat = 'הכל';
let quotePick = null; // id chosen for "every open" / after ↻
let readOpen = null; // book id with the inline "read up to page" box open
try { jmode = localStorage.getItem('jmode') || 'books'; } catch { /* ignore */ }

const J = () => (T().journal || { books: [], readlog: [], workouts: [], courses: [], dates: [], quotes: [], settings: {} });
const JS = () => J().settings || {};
const jcall = async (ch, arg) => { const r = await api.call(ch, arg); if (!r.ok) toast(errText(r), 'warn'); return r; };
const fmtD = (k) => { const [, m, d] = k.split('-').map(Number); return `${d}.${m}`; };
const coverStyle = (color) => { const c = COLORS[color]; return c ? `style="background:${c[1]}"` : ''; };

function onJournalOpen() { if (JS().quoteRotate === 'open') quotePick = null; }

function renderJournal() {
  const tabs = [['books', '📚', 'ספרים'], ['workouts', '💪', 'אימונים'], ['learning', '🎓', 'למידה'], ['dates', '📅', 'תאריכים'], ['quotes', '✨', 'משפטים']];
  const body = { books: booksHTML, workouts: workoutsHTML, learning: learningHTML, dates: datesHTML, quotes: quotesHTML }[jmode] || booksHTML;
  $('#tv').innerHTML = `
    <div class="jtabs">${tabs.map(([k, e, l]) => `<button class="${k === jmode ? 'on' : ''}" data-a="jmode" data-m="${k}"><span class="je">${e}</span>${l}</button>`).join('')}</div>
    <div class="jbody">${body()}</div>`;
  if (jmode === 'books' && readOpen) { const el = $('#read-page'); if (el) el.focus(); }
  if (jmode === 'quotes') { const el = $('#q-in'); if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') addQuote(); }); }
  if (jmode === 'books') { const el = $('#read-page'); if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRead(); if (e.key === 'Escape') { readOpen = null; renderView(); } }); }
}

/* streak card used by all sections */
function streakCard(count, label, extra = '') {
  return `<div class="jstreak"><div class="jfl">🔥</div><div class="jst-main"><div class="jst-n">${count}</div><div class="muted small">${label}</div>${extra}</div></div>`;
}

/* color swatches for the editors (the sidebar's bindLook isn't loaded in this window) */
function jLook(m, d) {
  const sw = $('.swatches', m);
  if (!sw) return;
  const draw = () => {
    sw.innerHTML = Object.entries(COLORS).map(([k, [name, hex]]) => `<button class="swatch ${d.color === k ? 'on' : ''}" data-c="${k}" title="${name}" style="--c:${hex}"></button>`).join('');
  };
  draw();
  sw.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { d.color = b.dataset.c; draw(); } };
}

/* ───────── 📚 books ───────── */
function booksHTML() {
  const { books, readlog, settings } = J();
  const days = new Set(readlog);
  const st = Streaks.dailyStreak(days);
  const ws = Streaks.weekStart(new Date());
  const frozen = new Set(st.frozen);
  const today = todayKey();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws); d.setDate(ws.getDate() + i);
    const k = dk(d);
    const cls = days.has(k) ? 'on' : frozen.has(k) ? 'fz' : '';
    return `<div class="jd"><i class="${cls} ${k === today ? 'today' : ''} ${k > today ? 'fut' : ''}">${cls === 'on' ? '🔥' : cls === 'fz' ? '🧊' : ''}</i>${DOW[i]}</div>`;
  }).join('');
  const year = new Date().getFullYear();
  const doneYear = books.filter((b) => b.status === 'done' && b.finishedAt && new Date(b.finishedAt).getFullYear() === year).length;
  const counts = { reading: 0, want: 0, done: 0 };
  books.forEach((b) => { counts[b.status] = (counts[b.status] || 0) + 1; });
  const list = books.filter((b) => b.status === bookFilter).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return `
    ${streakCard(st.count, 'ימי קריאה ברצף', `<div class="jdays">${week}</div>`)}
    ${st.todayDone
      ? `<div class="jok">✓ קראת היום <button class="link-btn" data-a="j-unread">ביטול</button></div>`
      : `<div class="jrisk">⏳ ${st.count ? 'עוד לא קראת היום — אפילו עמוד אחד שומר על הרצף' : 'קוראים היום ומתחילים רצף'} <button class="primary sm" data-a="j-readtoday">+ קראתי היום</button></div>`}
    <div class="st-chips">
      <button class="st-chip ${bookFilter === 'reading' ? 'on' : ''}" data-a="j-bf" data-f="reading">קוראת עכשיו · ${counts.reading}</button>
      <button class="st-chip ${bookFilter === 'want' ? 'on' : ''}" data-a="j-bf" data-f="want">רוצה לקרוא · ${counts.want}</button>
      <button class="st-chip ${bookFilter === 'done' ? 'on' : ''}" data-a="j-bf" data-f="done">סיימתי · ${counts.done}</button>
    </div>
    ${list.length ? list.map(bookCard).join('') : `<div class="muted small center" style="padding:14px">${bookFilter === 'reading' ? 'אין ספר בקריאה — מוסיפים ספר ומתחילים' : 'עוד אין כאן ספרים'}</div>`}
    <button class="ghost jadd" data-a="j-book-new">${icon('plus')} ספר חדש</button>
    <button class="jgoal" data-a="j-goal">יעד ${year}: <b>${doneYear} / ${settings.readGoalYear || 12}</b> ספרים <span class="muted small">(לחיצה לשינוי)</span></button>`;
}

function bookCard(b) {
  const pct = b.pages ? Math.round((b.page / b.pages) * 100) : 0;
  let eta = '';
  if (b.status === 'reading' && b.pages && b.page && b.startedAt) {
    const daysIn = Math.max(1, (Date.now() - b.startedAt) / 864e5);
    const perDay = b.page / daysIn;
    if (perDay > 0) { const d = new Date(Date.now() + ((b.pages - b.page) / perDay) * 864e5); eta = `בקצב הזה: מסיימת ב-${d.getDate()}.${d.getMonth() + 1}`; }
  }
  const stars = b.status === 'done' && b.rating ? ' · ' + '★'.repeat(b.rating) : '';
  return `
    <div class="jcard" data-a="j-book-edit" data-id="${b.id}">
      <div class="jcov" ${coverStyle(b.color)}>📖</div>
      <div class="jc-main">
        <b dir="auto">${esc(b.title)}</b>${b.author ? `<span class="muted small" dir="auto"> · ${esc(b.author)}</span>` : ''}
        ${b.status === 'reading' ? `
          <div class="muted small">${b.pages ? `עמ׳ ${b.page} מתוך ${b.pages} · ${pct}%` : `עמ׳ ${b.page || 0}`}</div>
          ${b.pages ? `<div class="jbar"><i style="width:${pct}%"></i></div>` : ''}
          ${eta ? `<div class="muted small">${eta}</div>` : ''}` : ''}
        ${b.status === 'done' ? `<div class="muted small">סיימתי ${b.finishedAt ? new Date(b.finishedAt).toLocaleDateString('he-IL') : ''}${stars}</div>` : ''}
        ${b.status === 'want' ? '<div class="muted small">ברשימה</div>' : ''}
        ${readOpen === b.id ? `<div class="jread" data-stop="1"><span>עד עמוד</span><input id="read-page" type="number" min="${b.page || 0}" ${b.pages ? `max="${b.pages}"` : ''} value="${b.page || ''}"><button class="primary sm" data-a="j-read-save">שמירה</button></div>` : ''}
      </div>
      <div class="jc-btns">
        ${b.status !== 'done' ? `<button class="btn-pink fill" data-a="j-read" data-id="${b.id}">${b.status === 'want' ? 'התחלה' : '+ קראתי'}</button>` : ''}
        <button class="btn-pink" data-a="j-quote-book" data-id="${b.id}">+ ציטוט</button>
      </div>
    </div>`;
}

async function saveRead() {
  const el = $('#read-page');
  const id = readOpen;
  readOpen = null;
  await jcall('j:readToday', { bookId: id, page: el ? el.value : '' });
  toast('🔥 נרשם — קראת היום');
}

function openBook(b) {
  const d = b ? { ...b } : { id: null, title: '', author: '', pages: '', page: 0, status: 'reading', rating: 0, color: 'pink' };
  showModal(`
    <h3>${b ? 'ספר' : 'ספר חדש'}</h3>
    <label class="lbl">שם הספר<input class="b-t" dir="auto"></label>
    <label class="lbl">סופר/ת (רשות)<input class="b-a" dir="auto"></label>
    <div class="seg b-s"><button data-s="want">רוצה לקרוא</button><button data-s="reading">קוראת עכשיו</button><button data-s="done">סיימתי</button></div>
    <div class="set-row"><span>מספר עמודים</span><input class="b-p inp-sm" type="number" min="0"></div>
    <div class="set-row"><span>הגעתי לעמוד</span><input class="b-g inp-sm" type="number" min="0"></div>
    <div class="set-row b-r-row"><span>דירוג</span><span class="b-r">${[1, 2, 3, 4, 5].map((n) => `<button class="star" data-r="${n}">★</button>`).join('')}</span></div>
    <div class="lbl-t">צבע</div><div class="swatches"></div>
    <div class="err m-err"></div>
    <div class="m-actions">${b ? '<button class="danger m-del">מחיקה</button>' : ''}<span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    $('.b-t', m).value = d.title;
    $('.b-a', m).value = d.author || '';
    $('.b-p', m).value = d.pages || '';
    $('.b-g', m).value = d.page || '';
    const draw = () => {
      $$('.b-s button', m).forEach((x) => x.classList.toggle('on', x.dataset.s === d.status));
      $$('.b-r .star', m).forEach((x) => x.classList.toggle('on', Number(x.dataset.r) <= d.rating));
      $('.b-r-row', m).classList.toggle('hidden', d.status !== 'done');
    };
    draw();
    jLook(m, d);
    $('.b-s', m).onclick = (e) => { const x = e.target.closest('button'); if (x) { d.status = x.dataset.s; draw(); } };
    $('.b-r', m).onclick = (e) => { const x = e.target.closest('.star'); if (x) { d.rating = Number(x.dataset.r) === d.rating ? 0 : Number(x.dataset.r); draw(); } };
    $('.m-cancel', m).onclick = closeModal;
    const del = $('.m-del', m);
    if (del) del.onclick = async () => { if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'בטוח? לחיצה נוספת'; return; } await jcall('j:delete', { list: 'books', id: b.id }); closeModal(); };
    $('.m-save', m).onclick = async () => {
      d.title = $('.b-t', m).value.trim();
      if (!d.title) { $('.m-err', m).textContent = 'צריך שם לספר'; return; }
      d.author = $('.b-a', m).value;
      d.pages = Number($('.b-p', m).value) || 0;
      d.page = Number($('.b-g', m).value) || 0;
      const r = await jcall('j:save', { list: 'books', doc: d });
      if (r.ok) { bookFilter = d.status; closeModal(); }
    };
  });
}

function openQuote(q, preset = {}) {
  const d = q ? { ...q } : { id: null, text: '', source: '', category: 'כללי', fav: false, ...preset };
  const cats = quoteCats();
  showModal(`
    <h3>${q ? 'עריכת משפט' : 'משפט חדש'}</h3>
    <label class="lbl">המשפט<textarea class="q-t" rows="3" dir="auto"></textarea></label>
    <label class="lbl">מקור (רשות)<input class="q-s" dir="auto" placeholder="שם הספר / מי אמר"></label>
    ${d.bookId ? '<div class="set-row"><span>עמוד</span><input class="q-p inp-sm" type="number" min="0"></div>' : ''}
    <label class="lbl">קטגוריה<input class="q-c" list="q-cats" dir="auto"><datalist id="q-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
    <div class="err m-err"></div>
    <div class="m-actions">${q ? '<button class="danger m-del">מחיקה</button>' : ''}<span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    $('.q-t', m).value = d.text;
    $('.q-s', m).value = d.source;
    $('.q-c', m).value = d.category;
    if ($('.q-p', m)) $('.q-p', m).value = d.page || '';
    $('.m-cancel', m).onclick = closeModal;
    const del = $('.m-del', m);
    if (del) del.onclick = async () => { await jcall('j:delete', { list: 'quotes', id: q.id }); if (quotePick === q.id) quotePick = null; closeModal(); };
    $('.m-save', m).onclick = async () => {
      d.text = $('.q-t', m).value.trim();
      if (!d.text) { $('.m-err', m).textContent = 'צריך לכתוב משפט'; return; }
      d.source = $('.q-s', m).value;
      d.category = $('.q-c', m).value;
      if ($('.q-p', m)) {
        d.page = Number($('.q-p', m).value) || 0;
        const book = J().books.find((x) => x.id === d.bookId);
        if (book && (!d.source || d.source.startsWith(book.title))) d.source = `${book.title}${d.page ? ` · עמ׳ ${d.page}` : ''}`;
      }
      const r = await jcall('j:save', { list: 'quotes', doc: d });
      if (r.ok) { closeModal(); toast('המשפט נשמר ✨'); }
    };
  });
}

/* ───────── 💪 workouts ───────── */
function workoutsHTML() {
  const { workouts, settings } = J();
  const target = settings.workoutTarget || 3;
  const byWeek = new Map();
  for (const w of workouts) { const k = Streaks.weekKey(new Date(`${w.date}T12:00`)); byWeek.set(k, (byWeek.get(k) || 0) + 1); }
  const st = Streaks.weeklyStreak((k) => byWeek.get(k) || 0, target);
  const frozen = new Set(st.frozen);
  const types = settings.workoutTypes && settings.workoutTypes.length ? settings.workoutTypes : ['פילאטיס', 'הליכה', 'חדר כושר'];
  const thisWeek = Streaks.weekKey(new Date());
  const weekList = workouts.filter((w) => Streaks.weekKey(new Date(`${w.date}T12:00`)) === thisWeek).sort((a, b) => b.date.localeCompare(a.date));

  // month summary: weeks that start in this month
  const now = new Date();
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthKey = dk(m0).slice(0, 7);
  const monthW = workouts.filter((w) => w.date.startsWith(monthKey));
  const weeks = [];
  for (let w = Streaks.weekStart(m0); w <= now; w.setDate(w.getDate() + 7)) weeks.push(dk(w));
  const typeCount = {};
  monthW.forEach((w) => { typeCount[w.type] = (typeCount[w.type] || 0) + 1; });
  const top = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
  const weeksMet = weeks.filter((k) => (byWeek.get(k) || 0) >= target).length;

  return `
    ${streakCard(st.count, `שבועות ברצף עם ${target} אימונים`, `
      <div class="jwk"><b>השבוע</b><span class="jwk-n">${st.current}/${target}</span><div class="jbar"><i style="width:${Math.min(100, (st.current / target) * 100)}%"></i></div></div>`)}
    ${st.met ? `<div class="jok">✓ השבוע ביעד — הרצף נשמר 🎉</div>` : (st.atRisk ? `<div class="jrisk">⏳ עוד ${target - st.current} ${target - st.current === 1 ? 'אימון' : 'אימונים'} עד שבת כדי לשמור על הרצף</div>` : '')}
    <div class="jtypes">${types.map((t) => `<button class="btn-pink" data-a="j-wo" data-t="${esc(t)}">+ ${esc(t)}</button>`).join('')}<button class="btn-pink" data-a="j-wo-other">+ אחר…</button></div>
    ${weekList.length ? `<div class="sec-t">השבוע</div>${weekList.map((w) => `<div class="jrow"><span>${esc(w.type)}${w.minutes ? ` · ${w.minutes} דק׳` : ''}</span><span class="muted small">${DOW[new Date(`${w.date}T12:00`).getDay()]} ${fmtD(w.date)}</span><button class="icon-btn sm" data-a="j-wo-del" data-id="${w.id}" title="מחיקה">${icon('x')}</button></div>`).join('')}` : ''}
    <div class="sec-t">${MONTHS[now.getMonth()]} · סיכום</div>
    ${weeks.map((k, i) => {
      const n = byWeek.get(k) || 0;
      return `<div class="jwrow"><span class="jw-l">שבוע ${i + 1}</span><span class="jdots">${Array.from({ length: Math.max(n, target) }, (_, j) => `<i class="${j < n ? 'on' : ''}"></i>`).join('')}</span><span class="muted small">${frozen.has(k) ? '🧊 הוקפא' : `${n}/${target}${n >= target ? ' ✓' : ''}`}</span></div>`;
    }).join('')}
    <div class="stats">
      <div class="stat"><b>${monthW.length}</b><span>אימונים החודש</span></div>
      <div class="stat"><b>${weeksMet}/${weeks.length}</b><span>שבועות ביעד</span></div>
      <div class="stat"><b>${top ? esc(top[0]) : '—'}</b><span>${top ? `הכי הרבה (${top[1]})` : 'סוג מוביל'}</span></div>
    </div>
    <button class="link-btn" data-a="j-wo-settings">יעד שבועי וסוגי אימונים</button>`;
}

function openWorkoutOther() {
  const types = (JS().workoutTypes || []);
  showModal(`
    <h3>💪 אימון</h3>
    <label class="lbl">סוג<input class="w-t" list="w-types" dir="auto" placeholder="למשל: שחייה"><datalist id="w-types">${types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
    <div class="set-row"><span>תאריך</span><input class="w-d inp-sm" type="date" style="width:150px !important"></div>
    <div class="set-row"><span>דקות (רשות)</span><input class="w-m inp-sm" type="number" min="0"></div>
    <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    $('.w-d', m).value = todayKey();
    $('.m-cancel', m).onclick = closeModal;
    $('.m-save', m).onclick = async () => {
      const r = await jcall('j:save', { list: 'workouts', doc: { type: $('.w-t', m).value, date: $('.w-d', m).value, minutes: $('.w-m', m).value } });
      if (r.ok) { closeModal(); toast('💪 נרשם'); }
    };
  });
}

function openWorkoutSettings() {
  const s = JS();
  showModal(`
    <h3>הגדרות אימונים</h3>
    <div class="set-row"><span>יעד אימונים בשבוע</span><select class="ws-t">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
    <label class="lbl">כפתורים מהירים (מופרד בפסיקים)<input class="ws-y" dir="auto"></label>
    <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    $('.ws-t', m).value = String(s.workoutTarget || 3);
    $('.ws-y', m).value = (s.workoutTypes || []).join(', ');
    $('.m-cancel', m).onclick = closeModal;
    $('.m-save', m).onclick = async () => {
      const r = await jcall('j:save', { list: 'jset', doc: { workoutTarget: Number($('.ws-t', m).value), workoutTypes: $('.ws-y', m).value.split(',').map((x) => x.trim()).filter(Boolean) } });
      if (r.ok) closeModal();
    };
  });
}

/* ───────── 🎓 learning ───────── */
function learningHTML() {
  const { courses, settings } = J();
  const goal = settings.learnWeeklyMin || 120;
  const blockIds = new Set(courses.map((c) => c.blockId).filter(Boolean));
  const now = Date.now();
  const byWeek = new Map();
  for (const s of T().sessions) {
    if (!blockIds.has(s.blockId)) continue;
    const k = Streaks.weekKey(new Date(s.start));
    byWeek.set(k, (byWeek.get(k) || 0) + ((s.end || now) - s.start) / 60000);
  }
  const st = Streaks.weeklyStreak((k) => byWeek.get(k) || 0, goal);
  const bst = blockStats();
  const a = T().active;
  const list = courses.slice().sort((x, y) => (x.status === 'done') - (y.status === 'done') || (y.updatedAt - x.updatedAt));
  return `
    ${streakCard(st.count, `שבועות ברצף ביעד (${hm(goal)} שעות בשבוע)`, `
      <div class="jwk"><b>השבוע</b><span class="jwk-n">${hm(st.current)}/${hm(goal)}</span><div class="jbar"><i style="width:${Math.min(100, (st.current / goal) * 100)}%"></i></div></div>`)}
    ${list.length ? list.map((c) => {
      const pct = Math.round((c.done / c.total) * 100);
      const total = (bst.get(c.blockId) || {}).total || 0;
      const run = a && a.sessionId && a.blockId === c.blockId;
      let eta = '';
      if (c.status !== 'done' && c.done && c.startedAt) {
        const per = c.done / Math.max(1, (now - c.startedAt) / 864e5);
        const d = new Date(now + ((c.total - c.done) / per) * 864e5);
        eta = ` · בקצב הזה: ${d.getDate()}.${d.getMonth() + 1}`;
      }
      const unit = c.kind === 'language' ? 'שיעור' : c.kind === 'other' ? 'יחידה' : 'שיעור';
      return `
        <div class="jcard ${c.status === 'done' ? 'dim' : ''}" data-a="j-course-edit" data-id="${c.id}">
          <div class="jcov" ${coverStyle(c.color)}>${c.kind === 'language' ? '🗣' : '🎓'}</div>
          <div class="jc-main">
            <b dir="auto">${esc(c.title)}</b>
            <div class="muted small">${unit} ${c.done} מתוך ${c.total} · ${pct}% · ${hm(total)} שעות</div>
            <div class="jbar"><i style="width:${pct}%"></i></div>
            <div class="muted small">${c.status === 'done' ? 'הושלם ✓' : `${c.current ? `עכשיו: ${esc(c.current)}` : ''}${eta}`}</div>
          </div>
          ${c.status === 'done' ? '' : `<div class="jc-btns">
            <button class="tb-play ${run ? 'on' : ''}" data-a="${run ? 'blk-pause' : 'j-course-play'}" data-id="${c.blockId}" title="${run ? 'השהיה' : 'התחלת זמן למידה (TIME BLOCK)'}">${icon(run ? 'pause' : 'play')}</button>
            <button class="btn-pink" data-a="j-course-plus" data-id="${c.id}">+1 ${unit}</button>
          </div>`}
        </div>`;
    }).join('') : '<div class="muted small center" style="padding:14px">עוד אין כאן קורס, שפה או ספר לימוד</div>'}
    <button class="ghost jadd" data-a="j-course-new">${icon('plus')} למידה חדשה</button>
    <p class="muted small">▶ מפעיל TIME BLOCK — הזמן נספר גם בקוביות של "החודש". ${S.blockHotkeyLabel ? `השהיה: ${esc(S.blockHotkeyLabel)}` : ''}</p>
    <button class="link-btn" data-a="j-learn-goal">שינוי היעד השבועי</button>`;
}

function openCourse(c) {
  const d = c ? { ...c } : { id: null, title: '', kind: 'course', total: 10, done: 0, current: '', status: 'active', color: 'purple' };
  showModal(`
    <h3>${c ? 'למידה' : 'למידה חדשה'}</h3>
    <label class="lbl">שם<input class="c-t" dir="auto" placeholder="למשל: קורס פיגמה / אנגלית"></label>
    <div class="seg c-k"><button data-k="course">🎓 קורס</button><button data-k="language">🗣 שפה</button><button data-k="other">📘 אחר</button></div>
    <div class="set-row"><span>כמה שיעורים / יחידות</span><input class="c-n inp-sm" type="number" min="1"></div>
    <div class="set-row"><span>כמה סיימתי</span><input class="c-d inp-sm" type="number" min="0"></div>
    <label class="lbl">השיעור הנוכחי (רשות)<input class="c-c" dir="auto" placeholder="למשל: Auto Layout"></label>
    <label class="check"><input type="checkbox" class="c-s"><span>הושלם</span></label>
    <div class="lbl-t">צבע</div><div class="swatches"></div>
    <div class="err m-err"></div>
    <div class="m-actions">${c ? '<button class="danger m-del">מחיקה</button>' : ''}<span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    $('.c-t', m).value = d.title;
    $('.c-n', m).value = d.total;
    $('.c-d', m).value = d.done;
    $('.c-c', m).value = d.current || '';
    $('.c-s', m).checked = d.status === 'done';
    const drawK = () => $$('.c-k button', m).forEach((x) => x.classList.toggle('on', x.dataset.k === d.kind));
    drawK();
    jLook(m, d);
    $('.c-k', m).onclick = (e) => { const x = e.target.closest('button'); if (x) { d.kind = x.dataset.k; drawK(); } };
    $('.m-cancel', m).onclick = closeModal;
    const del = $('.m-del', m);
    if (del) del.onclick = async () => { if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'בטוח? (הזמן נשאר ב-TIME BLOCKS)'; return; } await jcall('j:delete', { list: 'courses', id: c.id }); closeModal(); };
    $('.m-save', m).onclick = async () => {
      d.title = $('.c-t', m).value.trim();
      if (!d.title) { $('.m-err', m).textContent = 'צריך שם'; return; }
      d.total = Number($('.c-n', m).value) || 1;
      d.done = Number($('.c-d', m).value) || 0;
      d.current = $('.c-c', m).value;
      d.status = $('.c-s', m).checked ? 'done' : 'active';
      const r = await jcall('j:save', { list: 'courses', doc: d });
      if (r.ok) closeModal();
    };
  });
}

/* ───────── 📅 dates ───────── */
function nextOcc(d) {
  const [m, day] = d.md.split('-').map(Number);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  let y = d.yearly || !d.year ? t0.getFullYear() : Number(d.year);
  let when = new Date(y, m - 1, day);
  if ((d.yearly || !d.year) && when < t0) { y += 1; when = new Date(y, m - 1, day); }
  return { when, days: Math.round((when - t0) / 864e5) };
}

function datesHTML() {
  const list = J().dates.map((d) => ({ d, ...nextOcc(d) })).filter((x) => x.days >= 0).sort((a, b) => a.days - b.days);
  const past = J().dates.map((d) => ({ d, ...nextOcc(d) })).filter((x) => x.days < 0);
  return `
    ${list.length ? list.map(({ d, when, days }) => `
      <div class="jcard ${days === 0 ? 'hot' : ''}" data-a="j-date-edit" data-id="${d.id}">
        <div class="jcount ${days <= (d.remind || 0) ? 'soon' : ''}"><b>${days === 0 ? 'היום' : days}</b>${days ? '<small>ימים</small>' : ''}</div>
        <div class="jc-main"><b dir="auto">${esc(d.title)} ${esc(d.emoji || '')}</b>
          <div class="muted small">${when.getDate()}.${when.getMonth() + 1}${d.yearly ? ' · כל שנה' : ''}${d.remind ? ` · תזכורת ${d.remind === 1 ? 'יום' : `${d.remind} ימים`} לפני` : ''}</div></div>
      </div>`).join('') : '<div class="muted small center" style="padding:14px">ימי הולדת, חידושים, תורים — מוסיפים ומקבלים תזכורת</div>'}
    ${past.length ? `<div class="muted small" style="margin:6px 4px">עבר: ${past.map(({ d }) => esc(d.title)).join(' · ')}</div>` : ''}
    <button class="ghost jadd" data-a="j-date-new">${icon('plus')} תאריך חדש</button>`;
}

function openDate(dt) {
  const d = dt ? { ...dt } : { id: null, title: '', emoji: '🎂', md: '', year: '', yearly: true, remind: 2 };
  const [mm, dd] = (d.md || '').split('-');
  const EM = ['🎂', '💍', '🎉', '🚗', '🦷', '🏥', '📄', '✈️', '🏠', '💳', '🎓', '❤️'];
  showModal(`
    <h3>${dt ? 'תאריך' : 'תאריך חדש'}</h3>
    <label class="lbl">מה<input class="d-t" dir="auto" placeholder="למשל: יום הולדת לאמא"></label>
    <div class="emoji-grid d-e">${EM.map((e) => `<button class="emoji" data-e="${e}">${e}</button>`).join('')}</div>
    <div class="set-row"><span>תאריך</span><select class="d-d">${Array.from({ length: 31 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}</option>`).join('')}</select>
      <select class="d-m">${MONTHS.map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}">${n}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" class="d-y"><span>חוזר כל שנה</span></label>
    <div class="set-row d-yr-row"><span>שנה</span><input class="d-yr inp-sm" type="number" min="2024" max="2100"></div>
    <div class="set-row"><span>תזכורת</span><select class="d-r">${[[0, 'רק ביום עצמו'], [1, 'יום לפני'], [2, 'יומיים לפני'], [3, '3 ימים לפני'], [7, 'שבוע לפני'], [14, 'שבועיים לפני']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
    <div class="err m-err"></div>
    <div class="m-actions">${dt ? '<button class="danger m-del">מחיקה</button>' : ''}<span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    const t = new Date();
    $('.d-t', m).value = d.title;
    $('.d-d', m).value = dd || String(t.getDate()).padStart(2, '0');
    $('.d-m', m).value = mm || String(t.getMonth() + 1).padStart(2, '0');
    $('.d-y', m).checked = d.yearly !== false;
    $('.d-yr', m).value = d.year || t.getFullYear();
    $('.d-r', m).value = String(d.remind ?? 2);
    const draw = () => {
      $$('.d-e .emoji', m).forEach((x) => x.classList.toggle('on', x.dataset.e === d.emoji));
      $('.d-yr-row', m).classList.toggle('hidden', $('.d-y', m).checked);
    };
    draw();
    $('.d-e', m).onclick = (e) => { const x = e.target.closest('.emoji'); if (x) { d.emoji = x.dataset.e; draw(); } };
    $('.d-y', m).onchange = draw;
    $('.m-cancel', m).onclick = closeModal;
    const del = $('.m-del', m);
    if (del) del.onclick = async () => { await jcall('j:delete', { list: 'jdates', id: dt.id }); closeModal(); };
    $('.m-save', m).onclick = async () => {
      d.title = $('.d-t', m).value.trim();
      if (!d.title) { $('.m-err', m).textContent = 'צריך לכתוב מה'; return; }
      d.md = `${$('.d-m', m).value}-${$('.d-d', m).value}`;
      d.yearly = $('.d-y', m).checked;
      d.year = d.yearly ? '' : $('.d-yr', m).value;
      d.remind = Number($('.d-r', m).value);
      const r = await jcall('j:save', { list: 'jdates', doc: d });
      if (r.ok) closeModal();
    };
  });
}

/* ───────── ✨ quotes ───────── */
function quoteCats() {
  return [...new Set(['מוטיבציה', 'עבודה', 'אישי', 'רוגע', 'ספרים', ...J().quotes.map((q) => q.category)].filter(Boolean))];
}

function seedPick(qs, seed) {
  const pool = qs.flatMap((q) => (q.fav ? [q, q, q] : [q]));
  if (!pool.length) return null;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

function currentQuote() {
  const qs = J().quotes;
  if (!qs.length) return null;
  const mode = JS().quoteRotate || 'open';
  const keep = quotePick && qs.find((q) => q.id === quotePick);
  if (keep) return keep;
  if (mode === 'open') {
    const pool = qs.flatMap((q) => (q.fav ? [q, q, q] : [q]));
    const q = pool[Math.floor(Math.random() * pool.length)];
    quotePick = q.id;
    return q;
  }
  const now = new Date();
  return seedPick(qs, mode === 'day' ? todayKey() : `${todayKey()}-${now.getHours()}`);
}

function quotesHTML() {
  const q = currentQuote();
  const mode = JS().quoteRotate || 'open';
  const all = J().quotes;
  const cats = ['הכל', '♥ מועדפים', ...quoteCats()];
  const list = all.filter((x) => quoteCat === 'הכל' || (quoteCat === '♥ מועדפים' ? x.fav : x.category === quoteCat))
    .sort((a, b) => (b.fav - a.fav) || ((b.createdAt || 0) - (a.createdAt || 0)));
  return `
    <div class="qh"><b>✨ משפט היום</b><span class="muted small">${{ open: 'מתחלף בכל פתיחה', day: 'מתחלף כל יום', hour: 'מתחלף כל שעה' }[mode]}</span></div>
    ${q ? `
      <div class="qbox"><div class="qtext" dir="auto">„${esc(q.text)}”</div>${q.source ? `<div class="qsrc" dir="auto">— ${esc(q.source)}</div>` : ''}</div>
      <div class="qbtns">
        <button class="ghost sm" data-a="q-fav" data-id="${q.id}">${q.fav ? '♥' : '♡'} מועדף</button>
        <button class="ghost sm" data-a="q-next">↻ משפט אחר</button>
        <button class="ghost sm" data-a="q-copy" data-id="${q.id}">${icon('copy')} העתקה</button>
        <button class="ghost sm" data-a="q-edit" data-id="${q.id}">${icon('edit')} עריכה</button>
      </div>` : '<div class="qbox"><div class="qtext">עוד אין משפטים — מוסיפים למטה</div></div>'}
    <div class="qrot">מתחלף: ${[['day', 'כל יום'], ['open', 'בכל פתיחה'], ['hour', 'כל שעה']].map(([k, l]) => `<button class="${k === mode ? 'on' : ''}" data-a="q-rot" data-r="${k}">${l}</button>`).join('')}</div>
    <div class="note-add qadd"><input id="q-in" placeholder="משפט חדש… (Enter)" dir="auto" autocomplete="off"><button class="icon-btn" data-a="q-add" title="שמירה">${icon('plus')}</button></div>
    <button class="link-btn" data-a="q-paste">הדבקת רשימה (משפט בכל שורה)</button>
    <div class="qcats">${cats.map((c) => `<button class="${c === quoteCat ? 'on' : ''}" data-a="q-cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    ${list.map((x) => `
      <div class="qrow">
        <button class="q-heart ${x.fav ? 'on' : ''}" data-a="q-fav" data-id="${x.id}" title="מועדף">${x.fav ? '♥' : '♡'}</button>
        <div class="qr-t" data-a="q-edit" data-id="${x.id}"><span dir="auto">${esc(x.text)}</span>${x.source ? `<small class="muted" dir="auto">${esc(x.source)}</small>` : ''}</div>
        <span class="muted small">${esc(x.category)}</span>
      </div>`).join('')}`;
}

async function addQuote() {
  const el = $('#q-in');
  const text = el.value.trim();
  if (!text) return;
  const cat = quoteCat !== 'הכל' && quoteCat !== '♥ מועדפים' ? quoteCat : 'כללי';
  const r = await jcall('j:save', { list: 'quotes', doc: { text, category: cat } });
  if (r.ok) { el.value = ''; toast('המשפט נשמר ✨'); }
}

function openPaste() {
  showModal(`
    <h3>הדבקת משפטים</h3>
    <p class="muted small">משפט בכל שורה. אפשר להוסיף מקור אחרי מקף: "המשפט — מי אמר"</p>
    <textarea class="p-t" rows="8" dir="auto"></textarea>
    <label class="lbl" style="margin-top:8px">קטגוריה<input class="p-c" list="p-cats" dir="auto" value="כללי"><datalist id="p-cats">${quoteCats().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
    <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">הוספה</button></div>`, (m) => {
    $('.m-cancel', m).onclick = closeModal;
    $('.m-save', m).onclick = async () => {
      const lines = $('.p-t', m).value.split('\n').map((l) => l.trim()).filter(Boolean);
      const cat = $('.p-c', m).value;
      for (const l of lines) {
        const [text, source] = l.split(/\s+[—–-]\s+/);
        // sequential on purpose — each save is small
        await api.call('j:save', { list: 'quotes', doc: { text: text.replace(/^["„“]|["”]$/g, ''), source: source || '', category: cat } });
      }
      closeModal();
      toast(`נוספו ${lines.length} משפטים ✨`);
    };
  }, 'tall');
}

/* ───────── actions ───────── */
async function journalAction(act, a, e) {
  const id = a.dataset.id;
  switch (act) {
    case 'jmode': jmode = a.dataset.m; try { localStorage.setItem('jmode', jmode); } catch { /* ignore */ } renderView(); return true;
    // books
    case 'j-bf': bookFilter = a.dataset.f; renderView(); return true;
    case 'j-readtoday': await jcall('j:readToday', {}); toast('🔥 נרשם — קראת היום'); return true;
    case 'j-unread': await jcall('j:unreadToday'); return true;
    case 'j-book-new': openBook(null); return true;
    case 'j-book-edit': if (e.target.closest('[data-stop]')) return true; openBook(J().books.find((b) => b.id === id)); return true;
    case 'j-read': {
      e.stopPropagation();
      const b = J().books.find((x) => x.id === id);
      if (b && b.status === 'want') { await jcall('j:save', { list: 'books', doc: { ...b, status: 'reading' } }); bookFilter = 'reading'; return true; }
      readOpen = readOpen === id ? null : id;
      renderView();
      return true;
    }
    case 'j-read-save': e.stopPropagation(); saveRead(); return true;
    case 'j-quote-book': {
      e.stopPropagation();
      const b = J().books.find((x) => x.id === id);
      openQuote(null, { bookId: id, source: b ? b.title : '', category: 'ספרים', page: b ? b.page : 0 });
      return true;
    }
    case 'j-goal': {
      showModal(`<h3>יעד קריאה ל-${new Date().getFullYear()}</h3><div class="set-row"><span>כמה ספרים</span><input class="g-n inp-sm" type="number" min="0"></div>
        <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
        $('.g-n', m).value = JS().readGoalYear || 12;
        $('.m-cancel', m).onclick = closeModal;
        $('.m-save', m).onclick = async () => { await jcall('j:save', { list: 'jset', doc: { readGoalYear: Number($('.g-n', m).value) } }); closeModal(); };
      });
      return true;
    }
    // workouts
    case 'j-wo': { const r = await jcall('j:save', { list: 'workouts', doc: { type: a.dataset.t, date: todayKey() } }); if (r.ok) toast(`💪 ${a.dataset.t} נרשם`); return true; }
    case 'j-wo-other': openWorkoutOther(); return true;
    case 'j-wo-del': await jcall('j:delete', { list: 'workouts', id }); return true;
    case 'j-wo-settings': openWorkoutSettings(); return true;
    // learning
    case 'j-course-new': openCourse(null); return true;
    case 'j-course-edit': openCourse(J().courses.find((c) => c.id === id)); return true;
    case 'j-course-play': e.stopPropagation(); await jcall('trk:start', { blockId: id }); toast('▶ זמן למידה התחיל'); return true;
    case 'j-course-plus': {
      e.stopPropagation();
      const c = J().courses.find((x) => x.id === id);
      if (c) { const done = Math.min(c.total, c.done + 1); await jcall('j:save', { list: 'courses', doc: { ...c, done, status: done >= c.total ? 'done' : 'active' } }); toast(done >= c.total ? '🎓 סיימת את כל השיעורים!' : `✓ ${done}/${c.total}`); }
      return true;
    }
    case 'j-learn-goal': {
      showModal(`<h3>יעד למידה שבועי</h3><div class="set-row"><span>שעות בשבוע</span><select class="l-g">${[30, 60, 90, 120, 180, 240, 300, 420, 600].map((n) => `<option value="${n}">${hm(n)}</option>`).join('')}</select></div>
        <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
        $('.l-g', m).value = String(JS().learnWeeklyMin || 120);
        $('.m-cancel', m).onclick = closeModal;
        $('.m-save', m).onclick = async () => { await jcall('j:save', { list: 'jset', doc: { learnWeeklyMin: Number($('.l-g', m).value) } }); closeModal(); };
      });
      return true;
    }
    // dates
    case 'j-date-new': openDate(null); return true;
    case 'j-date-edit': openDate(J().dates.find((d) => d.id === id)); return true;
    // quotes
    case 'q-next': {
      const qs = J().quotes.filter((x) => x.id !== quotePick);
      if (qs.length) { const pool = qs.flatMap((x) => (x.fav ? [x, x, x] : [x])); quotePick = pool[Math.floor(Math.random() * pool.length)].id; }
      renderView();
      return true;
    }
    case 'q-fav': { const q = J().quotes.find((x) => x.id === id); if (q) { quotePick = quotePick || null; await jcall('j:save', { list: 'quotes', doc: { ...q, fav: !q.fav } }); } return true; }
    case 'q-copy': { const q = J().quotes.find((x) => x.id === id); if (q) { await api.call('clip:copy', { text: q.source ? `${q.text} — ${q.source}` : q.text }); toast('הועתק'); } return true; }
    case 'q-edit': openQuote(J().quotes.find((x) => x.id === id)); return true;
    case 'q-rot': quotePick = null; await jcall('j:save', { list: 'jset', doc: { quoteRotate: a.dataset.r } }); return true;
    case 'q-add': addQuote(); return true;
    case 'q-paste': openPaste(); return true;
    case 'q-cat': quoteCat = a.dataset.c; renderView(); return true;
    default: return false;
  }
}
