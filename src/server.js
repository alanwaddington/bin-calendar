const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { initDb, getDb } = require('./db');
const { runSync } = require('./sync');
const { startScheduler, getNextSyncDate } = require('./scheduler');
const { isGoogleConfigured, getAuthUrl, exchangeCode, listCalendars } = require('./google');
const { fetchCalendars } = require('./icloud');
const { encryptJson } = require('./crypto');
const { lookupPostcode, getAddressDetail } = require('./uprn');
const { checkSingleCredential } = require('./credential-check');

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
    'SELECT id, label, uprn, calendar_type, calendar_id, created_at, updated_at, (credentials IS NOT NULL) as connected, credential_status, credential_checked_at FROM properties'
  ).all();
  res.json(rows);
});

app.post('/api/properties', (req, res) => {
  const { label, uprn, calendar_type } = req.body;
  if (!label || !uprn || !calendar_type) return res.status(400).json({ error: 'Missing fields' });
  const result = getDb().prepare(
    'INSERT INTO properties (label, uprn, calendar_type, calendar_id) VALUES (?, ?, ?, ?)'
  ).run(label, uprn, calendar_type, calendar_type === 'google' ? 'primary' : null);
  res.status(201).json({ id: result.lastInsertRowid });
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

app.get('/api/properties/:id/credential-status', async (req, res) => {
  const property = getDb().prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  if (!property.credentials) return res.status(400).json({ error: 'Property has no credentials' });
  try {
    const status = await checkSingleCredential(property);
    res.json({ status, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Google OAuth ───────────────────────────────────────────────────────────
// Returns the Google auth URL for a property (Desktop app OAuth — user pastes callback URL back)
app.get('/api/google/auth-url/:propertyId', (req, res) => {
  if (!isGoogleConfigured()) return res.status(503).json({ error: 'Google not configured' });
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const db = getDb();
  db.prepare('INSERT INTO oauth_state (nonce, property_id, expires_at) VALUES (?, ?, ?)')
    .run(nonce, req.params.propertyId, expiresAt);
  db.prepare("DELETE FROM oauth_state WHERE expires_at < datetime('now')").run();
  const state = Buffer.from(JSON.stringify({ property_id: req.params.propertyId, nonce })).toString('base64url');
  res.json({ authUrl: getAuthUrl(state) });
});

// Accepts the full callback URL pasted by the user after Google authorization
app.post('/api/google/complete', async (req, res) => {
  const { pastedUrl } = req.body;
  if (!pastedUrl) return res.status(400).json({ error: 'pastedUrl is required' });
  try {
    const parsed = new URL(pastedUrl);
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const error = parsed.searchParams.get('error');

    if (!state) return res.status(400).json({ error: 'Invalid URL — missing state parameter' });
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    const { property_id, nonce } = decoded;
    const db = getDb();

    if (error) {
      db.prepare('DELETE FROM oauth_state WHERE property_id = ?').run(property_id);
      return res.status(400).json({ error: 'Google access was denied' });
    }

    const row = db.prepare('SELECT * FROM oauth_state WHERE property_id = ? AND nonce = ?')
      .get(property_id, nonce);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OAuth session expired — please start again' });
    }
    db.prepare('DELETE FROM oauth_state WHERE nonce = ?').run(nonce);

    const tokens = await exchangeCode(code);
    db.prepare('UPDATE properties SET credentials = ?, credential_status = ? WHERE id = ?')
      .run(encryptJson(tokens), 'ok', property_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('OAuth complete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Returns the list of Google Calendars for a connected property
app.get('/api/google/calendars/:propertyId', async (req, res) => {
  const property = getDb().prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  if (!property.credentials) return res.status(400).json({ error: 'Property not connected to Google' });
  try {
    const calendars = await listCalendars(property);
    res.json(calendars);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Updates the selected calendar for a property
app.put('/api/properties/:id/calendar', (req, res) => {
  const { calendar_id } = req.body;
  if (!calendar_id) return res.status(400).json({ error: 'calendar_id is required' });
  getDb().prepare('UPDATE properties SET calendar_id = ? WHERE id = ?').run(calendar_id, req.params.id);
  res.json({ ok: true });
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
  getDb().prepare('UPDATE properties SET credentials = ?, calendar_id = ?, credential_status = ? WHERE id = ?')
    .run(creds, calendar_url, 'ok', req.params.id);
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
if (require.main === module) {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey || !/^[0-9a-f]{64}$/i.test(encKey)) {
    console.error('FATAL: ENCRYPTION_KEY must be a 64-character hex string. Exiting.');
    process.exit(1);
  }
  initDb();
  startScheduler();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  app.listen(PORT, () => console.log(`bin-calendar running on port ${PORT}`));
}

module.exports = { app };
