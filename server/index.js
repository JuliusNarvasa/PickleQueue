// PickleQueue Tracking Service
// Receives play records (who played on a court) via POST /api/play,
// stores them in SQLite, and exposes them via GET /api/plays (token-gated).

import express from 'express';
import { openDb, recordPlay, getPlays } from './db.js';

const PORT = process.env.PORT || 4323;
const DB_PATH = process.env.DB_PATH || './data/picklequeue.db';
const TRACKING_TOKEN = process.env.TRACKING_TOKEN || '';

const db = openDb(DB_PATH);

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '4kb' }));

// Permissive CORS for dev (frontend on different port). Harmless in prod same-origin.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Tracking-Token, X-Tracking-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || req.socket.remoteAddress || '';
  }
  return req.socket.remoteAddress || '';
}

// POST /api/play - record who played on a court. Open ingest (like portfolio /api/track).
app.post('/api/play', (req, res) => {
  const { names, ts } = req.body || {};
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'names must be a non-empty array' });
  }
  const clean = names.map((n) => String(n).slice(0, 60)).slice(0, 32);
  recordPlay(db, { ts: typeof ts === 'number' ? ts : Date.now(), names: clean });
  res.status(204).end();
});

// Gate: invalid/missing token -> 404 (hide existence), not 401.
function requireToken(req, res, next) {
  if (!TRACKING_TOKEN) return next(); // dev mode: open
  const supplied = (req.query.token ?? req.get('x-tracking-token') ?? req.get('x-tracking-key')) || '';
  if (supplied === TRACKING_TOKEN) return next();
  return res.status(404).json({ error: 'not found' });
}

// GET /api/plays - list plays. Token-gated.
app.get('/api/plays', requireToken, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getPlays(db));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal' });
});

app.listen(PORT, () => {
  const auth = TRACKING_TOKEN ? 'auth=token' : 'auth=off';
  console.log(`PickleQueue tracking listening on port ${PORT}, db=${DB_PATH}, ${auth}`);
});