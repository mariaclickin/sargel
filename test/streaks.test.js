'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dailyStreak, weeklyStreak, dayKey, weekStart } = require('../src/renderer/streaks');

const today = new Date(2026, 10, 11, 10, 0); // Wed 11 Nov 2026, morning
const daysBack = (...ns) => new Set(ns.map((n) => { const d = new Date(today); d.setDate(d.getDate() - n); return dayKey(d); }));

test('daily: counts consecutive reading days; today not read yet does not break it', () => {
  const s = dailyStreak(daysBack(1, 2, 3, 4), today);
  assert.strictEqual(s.count, 4);
  assert.strictEqual(s.todayDone, false);
  assert.strictEqual(s.atRisk, false); // 10:00, not evening yet
});

test('daily: one missed day per month is frozen, two in a row break', () => {
  assert.strictEqual(dailyStreak(daysBack(0, 1, 3, 4), today).count, 4);
  assert.deepStrictEqual(dailyStreak(daysBack(0, 1, 3, 4), today).frozen.length, 1);
  assert.strictEqual(dailyStreak(daysBack(0, 1, 4, 5), today).count, 2);
  // second miss in the same month (Nov) is not frozen
  assert.strictEqual(dailyStreak(daysBack(0, 2, 4), today).count, 2);
});

test('weekly: 3 workouts a week; the current week in progress does not break it', () => {
  const ws = weekStart(today);
  const wk = (n) => { const d = new Date(ws); d.setDate(d.getDate() - 7 * n); return dayKey(d); };
  const amounts = { [wk(0)]: 2, [wk(1)]: 3, [wk(2)]: 4, [wk(3)]: 1, [wk(4)]: 3 };
  const s = weeklyStreak((k) => amounts[k] || 0, 3, today);
  assert.strictEqual(s.current, 2);
  assert.strictEqual(s.met, false);
  assert.strictEqual(s.count, 3); // wk1, wk2, (wk3 frozen), wk4
  assert.strictEqual(s.frozen.length, 1);
});
