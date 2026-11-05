'use strict';
/* Development only — scripted walk through every screen, saving screenshots. Not packaged. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Vault } = require('./vault');
const { dateKey } = require('./activity');

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
  const id = () => crypto.randomUUID();

  try {
    await wait(1800);
    const sb = ctx.sidebar();
    const tr = ctx.tracker();
    await snap(sb, '01-handle-purple');
    await snap(tr, '02-handle-green');

    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);
    await wait(600);

    // fake history: TIME BLOCKS on many days this month (incl. weekends), checklist, jobs
    const v = ctx.vaults.personal;
    const now = new Date();
    const names = ['כתיבת מאמר', 'מחקר מילות מפתח', 'קורס עיצוב', 'פרויקט אישי'];
    for (let back = 0; back < 40; back++) {
      if (back % 5 === 3) continue;
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 9, 0);
      const mins = [30, 70, 150, 260, 400][(back * 7) % 5];
      let t = d.getTime();
      let left = mins;
      let i = back;
      while (left > 0) {
        const len = Math.min(left, 50 + (i % 3) * 20);
        v.data.sessions.push({ id: id(), name: names[i % names.length], start: t, end: back === 0 && left === len ? 0 : t + len * 60000, machine: ctx.activity().machine, updatedAt: Date.now() });
        t += (len + 10) * 60000;
        left -= len;
        i++;
      }
    }
    const running = v.data.sessions.find((s) => !s.end);
    if (running) {
      running.start = Date.now() - 42 * 60000;
      v.data.tstate.push({ id: 'active', name: running.name, sessionId: running.id, updatedAt: Date.now() });
    }
    const today = dateKey();
    const yest = dateKey(new Date(Date.now() - 864e5));
    v.data.tchecks.push(
      { id: id(), text: 'לשלוח הצעת מחיר לחנות פרחים', done: true, doneAt: Date.now(), date: today, order: 0, updatedAt: Date.now() },
      { id: id(), text: 'לעדכן מטא דיסקריפשן – ARDIV', done: false, date: yest, order: 1, updatedAt: Date.now() },
      { id: id(), text: 'להתקשר לרונית', done: false, date: today, order: 2, updatedAt: Date.now() },
    );
    v.data.jobs.push(
      { id: id(), title: 'מאמרי SEO נובמבר – envirogreen', kind: 'job', status: 1, due: dateKey(new Date(Date.now() + 5 * 864e5)), note: '', updatedAt: Date.now() },
      { id: id(), title: 'תיקון לוגו בהדר – ARDIV', kind: 'job', status: 1, due: dateKey(new Date(Date.now() - 864e5)), note: 'הלקוח שלח קובץ SVG', updatedAt: Date.now() },
      { id: id(), title: 'מכון כושר בחולון', kind: 'lead', status: 1, due: '', note: 'שיחה שנייה ביום א׳', updatedAt: Date.now() },
      { id: id(), title: 'מספרה בחולון', kind: 'lead', status: 0, due: '', note: '', updatedAt: Date.now() },
    );
    await v.save();
    ctx.lockAll();
    await ctx.unlockPersonal('test-pass-123'); // runs carry-over of yesterday's checklist
    await wait(400);

    ctx.state.pinned = false;
    ctx.setExpanded(true, { explicit: true }, 'tracker');
    ctx.tstate.pinned = true;
    await wait(700);
    await js(tr, `document.querySelector('[data-a="mode"][data-m="month"]').click()`);
    await wait(400);
    await snap(tr, '03-month');
    await js(tr, `document.querySelector('[data-a="mode"][data-m="checks"]').click()`);
    await wait(400);
    await snap(tr, '04-checklist');
    await js(tr, `document.querySelector('[data-a="mode"][data-m="blocks"]').click()`);
    await wait(500);
    await snap(tr, '05-time-blocks');
    await js(tr, `document.querySelector('[data-a="mode"][data-m="jobs"]').click()`);
    await wait(400);
    await snap(tr, '06-jobs');
    await js(tr, `document.querySelector('[data-a="job-open"]').click()`);
    await wait(400);
    await snap(tr, '07-job-editor');
    log(`carried: ${v.data.tchecks.filter((c) => c.carried).map((c) => `${c.text}→${c.date}`).join(', ')}`);
    log(`sessions: ${v.data.sessions.length}, running: ${!!(v.data.tstate[0] && v.data.tstate[0].sessionId)}`);

    // opening the purple one closes the green one
    ctx.tstate.pinned = false;
    ctx.setExpanded(true, { explicit: true }, 'sidebar');
    await wait(400);
    log(`after opening sidebar: sidebar=${ctx.state.expanded} tracker=${ctx.tstate.expanded}`);
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
