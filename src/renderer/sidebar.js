'use strict';
/* The edge sidebar: handle (collapsed) ⇄ panel (expanded) */

let S = null; // state from the main process
let view = null; // 'onboarding' | 'lock' | 'main'
let activeTab = null;
let query = '';
let modal = null;
const openItems = new Set();
const revealed = new Set();

try { activeTab = localStorage.getItem('activeTab'); } catch { /* ignore */ }

const body = document.body;
const panel = $('#panel');
const handleEl = $('#handle');

/* ───────────── wiring ───────────── */
api.on('state', (s) => { S = s; render(); });
api.on('ui:expanded', (v) => {
  body.classList.toggle('expanded', v);
  if (v) {
    if (view === 'lock') setTimeout(() => $('#pw') && $('#pw').focus(), 30);
  } else {
    revealed.clear();
    if (view === 'main' && !modal) renderList();
  }
});
api.on('toast', (t) => toast(t.message, t.kind));

handleEl.addEventListener('click', () => api.call('ui:expand', { focus: true }));

(async () => {
  const r = await api.call('state:get');
  S = r.state;
  body.classList.toggle('expanded', !!S.ui.expanded);
  render();
})();

/* hold = "don't auto-collapse": while a dialog is open, or while typing in the focused panel */
let holdSent = null;
function updateHold() {
  setTimeout(() => {
    const ae = document.activeElement;
    const typing = document.hasFocus() && ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    const h = !!modal || !!typing;
    if (h !== holdSent) { holdSent = h; api.call('ui:hold', { hold: h }); }
  }, 0);
}
document.addEventListener('focusin', updateHold);
document.addEventListener('focusout', updateHold);
window.addEventListener('focus', updateHold);
window.addEventListener('blur', updateHold);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modal) { closeModal(); return; }
    if (view === 'main' && query) { setQuery(''); return; }
    if (!S.ui.pinned) api.call('ui:collapse');
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && view === 'main') {
    e.preventDefault();
    $('#q').focus();
  }
});

/* ───────────── render root ───────────── */
function render() {
  if (!S) return;
  body.classList.toggle('side-left', S.config.side === 'left');
  body.classList.toggle('locked', !S.vaults.personal.unlocked);
  const v = !S.vaults.personal.configured ? 'onboarding' : (!S.vaults.personal.unlocked ? 'lock' : 'main');
  if (v !== view) {
    view = v;
    closeModal();
    if (v === 'onboarding') mountOnboarding();
    else if (v === 'lock') mountLock();
    else mountMain();
  }
  if (view === 'main') renderMain();
  if (view === 'lock') renderLockInfo();
}

/* ───────────── onboarding / vault setup ───────────── */
function setupHTML(which) {
  const team = which === 'team';
  const remember = team ? `
    <label class="check"><input type="checkbox" class="remember" checked>
      <span>לזכור את סיסמת הצוות בתוך הסרגל האישי שלי<small>כך כספת הצוות תיפתח לבד יחד עם הסרגל</small></span></label>` : '';
  return `
  <div class="setup" data-which="${which}">
    <div class="setup-step" data-step="choose">
      ${team
        ? `<h2>${icon('users')} חיבור כספת צוות</h2>
           <p class="muted">כספת צוות היא קובץ מוצפן נפרד, בתיקייה משותפת בדרייב. מי שיש לו את הקובץ ואת סיסמת הצוות רואה את הטאבים המשותפים — והאישיים נשארים רק אצלך.</p>`
        : `<div class="hero">${LOGO}</div>
           <h1>ברוכים הבאים לסרגל</h1>
           <p class="muted center">טקסטים, קישורים, פרטי לקוחות וגישות — בשליפה מהצד של המסך. הכל נשמר בקובץ מוצפן אחד שעובר איתך בין המחשבים.</p>`}
      <button class="big-choice" data-go="create">${icon('plus')}<span><b>${team ? 'כספת צוות חדשה' : 'סרגל חדש'}</b><small>${team ? 'יוצרים קובץ צוות בתיקייה משותפת' : 'מתחילים מאפס'}</small></span></button>
      <button class="big-choice" data-go="open">${icon('folder')}<span><b>${team ? 'הצטרפות לכספת צוות קיימת' : 'יש לי כבר סרגל'}</b><small>${team ? 'פותחים את קובץ הצוות שכבר נוצר' : 'פותחים את הקובץ שנוצר במחשב אחר'}</small></span></button>
    </div>

    <div class="setup-step hidden" data-step="create">
      <h2>${team ? 'כספת צוות חדשה' : 'סרגל חדש'}</h2>
      <div class="lbl-t">איפה לשמור את הקובץ?</div>
      <div class="folders"><div class="muted small">מחפש תיקיות…</div></div>
      <p class="hint">${icon('cloud')} כדי שהסרגל יעבור בין מחשבים — בוחרים תיקייה של Google Drive, OneDrive או Dropbox${team ? ' שמשותפת עם הצוות' : ''}.</p>
      <label class="lbl">${team ? 'סיסמת צוות' : 'סיסמה ראשית'}<input type="password" class="pw1" autocomplete="new-password" placeholder="8 תווים לפחות"></label>
      <label class="lbl">שוב, לאימות<input type="password" class="pw2" autocomplete="new-password"></label>
      ${remember}
      <p class="warn">${icon('key')}<span>אין דרך לשחזר סיסמה שנשכחה — כדאי לשמור אותה במקום בטוח.</span></p>
      <div class="err"></div>
      <div class="row-btns"><button class="ghost" data-go="choose">חזרה</button><button class="primary" data-do="create">יצירה</button></div>
    </div>

    <div class="setup-step hidden" data-step="open">
      <h2>${team ? 'הצטרפות לכספת צוות' : 'פתיחת סרגל קיים'}</h2>
      <p class="muted">${team ? 'בוחרים את הקובץ <b dir="ltr">sargel-team.sargel</b> מהתיקייה המשותפת.' : 'בוחרים את הקובץ <b dir="ltr">sargel-personal.sargel</b> — למשל מתוך Google Drive.'}</p>
      <button class="file-pick" data-do="pick-file">${icon('file')}<span class="file-name">בחירת קובץ…</span></button>
      <label class="lbl">${team ? 'סיסמת צוות' : 'סיסמה ראשית'}<input type="password" class="pw" autocomplete="current-password"></label>
      ${remember}
      <div class="err"></div>
      <div class="row-btns"><button class="ghost" data-go="choose">חזרה</button><button class="primary" data-do="open">פתיחה</button></div>
    </div>
  </div>`;
}

