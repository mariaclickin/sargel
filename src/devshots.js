'use strict';
/* Development only — scripted check of "My day": paging back through weeks + per-day averages. Not packaged. */
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
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // a day of work from `from` to `to` (minutes) with one break
  const line = (from, to, bFrom, bLen) => {
    const a = '.'.repeat(1440).split('');
    for (let i = from; i < to; i++) a[i] = 'w';
    for (let i = bFrom; i < bFrom + bLen; i++) a[i] = 'b';
    return a.join('');
  };

  try {
    await wait(1800);
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);

    // sample history: the last 3 weeks, Sunday–Thursday
    const act = ctx.activity();
    const now = new Date();
    for (let back = 1; back <= 21; back++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      if (d.getDay() > 4) continue;
      const start = 8 * 60 + 30 + (back % 3) * 10;
      const end = 17 * 60 + (back % 4) * 15;
      act.day(key(d)).line = line(start, end, 13 * 60, 30 + (back % 5) * 5);
    }
    act.dirty = true;
    await wait(300);

    ctx.setExpanded(true, { explicit: true }, 'sidebar');
    await wait(700);
    await js(ctx.sidebar(), `setMode('day')`);
    await wait(900);
    const sb = ctx.sidebar();
    await js(sb, `document.querySelector('.wk-nav')?.scrollIntoView()`);
    await wait(300);
    log(`this week: ${JSON.stringify(ctx.activitySummary({ weekOffset: 0 }).weekAvg)}`);
    await snap(sb, '01-this-week');
    await js(sb, `document.querySelector('[data-action="week"][title="שבוע קודם"]').click()`);
    await wait(900);
    await js(sb, `document.querySelector('.wk-nav')?.scrollIntoView()`);
    await wait(300);
    log(`header after back: ${await js(sb, `document.querySelector('.wk-nav').parentElement.textContent.replace(/\\s+/g, ' ').trim()`)}`);
    log(`avg row: ${await js(sb, `document.querySelector('.wk-avg').textContent.replace(/\\s+/g, ' ').trim()`)}`);
    log(`last week: ${JSON.stringify(ctx.activitySummary({ weekOffset: 1 }).weekAvg)}`);
    await snap(sb, '02-last-week');
    await js(sb, `document.querySelector('[data-action="week"][title="שבוע קודם"]').click()`);
    await wait(900);
    await js(sb, `document.querySelector('.wk-nav')?.scrollIntoView()`);
    await wait(300);
    await snap(sb, '03-two-weeks-back');
    await js(sb, `document.querySelector('[data-action="week"][title="שבוע הבא"]').click()`);
    await wait(900);
    await js(sb, `document.querySelector('[data-action="week"][title="שבוע הבא"]').click()`);
    await wait(900);
    log(`back to now: ${await js(sb, `document.querySelector('.wk-nav').parentElement.textContent.replace(/\\s+/g, ' ').trim()`)}`);
    log(`next disabled now: ${await js(sb, `document.querySelector('[data-action="week"][title="שבוע הבא"]').disabled`)}`);

    // settings: hide the breaks average
    await js(sb, `openSettings()`);
    await wait(700);
    await js(sb, `document.querySelector('.s-avgw').closest('.sec').scrollIntoView()`);
    await wait(300);
    await snap(sb, '04-settings');
    await js(sb, `const el = document.querySelector('.s-avgb'); el.checked = false; el.onchange()`);
    await wait(900);
    await js(sb, `closeModal()`);
    await js(sb, `document.querySelector('[data-action="week"][title="שבוע קודם"]').click()`);
    await wait(900);
    await js(sb, `document.querySelector('.wk-nav')?.scrollIntoView()`);
    await wait(300);
    log(`avg row with breaks hidden: ${await js(sb, `document.querySelector('.wk-avg').textContent.replace(/\\s+/g, ' ').trim()`)}`);
    await snap(sb, '05-only-work-avg');
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
