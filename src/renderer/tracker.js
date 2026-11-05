'use strict';
/* The green "tracker" panel — personal, every day of the week, separate from work:
   The month (GitHub-style squares by TIME BLOCKS time) · Checklist · TIME BLOCKS · Jobs & leads */

let S = null;
let view = null; // 'setup' | 'lock' | 'main'
let mode = 'month';
let monthOffset = 0;
let selDay = null;
let boardStatus = 1;
let boardKind = 'all';
let modal = null;
try { mode = localStorage.getItem('tmode') || 'month'; } catch { /* ignore */ }

const body = document.body;
const panel = $('#panel');
const STATUSES = ['חדש', 'בטיפול', 'ממתין ללקוח', 'הושלם'];
// month squares: the more time that day, the deeper the pink
const SHADES = ['', '#F9D8E4', '#F2AEC6', '#E57CA1', '#C94B7B', '#93264F'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => dk(new Date());
const T = () => (S && S.data.tracker) || { sessions: [], checks: [], jobs: [], active: null };

api.on('state', (s) => { S = s; render(); });
api.on('ui:expanded', (v) => {
  body.classList.toggle('expanded', v);
  if (v && view === 'lock') setTimeout(() => $('#pw') && $('#pw').focus(), 30);
  if (v && view === 'main') renderView();
});
api.on('toast', (t) => toast(t.message, t.kind));
$('#handle').addEventListener('click', () => api.call('ui:expand', { focus: true }));
(async () => { const r = await api.call('state:get'); S = r.state; body.classList.toggle('expanded', !!S.ui.trackerExpanded); render(); })();

/* don't auto-close while typing / a dialog is open */
let holdSent = null;
function updateHold() {
  setTimeout(() => {
    const ae = document.activeElement;
    const h = !!modal || (document.hasFocus() && ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
    if (h !== holdSent) { holdSent = h; api.call('ui:hold', { hold: h }); }
  }, 0);
}
document.addEventListener('focusin', updateHold);
document.addEventListener('focusout', updateHold);
window.addEventListener('blur', updateHold);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modal) { closeModal(); return; }
  if (!(S && S.ui.trackerPinned)) api.call('ui:collapse');
});

/* ───────── time math ───────── */
/** minutes per day key, splitting sessions across midnight; running sessions count up to now */
function minutesByDay() {
  const out = new Map();
  const now = Date.now();
  for (const s of T().sessions) {
    let a = s.start;
    const b = s.end || now;
    while (a < b) {
      const d = new Date(a);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const end = Math.min(b, next);
      const k = dk(d);
      out.set(k, (out.get(k) || 0) + (end - a) / 60000);
      a = end;
    }
  }
  return out;
}

/** {name → minutes} for one day (or a range of day keys) */
function blocksIn(keys) {
  const set = new Set(keys);
  const out = new Map();
  const now = Date.now();
  for (const s of T().sessions) {
    let a = s.start;
    const b = s.end || now;
    while (a < b) {
      const d = new Date(a);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const end = Math.min(b, next);
      if (set.has(dk(d))) out.set(s.name, (out.get(s.name) || 0) + (end - a) / 60000);
      a = end;
    }
  }
  return [...out.entries()].sort((x, y) => y[1] - x[1]);
}

const level = (m) => (m <= 0 ? 0 : m < 60 ? 1 : m < 120 ? 2 : m < 240 ? 3 : m < 360 ? 4 : 5);
const hm = (m) => fmtMin(Math.round(m));
const hms = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/* ───────── root ───────── */
function render() {
  if (!S) return;
  body.classList.toggle('side-left', S.config.side === 'left');
  body.classList.toggle('locked', !S.vaults.personal.unlocked);
  const v = !S.vaults.personal.configured ? 'setup' : (!S.vaults.personal.unlocked ? 'lock' : 'main');
  if (v !== view) {
    view = v;
    closeModal();
    if (v === 'setup') {
      panel.innerHTML = `<div class="lockview"><div class="hero">${LOGO}</div><h2>המעקב</h2><p class="muted">קודם מגדירים את הסרגל — הידית הסגולה.</p><button class="primary" data-a="open-sidebar">פתיחת הסרגל</button></div>`;
    } else if (v === 'lock') {
      mountLock();
    } else {
      mountMain();
    }
  }
  if (view === 'main') renderMain();
}