function bindSetup(root, which, done) {
  const st = { folder: null, file: null, folders: [] };
  const step = (name) => {
    $$('.setup-step', root).forEach((el) => el.classList.toggle('hidden', el.dataset.step !== name));
    const f = $(`.setup-step[data-step="${name}"] input[type=password]`, root);
    if (f) setTimeout(() => f.focus(), 30);
    if (name === 'create' && !st.folders.length) loadFolders();
  };
  const errEl = () => $('.setup-step:not(.hidden) .err', root);

  async function loadFolders() {
    const r = await api.call('vault:suggestFolders');
    st.folders = r.folders || [];
    const synced = st.folders.find((f) => f.synced);
    st.folder = (synced || st.folders[0] || {}).path || null;
    drawFolders();
  }
  function drawFolders() {
    const box = $('.folders', root);
    const opts = st.folders.map((f) => `
      <button class="folder-opt ${f.path === st.folder ? 'on' : ''}" data-folder="${esc(f.path)}">
        ${icon(f.synced ? 'cloud' : 'folder')}
        <span><b>${esc(f.label)}</b><span class="fp">${esc(f.path)}</span></span>
      </button>`).join('');
    const custom = st.folder && !st.folders.some((f) => f.path === st.folder)
      ? `<button class="folder-opt on" data-folder="${esc(st.folder)}">${icon('folder')}<span><b>תיקייה שבחרתי</b><span class="fp">${esc(st.folder)}</span></span></button>` : '';
    const noCloud = !st.folders.some((f) => f.synced)
      ? `<p class="warn small">${icon('warn')}<span>לא מצאתי במחשב הזה Google Drive / OneDrive / Dropbox. אפשר לשמור במסמכים ולהעביר אחר כך — או להתקין את Google Drive למחשב ולבחור אותו.</span></p>` : '';
    box.innerHTML = noCloud + opts + custom + `<button class="folder-opt dashed" data-do="pick-folder">${icon('plus')}<span><b>תיקייה אחרת…</b></span></button>`;
  }

  root.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { step(go.dataset.go); return; }
    const fo = e.target.closest('[data-folder]');
    if (fo) { st.folder = fo.dataset.folder; drawFolders(); return; }
    const d = e.target.closest('[data-do]');
    if (!d) return;
    const err = errEl();
    if (err) err.textContent = '';

    if (d.dataset.do === 'pick-folder') {
      const r = await api.call('vault:pickFolder');
      if (r.path) { st.folder = r.path; drawFolders(); }
      return;
    }
    if (d.dataset.do === 'pick-file') {
      const r = await api.call('vault:pickFile');
      if (r.path) {
        st.file = r.path;
        $('.file-name', root).textContent = r.path;
        $('.file-pick', root).classList.add('on');
        $('.setup-step[data-step="open"] .pw', root).focus();
      }
      return;
    }
    const remember = $('.setup-step:not(.hidden) .remember', root);
    if (d.dataset.do === 'create') {
      const pw1 = $('.pw1', root).value;
      const pw2 = $('.pw2', root).value;
      if (!st.folder) { err.textContent = 'צריך לבחור תיקייה'; return; }
      if (pw1.length < 8) { err.textContent = ERRORS.WEAK_PASSWORD; return; }
      if (pw1 !== pw2) { err.textContent = 'הסיסמאות לא זהות'; return; }
      await busy(d, async () => {
        const r = await api.call('vault:create', { which, folder: st.folder, password: pw1, remember: remember ? remember.checked : false });
        if (!r.ok) { err.textContent = errText(r); return; }
        done();
      });
    }
    if (d.dataset.do === 'open') {
      const pw = $('.setup-step[data-step="open"] .pw', root).value;
      if (!st.file) { err.textContent = 'צריך לבחור קובץ'; return; }
      if (!pw) { err.textContent = 'צריך להקליד סיסמה'; return; }
      await busy(d, async () => {
        const r = await api.call('vault:open', { which, file: st.file, password: pw, remember: remember ? remember.checked : false });
        if (!r.ok) { err.textContent = errText(r); shake(root); return; }
        done();
      });
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const b = $('.setup-step:not(.hidden) .primary', root);
    if (b) b.click();
  });
}

async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'רגע…';
  try { await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function mountOnboarding() {
  panel.innerHTML = setupHTML('personal');
  bindSetup($('.setup', panel), 'personal', () => toast('הסרגל מוכן ✨'));
}

/* ───────────── lock screen ───────────── */
function mountLock() {
  panel.innerHTML = `
    <div class="lockview">
      <div class="hero">${LOGO}</div>
      <h2>הסרגל נעול</h2>
      <p class="muted small file-line" dir="ltr"></p>
      <div class="lock-missing hidden warn small">${icon('warn')}<span>${ERRORS.NOT_FOUND}</span></div>
      <form class="unlock">
        <div class="pw-wrap big">
          <input type="password" id="pw" placeholder="סיסמה ראשית" autocomplete="current-password">
          <button type="submit" class="primary">${icon('unlock')} פתיחה</button>
        </div>
      </form>
      <div class="err"></div>
      <div class="lock-foot">
        <span class="muted small">${esc(S.hotkeyLabel ? `חיפוש מהיר מכל מקום: ${S.hotkeyLabel}` : '')}</span>
        <button class="link-btn" data-act="switch">פתיחת קובץ סרגל אחר</button>
      </div>
    </div>`;
  const form = $('.unlock', panel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#pw').value;
    if (!pw) return;
    const btn = $('button[type=submit]', form);
    await busy(btn, async () => {
      const r = await api.call('vault:unlock', { password: pw });
      if (!r.ok) {
        $('.lockview .err').textContent = errText(r);
        shake(form);
        $('#pw').select();
      }
    });
  });
  $('[data-act="switch"]', panel).addEventListener('click', () => {
    confirmModal('פתיחת קובץ סרגל אחר', 'הסרגל יתנתק מהקובץ הנוכחי (הקובץ עצמו לא נמחק) ותוכלו לבחור קובץ אחר או ליצור חדש.', 'המשך', async () => {
      await api.call('vault:disconnect', { which: 'personal' });
    });
  });
  if (S.ui.expanded) setTimeout(() => $('#pw') && $('#pw').focus(), 50);
}

