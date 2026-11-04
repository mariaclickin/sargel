'use strict';
/* Quick note — hotkey from anywhere, type, Enter saves to the Notes area */

let S = null;
let color = '';
const card = $('#card');

api.on('state', (s) => { const was = S && S.vaults.personal.unlocked; S = s; if (!was && s.vaults.personal.unlocked) render(); });
api.on('quick:open', (s) => { if (s) S = s; color = ''; render(); });
(async () => { const r = await api.call('state:get'); S = r.state; render(); })();

document.body.addEventListener('mousedown', (e) => { if (!card.contains(e.target)) api.call('quick:hide'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); api.call('quick:hide'); } });

function render() {
  if (!S) return;
  if (!S.vaults.personal.unlocked) {
    card.innerHTML = `
      <form class="spot-input" id="f">${icon('lock')}
        <input id="pw" type="password" placeholder="${S.vaults.personal.configured ? 'הסרגל נעול — סיסמה ראשית ו-Enter' : 'קודם צריך להגדיר את הסרגל'}" ${S.vaults.personal.configured ? '' : 'disabled'}>
        <kbd>Esc</kbd></form><div class="spot-msg err"></div>`;
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api.call('vault:unlock', { password: $('#pw').value });
      if (!r.ok) { $('.spot-msg').textContent = errText(r); $('#pw').select(); }
    });
    setTimeout(() => $('#pw') && $('#pw').focus(), 20);
    return;
  }
  card.innerHTML = `
    <div class="qn-head">${icon('note')}<b>פתק חדש</b><span class="spacer"></span><kbd>Esc</kbd></div>
    <textarea id="t" placeholder="מה לרשום?" dir="auto"></textarea>
    <div class="qn-foot">
      <div class="swatches qn-sw"></div>
      <span class="spacer"></span>
      <span class="muted small" title="Shift+Enter = שורה חדשה">Enter = שמירה</span>
    </div>`;
  const drawSw = () => {
    $('.qn-sw').innerHTML = `<button class="swatch none ${!color ? 'on' : ''}" data-c="" title="בלי צבע">${icon('x')}</button>`
      + Object.entries(COLORS).map(([k, [n, hex]]) => `<button class="swatch ${color === k ? 'on' : ''}" data-c="${k}" title="${n}" style="--c:${hex}"></button>`).join('');
  };
  drawSw();
  $('.qn-sw').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { color = b.dataset.c; drawSw(); $('#t').focus(); } };
  const t = $('#t');
  t.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const text = t.value.trim();
    if (!text) return;
    const lines = text.split('\n');
    const title = lines.length > 1 ? lines[0].slice(0, 120) : '';
    const body = lines.length > 1 ? lines.slice(1).join('\n') : text;
    const r = await api.call('notes:save', { note: { title, text: body, color } });
    if (!r.ok) { toast(errText(r), 'warn'); return; }
    card.classList.add('saved');
    setTimeout(() => { card.classList.remove('saved'); api.call('quick:hide'); }, 250);
  });
  setTimeout(() => t.focus(), 30);
}