panel.addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]');
  if (!a) return;
  onAction(a.dataset.a, a, e);
});

function mountLock() {
  panel.innerHTML = `
    <div class="lockview">
      <div class="hero trk-hero">${icon('flag')}</div>
      <h2>המעקב נעול</h2>
      <p class="muted small">אותה סיסמה ראשית של הסרגל</p>
      <form class="unlock"><div class="pw-wrap big"><input type="password" id="pw" placeholder="סיסמה ראשית"><button type="submit" class="primary">${icon('unlock')} פתיחה</button></div></form>
      <div class="err"></div>
    </div>`;
  $('.unlock', panel).addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api.call('vault:unlock', { password: $('#pw').value });
    if (!r.ok) { $('.lockview .err').textContent = errText(r); $('#pw').select(); }
  });
}

function mountMain() {
  panel.innerHTML = `
    <header class="top">
      <div class="brand"><span class="trk-logo">${icon('flag')}</span><span>המעקב</span></div>
      <button class="icon-btn" data-a="pin" title="נעיצה — יישאר פתוח">${icon('pin')}</button>
    </header>
    <div class="seg modes trk-modes">
      <button data-a="mode" data-m="month">${icon('calendar')} החודש</button>
      <button data-a="mode" data-m="checks">${icon('checklist')} צ'קליסט</button>
      <button data-a="mode" data-m="blocks">${icon('clock')} TIME BLOCKS</button>
      <button data-a="mode" data-m="jobs">${icon('briefcase')} עבודות</button>
    </div>
    <main id="tv" class="list"></main>`;
}

function renderMain() {
  $('[data-a="pin"]', panel).classList.toggle('on', !!S.ui.trackerPinned);
  $$('.trk-modes button', panel).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
  renderView();
}

function renderView() {
  if (view !== 'main' || !$('#tv')) return;
  if (modal) return; // don't redraw under an open dialog
  if (mode === 'month') renderMonth();
  else if (mode === 'checks') renderChecks();
  else if (mode === 'blocks') renderBlocks();
  else renderJobs();
}

// live clock for a running block
setInterval(() => {
  if (view !== 'main' || !S || !S.ui.trackerExpanded) return;
  const a = T().active;
  if (a && a.sessionId) {
    const el = $('#run-clock');
    if (el) el.textContent = hms(runningTodayMs(a));
    if (mode === 'month' && new Date().getSeconds() === 0) renderView();
  }
}, 1000);

function runningTodayMs(a) {
  const today = todayKey();
  let ms = 0;
  const now = Date.now();
  for (const s of T().sessions) {
    if (s.name !== a.name) continue;
    const st = Math.max(s.start, new Date(new Date().setHours(0, 0, 0, 0)).getTime());
    const en = s.end || now;
    if (en > st && dk(new Date(en - 1)) === today) ms += en - st;
  }
  return ms;
}