function renderLockInfo() {
  const p = S.vaults.personal;
  const line = $('.file-line', panel);
  if (line) line.textContent = p.name || '';
  const miss = $('.lock-missing', panel);
  if (miss) miss.classList.toggle('hidden', !!p.exists);
}

/* ───────────── main view ───────────── */
function mountMain() {
  panel.innerHTML = `
    <header class="top">
      <div class="brand">${LOGO}<span>הסרגל</span></div>
      <button class="icon-btn" data-action="pin" title="נעיצה — הסרגל יישאר פתוח">${icon('pin')}</button>
      <button class="icon-btn" data-action="lock" title="נעילה">${icon('lock')}</button>
      <button class="icon-btn" data-action="settings" title="הגדרות">${icon('gear')}</button>
    </header>
    <div class="searchbox">${icon('search')}<input id="q" placeholder="חיפוש בכל הסרגל…" autocomplete="off" spellcheck="false"><kbd id="hk"></kbd></div>
    <div id="banner"></div>
    <nav id="tabs" class="tabs"></nav>
    <main id="list" class="list"></main>
    <footer class="foot"><button class="primary" data-action="add-item">${icon('plus')} פריט חדש</button></footer>`;

  const q = $('#q');
  q.addEventListener('input', () => { query = q.value; renderTabs(); renderList(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('#list .item .row');
      if (first) first.click();
    }
  });

  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.tab[data-id]');
    if (t) openTabEditor(tabById(t.dataset.id));
  });
  panel.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.tab[data-id]');
    if (t) { e.preventDefault(); openTabEditor(tabById(t.dataset.id)); return; }
    const it = e.target.closest('.item');
    if (it) { e.preventDefault(); openItemEditor(findItem(it.dataset.id)); }
  });
  bindDrag();
}

function renderMain() {
  $('[data-action="pin"]', panel).classList.toggle('on', !!S.ui.pinned);
  const hk = $('#hk');
  hk.textContent = S.hotkeyLabel || '';
  hk.classList.toggle('hidden', !S.hotkeyLabel);
  hk.title = 'חיפוש מהיר מכל מקום במחשב';
  const t = S.vaults.team;
  $('#banner').innerHTML = t.configured && !t.unlocked
    ? `<div class="banner">${icon('users')}<span>כספת הצוות נעולה</span><button class="ghost sm" data-action="unlock-team">פתיחה</button></div>` : '';
  renderTabs();
  renderList();
}

const tabsSorted = () => S.data.tabs.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
const tabById = (id) => S.data.tabs.find((t) => t.id === id);
const findItem = (id) => S.data.items.find((i) => i.id === id);
const itemsOf = (tabId) => S.data.items.filter((i) => i.tabId === tabId).sort((a, b) => (a.order || 0) - (b.order || 0));

function setQuery(v) {
  query = v;
  const q = $('#q');
  if (q) q.value = v;
  renderTabs();
  renderList();
}

function renderTabs() {
  const tabs = tabsSorted();
  if (!tabs.find((t) => t.id === activeTab)) activeTab = tabs[0] ? tabs[0].id : null;
  $('#tabs').innerHTML = tabs.map((t) => `
    <button class="tab ${t.id === activeTab && !query ? 'active' : ''}" data-action="tab" data-id="${t.id}" draggable="true"
      title="${t.vault === 'team' ? 'משותף לצוות · ' : ''}לחיצה כפולה לעריכה">
      ${t.icon ? `<span class="ticon">${esc(t.icon)}</span>` : ''}<span class="tname">${esc(t.name)}</span>
      ${t.vault === 'team' ? `<span class="team-badge">${icon('users')}</span>` : ''}
    </button>`).join('')
    + `<button class="tab add" data-action="add-tab" title="טאב חדש">${icon('plus')}</button>`;
}

function itemHTML(it, showTab) {
  const fs = fieldsOf(it);
  const multi = fs.length > 1;
  const f = fs[0];
  const open = multi && openItems.has(it.id);
  const kind = multi ? 'stack' : (f ? f.kind : 'text');
  let sub;
  if (multi) sub = fs.map((x) => x.label || KIND_LABEL[x.kind]).join(' · ');
  else if (f && f.kind === 'secret' && revealed.has(f.id)) sub = f.value;
  else sub = preview(f);

  let actions = '';
  if (!multi && f) {
    if (f.kind === 'link' && normalizeUrl(f.value)) actions += `<button class="icon-btn sm" data-action="open-field" data-fid="${f.id}" title="פתיחה בדפדפן">${icon('external')}</button>`;
    if (f.kind === 'secret') actions += `<button class="icon-btn sm" data-action="reveal" data-fid="${f.id}" title="הצגה">${icon(revealed.has(f.id) ? 'eyeOff' : 'eye')}</button>`;
    actions += `<button class="icon-btn sm" data-action="copy-field" data-fid="${f.id}" title="העתקה">${icon('copy')}</button>`;
  }
  actions += `<button class="icon-btn sm" data-action="edit-item" title="עריכה">${icon('edit')}</button>`;
  const tab = showTab ? tabById(it.tabId) : null;

  return `
  <div class="item ${multi ? 'multi' : ''} ${open ? 'open' : ''}" data-id="${it.id}" draggable="${query ? 'false' : 'true'}">
    <div class="row" data-action="${multi ? 'toggle' : 'copy-field'}" ${!multi && f ? `data-fid="${f.id}"` : ''}
      title="${multi ? 'לחיצה פותחת' : 'לחיצה מעתיקה'}">
      <span class="kind k-${kind}">${icon(multi ? 'stack' : KIND_ICON[kind] || 'text')}</span>
      <div class="txt">
        <div class="title">${esc(it.title || preview(f) || '(ללא כותרת)')}</div>
        ${tab ? `<div class="from">${esc(tab.icon || '')} ${esc(tab.name)}</div>` : ''}
        <div class="sub" dir="auto">${esc(sub)}</div>
      </div>
      <div class="row-actions">${actions}</div>
      ${multi ? `<span class="chev">${icon('chevron')}</span>` : ''}
    </div>
    ${open ? `<div class="fields">${fs.map(fieldHTML).join('')}</div>` : ''}
  </div>`;
}

