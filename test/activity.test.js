'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Activity, combine, stats, focusStreak, workday, workdayPlaces, dateKey } = require('../src/activity');

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

test('home: only active time counts — 2h, a 3h break, 4h = 6h, no overtime', () => {
  const home = lineOf([[H(8, 30), H(10, 30), 'w'], [H(10, 30), H(13, 30), 'b'], [H(13, 30), H(17, 30), 'w']]);
  const d = workdayPlaces({ office: null, home }, 10, { ws: H(9), we: H(17) });
  assert.strictEqual(d.place, 'home');
  assert.strictEqual(d.total, H(6));
  assert.strictEqual(d.overtime, 0);
  assert.strictEqual(d.breakMinutes, 0, 'at home a quiet stretch is not a break');
  assert.strictEqual(d.sessions, 2);
  // the same minutes on an office computer: arrival to leaving, breaks included
  const o = workdayPlaces({ office: home, home: null }, 10, { ws: H(9), we: H(17) });
  assert.strictEqual(o.place, 'office');
  assert.strictEqual(o.total, H(9));
});

test('home: a minute in the morning and one at night do not make a long day', () => {
  const home = lineOf([[H(7), H(7, 1), 'w'], [H(10), H(12), 'w'], [H(22), H(22, 2), 'w']]);
  const d = workdayPlaces({ office: null, home }, 10, { ws: H(9), we: H(17) });
  assert.strictEqual(d.total, 1 + H(2) + 2);
});

test('office + home on the same day: home time outside the office span is added', () => {
  const office = lineOf([[H(9), H(17), 'w']]);
  const home = lineOf([[H(16), H(17), 'w'], [H(20), H(21), 'w']]); // 16–17 overlaps the office day
  const d = workdayPlaces({ office, home }, 10, { ws: H(9), we: H(17) });
  assert.strictEqual(d.place, 'mixed');
  assert.strictEqual(d.homeMinutes, H(1));
  assert.strictEqual(d.total, H(9));
});

test('home: vacation and manual times still win', () => {
  const home = lineOf([[H(10), H(12), 'w']]);
  const vac = workdayPlaces({ office: null, home }, 10, { ws: H(9), we: H(17), fix: { type: 'vac' } });
  assert.strictEqual(vac.off, 'vac');
  const fixed = workdayPlaces({ office: null, home }, 10, { ws: H(9), we: H(17), fix: { type: 'work', arrive: '09:00', leave: '13:00', breaks: null } });
  assert.strictEqual(fixed.total, H(4));
});

test('switching a computer to home relabels today and older unlabelled days, not labelled ones', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sargel-act-')), 'a.json');
  const a = new Activity(file);
  a.day('2026-01-01');
  a.setPlace('2026-01-02', 'office');
  a.switchPlace('home', '2026-01-03');
  assert.strictEqual(a.day('2026-01-01').place, 'home');
  assert.strictEqual(a.day('2026-01-02').place, 'office');
  assert.strictEqual(a.day('2026-01-03').place, 'home');
  const r = a.records(100000).find((x) => x.date === '2026-01-01');
  assert.strictEqual(r.place, 'home');
});

test('home: a night of work and an evening, with the computer off all day in between', () => {
  // like a real day: 00:00–01:21 after midnight, then nothing until the evening (lid closed / asleep)
  const home = lineOf([[H(0), H(1, 21), 'w'], [H(1, 21), H(3), 'b'], [H(19), H(19, 30), 'w'], [H(19, 30), H(19, 33), '.'], [H(19, 33), H(19, 50), 'w'], [H(21, 30), H(21, 56), 'w']]);
  const d = workdayPlaces({ office: null, home }, 10, { ws: H(9), we: H(17) });
  assert.strictEqual(d.total, 81 + 30 + 3 + 17 + 26);
  assert.strictEqual(d.breakMinutes, 0);
  assert.strictEqual(d.sessions, 3);
});

test('home day from 05:00: a shifted line reports clock times', () => {
  // shifted line: index 0 = 05:00. Work 19:00–21:00 (index 840–960) and 00:00–01:21 after midnight (index 1140–1221)
  const home = lineOf([[840, 960, 'w'], [1140, 1221, 'w']]);
  const d = workdayPlaces({ office: null, home }, 10, { ws: H(9), we: H(17), shift: 300 });
  assert.strictEqual(d.total, 120 + 81);
  assert.strictEqual(d.arrival, H(19));
  assert.strictEqual(d.leave, H(1, 21));
  assert.strictEqual(d.sessions, 2);
});