/* ───────── The month ───────── */
function renderMonth() {
  const base = new Date();
  const m0 = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const daysIn = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
  const byDay = minutesByDay();
  const today = todayKey();
  if (!selDay || !selDay.startsWith(dk(m0).slice(0, 7))) selDay = monthOffset === 0 ? today : dk(m0);

  let cells = DOW.map((d) => `<b>${d}</b>`).join('');
  for (let i = 0; i < m0.getDay(); i++) cells += '<span></span>';
  let total = 0;
  let elapsed = 0;
  for (let d = 1; d <= daysIn; d++) {
    const k = dk(new Date(m0.getFullYear(), m0.getMonth(), d));
    const min = byDay.get(k) || 0;
    const fut = k > today;
    if (!fut) { total += min; elapsed++; }
    const lv = level(min);
    cells += `<button class="hm ${fut ? 'fut' : ''} ${k === selDay ? 'sel' : ''} lv${lv}" data-a="day" data-k="${k}" ${!fut && lv ? `style="background:${SHADES[lv]}"` : ''} title="${d}.${m0.getMonth() + 1} · ${min ? `${hm(min)} שעות` : '—'}">${d}</button>`;
  }
  // streak: consecutive days with time, ending today (or yesterday if today is still empty)
  let streak = 0;
  const c = new Date();
  if (!(byDay.get(today) > 0)) c.setDate(c.getDate() - 1);
  while ((byDay.get(dk(c)) || 0) > 0) { streak++; c.setDate(c.getDate() - 1); }

  const sel = byDay.get(selDay) || 0;
  const blocks = blocksIn([selDay]);
  const dayChecks = T().checks.filter((x) => x.date === selDay);
  const [sy, sm, sd] = selDay.split('-').map(Number);
  const selDate = new Date(sy, sm - 1, sd);

  $('#tv').innerHTML = `
    <div class="mh">
      <button class="icon-btn sm" data-a="month-prev" title="חודש קודם">${icon('chevron')}</button>
      <b>${MONTHS[m0.getMonth()]} ${m0.getFullYear()}</b>
      <button class="icon-btn sm" data-a="month-next" title="חודש הבא" ${monthOffset >= 0 ? 'disabled' : ''}>${icon('chevron')}</button>
    </div>
    <div class="hm-grid">${cells}</div>
    <div class="hm-legend">פחות ${SHADES.map((g, i) => `<i class="lv${i}" ${i ? `style="background:${g}"` : ''}></i>`).join('')} יותר <span class="muted">(0 · שעה · 2 · 4 · 6+)</span></div>
    <div class="day-detail">
      <div class="dd-h"><b>${DOW[selDate.getDay()]} ${sd}.${sm}</b><span>${sel ? `${hm(sel)} שעות` : 'לא הושקע זמן'}</span></div>
      ${blocks.length ? blocks.map(([n, mm]) => `<div class="kv"><span>${esc(n)}</span><b>${hm(mm)}</b></div>`).join('') : ''}
      ${dayChecks.length ? `<div class="muted small dd-c">${icon('checklist')} צ'קליסט: ${dayChecks.filter((x) => x.done).length} מתוך ${dayChecks.length} הושלמו</div>` : ''}
    </div>
    <div class="stats">
      <div class="stat"><b>${hm(total)}</b><span>שעות החודש</span></div>
      <div class="stat"><b>${elapsed ? hm(total / elapsed) : '0:00'}</b><span>ממוצע ליום</span></div>
      <div class="stat"><b>🔥 ${streak}</b><span>ימים רצופים</span></div>
    </div>`;
}

/* ───────── Checklist ───────── */
function renderChecks() {
  const today = todayKey();
  const list = T().checks.filter((x) => x.date === today).sort((a, b) => (a.done - b.done) || ((a.order || 0) - (b.order || 0)));
  const done = list.filter((x) => x.done).length;
  const d = new Date();
  $('#tv').innerHTML = `
    <div class="ck-h"><b>היום · ${DOW[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}</b><span class="muted">${done} / ${list.length}</span></div>
    <div class="wd-bar"><div class="wd-fill trk-fill" style="width:${list.length ? Math.round((done / list.length) * 100) : 0}%"></div></div>
    <div class="note-add ck-add"><input id="ck-in" placeholder="משימה להיום… (Enter)" autocomplete="off" dir="auto"><button class="icon-btn" data-a="ck-add" title="הוספה">${icon('plus')}</button></div>
    ${list.length ? list.map((c) => `
      <div class="ck ${c.done ? 'done' : ''}" data-a="ck-toggle" data-id="${c.id}">
        ${icon(c.done ? 'checkbox' : 'square')}
        <span class="ck-t" dir="auto">${esc(c.text)}</span>
        ${c.carried && !c.done ? '<span class="pill ck-old">מאתמול</span>' : ''}
        <button class="icon-btn sm ck-x" data-a="ck-del" data-id="${c.id}" title="מחיקה">${icon('x')}</button>
      </div>`).join('') : '<div class="empty"><div class="big">✅</div>מה עושים היום?<br>כותבים למעלה ו-Enter.</div>'}
    <p class="muted small center">מה שלא הושלם עובר לבד למחר</p>`;
  const inp = $('#ck-in');
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCheck(); });
}

async function addCheck() {
  const inp = $('#ck-in');
  const t = inp.value.trim();
  if (!t) return;
  const r = await api.call('trk:checkAdd', { text: t });
  if (r.ok) { inp.value = ''; setTimeout(() => $('#ck-in') && $('#ck-in').focus(), 30); } else toast(errText(r), 'warn');
}

/* ───────── TIME BLOCKS ───────── */
function weekKeys() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return dk(x); });
}

function renderBlocks() {
  const a = T().active;
  const today = todayKey();
  const todays = blocksIn([today]);
  const week = blocksIn(weekKeys()).slice(0, 8);
  const maxW = Math.max(1, ...week.map(([, m]) => m));
  const names = [...new Set(T().sessions.slice().sort((x, y) => y.start - x.start).map((s) => s.name))].slice(0, 30);
  const segs = (name) => T().sessions.filter((s) => s.name === name && dk(new Date(s.start)) === today).length;

  $('#tv').innerHTML = `
    ${a && a.name ? `
      <div class="blk-active ${a.sessionId ? 'run' : 'paused'}">
        <div class="muted small">${a.sessionId ? 'בלוק פעיל' : 'מושהה'}</div>
        <div class="blk-row"><b dir="auto">${esc(a.name)}</b><span id="run-clock" class="blk-clock">${hms(runningTodayMs(a))}</span></div>
        <div class="btns">
          ${a.sessionId
            ? `<button class="ghost sm" data-a="blk-pause">${icon('clock')} השהיה</button>`
            : `<button class="primary sm" data-a="blk-resume">${icon('play')} המשך</button>`}
          <button class="ghost sm" data-a="blk-stop">${icon('check')} סיום</button>
        </div>
      </div>` : ''}
    <div class="note-add blk-new">
      <input id="blk-in" list="blk-names" placeholder="שם לבלוק… למשל: כתיבת מאמר" autocomplete="off" dir="auto">
      <datalist id="blk-names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <button class="primary sm" data-a="blk-start">${icon('play')} התחלה</button>
    </div>
    <div class="sec-t">היום</div>
    ${todays.length ? todays.map(([n, m]) => `
      <div class="blk ${a && a.name === n && a.sessionId ? 'on' : ''}">
        <span class="blk-n" dir="auto">${esc(n)}</span>
        <span class="muted small">${segs(n) > 1 ? `${segs(n)} קטעים` : ''}</span>
        <b>${hm(m)}</b>
        <button class="icon-btn sm" data-a="blk-go" data-n="${esc(n)}" title="המשך הבלוק">${icon('play')}</button>
        <button class="icon-btn sm blk-x" data-a="blk-del" data-n="${esc(n)}" title="מחיקת הזמן של היום">${icon('x')}</button>
      </div>`).join('') : '<div class="muted small center" style="padding:14px">עוד אין בלוקים היום</div>'}
    <div class="sec-t">השבוע לפי בלוק</div>
    ${week.length ? week.map(([n, m]) => `
      <div class="wbar"><span dir="auto">${esc(n)}</span><div><i style="width:${Math.round((m / maxW) * 100)}%"></i></div><b>${hm(m)}</b></div>`).join('') : '<div class="muted small center">—</div>'}`;
  const inp = $('#blk-in');
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBlock(inp.value); });
}

async function startBlock(name) {
  const n = String(name || '').trim();
  if (!n) { toast('צריך לתת שם לבלוק', 'warn'); $('#blk-in') && $('#blk-in').focus(); return; }
  const r = await api.call('trk:start', { name: n });
  if (!r.ok) toast(errText(r), 'warn');
}

/* ───────── Jobs & leads ───────── */
function renderJobs() {
  const jobs = T().jobs;
  const counts = STATUSES.map((_, i) => jobs.filter((j) => j.status === i && (boardKind === 'all' || j.kind === boardKind)).length);
  const list = jobs.filter((j) => j.status === boardStatus && (boardKind === 'all' || j.kind === boardKind))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.updatedAt - a.updatedAt));
  const today = todayKey();
  $('#tv').innerHTML = `
    <div class="st-chips">${STATUSES.map((s, i) => `<button class="st-chip ${i === boardStatus ? 'on' : ''}" data-a="st" data-s="${i}">${s} · ${counts[i]}</button>`).join('')}</div>
    <div class="seg sm jb-kind">
      <button data-a="kind" data-k="all" class="${boardKind === 'all' ? 'on' : ''}">הכל</button>
      <button data-a="kind" data-k="job" class="${boardKind === 'job' ? 'on' : ''}">עבודות</button>
      <button data-a="kind" data-k="lead" class="${boardKind === 'lead' ? 'on' : ''}">לידים</button>
    </div>
    ${list.length ? list.map((j) => `
      <div class="job" draggable="true" data-a="job-open" data-id="${j.id}">
        <div class="job-row"><b dir="auto">${esc(j.title)}</b><span class="pill ${j.kind === 'lead' ? 'lead' : ''}">${j.kind === 'lead' ? 'ליד' : 'עבודה'}</span></div>
        ${j.due ? `<div class="muted small ${j.due < today && j.status < 3 ? 'late' : ''}">${icon('calendar')} עד ${j.due.split('-').reverse().slice(0, 2).join('.')}${j.due < today && j.status < 3 ? ' · באיחור' : ''}</div>` : ''}
        ${j.note ? `<div class="muted small job-note" dir="auto">${esc(j.note)}</div>` : ''}
      </div>`).join('') : `<div class="empty"><div class="big">🗂️</div>אין כאן כלום ב„${STATUSES[boardStatus]}”</div>`}
    <button class="ghost jb-add" data-a="job-new">${icon('plus')} עבודה / ליד חדש</button>
    <p class="muted small center">גוררים כרטיס אל סטטוס אחר למעלה</p>`;
}

let dragJob = null;
panel.addEventListener('dragstart', (e) => { const j = e.target.closest && e.target.closest('.job'); if (j) { dragJob = j.dataset.id; e.dataTransfer.setData('text/plain', dragJob); } });
panel.addEventListener('dragover', (e) => { if (dragJob && e.target.closest('.st-chip')) { e.preventDefault(); $$('.st-chip', panel).forEach((c) => c.classList.toggle('drop', c === e.target.closest('.st-chip'))); } });
panel.addEventListener('dragend', () => { dragJob = null; $$('.st-chip', panel).forEach((c) => c.classList.remove('drop')); });
panel.addEventListener('drop', async (e) => {
  const chip = e.target.closest('.st-chip');
  if (!dragJob || !chip) return;
  e.preventDefault();
  const j = T().jobs.find((x) => x.id === dragJob);
  dragJob = null;
  if (j) { await api.call('trk:jobSave', { job: { ...j, status: Number(chip.dataset.s) } }); toast(`הועבר אל ${STATUSES[Number(chip.dataset.s)]}`); }
});

function openJob(job) {
  const d = job ? { ...job } : { id: null, title: '', kind: 'job', status: boardStatus, due: '', note: '' };
  showModal(`
    <h3>${job ? 'עריכה' : 'עבודה / ליד חדש'}</h3>
    <label class="lbl">כותרת<input class="j-t" dir="auto" placeholder="למשל: עמוד נחיתה – ARDIV"></label>
    <div class="seg j-k"><button data-k="job">${icon('briefcase')} עבודה</button><button data-k="lead">${icon('user')} ליד</button></div>
    <label class="lbl">סטטוס<select class="j-s">${STATUSES.map((s, i) => `<option value="${i}">${s}</option>`).join('')}</select></label>
    <label class="lbl">עד תאריך (רשות)<input class="j-d" type="date"></label>
    <label class="lbl">הערות<textarea class="j-n" rows="3" dir="auto"></textarea></label>
    <div class="err m-err"></div>
    <div class="m-actions">${job ? '<button class="danger m-del">מחיקה</button>' : ''}<span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-save">שמירה</button></div>`, (m) => {
    $('.j-t', m).value = d.title;
    $('.j-s', m).value = String(d.status);
    $('.j-d', m).value = d.due || '';
    $('.j-n', m).value = d.note || '';
    const drawK = () => $$('.j-k button', m).forEach((b) => b.classList.toggle('on', b.dataset.k === d.kind));
    drawK();
    $('.j-k', m).onclick = (e) => { const b = e.target.closest('button'); if (b) { d.kind = b.dataset.k; drawK(); } };
    $('.m-cancel', m).onclick = closeModal;
    $('.m-save', m).onclick = async () => {
      d.title = $('.j-t', m).value.trim();
      if (!d.title) { $('.m-err', m).textContent = 'צריך כותרת'; return; }
      d.status = Number($('.j-s', m).value);
      d.due = $('.j-d', m).value;
      d.note = $('.j-n', m).value;
      const r = await api.call('trk:jobSave', { job: d });
      if (!r.ok) { $('.m-err', m).textContent = errText(r); return; }
      boardStatus = d.status;
      closeModal();
    };
    const del = $('.m-del', m);
    if (del) del.onclick = async () => {
      if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'בטוח? לחיצה נוספת'; return; }
      await api.call('trk:jobDelete', { id: job.id });
      closeModal();
    };
  });
}

