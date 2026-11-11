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
  const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dateKey(d); };

  try {
    await wait(1800);
    const tr = ctx.journal();
    await snap(ctx.sidebar(), 'h-sidebar'); await snap(ctx.tracker(), 'h-tracker'); await snap(tr, 'h-journal');
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);
    await wait(500);
    const v = ctx.vaults.personal;
    const now = Date.now();

    // reading: every day for the last 23 days except one (→ frozen), not yet today
    for (let i = 1; i <= 23; i++) if (i !== 6) v.data.readlog.push({ id: back(i), date: back(i), pages: 10, updatedAt: now });
    v.data.books.push(
      { id: id(), title: 'הרגלים אטומיים', author: 'ג׳יימס קליר', status: 'reading', pages: 320, page: 142, rating: 0, color: 'pink', startedAt: now - 20 * 864e5, finishedAt: 0, createdAt: now, updatedAt: now },
      { id: id(), title: 'Deep Work', author: 'Cal Newport', status: 'want', pages: 300, page: 0, rating: 0, color: 'blue', startedAt: 0, finishedAt: 0, createdAt: now, updatedAt: now - 1 },
      { id: id(), title: 'הארי פוטר', author: '', status: 'done', pages: 400, page: 400, rating: 5, color: 'amber', startedAt: now - 90 * 864e5, finishedAt: now - 30 * 864e5, createdAt: now, updatedAt: now - 2 },
    );
    // workouts: 3+ a week for the past weeks, 2 this week
    const types = ['פילאטיס', 'הליכה', 'חדר כושר'];
    const dow = new Date().getDay();
    for (let w = 1; w <= 7; w++) for (let k = 0; k < (w === 3 ? 1 : 3); k++) v.data.workouts.push({ id: id(), date: back(dow + 7 * (w - 1) + 1 + k * 2), type: types[(w + k) % 3], minutes: 45, createdAt: now, updatedAt: now });
    if (dow >= 1) v.data.workouts.push({ id: id(), date: back(0), type: 'פילאטיס', minutes: 50, createdAt: now, updatedAt: now });
    v.data.workouts.push({ id: id(), date: back(Math.min(dow, 1)), type: 'הליכה', minutes: 30, createdAt: now, updatedAt: now });
    // learning: a course with its own block + 1:20 this week
    const blk = { id: id(), name: '🎓 קורס פיגמה', done: false, doneAt: 0, createdAt: now, order: 0, updatedAt: now };
    v.data.tblocks.push(blk);
    v.data.sessions.push({ id: id(), name: blk.name, blockId: blk.id, subId: '', start: now - 3 * 3600e3, end: now - 3 * 3600e3 + 80 * 60e3, updatedAt: now });
    v.data.courses.push({ id: id(), title: 'קורס פיגמה', kind: 'course', total: 20, done: 7, current: 'Auto Layout', blockId: blk.id, status: 'active', color: 'purple', startedAt: now - 25 * 864e5, createdAt: now, updatedAt: now });
    // dates
    const md = (n) => { const d = new Date(now + n * 864e5); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    v.data.jdates.push(
      { id: id(), title: 'יום הולדת לאמא', emoji: '🎂', md: md(6), year: '', yearly: true, remind: 2, createdAt: now, updatedAt: now },
      { id: id(), title: 'חידוש ביטוח רכב', emoji: '🚗', md: md(23), year: '', yearly: true, remind: 7, createdAt: now, updatedAt: now },
      { id: id(), title: 'רופא שיניים', emoji: '🦷', md: md(1), year: String(new Date(now + 864e5).getFullYear()), yearly: false, remind: 1, createdAt: now, updatedAt: now },
    );
    await v.save();
    ctx.lockAll();
    await ctx.unlockPersonal('test-pass-123'); // seeds the 30 starter quotes
    await wait(500);
    log(`quotes after unlock: ${v.data.quotes.length} (starter: ${v.data.quotes.filter((q) => q.starter).length})`);

    ctx.setExpanded(true, { explicit: true }, 'journal');
    ctx.jstate.pinned = true;
    await wait(700);

    await wait(400);
    for (const m of ['books', 'workouts', 'learning', 'dates', 'quotes']) {
      await js(tr, `document.querySelector('[data-a="jmode"][data-m="${m}"]').click()`);
      await wait(450);
      await snap(tr, `j-${m}`);
    }
    // read today through the UI → streak goes up
    await js(tr, `document.querySelector('[data-a="jmode"][data-m="books"]').click()`);
    await wait(300);
    await js(tr, `document.querySelector('[data-a="j-readtoday"]').click()`);
    await wait(700);
    await snap(tr, 'j-books-after-read');
    log(`read today logged: ${v.data.readlog.some((r) => r.date === dateKey() && !r.deleted)}`);
    // a quote from a book
    await js(tr, `document.querySelector('[data-a="j-quote-book"]').click()`);
    await wait(400);
    await js(tr, `document.querySelector('.q-t').value = 'אתה לא עולה לרמת המטרות שלך, אתה יורד לרמת המערכות שלך.'; document.querySelector('.q-p').value = '27'; document.querySelector('.m-save').click()`);
    await wait(600);
    const bq = v.data.quotes.find((q) => q.bookId);
    log(`book quote: ${bq ? `${bq.source} | ${bq.category}` : 'missing'}`);
    // the pink panel no longer has the journal tab; the three handles are stacked
    ctx.jstate.pinned = false;
    ctx.setExpanded(true, { explicit: true }, 'tracker');
    ctx.tstate.pinned = true;
    await wait(600);
    await snap(ctx.tracker(), 'pink-panel');
    log(`open: sidebar=${ctx.state.expanded} tracker=${ctx.tstate.expanded} journal=${ctx.jstate.expanded}`);
    ctx.tstate.pinned = false;
    ctx.setExpanded(false, {}, 'tracker');
    await wait(300);
    log(`handles y: purple=${ctx.sidebar().getBounds().y} pink=${ctx.tracker().getBounds().y} blue=${ctx.journal().getBounds().y}`);
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
