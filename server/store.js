// Tiny JSON-file store. Swap for Postgres/SQLite when you outgrow one machine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { users: {}, tokens: {}, refCodes: {}, jobs: {}, uploads: {} };
  }
}

export const db = load();
let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 100);
}
export function flush() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
process.on('exit', () => { try { flush(); } catch {} });

export const uid = (n = 12) => crypto.randomBytes(n).toString('base64url');
export const today = () => new Date().toISOString().slice(0, 10);
