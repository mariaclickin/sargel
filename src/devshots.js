'use strict';
/* Development only — scripted check of the end-of-day confetti. Not packaged. */
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

  try {
    await wait(1800);
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);

    // the celebration itself
    ctx.celebrate();
    await wait(900);
    const w = ctx.confettiWin();
    log(`confetti window: ${w ? `visible=${w.isVisible()} bounds=${JSON.stringify(w.getBounds())} focusable=${w.isFocusable()}` : 'none'}`);
    log(`confetti loaded: ${w ? await js(w, 'typeof window.confetti') : '-'}`);
    if (w) await snap(w, '01-confetti');
    await wait(5500);
    log(`after 6.4s the window is gone: ${!ctx.confettiWin()}`);

    // settings: the checkbox (turning it on previews it)
    ctx.setExpanded(true, { explicit: true }, 'sidebar');
    await wait(700);
    const sb = ctx.sidebar();
    await js(sb, 'openSettings()');
    await wait(700);
    await js(sb, "document.querySelector('.s-confetti').closest('.sec').scrollIntoView()");
    await wait(300);
    log(`checkbox: ${await js(sb, "document.querySelector('.s-confetti').checked + ' · ' + document.querySelector('.s-confetti').closest('label').textContent.replace(/\\s+/g, ' ').trim()")}`);
    await snap(sb, '02-settings');
    await js(sb, "const el = document.querySelector('.s-confetti'); el.checked = false; el.onchange()");
    await wait(400);
    log(`off saved: ${ctx.cfg().get('confetti')}`);
    await js(sb, "const el = document.querySelector('.s-confetti'); el.checked = true; el.onchange()");
    await wait(900);
    log(`on again → preview shown: ${!!ctx.confettiWin()} · saved: ${ctx.cfg().get('confetti')}`);
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
