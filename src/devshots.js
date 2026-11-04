'use strict';
/* Development only — scripted walk through every screen, saving screenshots. Not packaged. */
const fs = require('fs');
const path = require('path');

module.exports = async function devShots(ctx) {
  const dir = process.env.SARGEL_SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };
  const js = (win, code) => win.webContents.executeJavaScript(`{ ${code} }`, true);
  const log = (m) => fs.appendFileSync(path.join(dir, 'log.txt'), `${m}\n`);

  try {
    await wait(1800);
    const sb = ctx.sidebar();
    ctx.state.pinned = false;
    ctx.setExpanded(false);
    await wait(400);
    await snap(sb, '01-handle');

    ctx.state.pinned = true;
    ctx.setExpanded(true, { explicit: true });
    await wait(600);
    await snap(sb, '02-onboarding');

    await js(sb, `document.querySelector('[data-go="create"]').click()`);
    await wait(700);
    await snap(sb, '03-create');

    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);
    await wait(700);
    await snap(sb, '04-main');

    await js(sb, `document.querySelectorAll('.tab[data-id]')[1].click()`);
    await wait(250);
    await js(sb, `document.querySelector('.item.multi .row').click()`);
    await wait(400);
    await snap(sb, '05-multi');

    await js(sb, `document.querySelector('.item.multi [data-action="edit-item"]').click()`);
    await wait(500);
    await snap(sb, '06-editor');

    await js(sb, `document.querySelector('.m-cancel').click(); document.querySelector('[data-action="add-tab"]').click()`);
    await wait(500);
    await snap(sb, '07-tab-editor');

    await js(sb, `document.querySelector('.m-cancel').click(); document.querySelector('[data-action="settings"]').click()`);
    await wait(500);
    await snap(sb, '08-settings');

    await js(sb, `document.querySelector('.m-close').click(); const q=document.getElementById('q'); q.value='לקוח'; q.dispatchEvent(new Event('input'))`);
    await wait(400);
    await snap(sb, '09-sidebar-search');
    await js(sb, `const q=document.getElementById('q'); q.value=''; q.dispatchEvent(new Event('input'))`);

    ctx.lockAll();
    await wait(600);
    await snap(sb, '10-lock');

    await ctx.unlockPersonal('test-pass-123');
    await wait(300);
    ctx.showSearch();
    await wait(600);
    await snap(ctx.search(), '11-search-empty');
    await js(ctx.search(), `const i=document.getElementById('sq'); i.value='לקוח'; i.dispatchEvent(new Event('input'))`);
    await wait(400);
    await snap(ctx.search(), '12-search-query');
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