/* ───────── actions ───────── */
async function onAction(act, a, e) {
  switch (act) {
    case 'open-sidebar': api.call('ui:openSidebar'); break;
    case 'pin': api.call('ui:pin', { pinned: !S.ui.trackerPinned }); break;
    case 'mode':
      mode = a.dataset.m;
      try { localStorage.setItem('tmode', mode); } catch { /* ignore */ }
      renderMain();
      break;
    case 'month-prev': monthOffset--; selDay = null; renderView(); break;
    case 'month-next': if (monthOffset < 0) { monthOffset++; selDay = null; renderView(); } break;
    case 'day': if (!a.classList.contains('fut')) { selDay = a.dataset.k; renderView(); } break;
    case 'ck-add': addCheck(); break;
    case 'ck-toggle': await api.call('trk:checkToggle', { id: a.dataset.id }); break;
    case 'ck-del': e.stopPropagation(); await api.call('trk:checkDelete', { id: a.dataset.id }); break;
    case 'blk-start': startBlock($('#blk-in').value); break;
    case 'blk-go': startBlock(a.dataset.n); break;
    case 'blk-pause': await api.call('trk:pause'); break;
    case 'blk-resume': await api.call('trk:resume'); break;
    case 'blk-stop': await api.call('trk:stop'); toast('הבלוק הסתיים'); break;
    case 'blk-del': {
      const n = a.dataset.n;
      if (!a.dataset.sure) { a.dataset.sure = '1'; a.classList.add('sure'); a.title = 'לחיצה נוספת מוחקת את הזמן של היום'; setTimeout(() => { delete a.dataset.sure; a.classList.remove('sure'); }, 3000); return; }
      await api.call('trk:deleteBlock', { name: n, date: todayKey() });
      break;
    }
    case 'st': boardStatus = Number(a.dataset.s); renderView(); break;
    case 'kind': boardKind = a.dataset.k; renderView(); break;
    case 'job-new': openJob(null); break;
    case 'job-open': openJob(T().jobs.find((j) => j.id === a.dataset.id)); break;
    default: break;
  }
}

/* ───────── modal ───────── */
function showModal(html, bind) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  panel.appendChild(back);
  modal = back;
  updateHold();
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
  bind(back.firstElementChild);
  const f = $('input, textarea', back);
  if (f) setTimeout(() => f.focus(), 40);
}

function closeModal() {
  if (!modal) return;
  modal.remove();
  modal = null;
  updateHold();
  renderView();
}
