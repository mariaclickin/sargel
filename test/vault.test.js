'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, merge } = require('../src/vault');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sargel-test-'));
const sample = () => ({
  schema: 1,
  tabs: [{ id: 't1', name: 'מיילים', order: 0, updatedAt: 1 }],
  items: [{ id: 'i1', tabId: 't1', title: 'שלום', fields: [{ id: 'f1', label: '', kind: 'text', value: 'היי' }], order: 0, updatedAt: 1 }],
  settings: { updatedAt: 1 },
});

test('create → file is encrypted, unlock round-trips', async () => {
  const file = path.join(tmp(), 'v.sargel');
  await Vault.create(file, 'correct horse', sample());
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('שלום'), 'plaintext must not be in the file');
  assert.ok(!raw.includes('היי'));
  const v = new Vault(file);
  await v.unlock('correct horse');
  assert.strictEqual(v.data.items[0].fields[0].value, 'היי');
});

test('wrong password is rejected', async () => {
  const file = path.join(tmp(), 'v.sargel');
  await Vault.create(file, 'correct horse', sample());
  const v = new Vault(file);
  await assert.rejects(() => v.unlock('nope'), (e) => e.code === 'WRONG_PASSWORD');
  assert.strictEqual(v.unlocked, false);
});

test('two computers editing the same synced file merge instead of overwriting', async () => {
  const file = path.join(tmp(), 'v.sargel');
  await Vault.create(file, 'pw-12345678', sample());
  const a = new Vault(file);
  const b = new Vault(file);
  await a.unlock('pw-12345678');
  await b.unlock('pw-12345678');

  // computer A adds an item
  a.data.items.push({ id: 'iA', tabId: 't1', title: 'from A', fields: [], order: 1, updatedAt: Date.now() });
  await a.save();
  // computer B (has not seen A's change) adds another item and edits i1
  b.data.items.push({ id: 'iB', tabId: 't1', title: 'from B', fields: [], order: 2, updatedAt: Date.now() + 1 });
  b.data.items[0] = { ...b.data.items[0], title: 'edited on B', updatedAt: Date.now() + 2 };
  await b.save();

  const c = new Vault(file);
  await c.unlock('pw-12345678');
  const ids = c.data.items.map((i) => i.id).sort();
  assert.deepStrictEqual(ids, ['i1', 'iA', 'iB']);
  assert.strictEqual(c.data.items.find((i) => i.id === 'i1').title, 'edited on B');

  // A picks up B's changes
  const changed = await a.pullExternal();
  assert.strictEqual(changed, true);
  assert.strictEqual(a.data.items.length, 3);
});

test('deletions win over older copies (tombstones)', () => {
  const local = sample();
  const remote = sample();
  remote.items = [{ id: 'i1', deleted: true, updatedAt: Date.now() }];
  const m = merge(local, remote);
  assert.strictEqual(m.items.length, 1);
  assert.strictEqual(m.items[0].deleted, true);
});

test('launchers merge between computers like items', () => {
  const now = Date.now();
  const local = { ...sample(), launchers: [{ id: 'l1', key: '1', title: 'Chrome A', updatedAt: now }] };
  const remote = { ...sample(), launchers: [{ id: 'l2', key: '2', title: 'Claude', updatedAt: now }] };
  const m = merge(local, remote);
  assert.deepStrictEqual(m.launchers.map((l) => l.id).sort(), ['l1', 'l2']);
  const old = merge(sample(), {});
  assert.deepStrictEqual(old.launchers, [], 'vaults from v0.1.0 get an empty launcher list');
});

test('password change on one computer locks out the stale password on the other', async () => {
  const file = path.join(tmp(), 'v.sargel');
  await Vault.create(file, 'old-password', sample());
  const a = new Vault(file);
  const b = new Vault(file);
  await a.unlock('old-password');
  await b.unlock('old-password');
  await a.changePassword('new-password');
  await assert.rejects(() => b.pullExternal(), (e) => e.code === 'WRONG_PASSWORD');
  const c = new Vault(file);
  await c.unlock('new-password');
  assert.strictEqual(c.data.items.length, 1);
});
