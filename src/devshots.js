'use strict';
/* Development only — scripted check of the switch tabs between the three panels. Not packaged. */
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

    // open the pink panel: the purple and blue tabs should stick out of its side
    ctx.setExpanded(true, { explicit: true }, 'tracker');
    await wait(700);
    const tabs = await js(ctx.tracker(), `[...document.querySelectorAll('.swtab')].map((t) => t.dataset.to + '@' + t.getBoundingClientRect().top + ':' + getComputedStyle(t).display).join(' ')`);
    log(`tabs in pink panel: ${tabs}`);
    await snap(ctx.tracker(), '01-pink-with-tabs');
    // hover the blue tab (simulated) → after a short rest it switches
    await js(ctx.tracker(), `document.querySelector('.swtab[data-to="journal"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    await wait(1300);
    log(`after hovering blue tab: ${openNow()}`);
    await snap(ctx.journal(), '02-blue-after-switch');
    // click the purple tab from the blue panel
    await js(ctx.journal(), `document.querySelector('.swtab[data-to="sidebar"]').click()`);
    await wait(800);
    log(`after clicking purple tab: ${openNow()}`);
    await snap(ctx.sidebar(), '03-purple-after-switch');
    log(`window width open: ${ctx.sidebar().getBounds().width}`);
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
