'use strict';
/* Development only — scripted walk through every screen, saving screenshots. Not packaged. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Vault } = require('./vault');

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
    ctx.setExpanded(true, { explicit: true });
    await wait(600);
    await snap(sb, '01-onboarding');

    // a vault exactly like one made with v0.1.0 — checks the one-time upgrade
    const vdir = path.join(dir, 'vault');
    fs.rmSync(vdir, { recursive: true, force: true });
    const now = Date.now();
    const t = (name, icon, order) => ({ id: id(), name, icon, order, updatedAt: now });
    const tabs = [t('נושאים ומיילים', '✉️', 0), t('לקוחות', '👥', 1), t('גישות', '🔑', 2), t('קישורים', '🔗', 3)];
    const it = (title, value) => ({ id: id(), tabId: tabs[0].id, title, order: 0, updatedAt: now, fields: [{ id: id(), label: '', kind: 'text', value }] });
    const file = path.join(vdir, 'sargel-personal.sargel');
    await Vault.create(file, 'test-pass-123', {
      schema: 1, tabs,
      items: [it('דוגמה — לחיצה מעתיקה אותי', 'שלום, תודה על פנייתך!'), it('לבדוק את הנושאים של דרורית', '.'), it('נורית - לשלוח מאמרים', '.')],
      settings: { updatedAt: now },
    });
    await ctx.openVault('personal', file, 'test-pass-123', false);
    await wait(900);
    const p = ctx.vaults.personal.data;
    log(`tabs after upgrade: ${p.tabs.filter((x) => !x.deleted).sort((a, b) => a.order - b.order).map((x) => x.name).join(' | ')}`);
    log(`launchers: ${p.launchers.map((l) => `${l.key}:${l.title}:${l.type}:${l.profile || l.target}`).join(' | ')}`);
    await snap(sb, '02-upgraded-main');

    // color a few items through the real editor
    await js(sb, `document.querySelectorAll('.tab[data-id]')[1].click()`);
    await wait(250);
    await js(sb, `document.querySelector('.item [data-action="edit-item"]').click()`);
    await wait(400);
    await js(sb, `document.querySelector('.swatch[data-c="blue"]').click(); document.querySelector('.icon-opt[data-i="mail"]').click()`);
    await wait(200);
    await snap(sb, '03-item-editor');
    await js(sb, `document.querySelector('.m-save').click()`);
    await wait(500);
    await js(sb, `document.querySelectorAll('.item [data-action="edit-item"]')[1].click()`);
    await wait(300);
    await js(sb, `document.querySelector('.swatch[data-c="amber"]').click(); document.querySelector('.icon-opt[data-i="checklist"]').click(); document.querySelector('.m-save').click()`);
    await wait(500);
    await js(sb, `document.querySelectorAll('.item [data-action="edit-item"]')[2].click()`);
    await wait(300);
    await js(sb, `document.querySelector('.swatch[data-c="green"]').click(); document.querySelector('.icon-opt[data-i="send"]').click(); document.querySelector('.m-save').click()`);
    await wait(600);
    await snap(sb, '04-colored');

    await js(sb, `document.querySelector('.cdot[data-c="amber"]').click()`);
    await wait(250);
    await snap(sb, '05-color-filter');
    await js(sb, `document.querySelector('.cdot[data-c="amber"]').click()`);

    await js(sb, `document.querySelector('.lbtn[data-lid]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true}))`);
    await wait(700);
    await snap(sb, '06-launcher-editor');
    await js(sb, `document.querySelector('.l-type button[data-v="app"]').click()`);
    await wait(2500);
    await snap(sb, '07-launcher-app');
    await js(sb, `document.querySelector('.m-cancel').click(); document.querySelector('[data-action="keyboard"]').click()`);
    await wait(400);
    await snap(sb, '08-keyboard-editor');
    await js(sb, `document.querySelector('.m-close').click()`);

    ctx.showKeys();
    await wait(700);
    await snap(ctx.keys(), '09-keys-overlay');
    log('ok');
  } catch (e) {
    log(`error: ${e && e.stack}`);
  }
  ctx.app.exit(0);
};
