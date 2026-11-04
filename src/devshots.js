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
    ctx.state.pinned = true;

    // a vault like one made with v0.1.0 — checks the one-time upgrade still works
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    const now = Date.now();
    const t = (name, icon, order) => ({ id: id(), name, icon, order, updatedAt: now });
    const tabs = [t('נושאים ומיילים', '✉️', 0), t('לקוחות', '👥', 1), t('גישות', '🔑', 2), t('קישורים', '🔗', 3)];
    const it = (title, value, color, icon) => ({ id: id(), tabId: tabs[0].id, title, order: 0, updatedAt: now, color, icon, fields: [{ id: id(), label: '', kind: 'text', value }] });
    const file = path.join(vdir, 'sargel-personal.sargel');
    await Vault.create(file, 'test-pass-123', {
      schema: 1, tabs,
      items: [
        it('דוגמה — לחיצה מעתיקה אותי', 'שלום, תודה על פנייתך!', 'blue', 'mail'),
        it('נורית - לשלוח מאמרים בווטסאפ', 'לשלוח את 3 המאמרים', 'pink', 'send'),
        it('לבדוק נושאים – דרורית', 'רשימת נושאים לחודש הבא', 'amber', 'checklist'),
        it('מספר עוסק', '514000000', '', ''),
      ],
      settings: { updatedAt: now },
    });

    // fake activity for today: 08:52–10:30 work, 12 min break, …
    const act = ctx.activity();
    const key = dateKey();
    const d = act.day(key);
    const a = d.line.split('');
    const fill = (from, to, ch) => { for (let i = from; i < to; i++) a[i] = ch; };
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const cap = (m) => Math.min(m, nowMin);
    fill(532, cap(630), 'w'); fill(cap(630), cap(642), 'b'); fill(cap(642), cap(760), 'w'); fill(cap(760), cap(790), 'b');
    fill(cap(790), cap(880), 'w'); fill(cap(880), cap(892), 'o'); fill(cap(892), cap(960), 'w');
    d.line = a.join('');
    d.water = 3;
    act.touch(d);

    await ctx.openVault('personal', file, 'test-pass-123', false);
    ctx.setExpanded(true, { explicit: true });
    await wait(900);
    await js(sb, `localStorage.setItem('mode','items')`);
    await js(sb, `document.querySelector('[data-action="mode"][data-mode="items"]').click()`);
    await js(sb, `document.querySelectorAll('.tab[data-id]')[1].click()`);
    await wait(300);
    // mark the Nurit item done through the real button
    await js(sb, `document.querySelectorAll('.item [data-action="toggle-done"]')[1].click()`);
    await wait(700);
    await snap(sb, '01-items-colored-done');

    // notes
    ctx.vaults.personal.data.notes.push(
      { id: id(), title: 'להיום', text: '', checklist: true, pinned: true, color: 'amber', updatedAt: now + 3, checks: [{ id: id(), text: 'לשלוח לנורית מאמרים', done: true }, { id: id(), text: 'לבדוק נושאים – דרורית', done: false }, { id: id(), text: 'חשבונית לספק', done: false }] },
      { id: id(), title: 'רעיון לפוסט', text: '5 טעויות SEO שכל עסק קטן עושה', checklist: false, checks: [], color: 'blue', pinned: false, updatedAt: now + 2 },
      { id: id(), title: 'טלפון מהיר', text: 'רונית – 052-0000000\nלחזור אחרי 14:00', checklist: false, checks: [], color: 'green', pinned: false, updatedAt: now + 1 },
      { id: id(), title: '', text: 'לזכור: פגישה ביום ה׳ 10:30', checklist: false, checks: [], color: 'pink', pinned: false, updatedAt: now },
      { id: id(), title: 'וויפי משרד', text: 'בגישות › משרד', checklist: false, checks: [], color: '', pinned: false, updatedAt: now - 1 },
    );
    ctx.broadcast();
    await js(sb, `document.querySelector('[data-action="mode"][data-mode="notes"]').click()`);
    await wait(500);
    await snap(sb, '02-notes');
    await js(sb, `document.querySelector('.note').click()`);
    await wait(500);
    await snap(sb, '03-note-editor');
    await js(sb, `document.querySelector('.m-cancel').click()`);

    await js(sb, `document.querySelector('[data-action="mode"][data-mode="day"]').click()`);
    await wait(900);
    await snap(sb, '04-my-day');

    await js(sb, `document.querySelector('[data-action="mode"][data-mode="items"]').click(); document.querySelector('[data-action="settings"]').click()`);
    await wait(500);
    await js(sb, `document.querySelector('.s-ws').closest('.sec').scrollIntoView()`);
    await wait(300);
    await snap(sb, '05-settings');
    await js(sb, `document.querySelector('.m-close').click()`);

    ctx.showQuick();
    await wait(600);
    await js(ctx.quick(), `document.getElementById('t').value='לחזור לרונית אחרי 14:00 לגבי ההצעה'`);
    await wait(200);
    await snap(ctx.quick(), '06-quick-note');

    ctx.showToast({ kind: 'hour', title: 'שעה 3 מתוך 8 הושלמה', body: '37% מהיום · נשארו 5 שעות', water: true, waterText: '💧 זמן לכוס מים · 3/8 היום' });
    await wait(700);
    await snap(ctx.toastWin(), '07-hour-toast');

    const st = ctx.vaults.personal.data;
    log(`items done: ${st.items.filter((x) => x.done).map((x) => x.title).join(', ')}`);
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
