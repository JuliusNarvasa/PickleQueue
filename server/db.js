// db.js - SQLite schema and helpers for the PickleQueue tracking service.
// Uses Node's built-in node:sqlite (no native deps). Tracks who played on a court.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      names TEXT NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_plays_ts ON plays(ts);');
  return db;
}

export function recordPlay(db, { ts, names }) {
  const safeNames = Array.isArray(names) ? names.map((n) => String(n).slice(0, 60)) : [];
  db.prepare('INSERT INTO plays (ts, names) VALUES (?, ?)').run(ts || Date.now(), JSON.stringify(safeNames));
}

export function getPlays(db) {
  const rows = db.prepare('SELECT id, ts, names FROM plays ORDER BY ts DESC LIMIT 500').all();
  return rows.map((r) => {
    let names = [];
    try { names = JSON.parse(r.names); } catch { names = []; }
    return { id: r.id, ts: r.ts, names: Array.isArray(names) ? names : [] };
  });
}