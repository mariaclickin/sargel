'use strict';
/* Duolingo-style streaks. Works in the renderer (global) and in Node tests (module.exports).
   One "freeze" per calendar month: a single missed day (or week) doesn't break the streak. */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const weekStart = (d) => { const x = day0(d); x.setDate(x.getDate() - x.getDay()); return x; };

  /** days: Set of 'YYYY-MM-DD' → {count, todayDone, frozen:[keys], atRisk} */
  function dailyStreak(days, today = new Date()) {
    const d = day0(today);
    const todayDone = days.has(key(d));
    if (!todayDone) d.setDate(d.getDate() - 1); // today isn't over yet
    let count = 0;
    const frozen = [];
    const used = new Set();
    let lastWasFreeze = false;
    for (let guard = 0; guard < 4000; guard++) {
      const k = key(d);
      if (days.has(k)) { count++; lastWasFreeze = false; } else if (!lastWasFreeze && !used.has(k.slice(0, 7))) {
        used.add(k.slice(0, 7));
        frozen.push(k);
        lastWasFreeze = true;
      } else {
        if (lastWasFreeze) frozen.pop();
        break;
      }
      d.setDate(d.getDate() - 1);
    }
    if (!count) frozen.length = 0;
    return { count, todayDone, frozen, atRisk: !todayDone && today.getHours() >= 18 };
  }

  /**
   * amountOf(weekStartKey) → number; target per week.
   * → {count, current, met, frozen:[weekKeys], atRisk}
   */
  function weeklyStreak(amountOf, target, today = new Date()) {
    const w = weekStart(today);
    const current = amountOf(key(w));
    const met = current >= target;
    let count = met ? 1 : 0;
    const frozen = [];
    const used = new Set();
    let lastWasFreeze = false;
    w.setDate(w.getDate() - 7);
    for (let guard = 0; guard < 600; guard++) {
      const k = key(w);
      if (amountOf(k) >= target) { count++; lastWasFreeze = false; } else if (!lastWasFreeze && !used.has(k.slice(0, 7))) {
        used.add(k.slice(0, 7));
        frozen.push(k);
        lastWasFreeze = true;
      } else {
        if (lastWasFreeze) frozen.pop();
        break;
      }
      w.setDate(w.getDate() - 7);
    }
    if (!count) frozen.length = 0;
    return { count, current, met, frozen, atRisk: !met && today.getDay() >= 4 };
  }

  const api = { dailyStreak, weeklyStreak, dayKey: key, weekStart, weekKey: (d) => key(weekStart(d)) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Streaks = api;
}(typeof window !== 'undefined' ? window : globalThis));
