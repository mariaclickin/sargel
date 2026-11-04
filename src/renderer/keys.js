'use strict';
/* Shortcut keyboard overlay: hotkey → keyboard pops up → press a key → it runs */

let S = null;
let busy = false;
const card = $('#card');

api.on('state', (s) => { S = s; render(); });
api.on('keys:open', (s) => { if (s) S = s; busy = false; render(); });
(async () => { const r = await api.call('state:get'); S = r.state; render(); })();

document.body.addEventListener('mousedown', (e) => { if (!card.contains(e.target)) api.call('keys:hide'); });

function render() {
  if (!S) return;
  if (!S.vaults.personal.unlocked) {
    card.innerHTML = `
      <form class="spot-input" id="f">${icon('lock')}
        <input id="pw" type="password" placeholder="${S.vaults.personal.configured ? 'הסרגל נעול — סיסמה ראשית ו-Enter' : 'קודם צריך להגדיר את הסרגל (בצד המסך)'}" ${S.vaults.personal.configured ? '' : 'disabled'}>
        <kbd>Esc</kbd></form><div class="spot-msg err"></div>`;
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api.call('vault:unlock', { password: $('#pw').value });
      if (!r.ok) { $('.spot-msg').textContent = errText(r); $('#pw').select(); }
    });
    setTimeout(() => $('#pw') && $('#pw').focus(), 20);
    return;
  }
  const n = S.data.launchers.filter((l) => l.key).length;
  card.innerHTML = `
    <div class="keys-head">${icon('keyboard')}<b>מקלדת קיצורים</b>
      <span class="muted small">${n ? 'לוחצים על מקש כדי להפעיל' : 'עוד לא הוגדרו מקשים — לוחצים על מקש כדי להגדיר'}</span>
      <span class="spacer"></span><kbd>Esc</kbd></div>
    <div class="keys-body-in">${keyboardHTML(S.data.launchers)}</div>
    <div class="spot-foot"><span>מקש פנוי = הגדרה חדשה</span><span>קליק ימני על מקש = עריכה</span></div>`;
  card.tabIndex = -1;
  setTimeout(() => card.focus(), 20);
}

async function press(k, edit) {
  if (busy || !S || !S.vaults.personal.unlocked) return;
  const l = S.data.launchers.find((x) => x.key === k);
  if (!l || edit) { api.call('keys:openEditor', { key: k }); return; }
  busy = true;
  const el = $(`.key[data-key="${k}"]`);
  if (el) el.classList.add('pressed');
  const r = await api.call('launch:run', { id: l.id });
  if (!r.ok) {
    busy = false;
    if (el) el.classList.remove('pressed');
    const foot = $('.spot-foot');
    if (foot) foot.innerHTML = `<span class="err">${esc(r.code === 'NOT_FOUND' ? 'הקובץ או התיקייה לא נמצאו' : errText(r))}</span>`;
    return;
  }
  if (r.done === 'copied') recordRecent(`${l.itemId}:${l.fieldId}`);
  setTimeout(() => { busy = false; api.call('keys:hide'); }, 180);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.call('keys:hide'); return; }
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = keyFromCode(e.code);
  if (k) { e.preventDefault(); press(k, false); }
});

card.addEventListener('click', (e) => {
  const b = e.target.closest('.key');
  if (b) press(b.dataset.key, false);
});
card.addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.key');
  if (b) { e.preventDefault(); press(b.dataset.key, true); }
});
