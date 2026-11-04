'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Activity, combine, stats, dateKey } = require('../src/activity');

const at = (h, m) => { const d = new Date(2026, 10, 4, h, m, 0); return d; };
const fresh = () => new Activity(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sargel-act-')), 'a.json'));

test('active minutes are counted, an idle stretch past the threshold becomes a break', () => {
  const a = fresh();
  const key = dateKey(at(9, 0));
  for (let m = 0; m < 60; m++) a.sample({ enabled: true, idleSec: 5, locked: false, breakMin: 10, now: at(9, m) });
  // 10:00–10:14 no input: first 9 minutes look like work, then the threshold re-labels them
  for (let m = 0; m < 15; m++) a.sample({ enabled: true, idleSec: m * 60, locked: false, breakMin: 10, now: at(10, m) });
  for (let m = 15; m < 45; m++) a.sample({ enabled: true, idleSec: 3, locked: false, breakMin: 10, now: at(10, m) });
  const s = stats(a.day(key).line, 10);
  assert.strictEqual(s.arrival, 9 * 60);
  assert.strictEqual(s.breaks, 1);
  assert.ok(s.breakMinutes >= 14 && s.breakMinutes <= 15, `break ${s.breakMinutes}`);
  assert.strictEqual(s.active + s.breakMinutes, 105);
});

test('switched off minutes are neither work nor break', () => {
  const a = fresh();
  const key = dateKey(at(9, 0));
  for (let m = 0; m < 20; m++) a.sample({ enabled: true, idleSec: 0, locked: false, breakMin: 10, now: at(9, m) });
  for (let m = 20; m < 50; m++) a.sample({ enabled: false, idleSec: 0, locked: false, breakMin: 10, now: at(9, m) });
  for (let m = 50; m < 60; m++) a.sample({ enabled: true, idleSec: 0, locked: false, breakMin: 10, now: at(9, m) });
  const s = stats(a.day(key).line, 10);
  assert.strictEqual(s.active, 30);
  assert.strictEqual(s.breaks, 0);
});

test('two computers on the same day combine (work wins)', () => {
  const l1 = `${'w'.repeat(60)}${'.'.repeat(1380)}`;
  const l2 = `${'.'.repeat(30)}${'b'.repeat(30)}${'w'.repeat(30)}${'.'.repeat(1350)}`;
  const c = combine([l1, l2]);
  assert.strictEqual(stats(c, 10).active, 90);
});

test('water and notifications persist to disk', () => {
  const a = fresh();
  const key = dateKey(at(9, 0));
  a.addWater(key, 1);
  a.addWater(key, 1);
  a.setNotified(key, 'h600');
  a.save();
  const b = new Activity(a.file);
  assert.strictEqual(b.day(key).water, 2);
  assert.ok(b.wasNotified(key, 'h600'));
  assert.strictEqual(b.machine, a.machine);
});
