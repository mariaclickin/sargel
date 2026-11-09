'use strict';
/**
 * Time-at-computer tracking. One 1440-char string per day, one char per minute:
 *   'w' working (mouse/keyboard active)  'b' break (idle ≥ threshold, screen locked, asleep)
 *   'o' tracking switched off            '.' no data
 * Kept in a local file (works while the vault is locked) and copied into the encrypted
 * vault per computer, so days from several computers add up.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 1440;
const KEEP_DAYS = 120;

const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

class Activity {
  constructor(file) {
    this.file = file;
    this.dirty = false;
    try { this.s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.s = {}; }
    if (!this.s.machine) { this.s.machine = crypto.randomUUID(); this.dirty = true; }
    if (!this.s.days || typeof this.s.days !== 'object') this.s.days = {};
    this.prune();
  }

  get machine() { return this.s.machine; }

  day(key) {
    let d = this.s.days[key];
    if (!d) d = this.s.days[key] = { line: '.'.repeat(DAY), water: 0, notified: [], updatedAt: 0 };
    if (!Array.isArray(d.notified)) d.notified = [];
    return d;
  }

  touch(d) { d.updatedAt = Date.now(); this.dirty = true; }

  mark(key, from, to, ch, onlyOver) {
    const d = this.day(key);
    const a = d.line.split('');
    for (let i = Math.max(0, from); i < Math.min(DAY, to); i++) {
      if (!onlyOver || onlyOver.includes(a[i])) a[i] = ch;
    }
    const line = a.join('');
    if (line !== d.line) { d.line = line; this.touch(d); }
  }

  /** called about once a minute */
  sample({ enabled, idleSec, locked, breakMin, now = new Date() }) {
    const key = dateKey(now);
    const m = now.getHours() * 60 + now.getMinutes();
    if (!enabled) { this.mark(key, m, m + 1, 'o'); return; }
    if (locked) { this.mark(key, m, m + 1, 'b'); return; }
    if (idleSec >= breakMin * 60) {
      // the quiet minutes before the threshold were recorded as work — re-label them as break
      const back = Math.min(m, Math.floor(idleSec / 60));
      this.mark(key, m - back, m + 1, 'b', ['w', '.', 'b']);
      return;
    }
    this.mark(key, m, m + 1, 'w');
  }

  addWater(key, delta) {
    const d = this.day(key);
    d.water = Math.max(0, Math.min(30, (d.water || 0) + delta));
    this.touch(d);
    return d.water;
  }

  wasNotified(key, id) { return this.day(key).notified.includes(id); }

  setNotified(key, id) {
    const d = this.day(key);
    if (!d.notified.includes(id)) { d.notified.push(id); this.dirty = true; }
  }

  clear() { this.s.days = {}; this.dirty = true; }

  prune() {
    const keys = Object.keys(this.s.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) { delete this.s.days[k]; this.dirty = true; }
  }

  save() {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.s));
      this.dirty = false;
    } catch { /* try again next time */ }
  }

  /** records for the vault: [{id, date, machine, line, water, updatedAt}] */
  records(sinceDays = 14) {
    const cut = dateKey(new Date(Date.now() - sinceDays * 864e5));
    return Object.entries(this.s.days)
      .filter(([k]) => k >= cut)
      .map(([date, d]) => ({ id: `${date}|${this.s.machine}`, date, machine: this.s.machine, line: d.line, water: d.water || 0, updatedAt: d.updatedAt || 0 }));
  }
}

/** combine the same day from several computers: work beats break beats off beats nothing */
const RANK = { '.': 0, o: 1, b: 2, w: 3 };
function combine(lines) {
  if (!lines.length) return '.'.repeat(DAY);
  const out = lines[0].split('');
  for (const l of lines.slice(1)) {
    for (let i = 0; i < DAY; i++) if ((RANK[l[i]] || 0) > (RANK[out[i]] || 0)) out[i] = l[i];
  }
  return out.join('');
}

function stats(line, breakMin) {
  const first = line.indexOf('w');
  if (first < 0) return { active: 0, breaks: 0, breakMinutes: 0, arrival: null, leave: null, longest: 0, longestAt: null };
  const last = line.lastIndexOf('w');
  let active = 0;
  let breaks = 0;
  let bmin = 0;
  let longest = 0;
  let longestAt = null;
  let i = first;
  while (i <= last) {
    if (line[i] === 'w') { active++; i++; continue; }
    let j = i;
    while (j <= last && line[j] !== 'w') j++;
    const run = line.slice(i, j);
    const len = j - i;
    if (/^o+$/.test(run)) { /* tracking was off — not counted */ } else if (len >= breakMin) {
      breaks++;
      bmin += len;
      if (len > longest) { longest = len; longestAt = i; }
    } else {
      active += len; // a short pause inside work
    }
    i = j;
  }
  return { active, breaks, breakMinutes: bmin, arrival: first, leave: last + 1, longest, longestAt };
}

/** longest stretch of work where no pause reached the break threshold: {len, start, end} in minutes */
function focusStreak(line, breakMin) {
  let best = { len: 0, start: null, end: null };
  let start = -1;
  let lastW = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== 'w') continue;
    if (start < 0 || i - lastW - 1 >= breakMin) start = i;
    lastW = i;
    const len = i + 1 - start;
    if (len > best.len) best = { len, start, end: i + 1 };
  }
  return best;
}

/**
 * The workday as she counts it: from arrival to leaving, breaks included, with optional manual fixes.
 * fix = {type:'work'|'vac'|'sick', arrive:'HH:MM'|'', leave:'HH:MM'|'', breaks:number|null}
 * Returns {total, arrival, leave, early, overtime, off, fixed, breakMinutes, breaks}
 */
function workday(line, breakMin, { ws, we, fix = null, nowMin = null } = {}) {
  const target = we - ws;
  if (fix && (fix.type === 'vac' || fix.type === 'sick')) {
    return { total: target, arrival: null, leave: null, early: 0, overtime: 0, off: fix.type, fixed: true, breakMinutes: 0, breaks: 0 };
  }
  const st = stats(line, breakMin);
  const hm = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let arrival = st.arrival;
  let leave = st.leave;
  if (nowMin != null && leave != null && leave > nowMin) leave = nowMin;
  const fa = fix ? hm(fix.arrive) : null;
  const fl = fix ? hm(fix.leave) : null;
  if (fa != null) arrival = fa;
  if (fl != null) leave = fl;
  if (arrival == null || leave == null || leave <= arrival) {
    return { total: 0, arrival, leave, early: 0, overtime: 0, off: null, fixed: !!fix, breakMinutes: st.breakMinutes, breaks: st.breaks };
  }
  // minutes where tracking was switched off are not counted
  let offMin = 0;
  if (fa == null && fl == null) for (let i = arrival; i < leave; i++) if (line[i] === 'o') offMin++;
  const total = leave - arrival - offMin;
  const breakMinutes = fix && typeof fix.breaks === 'number' ? fix.breaks : st.breakMinutes;
  // extra time = before the start time + after the end time
  const early = Math.max(0, Math.min(ws, leave) - arrival);
  const late = Math.max(0, leave - Math.max(we, arrival));
  return {
    total,
    arrival,
    leave,
    early,
    late,
    overtime: early + late,
    off: null,
    fixed: !!fix,
    breakMinutes,
    breaks: fix && typeof fix.breaks === 'number' ? null : st.breaks,
  };
}

module.exports = { Activity, combine, stats, focusStreak, workday, dateKey, DAY };
