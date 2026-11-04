'use strict';
/* Quick search window — opened from anywhere with the global hotkey */

let S = null;
let results = [];
let sel = 0;
let mode = null; // 'lock' | 'search'
const spot = $('#spot');

api.on('state', (s) => { S = s; if (document.hasFocus() || mode === null) mount(); });
api.on('search:open', (s) => { if (s) S = s; mode = null; mount(true); });

(async () => {
  const r = await api.call('state:get');
  S = r.state;
  mount();
})();

document.body.addEventListener('mousedown', (e) => {
  if (!spot.contains(e.target)) api.call('search:hide');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.call('search:hide'); }
});

function mount(reset) {
  if (!S) return;
  const unlocked = S.vaults.personal.unlocked;
  const configured = S.vaults.personal.configured;
  const next = unlocked ? 'search' : 'lock';
  if (next === mode && !reset) {
    if (mode === 'search') run();
    return;
  }
  mode = next;

  if (mode === 'lock') {
    spot.innerHTML = `
      <form class="spot-input" id="f">${icon('lock')}
        <input id="sq" type="password" placeholder="${configured ? 'הסרגל נעול — סיסמה ראשית ו-Enter' : 'קודם צריך להגדיר את הסרגל (בצד המסך)'}" ${configured ? '' : 'disabled'} autocomplete="current-password">
        <kbd>Esc</kbd></form>
      <div class="spot-msg err"></div>`;
    const input = $('#sq');
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) return;
      const r = await api.call('vault:unlock', { password: input.value });
      if (!r.ok) {
        $('.spot-msg').textContent = errText(r);
        spot.classList.remove('shake'); void spot.offsetWidth; spot.classList.add('shake');
        input.select();
      }
    });
    setTimeout(() => input.focus(), 20);
    return;
  }

  spot.innerHTML = `
    <div class="spot-input">${icon('search')}
      <input id="sq" placeholder="מה צריך? שם, לקוח, נושא…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div id="sres" class="spot-res"></div>
    <div class="spot-foot">
      <span><kbd>Enter</kbd> העתקה</span>
      <span><kbd>${S.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Enter</kbd> פתיחת קישור</span>
      <span><kbd>↑</kbd><kbd>↓</kbd> מעבר</span>
    </div>`;
  const input = $('#sq');
  input.addEventListener('input', () => { sel = 0; run(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) openSel(); else copySel();
    }
  });
  $('#sres').addEventListener('mousemove', (e) => {
    const r = e.target.closest('.sr');
    if (r && Number(r.dataset.i) !== sel) { sel = Number(r.dataset.i); paintSel(); }
  });
  $('#sres').addEventListener('click', (e) => {
    const r = e.target.closest('.sr');
    if (!r) return;
    sel = Number(r.dataset.i);
    if (e.target.closest('.sr-open')) openSel(); else copySel();
  });
  sel = 0;
  run();
  setTimeout(() => input.focus(), 20);
}

function entries() {
  const tabs = new Map(S.data.tabs.map((t) => [t.id, t]));
  const out = [];
  for (const it of S.data.items) {
    const tab = tabs.get(it.tabId);
    const fs = fieldsOf(it);
    for (const f of fs) {
      out.push({
        key: `${it.id}:${f.id}`,
        it, f, tab,
        label: fs.length > 1 ? (f.label || KIND_LABEL[f.kind]) : '',
      });
    }
  }
  return out;
}

function run() {
  const box = $('#sres');
  if (!box) return;
  const q = ($('#sq') || {}).value || '';
  const all = entries();
  const recent = recentMap();
  if (!q.trim()) {
    results = all
      .map((e) => ({ e, r: recent[e.key] || 0 }))
      .sort((a, b) => b.r - a.r || ((a.e.tab && a.e.tab.order) || 0) - ((b.e.tab && b.e.tab.order) || 0))
      .slice(0, 40)
      .map((x) => x.e);
  } else {
    results = all
      .map((e) => ({
        e,
        s: matchScore([[e.it.title, 4], [e.label, 3], [e.tab && e.tab.name, 1], [e.f.kind === 'secret' ? '' : e.f.value, 1]], q.trim())
          + (recent[e.key] ? 0.5 : 0),
      }))
      .filter((x) => x.s > 0.5 || (x.s > 0 && !recent[x.e.key]))
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.e);
  }
  if (sel >= results.length) sel = Math.max(0, results.length - 1);
  if (!results.length) {
    box.innerHTML = `<div class="empty small">${q.trim() ? `לא נמצא שום דבר עבור „${esc(q)}”` : 'הסרגל עדיין ריק — מוסיפים פריטים מהצד של המסך'}</div>`;
    return;
  }
  const head = q.trim() ? '' : `<div class="spot-sec">${Object.keys(recent).length ? 'אחרונים ושימושיים' : 'כל הפריטים'}</div>`;
  box.innerHTML = head + results.map((e, i) => `
    <div class="sr ${i === sel ? 'sel' : ''}" data-i="${i}">
      <span class="kind ${e.it.color ? '' : `k-${e.f.kind}`}" ${tileStyle(e.it.color)}>${icon(e.it.icon || KIND_ICON[e.f.kind] || 'text')}</span>
      <div class="txt">
        <div class="title">${esc(e.it.title || preview(e.f))}${e.label ? `<span class="lbl-sep"> › </span><span class="sr-label">${esc(e.label)}</span>` : ''}</div>
        <div class="sub" dir="auto">${esc(preview(e.f))}</div>
      </div>
      ${e.f.kind === 'link' && normalizeUrl(e.f.value) ? `<button class="icon-btn sm sr-open" title="פתיחה">${icon('external')}</button>` : ''}
      <span class="meta">${e.tab ? `${esc(e.tab.icon || '')} ${esc(e.tab.name)}` : ''}${e.it.vault === 'team' ? ' · צוות' : ''}</span>
    </div>`).join('');
}

function paintSel() {
  $$('.sr').forEach((el) => el.classList.toggle('sel', Number(el.dataset.i) === sel));
  const el = $(`.sr[data-i="${sel}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function move(d) {
  if (!results.length) return;
  sel = (sel + d + results.length) % results.length;
  paintSel();
}

async function copySel() {
  const e = results[sel];
  if (!e) return;
  await api.call('clip:copy', { text: e.f.value, secret: e.f.kind === 'secret' });
  recordRecent(e.key);
  const el = $(`.sr[data-i="${sel}"]`);
  if (el) {
    el.classList.add('done');
    $('.kind', el).innerHTML = icon('check');
  }
  setTimeout(() => api.call('search:hide'), 260);
}

function openSel() {
  const e = results[sel];
  const url = e && normalizeUrl(e.f.value);
  if (!url) { copySel(); return; }
  recordRecent(e.key);
  api.call('shell:open', { url });
  api.call('search:hide');
}