function fieldHTML(f) {
  const secret = f.kind === 'secret';
  const shown = secret && !revealed.has(f.id) ? '••••••••••' : f.value;
  let actions = '';
  if (f.kind === 'link' && normalizeUrl(f.value)) actions += `<button class="icon-btn sm" data-action="open-field" data-fid="${f.id}" title="פתיחה בדפדפן">${icon('external')}</button>`;
  if (secret) actions += `<button class="icon-btn sm" data-action="reveal" data-fid="${f.id}" title="הצגה">${icon(revealed.has(f.id) ? 'eyeOff' : 'eye')}</button>`;
  actions += `<button class="icon-btn sm" data-action="copy-field" data-fid="${f.id}" title="העתקה">${icon('copy')}</button>`;
  return `
    <div class="field" data-action="copy-field" data-fid="${f.id}" title="לחיצה מעתיקה">
      <span class="flabel">${esc(f.label || KIND_LABEL[f.kind])}</span>
      <span class="fval ${secret ? 'secret' : ''}" dir="auto">${esc(shown)}</span>
      <span class="row-actions">${actions}</span>
    </div>`;
}

function searchItems(q) {
  const tabs = new Map(S.data.tabs.map((t) => [t.id, t]));
  return S.data.items
    .map((it) => {
      const tab = tabs.get(it.tabId);
      const parts = [[it.title, 4], [tab && tab.name, 1]];
      for (const f of fieldsOf(it)) {
        parts.push([f.label, 2]);
        if (f.kind !== 'secret') parts.push([f.value, 1]);
      }
      return { it, s: matchScore(parts, q) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 80)
    .map((x) => x.it);
}

function renderList() {
  const list = $('#list');
  if (!list) return;
  if (query.trim()) {
    const res = searchItems(query.trim());
    list.innerHTML = res.length
      ? `<div class="list-head"><span>תוצאות חיפוש</span><span class="count">${res.length}</span></div>${res.map((it) => itemHTML(it, true)).join('')}`
      : `<div class="empty"><div class="big">🔎</div>לא נמצא שום דבר עבור „${esc(query)}”</div>`;
    return;
  }
  const tab = tabById(activeTab);
  if (!tab) {
    list.innerHTML = `<div class="empty"><div class="big">🗂️</div>אין עדיין טאבים.<br>לוחצים על <b>+</b> למעלה כדי ליצור את הראשון.</div>`;
    return;
  }
  const items = itemsOf(tab.id);
  list.innerHTML = `
    <div class="list-head">
      <span class="lh-name">${esc(tab.icon || '')} ${esc(tab.name)}</span>
      <span class="count">${items.length}</span>
      ${tab.vault === 'team' ? '<span class="pill">צוות</span>' : ''}
      <span class="grow"></span>
      <button class="icon-btn sm" data-action="edit-tab" data-id="${tab.id}" title="עריכת הטאב">${icon('edit')}</button>
    </div>
    ${items.length ? items.map((it) => itemHTML(it, false)).join('')
      : `<div class="empty"><div class="big">${esc(tab.icon || '📭')}</div>הטאב ריק.<br>לוחצים על <b>פריט חדש</b> כדי להוסיף טקסט, קישור, פרטי לקוח או סיסמה.</div>`}`;
}

async function onPanelClick(e) {
  const a = e.target.closest('[data-action]');
  if (!a || !panel.contains(a)) return;
  const itemEl = a.closest('.item');
  const item = itemEl ? findItem(itemEl.dataset.id) : null;
  const field = item && a.dataset.fid ? fieldsOf(item).find((f) => f.id === a.dataset.fid) : null;

  switch (a.dataset.action) {
    case 'tab':
      activeTab = a.dataset.id;
      try { localStorage.setItem('activeTab', activeTab); } catch { /* ignore */ }
      if (query) setQuery(''); else { renderTabs(); renderList(); }
      break;
    case 'add-tab': openTabEditor(null); break;
    case 'edit-tab': openTabEditor(tabById(a.dataset.id)); break;
    case 'toggle':
      if (openItems.has(item.id)) openItems.delete(item.id); else openItems.add(item.id);
      renderList();
      break;
    case 'copy-field': {
      if (!field) break;
      e.stopPropagation();
      await api.call('clip:copy', { text: field.value, secret: field.kind === 'secret' });
      recordRecent(`${item.id}:${field.id}`);
      flash(a.closest('.field') || a.closest('.row') || a);
      toast(field.kind === 'secret' ? 'הסיסמה הועתקה · תימחק מהלוח בעוד 30 שניות' : 'הועתק');
      break;
    }
    case 'open-field': {
      e.stopPropagation();
      const url = field && normalizeUrl(field.value);
      if (url) api.call('shell:open', { url });
      break;
    }
    case 'reveal':
      e.stopPropagation();
      if (revealed.has(field.id)) revealed.delete(field.id); else revealed.add(field.id);
      renderList();
      break;
    case 'edit-item': e.stopPropagation(); openItemEditor(item); break;
    case 'add-item': openItemEditor(null); break;
    case 'pin': api.call('ui:pin', { pinned: !S.ui.pinned }); break;
    case 'lock': api.call('vault:lock'); break;
    case 'settings': openSettings(); break;
    case 'unlock-team': openTeamUnlock(); break;
    default: break;
  }
}

/* ───────────── drag & drop ───────────── */
function bindDrag() {
  let drag = null; // {type:'item'|'tab', id}
  const clearMarks = () => $$('.drop-before,.drop-after,.drop', panel).forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop'));

  panel.addEventListener('dragstart', (e) => {
    const tab = e.target.closest && e.target.closest('.tab[data-id]');
    const item = e.target.closest && e.target.closest('.item');
    if (tab) drag = { type: 'tab', id: tab.dataset.id, el: tab };
    else if (item && !query) drag = { type: 'item', id: item.dataset.id, el: item };
    else { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.id);
    setTimeout(() => drag && drag.el.classList.add('dragging'), 0);
  });
  panel.addEventListener('dragend', () => {
    if (drag) drag.el.classList.remove('dragging');
    drag = null;
    clearMarks();
  });
  panel.addEventListener('dragover', (e) => {
    if (!drag) return;
    clearMarks();
    if (drag.type === 'item') {
      const tab = e.target.closest('.tab[data-id]');
      if (tab && tab.dataset.id !== activeTab) { e.preventDefault(); tab.classList.add('drop'); return; }
      const over = e.target.closest('.item');
      if (over && over.dataset.id !== drag.id) {
        e.preventDefault();
        const r = over.getBoundingClientRect();
        over.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
      }
    } else {
      const over = e.target.closest('.tab[data-id]');
      if (over && over.dataset.id !== drag.id) {
        e.preventDefault();
        const r = over.getBoundingClientRect();
        const before = (e.clientX > r.left + r.width / 2); // RTL: right half = before
        over.classList.add(before ? 'drop-before' : 'drop-after');
      }
    }
  });
  panel.addEventListener('drop', async (e) => {
    if (!drag) return;
    e.preventDefault();
    const d = drag;
    clearMarks();
    if (d.type === 'item') {
      const tabEl = e.target.closest('.tab[data-id]');
      const item = findItem(d.id);
      if (tabEl && item) {
        const target = tabById(tabEl.dataset.id);
        const r = await api.call('data:saveItem', { vault: target.vault, fromVault: item.vault, item: { ...item, tabId: target.id } });
        if (r.ok) toast(`הועבר אל ${target.name}`); else toast(errText(r), 'warn');
        return;
      }
      const over = e.target.closest('.item');
      if (!over || !item) return;
      const r = over.getBoundingClientRect();
      const after = e.clientY >= r.top + r.height / 2;
      const ids = itemsOf(activeTab).map((x) => x.id).filter((id) => id !== d.id);
      let idx = ids.indexOf(over.dataset.id);
      if (after) idx += 1;
      ids.splice(idx, 0, d.id);
      api.call('data:reorder', { entries: ids.map((id, i) => ({ vault: findItem(id).vault, kind: 'items', id, order: i })) });
    } else {
      const over = e.target.closest('.tab[data-id]');
      if (!over) return;
      const r = over.getBoundingClientRect();
      const before = e.clientX > r.left + r.width / 2;
      const ids = tabsSorted().map((t) => t.id).filter((id) => id !== d.id);
      let idx = ids.indexOf(over.dataset.id);
      if (!before) idx += 1;
      ids.splice(idx, 0, d.id);
      api.call('data:reorder', { entries: ids.map((id, i) => ({ vault: tabById(id).vault, kind: 'tabs', id, order: i })) });
    }
  });
}

/* ───────────── modals ───────────── */
function showModal(html, bind, cls = '') {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${cls}" role="dialog">${html}</div>`;
  panel.appendChild(back);
  modal = back;
  updateHold();
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
  const m = back.firstElementChild;
  bind(m);
  const first = $('input:not([type=checkbox]):not([type=range]), textarea', m);
  if (first) setTimeout(() => first.focus(), 40);
}

function closeModal() {
  if (!modal) return;
  modal.remove();
  modal = null;
  updateHold();
}

function confirmModal(title, text, okLabel, onOk, danger = false) {
  showModal(`
    <h3>${esc(title)}</h3>
    <p class="muted">${esc(text)}</p>
    <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="${danger ? 'danger' : 'primary'} m-ok">${esc(okLabel)}</button></div>`, (m) => {
    $('.m-cancel', m).onclick = closeModal;
    $('.m-ok', m).onclick = async () => { closeModal(); await onOk(); };
  });
}

/* item editor */
function openItemEditor(item) {
  const tabs = tabsSorted();
  if (!tabs.length) { toast('קודם צריך ליצור טאב', 'warn'); openTabEditor(null); return; }
  const isNew = !item;
  const draft = item
    ? JSON.parse(JSON.stringify(item))
    : { id: null, tabId: activeTab || tabs[0].id, title: '', fields: [{ id: rid(), label: '', kind: 'text', value: '' }] };
  if (!draft.fields.length) draft.fields.push({ id: rid(), label: '', kind: 'text', value: '' });

  showModal(`
    <h3>${isNew ? 'פריט חדש' : 'עריכת פריט'}</h3>
    <label class="lbl">כותרת<input class="m-title" placeholder="למשל: מייל פתיחה ללקוח / משה כהן – אינסטלציה"></label>
    <label class="lbl">טאב<select class="m-tab">${tabs.map((t) => `<option value="${t.id}">${esc(`${t.icon ? `${t.icon} ` : ''}${t.name}`)}${t.vault === 'team' ? ' · צוות' : ''}</option>`).join('')}</select></label>
    <div class="lbl-t">תוכן <span class="muted small">— שדה אחד: לחיצה מעתיקה. כמה שדות: נפתח כמו מחסנית.</span></div>
    <div class="m-fields"></div>
    <button class="ghost add-field">${icon('plus')} הוספת שדה</button>
    <div class="err m-err"></div>
    <div class="m-actions">
      ${isNew ? '' : `<button class="danger m-del">מחיקה</button>`}
      <span class="spacer"></span>
      <button class="ghost m-cancel">ביטול</button>
      <button class="primary m-save">שמירה</button>
    </div>`, (m) => {
    $('.m-title', m).value = draft.title || '';
    $('.m-tab', m).value = draft.tabId;

    const box = $('.m-fields', m);
    const draw = () => {
      box.innerHTML = draft.fields.map((f, i) => `
        <div class="fe" data-i="${i}">
          <div class="fe-top">
            <input class="fe-label" placeholder="תווית (רשות) — למשל טלפון">
            <select class="fe-kind"><option value="text">טקסט</option><option value="link">קישור</option><option value="secret">סיסמה</option></select>
            ${draft.fields.length > 1 ? `<button class="icon-btn sm fe-del" title="הסרת השדה">${icon('x')}</button>` : ''}
          </div>
          ${f.kind === 'text' ? '<textarea class="fe-value" rows="2" dir="auto" placeholder="התוכן שיועתק"></textarea>'
            : f.kind === 'secret' ? `<div class="pw-wrap"><input type="password" class="fe-value" dir="ltr" placeholder="סיסמה" autocomplete="off"><button class="icon-btn sm fe-eye" title="הצגה">${icon('eye')}</button><button class="icon-btn sm fe-gen" title="יצירת סיסמה חזקה">${icon('dice')}</button></div>`
            : '<input class="fe-value" dir="ltr" placeholder="https://…">'}
        </div>`).join('');
      $$('.fe', box).forEach((row) => {
        const f = draft.fields[Number(row.dataset.i)];
        $('.fe-label', row).value = f.label || '';
        $('.fe-kind', row).value = f.kind;
        $('.fe-value', row).value = f.value || '';
      });
    };
    draw();

    box.addEventListener('input', (e) => {
      const row = e.target.closest('.fe');
      if (!row) return;
      const f = draft.fields[Number(row.dataset.i)];
      if (e.target.classList.contains('fe-label')) f.label = e.target.value;
      if (e.target.classList.contains('fe-value')) f.value = e.target.value;
    });
    box.addEventListener('change', (e) => {
      if (!e.target.classList.contains('fe-kind')) return;
      draft.fields[Number(e.target.closest('.fe').dataset.i)].kind = e.target.value;
      draw();
    });
    box.addEventListener('click', (e) => {
      const row = e.target.closest('.fe');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('.fe-del')) { draft.fields.splice(i, 1); draw(); }
      if (e.target.closest('.fe-eye')) {
        const inp = $('.fe-value', row);
        inp.type = inp.type === 'password' ? 'text' : 'password';
      }
      if (e.target.closest('.fe-gen')) {
        const inp = $('.fe-value', row);
        inp.value = strongPassword();
        inp.type = 'text';
        draft.fields[i].value = inp.value;
      }
    });
    $('.add-field', m).onclick = () => {
      draft.fields.push({ id: rid(), label: '', kind: 'text', value: '' });
      draw();
      const rows = $$('.fe-label', box);
      rows[rows.length - 1].focus();
    };
    $('.m-cancel', m).onclick = closeModal;

    const del = $('.m-del', m);
    if (del) {
      del.onclick = async () => {
        if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'בטוח? לחיצה נוספת מוחקת'; return; }
        const r = await api.call('data:deleteItem', { vault: item.vault, id: item.id });
        if (r.ok) { closeModal(); toast('נמחק'); } else $('.m-err', m).textContent = errText(r);
      };
    }

    $('.m-save', m).onclick = async () => {
      const title = $('.m-title', m).value.trim();
      const tabId = $('.m-tab', m).value;
      let fields = draft.fields.filter((f) => String(f.label || '').trim() || String(f.value || '').trim());
      if (!fields.length) { $('.m-err', m).textContent = 'צריך למלא לפחות שדה אחד'; return; }
      fields = fields.map((f) => ({ ...f, value: f.kind === 'link' ? String(f.value).trim() : f.value }));
      const finalTitle = title || String(fields[0].label || fields[0].value).split('\n')[0].slice(0, 60);
      const target = tabById(tabId);
      const r = await api.call('data:saveItem', {
        vault: target.vault,
        fromVault: item ? item.vault : null,
        item: { id: draft.id, tabId, title: finalTitle, fields },
      });
      if (!r.ok) { $('.m-err', m).textContent = errText(r); return; }
      activeTab = tabId;
      if (fields.length > 1 && r.id) openItems.add(r.id);
      closeModal();
      toast(isNew ? 'נוסף' : 'נשמר');
    };

    m.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('.m-save', m).click();
    });
  }, 'tall');
}

