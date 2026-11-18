'use strict';
/* Development only — scripted check of the office / home switch, the one-row shortcuts and the flat Mac handles. Not packaged. */
const fs = require('fs');
const path = require('path');

module.exports = async function devShots(ctx) {
  const dir = process.env.SARGEL_SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (m) => fs.appendFileSync(path.join(dir, 'log.txt'), `${m}\n`);
  const snap = async (win, name) => {
    for (let i = 0; i < 3; i++) {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG()); return; } catch (e) { await wait(500); if (i === 2) log(`snap ${name} failed: ${e.message}`); }
    }
  };
  const js = (win, code) => win.webContents.executeJavaScript(`{ ${code} }`, true);
  const text = (win, sel) => js(win, `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent?.replace(/\\s+/g, ' ').trim()`);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const line = (parts) => {
    const a = '.'.repeat(1440).split('');
    for (const [from, to, ch] of parts) for (let i = from; i < to; i++) a[i] = ch;
    return a.join('');
  };
  const H = (h, m = 0) => h * 60 + m;

  try {
    await wait(1800);
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);

    for (let i = 0; i < 11; i++) ctx.trk.saveLauncher({ launcher: { type: 'web', title: `קיצור ${i + 1}`, url: 'https://example.com', icon: 'globe', color: ['blue', 'pink', 'green', 'amber'][i % 4], key: String((i % 9) + 1) } });
    ctx.broadcast();
    await wait(300);

    // today: 2h in the morning, a 3h break, then work again until now
    const act = ctx.activity();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    act.day(key(now)).line = line([[H(8, 30), H(10, 30), 'w'], [H(10, 30), H(13, 30), 'b'], [H(13, 30), Math.max(H(13, 31), nowMin), 'w']]);
    act.dirty = true;

    ctx.setExpanded(true, { explicit: true }, 'sidebar');
    await wait(700);
    const sb = ctx.sidebar();
    await js(sb, `setMode('day')`);
    await wait(900);
    log(`office tiles: ${await text(sb, '.stats')}`);
    log(`office banner: ${await text(sb, '#workday')}`);
    log(`shortcuts collapsed: ${await js(sb, `document.querySelectorAll('#launch .lbtn').length + ' buttons, last: ' + document.querySelector('#launch .lbtn:last-child').textContent.replace(/\s+/g, ' ').trim()`)}`);
    log(`switch: ${await text(sb, '.pchip')}`);
    await snap(sb, '01-office');
    await js(sb, `document.querySelector('[data-action="launch-more"]').click()`);
    await wait(400);
    log(`shortcuts open: ${await js(sb, `document.querySelectorAll('#launch .lbtn').length + ' buttons'`)}`);
    await snap(sb, '01b-shortcuts-open');
    await js(sb, `document.querySelector('[data-action="launch-more"]').click()`);
    await wait(400);

    await js(sb, `document.querySelector('[data-action="place"]').click()`);
    await wait(1200);
    log(`after click, switch: ${await text(sb, '.pchip')} · config: ${ctx.cfg().get('workPlace')}`);
    log(`home tiles: ${await text(sb, '.stats')}`);
    log(`home banner: ${await text(sb, '#workday')}`);
    log(`today place on disk: ${act.day(key(now)).place}`);
    await snap(sb, '02-home');

    // settings: handles section
    await js(sb, `openSettings()`);
    await wait(700);
    await snap(sb, '03-settings-handles');
    await js(sb, `document.querySelector('.s-hg').closest('.sec').scrollIntoView()`);
    await wait(300);
    log(`home settings: goal row visible=${await js(sb, `!document.querySelector('.s-hg').closest('.set-row').classList.contains('hidden')`)}, hours row hidden=${await js(sb, `document.querySelector('.s-ws').closest('.set-row').classList.contains('hidden')`)}`);
    await snap(sb, '03b-settings-home');
    await js(sb, `const el = document.querySelector('.s-hg'); el.value = '360'; el.onchange()`);
    await wait(500);
    log(`home goal saved: ${ctx.cfg().get('homeGoal')}`);
    await js(sb, `const el = document.querySelector('.s-journal'); el.checked = false; el.onchange()`);
    await wait(700);
    log(`journal window visible after hiding: ${ctx.journal().isVisible()}`);
    await js(sb, `const el = document.querySelector('.s-journal'); el.checked = true; el.onchange()`);
    await wait(500);
    await js(sb, `closeModal()`);
    await js(sb, `renderWorkday()`);
    await wait(600);
    log(`banner with 6h goal: ${await text(sb, '#workday')}`);

    // back to office for the next run
    await js(sb, `document.querySelector('[data-action="place"]').click()`);
    await wait(800);
    log(`back: ${await text(sb, '.pchip')}`);

    // what the slimmer Mac handle looks like (class only — the window size is set on a real Mac)
    ctx.setExpanded(false, {}, 'sidebar');
    await wait(500);
    for (const w of [ctx.sidebar(), ctx.tracker(), ctx.journal()]) await js(w, `document.documentElement.classList.add('mac')`);
    await wait(300);
    await snap(ctx.sidebar(), '04-mac-handle');
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
