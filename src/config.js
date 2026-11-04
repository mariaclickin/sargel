'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  personalPath: null,
  teamPath: null,
  side: 'right', // 'right' | 'left'
  handleY: 0.35, // 0..1 — vertical position of the edge handle
  width: 390, // expanded panel width
  hotkey: 'CommandOrControl+Shift+Space',
  launcherHotkey: 'CommandOrControl+Shift+K',
  quickNoteHotkey: 'CommandOrControl+Shift+Y', // Ctrl+Shift+N is Chrome's incognito window
  // workday + reminders
  workStart: '09:00',
  workEnd: '17:00',
  workDays: [0, 1, 2, 3, 4], // Sunday..Thursday
  trackEnabled: true,
  breakMinutes: 10,
  hourlyNotify: true,
  waterReminder: true,
  waterMinutes: 60,
  waterGoal: 8,
  autoLockMinutes: 15, // 0 = never
  launchAtLogin: true,
  theme: 'system', // 'system' | 'light' | 'dark'
};

class Config {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* first run */ }
  }

  get(k) { return this.data[k]; }

  set(patch) {
    Object.assign(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Config, DEFAULTS };