/* tab editor */
const EMOJIS = ['✉️', '📌', '👥', '🔑', '🔗', '📞', '💼', '🧾', '📝', '💡', '⭐', '📁', '🏷️', '🛒', '📣', '🗓️', '💬', '🧩', '🎨', '⚙️', '🌐', '📊', '🏠', '❤️', '🤝', '🚀', '📦', '🧠', '💳', '📷', '🎯', ''];

function openTabEditor(tab) {
  const isNew = !tab;
  const teamOpen = S.vaults.team.unlocked;
  let chosenIcon = tab ? tab.icon || '' : '📌';
  let vault = tab ? tab.vault : 'personal';
  const count = tab ? itemsOf(tab.id).length : 0;

  showModal(`
    <h3>${isNew ? 'טאב חדש' : 'עריכת טאב'}</h3>
    <label class="lbl">שם<input class="t-name" maxlength="60" placeholder="למשל: נושאים ומיילים"></label>
    <div class="lbl-t">אייקון</div>
    <div class="emoji-grid">${EMOJIS.map((e) => `<button class="emoji" data-e="${e}" title="${e ? '' : 'בלי אייקון'}">${e || '∅'}</button>`).join('')}</div>
    ${isNew && teamOpen ? `
      <div class="lbl-t">מי רואה את הטאב?</div>
      <div class="seg"><button data-v="personal">${icon('lock')} רק אני</button><button data-v="team">${icon('users')} כל הצוות</button></div>` : ''}
    ${!isNew && tab.vault === 'team' ? `<p class="muted small">${icon('users')} טאב משותף לצוות</p>` : ''}
    <div class="err m-err"></div>
    <div class="m-actions">
      ${isNew ? '' : '<button class="danger m-del">מחיקה</button>'}
      <span class="spacer"></span>
      <button class="ghost m-cancel">ביטול</button>
      <button class="primary m-save">${isNew ? 'יצירה' : 'שמירה'}</button>
    </div>`, (m) => {
    $('.t-name', m).value = tab ? tab.name : '';
    const drawEmoji = () => $$('.emoji', m).forEach((b) => b.classList.toggle('on', b.dataset.e === chosenIcon));
    const drawSeg = () => $$('.seg button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === vault));
    drawEmoji();
    drawSeg();
    $('.emoji-grid', m).onclick = (e) => { const b = e.target.closest('.emoji'); if (b) { chosenIcon = b.dataset.e; drawEmoji(); } };
    const seg = $('.seg', m);
    if (seg) seg.onclick = (e) => { const b = e.target.closest('button'); if (b) { vault = b.dataset.v; drawSeg(); } };
    $('.m-cancel', m).onclick = closeModal;
    const del = $('.m-del', m);
    if (del) {
      del.onclick = async () => {
        if (!del.dataset.sure) {
          del.dataset.sure = '1';
          del.textContent = count ? `למחוק גם ${count} פריטים? לחיצה נוספת` : 'בטוח? לחיצה נוספת';
          return;
        }
        const r = await api.call('data:deleteTab', { vault: tab.vault, id: tab.id });
        if (r.ok) { closeModal(); toast('הטאב נמחק'); } else $('.m-err', m).textContent = errText(r);
      };
    }
    $('.m-save', m).onclick = async () => {
      const name = $('.t-name', m).value.trim();
      if (!name) { $('.m-err', m).textContent = 'צריך לתת שם לטאב'; return; }
      const r = await api.call('data:saveTab', { vault, tab: { id: tab ? tab.id : null, name, icon: chosenIcon } });
      if (!r.ok) { $('.m-err', m).textContent = errText(r); return; }
      if (isNew) {
        activeTab = r.id;
        if (query) setQuery('');
      }
      closeModal();
    };
    $('.t-name', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.m-save', m).click(); });
  });
}

/* team unlock */
function openTeamUnlock() {
  showModal(`
    <h3>${icon('users')} פתיחת כספת הצוות</h3>
    <p class="muted small" dir="ltr">${esc(S.vaults.team.name || '')}</p>
    ${S.vaults.team.exists ? '' : `<p class="warn small">${icon('warn')}<span>${ERRORS.NOT_FOUND}</span></p>`}
    <label class="lbl">סיסמת צוות<input type="password" class="t-pw"></label>
    <label class="check"><input type="checkbox" class="remember" checked><span>לזכור בתוך הסרגל האישי שלי</span></label>
    <div class="err m-err"></div>
    <div class="m-actions"><button class="link-btn m-disc">ניתוק מכספת הצוות</button><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-ok">פתיחה</button></div>`, (m) => {
    $('.m-cancel', m).onclick = closeModal;
    $('.m-disc', m).onclick = () => confirmModal('ניתוק מכספת הצוות', 'הטאבים המשותפים יוסרו מהסרגל במחשב הזה. הקובץ המשותף עצמו לא נמחק.', 'ניתוק', () => api.call('vault:disconnect', { which: 'team' }), true);
    const go = async () => {
      const r = await api.call('vault:unlockTeam', { password: $('.t-pw', m).value, remember: $('.remember', m).checked });
      if (!r.ok) { $('.m-err', m).textContent = errText(r); shake(m); return; }
      closeModal();
      toast('כספת הצוות נפתחה');
    };
    $('.m-ok', m).onclick = go;
    $('.t-pw', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

/* team connect */
function openTeamConnect() {
  showModal(setupHTML('team'), (m) => {
    bindSetup($('.setup', m), 'team', () => { closeModal(); toast('כספת הצוות מחוברת'); });
  }, 'tall');
}

/* change password */
function openChangePassword(which) {
  showModal(`
    <h3>${which === 'team' ? 'שינוי סיסמת צוות' : 'שינוי סיסמה ראשית'}</h3>
    ${which === 'team' ? `<p class="warn small">${icon('warn')}<span>אחרי השינוי, כל אנשי הצוות יצטרכו להקליד את הסיסמה החדשה.</span></p>` : ''}
    <label class="lbl">הסיסמה הנוכחית<input type="password" class="c-cur"></label>
    <label class="lbl">סיסמה חדשה<input type="password" class="c-new" placeholder="8 תווים לפחות"></label>
    <label class="lbl">שוב, לאימות<input type="password" class="c-new2"></label>
    <div class="err m-err"></div>
    <div class="m-actions"><span class="spacer"></span><button class="ghost m-cancel">ביטול</button><button class="primary m-ok">שינוי</button></div>`, (m) => {
    $('.m-cancel', m).onclick = closeModal;
    $('.m-ok', m).onclick = async () => {
      const cur = $('.c-cur', m).value;
      const n1 = $('.c-new', m).value;
      const n2 = $('.c-new2', m).value;
      if (n1.length < 8) { $('.m-err', m).textContent = ERRORS.WEAK_PASSWORD; return; }
      if (n1 !== n2) { $('.m-err', m).textContent = 'הסיסמאות לא זהות'; return; }
      const r = await api.call('vault:changePassword', { which, current: cur, next: n1 });
      if (!r.ok) { $('.m-err', m).textContent = errText(r); return; }
      closeModal();
      toast('הסיסמה שונתה');
    };
  });
}

/* settings */
function accelFromEvent(e) {
  const mac = S.platform === 'darwin';
  const mods = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (mac && e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const c = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (c === 'Space') key = 'Space';
  else if (c.startsWith('Arrow')) key = c.slice(5);
  else if (['Backquote', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash'].includes(c)) {
    key = { Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\' }[c];
  }
  if (!key || !mods.length) return null;
  return [...mods, key].join('+');
}

function openSettings() {
  const c = S.config;
  const p = S.vaults.personal;
  const t = S.vaults.team;
  const lockOpts = [[5, '5 דקות'], [10, '10 דקות'], [15, '15 דקות'], [30, 'חצי שעה'], [60, 'שעה'], [240, '4 שעות'], [0, 'אף פעם']];

  showModal(`
    <h3>${icon('gear')} הגדרות</h3>

    <div class="sec">
      <h4>מראה</h4>
      <div class="set-row"><span>צד המסך</span>
        <div class="seg sm" data-k="side"><button data-v="right">ימין</button><button data-v="left">שמאל</button></div></div>
      <div class="set-row"><span>ערכת צבע</span>
        <div class="seg sm" data-k="theme"><button data-v="system">אוטומטי</button><button data-v="light">בהיר</button><button data-v="dark">כהה</button></div></div>
      <div class="set-row"><span>גובה הידית</span><input type="range" min="0" max="100" class="s-handle"></div>
      <div class="set-row"><span>רוחב הסרגל</span><input type="range" min="320" max="560" step="10" class="s-width"></div>
    </div>

    <div class="sec">
      <h4>חיפוש מהיר מכל מקום</h4>
      <div class="set-row"><span>קיצור מקשים</span><input class="hotkey" readonly title="לוחצים כאן ואז על צירוף המקשים הרצוי"></div>
      ${S.hotkeyOk ? '' : `<p class="warn small">${icon('warn')}<span>הקיצור הזה תפוס על ידי תוכנה אחרת — כדאי לבחור צירוף אחר.</span></p>`}
      <p class="muted small">לוחצים על השדה ואז על הצירוף החדש (למשל Ctrl+Shift+Space).</p>
    </div>

    <div class="sec">
      <h4>${icon('lock')} אבטחה</h4>
      <div class="set-row"><span>נעילה אוטומטית אחרי חוסר שימוש במחשב</span>
        <select class="s-lock">${lockOpts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <p class="muted small">הסרגל ננעל גם כשהמחשב ננעל או נכנס למצב שינה.</p>
    </div>

    <div class="sec">
      <h4>${icon('file')} הסרגל האישי</h4>
      <div class="path">${esc(p.path || '')}</div>
      <div class="btns">
        <button class="ghost" data-s="pw-personal">${icon('key')} שינוי סיסמה</button>
        <button class="ghost" data-s="backup-personal">${icon('save')} גיבוי לקובץ</button>
        <button class="ghost" data-s="reveal-personal">${icon('folder')} הצגה בתיקייה</button>
      </div>
    </div>

    <div class="sec">
      <h4>${icon('users')} כספת צוות</h4>
      ${t.configured ? `
        <div class="path">${esc(t.path || '')}</div>
        <div class="set-row"><span>מצב</span><span class="pill">${t.unlocked ? 'מחוברת ופתוחה' : 'נעולה'}</span></div>
        <div class="btns">
          ${t.unlocked ? `<button class="ghost" data-s="pw-team">${icon('key')} שינוי סיסמת צוות</button><button class="ghost" data-s="backup-team">${icon('save')} גיבוי</button>` : `<button class="ghost" data-s="unlock-team">${icon('unlock')} פתיחה</button>`}
          <button class="ghost" data-s="reveal-team">${icon('folder')} הצגה בתיקייה</button>
          <button class="ghost" data-s="disc-team">${icon('logout')} ניתוק</button>
        </div>` : `
        <p class="muted small">טאבים שכל הצוות רואה — בקובץ מוצפן נפרד עם סיסמת צוות.</p>
        <button class="ghost" data-s="connect-team">${icon('plus')} חיבור כספת צוות</button>`}
    </div>

    <div class="sec">
      <h4>כללי</h4>
      <label class="check"><input type="checkbox" class="s-login"><span>הפעלה אוטומטית כשהמחשב נדלק</span></label>
      <div class="set-row"><span class="muted small">גרסה ${esc(S.version)}</span><button class="link-btn" data-s="quit">יציאה מהסרגל</button></div>
    </div>

    <div class="m-actions"><span class="spacer"></span><button class="primary m-close">סגירה</button></div>`, (m) => {
    const set = (patch) => api.call('config:set', { patch });
    const drawSeg = () => $$('.seg[data-k]', m).forEach((sg) => $$('button', sg).forEach((b) => b.classList.toggle('on', b.dataset.v === S.config[sg.dataset.k])));
    drawSeg();
    $$('.seg[data-k]', m).forEach((sg) => {
      sg.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        await set({ [sg.dataset.k]: b.dataset.v });
        drawSeg();
      };
    });
    const hY = $('.s-handle', m);
    hY.value = Math.round((c.handleY || 0) * 100);
    hY.onchange = () => set({ handleY: Number(hY.value) / 100 });
    const w = $('.s-width', m);
    w.value = c.width;
    w.onchange = () => set({ width: Number(w.value) });
    const lk = $('.s-lock', m);
    lk.value = String(c.autoLockMinutes);
    lk.onchange = () => set({ autoLockMinutes: Number(lk.value) });
    const lg = $('.s-login', m);
    lg.checked = !!c.launchAtLogin;
    lg.onchange = () => set({ launchAtLogin: lg.checked });

    const hk = $('.hotkey', m);
    hk.value = S.hotkeyLabel || '—';
    hk.addEventListener('focus', () => { hk.value = 'לחצו על הצירוף…'; });
    hk.addEventListener('blur', () => { hk.value = S.hotkeyLabel || '—'; });
    hk.addEventListener('keydown', async (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { hk.blur(); return; }
      const acc = accelFromEvent(e);
      if (!acc) return;
      await set({ hotkey: acc });
      const r = await api.call('state:get');
      S = r.state;
      hk.blur();
      toast(S.hotkeyOk ? `הקיצור עודכן: ${S.hotkeyLabel}` : 'הקיצור תפוס — נסו צירוף אחר', S.hotkeyOk ? 'ok' : 'warn');
    });

    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const a = b.dataset.s;
      if (a === 'pw-personal') openChangePassword('personal');
      if (a === 'pw-team') openChangePassword('team');
      if (a === 'backup-personal' || a === 'backup-team') {
        const r = await api.call('vault:backup', { which: a.endsWith('team') ? 'team' : 'personal' });
        if (r.ok && r.saved) toast('הגיבוי נשמר');
      }
      if (a === 'reveal-personal') api.call('vault:reveal', { which: 'personal' });
      if (a === 'reveal-team') api.call('vault:reveal', { which: 'team' });
      if (a === 'connect-team') openTeamConnect();
      if (a === 'unlock-team') openTeamUnlock();
      if (a === 'disc-team') confirmModal('ניתוק מכספת הצוות', 'הטאבים המשותפים יוסרו מהסרגל במחשב הזה. הקובץ המשותף עצמו לא נמחק.', 'ניתוק', () => api.call('vault:disconnect', { which: 'team' }), true);
      if (a === 'quit') confirmModal('יציאה מהסרגל', 'הסרגל ייסגר עד ההפעלה הבאה של המחשב (או עד שתפתחו אותו שוב).', 'יציאה', () => api.call('app:quit'), true);
    });
    $('.m-close', m).onclick = closeModal;
  }, 'tall');
}
