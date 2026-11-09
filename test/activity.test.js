'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Activity, combine, stats, focusStreak, workday, dateKey } = require('../src/activity');

const lineOf = (parts) => {
  const a = '.'.repeat(1440).split('');
  for (const [from, to, ch] of parts) for (let i = from; i < to; i++) a[i] = ch;
  return a.join('');
};
const H = (h, m = 0) => h * 60 + m;

test('workday counts from arrival to leaving, breaks included; early arrival is overtime', () => {
  const line = lineOf([[H(8, 30), H(12), 'w'], [H(12), H(12, 30), 'b'], [H(12, 30), H(17), 'w']]);
  const d = workday(line, 10, { ws: H(9), we: H(17) });
  assert.strictEqual(d.total, H(8, 30));
  assert.strictEqual(d.early, 30);
  assert.strictEqual(d.overtime, 30);
  assert.strictEqual(d.breakMinutes, 30);
});

test('manual fix and vacation', () => {
  const line = lineOf([[H(9), H(19, 40), 'w']]);
  const fixed = workday(line, 10, { ws: H(9), we: H(17), fix: { type: 'work', arrive: '09:00', leave: '17:00', breaks: null } });
  assert.strictEqual(fixed.total, H(8));
  assert.strictEqual(fixed.overtime, 0);
  // arriving early counts even if leaving early
  const earlyShort = workday(lineOf([[H(8, 30), H(16, 30), 'w']]), 10, { ws: H(9), we: H(17) });
  assert.strictEqual(earlyShort.total, H(8));
  assert.strictEqual(earlyShort.overtime, 30);
  const vac = workday('.'.repeat(1440), 10, { ws: H(9), we: H(17), fix: { type: 'vac' } });
  assert.strictEqual(vac.total, H(8));
  assert.strictEqual(vac.off, 'vac');
});

test('focus streak ignores short pauses and stops at a real break', () => {
  const line = lineOf([[H(9), H(10), 'w'], [H(10), H(10, 5), 'b'], [H(10, 5), H(11), 'w'], [H(11), H(11, 30), 'b'], [H(11, 30), H(12), 'w']]);
  const f = focusStreak(line, 10);
  assert.strictEqual(f.len, 120);
  assert.strictEqual(f.start, H(9));
});

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
