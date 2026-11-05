'use strict';
/* Corner popup: "hour 3 of 8 done", water reminder, end of day */
const n = $('#n');

api.on('toast:show', (p) => {
  n.className = `ntf k-${p.kind}`;
  n.innerHTML = `
    <div class="ntf-top">${LOGO}<span>הסרגל · עכשיו</span><span class="spacer"></span><button class="icon-btn sm" data-a="close" title="סגירה">${icon('x')}</button></div>
    <div class="ntf-title">${esc(p.title)}</div>
    <div class="ntf-body">${esc(p.body)}</div>
    ${p.water && p.waterText ? `<div class="ntf-body">${esc(p.waterText)}</div>` : ''}
    ${p.quiet ? '' : `<div class="ntf-actions">
      ${p.water ? `<button class="primary sm" data-a="water">${icon('droplet')} שתיתי</button>` : ''}
      <button class="ghost sm" data-a="close">${p.water ? 'אחר כך' : 'סגירה'}</button>
    </div>`}`;
  void n.offsetWidth;
  n.classList.add('in');
});

n.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  if (b.dataset.a === 'water') api.call('toast:water');
  else api.call('toast:close');
});
