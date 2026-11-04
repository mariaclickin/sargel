'use strict';
/**
 * Encrypted vault file (.sargel)
 *
 * File = JSON { format, v, kdf:{name,N,r,p,salt}, iv, tag, data }
 * data = AES-256-GCM( JSON of { schema, tabs[], items[], settings{} } )
 * key  = scrypt(password, salt)
 *
 * The file is meant to live in a synced folder (Google Drive / OneDrive / Dropbox),
 * so every save first merges whatever another computer wrote (per-record, newest wins,
 * deletions kept as tombstones).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const FORMAT = 'sargel-vault';
const VERSION = 1;
const KDF_DEFAULT = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const KEYLEN = 32;
const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 120;

class VaultError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function deriveKey(password, kdf) {
  const salt = Buffer.from(kdf.salt, 'base64');
  return scrypt(String(password).normalize('NFC'), salt, KEYLEN, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024,
  });
}

function encryptWithKey(data, key, kdf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(FORMAT));
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), 'utf8')), cipher.final()]);
  return {
    format: FORMAT,
    v: VERSION,
    kdf,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptWithKey(file, key) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    d.setAAD(Buffer.from(FORMAT));
    d.setAuthTag(Buffer.from(file.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new VaultError('WRONG_PASSWORD');
  }
}

function parseFile(text) {
  let f;
  try { f = JSON.parse(text); } catch { throw new VaultError('NOT_A_VAULT'); }
  if (!f || f.format !== FORMAT || !f.kdf || !f.iv || !f.tag || !f.data) throw new VaultError('NOT_A_VAULT');
  if (f.v > VERSION) throw new VaultError('NEWER_VERSION');
  return f;
}

function emptyData() {
  return { schema: 1, tabs: [], items: [], launchers: [], settings: { updatedAt: 0 } };
}

function normalize(data) {
  data = data || {};
  return {
    schema: 1,
    tabs: Array.isArray(data.tabs) ? data.tabs : [],
    items: Array.isArray(data.items) ? data.items : [],
    launchers: Array.isArray(data.launchers) ? data.launchers : [],
    settings: data.settings && typeof data.settings === 'object' ? data.settings : { updatedAt: 0 },
  };
}

function mergeList(a, b) {
  const map = new Map();
  for (const x of a) map.set(x.id, x);
  for (const y of b) {
    const x = map.get(y.id);
    if (!x || (y.updatedAt || 0) > (x.updatedAt || 0)) map.set(y.id, y);
  }
  const now = Date.now();
  return [...map.values()].filter((x) => !(x.deleted && now - (x.updatedAt || 0) > TOMBSTONE_TTL));
}

function merge(local, remote) {
  local = normalize(local);
  remote = normalize(remote);
  return {
    schema: 1,
    tabs: mergeList(local.tabs, remote.tabs),
    items: mergeList(local.items, remote.items),
    launchers: mergeList(local.launchers, remote.launchers),
    settings: (remote.settings.updatedAt || 0) > (local.settings.updatedAt || 0) ? remote.settings : local.settings,
  };
}

/** true when `local` holds something newer than (or missing from) `remote` */
function hasNewer(local, remote) {
  const check = (la, ra) => {
    const m = new Map(ra.map((x) => [x.id, x.updatedAt || 0]));
    return la.some((x) => !m.has(x.id) || (x.updatedAt || 0) > m.get(x.id));
  };
  local = normalize(local);
  remote = normalize(remote);
  return check(local.tabs, remote.tabs)
    || check(local.items, remote.items)
    || check(local.launchers, remote.launchers)
    || (local.settings.updatedAt || 0) > (remote.settings.updatedAt || 0);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

class Vault {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.key = null;
    this.kdf = null;
    this.password = null;
    this.lastHash = null;
  }

  get unlocked() { return !!this.key; }

  exists() { return fs.existsSync(this.filePath); }

  static async create(filePath, password, initial) {
    if (fs.existsSync(filePath)) throw new VaultError('EXISTS');
    const v = new Vault(filePath);
    v.kdf = { ...KDF_DEFAULT, salt: crypto.randomBytes(16).toString('base64') };
    v.key = await deriveKey(password, v.kdf);
    v.password = String(password);
    v.data = normalize(initial || emptyData());
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    v._write(v.data);
    return v;
  }

  async unlock(password) {
    const text = this._read();
    const file = parseFile(text);
    const key = await deriveKey(password, file.kdf);
    const data = decryptWithKey(file, key);
    this.key = key;
    this.kdf = file.kdf;
    this.password = String(password);
    this.data = normalize(data);
    this.lastHash = sha(text);
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.password = null;
    this.data = null;
    this.kdf = null;
    this.lastHash = null;
  }

  checkPassword(pw) {
    if (!this.password) return false;
    const a = Buffer.from(String(pw));
    const b = Buffer.from(this.password);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  _read() {
    try {
      return fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      throw new VaultError(e.code === 'ENOENT' ? 'NOT_FOUND' : 'READ_FAILED', e.message);
    }
  }

  _write(data) {
    const text = JSON.stringify(encryptWithKey(data, this.key, this.kdf));
    const tmp = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, this.filePath);
    } catch {
      // some sync clients lock files briefly — fall back to a direct write
      fs.writeFileSync(this.filePath, text);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
    this.lastHash = sha(text);
  }

  /**
   * Merge in whatever another computer wrote to the file.
   * Returns true when the in-memory data changed.
   * Throws WRONG_PASSWORD if the password was changed elsewhere.
   */
  async pullExternal({ writeBack = true } = {}) {
    if (!this.unlocked) return false;
    let text;
    try { text = this._read(); } catch { return false; }
    const h = sha(text);
    if (h === this.lastHash) return false;
    let file;
    try { file = parseFile(text); } catch { return false; }

    let remote;
    if (file.kdf.salt === this.kdf.salt) {
      remote = decryptWithKey(file, this.key);
    } else {
      // re-encrypted elsewhere (e.g. password change) — try with our password
      const key = await deriveKey(this.password, file.kdf);
      remote = decryptWithKey(file, key);
      this.key.fill(0);
      this.key = key;
      this.kdf = file.kdf;
    }
    const before = JSON.stringify(this.data);
    const localNewer = hasNewer(this.data, remote);
    this.data = merge(this.data, remote);
    this.lastHash = h;
    if (localNewer && writeBack) this._write(this.data);
    return JSON.stringify(this.data) !== before;
  }

  async save() {
    if (!this.unlocked) throw new VaultError('LOCKED');
    await this.pullExternal({ writeBack: false });
    this._write(this.data);
  }

  async changePassword(newPassword) {
    if (!this.unlocked) throw new VaultError('LOCKED');
    await this.pullExternal({ writeBack: false });
    const kdf = { ...KDF_DEFAULT, salt: crypto.randomBytes(16).toString('base64') };
    const key = await deriveKey(newPassword, kdf);
    this.key.fill(0);
    this.key = key;
    this.kdf = kdf;
    this.password = String(newPassword);
    this._write(this.data);
  }
}

module.exports = { Vault, VaultError, merge, hasNewer, emptyData, FORMAT };
