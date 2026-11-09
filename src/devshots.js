'use strict';
/* Development only — scripted walk through every screen, saving screenshots. Not packaged. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dateKey } = require('./activity');

module.exports = async function devShots(ctx) {
  const dir = process.env.SARGEL_SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (m) => fs.appendFileSync(path.join(dir, 'log.txt'), `${m}\n`);
  const snap = async (win, name) => {
    for (let i = 0; i < 3; i++) {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
        return;
      } catch (e) {
        await wait(500);
        if (i === 2) log(`snap ${name} failed: ${e.message}`);
      }
    }
  };
  const js = (win, code) => win.webContents.executeJavaScript(`{ ${code} }`, true);
  const id = () => crypto.randomUUID();
  const H = (h, m = 0) => h * 60 + m;

  try {
    await wait(1800);
    const sb = ctx.sidebar();
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);
    await wait(500);

    // this week's activity (Sun..today): early arrival today, overtime Sunday, a long evening on Monday
    const act = ctx.activity();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const setDay = (date, parts) => {
      const d = act.day(dateKey(date));
      const a = '.'.repeat(1440).split('');
      for (const [f, t, ch] of parts) for (let i = f; i < t; i++) a[i] = ch;
      d.line = a.join('');
      act.touch(d);
    };
    const back = (n) => { const d = new Date(now); d.setDate(now.getDate() - n); return d; };
    const dow = now.getDay();
    if (dow >= 1) setDay(back(dow), [[H(8, 50), H(12, 30), 'w'], [H(12, 30), H(13), 'b'], [H(13), H(17, 45), 'w']]); // Sunday: 8:55 → overtime
    if (dow >= 2) setDay(back(dow - 1), [[H(9), H(19, 40), 'w']]); // Monday: computer left on — fixed manually below
    const cap = (m) => Math.min(m, nowMin);
    setDay(now, [[H(8, 30), cap(H(9, 55)), 'w'], [cap(H(9, 55)), cap(H(10)), 'b'], [cap(H(10)), cap(H(12)), 'w'], [cap(H(12)), cap(H(12, 27)), 'b'], [cap(H(12, 27)), cap(H(15)), 'w']]);
    act.day(dateKey(now)).water = 2;

    // a manual fix for Monday and a vacation for tomorrow (or Tuesday)
    const v = ctx.vaults.personal.data;
    if (dow >= 2) v.dayfix.push({ id: dateKey(back(dow - 1)), date: dateKey(back(dow - 1)), type: 'work', arrive: '09:00', leave: '17:00', breaks: null, note: 'המחשב נשאר פתוח', updatedAt: Date.now() });
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    v.dayfix.push({ id: dateKey(tomorrow), date: dateKey(tomorrow), type: 'vac', arrive: '', leave: '', breaks: null, note: '', updatedAt: Date.now() });

    // notes for the drag test
    const mk = (title, color, pinned, createdAt) => ({ id: id(), title, text: '', checklist: false, checks: [], color, pinned, createdAt, updatedAt: createdAt });
    v.notes.push(mk('להיום', 'amber', true, 5), mk('רעיון לפוסט', 'blue', false, 4), mk('טלפון מהיר', 'green', false, 3), mk('לזכור', 'pink', false, 2), mk('וויפי משרד', '', false, 1));
    ctx.broadcast();

    ctx.state.pinned = true;
    ctx.setExpanded(true, { explicit: true });
    await wait(700);
    await js(sb, `document.querySelector('[data-action="mode"][data-mode="day"]').click()`);
    await wait(900);
    await snap(sb, '01-my-day');
    const sum = (await ctx.activitySummary());
    log(`today total=${sum.today.workday.total} early=${sum.today.workday.early} overtime=${sum.today.workday.overtime} focus=${sum.today.focus.len}`);
    log(`week: ${sum.week.map((d) => `${d.dow}:${d.total}${d.off ? `(${d.off})` : ''}${d.fixed ? '✎' : ''}`).join(' ')} | weekTotal=${sum.weekTotal}/${sum.weekTarget} monthOver=${sum.monthOver}`);

    await js(sb, `document.querySelector('.day-track').scrollIntoView(); document.getElementById('day').scrollTop = 9999`);
    await wait(300);
    await snap(sb, '02-my-day-week');

    await js(sb, `document.querySelectorAll('.wk2')[${dow >= 1 ? 1 : 0}].click()`);
    await wait(700);
    await snap(sb, '03-day-edit');
    await js(sb, `document.querySelector('.m-cancel').click()`);

    // notes: move "וויפי משרד" (last) onto "רעיון לפוסט" (first regular)
    await js(sb, `document.querySelector('[data-action="mode"][data-mode="notes"]').click()`);
    await wait(400);
    const order = () => ctx.vaults.personal.data.notes.filter((n) => !n.deleted && !n.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((n) => n.title).join(' > ');
    await js(sb, `
      const ns = [...document.querySelectorAll('.note')];
      const src = ns.find((n) => n.textContent.includes('וויפי'));
      const dst = ns.find((n) => n.textContent.includes('רעיון'));
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
    await wait(700);
    log(`notes after drag: ${order()}`);
    await snap(sb, '04-notes-after-drag');
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
