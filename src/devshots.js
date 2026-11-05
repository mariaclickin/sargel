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
  const snap = async (win, name) => {
    for (let i = 0; i < 3; i++) {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
        return;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 500));
        if (i === 2) fs.appendFileSync(path.join(dir, 'log.txt'), `snap ${name} failed: ${e.message}\n`);
      }
    }
  };
  const js = (win, code) => win.webContents.executeJavaScript(`{ ${code} }`, true);
  const log = (m) => fs.appendFileSync(path.join(dir, 'log.txt'), `${m}\n`);
  const id = () => crypto.randomUUID();
  const mode = (m) => `document.querySelector('[data-a="mode"][data-m="${m}"]').click()`;

  try {
    await wait(1800);
    const sb = ctx.sidebar();
    const tr = ctx.tracker();
    await snap(tr, '01-handle-pink');

    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    await ctx.createVault('personal', vdir, 'test-pass-123', false);
    await wait(600);

    // history in the OLD format (sessions with a name only) — checks the grouping into blocks
    const v = ctx.vaults.personal;
    const now = new Date();
    const names = ['כתיבת מאמר', 'עמוד נחיתה ARDIV', 'קורס עיצוב', 'פרויקט אישי'];
    for (let back = 1; back < 40; back++) {
      if (back % 5 === 3) continue;
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 9, 0);
      let t = d.getTime();
      let left = [30, 70, 150, 260, 400][(back * 7) % 5];
      let i = back;
      while (left > 0) {
        const len = Math.min(left, 50 + (i % 3) * 20);
        v.data.sessions.push({ id: id(), name: names[i % names.length], start: t, end: t + len * 60000, machine: ctx.activity().machine, updatedAt: Date.now() });
        t += (len + 10) * 60000;
        left -= len;
        i++;
      }
    }
    const today = dateKey();
    v.data.tchecks.push(
      { id: id(), text: 'לשלוח הצעת מחיר לחנות פרחים', done: true, doneAt: Date.now(), date: today, order: 0, updatedAt: Date.now() },
      { id: id(), text: 'להתקשר לרונית', done: false, date: today, order: 1, updatedAt: Date.now() },
    );
    await v.save();
    ctx.lockAll();
    await ctx.unlockPersonal('test-pass-123'); // runs the grouping of old sessions into blocks
    await wait(400);

    const vb = v.data;
    log(`blocks after migration: ${vb.tblocks.filter((b) => !b.deleted).map((b) => b.name).join(' | ')}`);
    log(`sessions without block: ${vb.sessions.filter((s) => !s.deleted && !s.blockId).length}`);

    // a big block broken into steps; work on step 1, finish 1 and 2 → should be on step 3
    const art = vb.tblocks.find((b) => b.name === 'כתיבת מאמר');
    for (const t of ['מחקר מילות מפתח', 'שלד כותרות', 'כתיבת טיוטה', 'תמונות + אלטים', 'העלאה לוורדפרס']) ctx.trk.addSub({ blockId: art.id, text: t });
    const steps = vb.tsubs.filter((x) => x.blockId === art.id);
    ctx.trk.startBlock({ blockId: art.id, subId: steps[0].id });
    ctx.trk.toggleSub({ id: steps[0].id });
    ctx.trk.toggleSub({ id: steps[1].id });
    // give it some time today so the screens have numbers
    const run = vb.sessions.find((s) => !s.end);
    run.start = Date.now() - 38 * 60000;
    vb.sessions.push({ id: id(), name: art.name, blockId: art.id, subId: steps[0].id, start: Date.now() - 3 * 3600000, end: Date.now() - 2 * 3600000, updatedAt: Date.now() });
    await v.save();
    ctx.broadcast();
    const act = vb.tstate.find((x) => x.id === 'active');
    log(`running step: ${(vb.tsubs.find((x) => x.id === act.subId) || {}).text}`);

    ctx.setExpanded(true, { explicit: true }, 'tracker');
    ctx.tstate.pinned = true;
    await wait(700);
    await js(tr, mode('blocks'));
    await wait(500);
    await snap(tr, '02-blocks-steps');
    await js(tr, `document.querySelector('[data-a="blk-filter"][data-f="open"]').click()`);
    await js(tr, mode('month'));
    await wait(500);
    await snap(tr, '03-month-babypink');
    await js(tr, mode('checks'));
    await wait(400);
    await snap(tr, '04-checklist');

    // hotkey: pause → resume
    const isRunning = () => !!(vb.tstate.find((x) => x.id === 'active') || {}).sessionId;
    const r1 = ctx.trk.blockToggleWithToast();
    await wait(500);
    await snap(ctx.toastWin(), '05-toast-paused');
    const r2 = ctx.trk.blockToggleWithToast();
    log(`hotkey: ${r1.done} → running=${isRunning() === true ? 'after resume yes' : 'no'}; second: ${r2.done}`);
    // a keyboard button that starts a specific block (here: "קורס עיצוב"), then the same button pauses it
    const course = vb.tblocks.find((b) => b.name === 'קורס עיצוב');
    const { id: lid } = ctx.trk.saveLauncher({ launcher: { key: 'M', title: 'קורס', type: 'block', target: course.id, icon: 'play', color: 'pink' } });
    await ctx.trk.runLauncher({ id: lid });
    const a1 = vb.tstate.find((x) => x.id === 'active');
    log(`launcher M: running block = ${(vb.tblocks.find((b) => b.id === a1.blockId) || {}).name}, running=${isRunning()}`);
    await ctx.trk.runLauncher({ id: lid });
    log(`launcher M again: running=${isRunning()}`);
    await wait(300);

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
