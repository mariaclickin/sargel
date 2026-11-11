'use strict';
/* Development only — scripted check of the header dots that switch between the three panels. Not packaged. */
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
  const openNow = () => `sidebar=${ctx.state.expanded} tracker=${ctx.tstate.expanded} journal=${ctx.jstate.expanded}`;

  try {
    await wait(1800);
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);
    await wait(500);

    ctx.setExpanded(true, { explicit: true }, 'tracker');
    await wait(700);
    log(`dots in pink: ${await js(ctx.tracker(), `[...document.querySelectorAll('.swdot')].map((d) => d.dataset.to + (d.classList.contains('on') ? '*' : '')).join(' ')`)}`);
    log(`pink window width: ${ctx.tracker().getBounds().width}`);
    await snap(ctx.tracker(), '01-pink-dots');
    await js(ctx.tracker(), `document.querySelector('.swdot[data-to="journal"]').click()`);
    await wait(800);
    log(`after blue dot: ${openNow()}`);
    await snap(ctx.journal(), '02-blue-dots');
    await js(ctx.journal(), `document.querySelector('.swdot[data-to="sidebar"]').click()`);
    await wait(800);
    log(`after purple dot: ${openNow()}`);
    await snap(ctx.sidebar(), '03-purple-dots');
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
