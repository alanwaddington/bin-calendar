const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { initDb, getDb } = require('./db');
const { runSync } = require('./sync');
const { startScheduler, getNextSyncDate } = require('./scheduler');
const { isGoogleConfigured, getAuthUrl, exchangeCode } = require('./google');
const { fetchCalendars } = require('./icloud');
const { encryptJson } = require('./crypto');
const { lookupPostcode, getAddressDetail } = require('./uprn');

// ── Startup validation ─────────────────────────────────────────────────────
const encKey = process.env.ENCRYPTION_KEY;
if (!encKey || !/^[0-9a-f]{64}$/i.test(encKey)) {
  console.error('FATAL: ENCRYPTION_KEY must be a 64-character hex string. Exiting.');
  process.exit(1);
}

// ── Init ───────────────────────────────────────────────────────────────────
initDb();
startScheduler();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', nextSync: getNextSyncDate() });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

// ── Config (feature flags for UI) ─────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    googleConfigured: isGoogleConfigured(),
    addressLookupConfigured: !!process.env.GETADDRESS_API_KEY,
  });
});

// ── Properties ─────────────────────────────────────────────────────────────
app.get('/api/properties', (req, res) => {
  const rows = getDb().prepare(
    'SELECT id, label, uprn, calendar_type, calendar_id, created_at, updated_at, (credentials IS NOT NULL) as connected FROM properties'
  ).all();
  res.json(rows);
});

app.post('/api/properties', (req, res) => {
  const { label, uprn, calendar_type } = req.body;
  if (!label || !uprn || !calendar_type) return res.status(400).json({ error: 'Missing fields' });
  const result = getDb().prepare(
    'INSERT INTO properties (label, uprn, calendar_type, calendar_id) VALUES (?, ?, ?, ?)'
  ).run(label, uprn, calendar_type, calendar_type === 'google' ? 'primary' : null);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/properties/:id', (req, res) => {
  const { label, uprn } = req.body;
  if (!label || !uprn) return res.status(400).json({ error: 'Missing fields' });
  getDb().prepare('UPDATE properties SET label = ?, uprn = ? WHERE id = ?').run(label, uprn, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/properties/:id', (req, res) => {
  getDb().prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Google OAuth ───────────────────────────────────────────────────────────
app.get('/auth/google/start/:propertyId', (req, res) => {
  if (!isGoogleConfigured()) return res.status(503).json({ error: 'Google not configured' });
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const db = getDb();
  db.prepare('INSERT INTO oauth_state (nonce, property_id, expires_at) VALUES (?, ?, ?)')
    .run(nonce, req.params.propertyId, expiresAt);
  db.prepare("DELETE FROM oauth_state WHERE expires_at < datetime('now')").run();
  const state = Buffer.from(JSON.stringify({ property_id: req.params.propertyId, nonce })).toString('base64url');
  res.redirect(getAuthUrl(state));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  let propertyId;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    propertyId = decoded.property_id;
    const db = getDb();

    if (error) {
      db.prepare('DELETE FROM oauth_state WHERE property_id = ?').run(propertyId);
      return res.redirect('/properties?error=google_denied');
    }

    const row = db.prepare('SELECT * FROM oauth_state WHERE property_id = ? AND nonce = ?')
      .get(propertyId, decoded.nonce);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.redirect('/properties?error=oauth_expired');
    }
    db.prepare('DELETE FROM oauth_state WHERE nonce = ?').run(decoded.nonce);

    const tokens = await exchangeCode(code);
    db.prepare('UPDATE properties SET credentials = ? WHERE id = ?')
      .run(encryptJson(tokens), propertyId);
    res.redirect('/properties?success=google_connected');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/properties?error=oauth_failed');
  }
});

// ── iCloud ─────────────────────────────────────────────────────────────────
app.post('/api/icloud/calendars', async (req, res) => {
  const { apple_id, app_specific_password } = req.body;
  if (!apple_id || !app_specific_password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const calendars = await fetchCalendars(apple_id, app_specific_password);
    res.json(calendars);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/properties/:id/icloud', (req, res) => {
  const { apple_id, app_specific_password, calendar_url } = req.body;
  if (!apple_id || !app_specific_password || !calendar_url) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const creds = encryptJson({ apple_id, app_specific_password });
  getDb().prepare('UPDATE properties SET credentials = ?, calendar_id = ? WHERE id = ?')
    .run(creds, calendar_url, req.params.id);
  res.json({ ok: true });
});

// ── Sync ───────────────────────────────────────────────────────────────────
app.post('/api/sync', async (req, res) => {
  try {
    const result = await runSync();
    res.status(result.status).json(result);
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/runs', (req, res) => {
  const db = getDb();
  const runs = db.prepare(
    'SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100'
  ).all();
  const results = runs.length > 0
    ? db.prepare(
        `SELECT sr.*, p.label FROM sync_results sr
         LEFT JOIN properties p ON p.id = sr.property_id
         WHERE sr.run_id IN (${runs.map(() => '?').join(',')})
         ORDER BY sr.started_at DESC`
      ).all(...runs.map(r => r.id))
    : [];
  res.json({ runs, results });
});

// ── UPRN Lookup ────────────────────────────────────────────────────────────
app.get('/api/uprn/lookup', async (req, res) => {
  if (!process.env.GETADDRESS_API_KEY) {
    return res.status(503).json({ error: 'Address lookup not configured' });
  }
  if (!req.query.postcode) return res.status(400).json({ error: 'postcode is required' });
  try {
    const suggestions = await lookupPostcode(req.query.postcode);
    res.json(suggestions);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/uprn/detail', async (req, res) => {
  if (!process.env.GETADDRESS_API_KEY) {
    return res.status(503).json({ error: 'Address lookup not configured' });
  }
  if (!req.query.id) return res.status(400).json({ error: 'id is required' });
  try {
    const detail = await getAddressDetail(req.query.id);
    res.json(detail);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => console.log(`bin-calendar running on port ${PORT}`));

module.exports = app;
