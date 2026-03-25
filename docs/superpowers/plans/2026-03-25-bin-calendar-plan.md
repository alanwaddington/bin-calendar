# Implementation Plan: bin-calendar

**Spec:** docs/superpowers/specs/2026-03-25-bin-calendar-design.md
**Date:** 2026-03-25
**Status:** Ready

---

## Overview

This plan builds bin-calendar from scratch: a Node.js + Express Docker application hosted on a Synology NAS that fetches East Ayrshire Council bin collection schedules via ICS and syncs them to Google Calendar or iCloud. It covers the full stack — database, encryption, calendar integrations, sync engine, web UI, and CI/CD — in dependency order.

---

## Steps

### Step 1: Initialise npm project and install dependencies

**What:** Create `package.json` with all required dependencies and scripts.
**File:** `package.json` (create)
**Change:**
```json
{
  "name": "bin-calendar",
  "version": "1.0.0",
  "description": "Sync East Ayrshire bin collection schedules to Google Calendar or iCloud",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "express": "^4.18.3",
    "googleapis": "^140.0.0",
    "node-cron": "^3.0.3",
    "node-ical": "^0.19.0",
    "tsdav": "^2.0.10"
  }
}
```

**Verify:** Run `npm install` — `node_modules/` is created with no errors.
**Depends on:** none

---

### Step 2: Create environment variable template

**What:** Document all environment variables with descriptions and example values.
**File:** `.env.example` (create)
**Change:**
```bash
# Required — 64-character hex string (run: openssl rand -hex 32)
ENCRYPTION_KEY=

# Required for Google Calendar integration
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://<nas-ip>:3000/auth/google/callback

# Optional — disables address lookup if absent
GETADDRESS_API_KEY=

# Optional — internal Express port (default: 3000)
PORT=3000
```

**Verify:** File exists at `.env.example`. All variables from the spec are present.
**Depends on:** none

---

### Step 3: Create AES-256-GCM encryption utility

**What:** Implement encrypt and decrypt functions using AES-256-GCM with a random IV per operation. Key is sourced from `ENCRYPTION_KEY` (64-char hex = 32 bytes).
**File:** `src/crypto.js` (create)
**Change:**
```js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(12) + authTag(16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function encryptJson(obj) {
  return encrypt(JSON.stringify(obj));
}

function decryptJson(ciphertext) {
  return JSON.parse(decrypt(ciphertext));
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson };
```

**Verify:** In Node REPL:
```js
const { encryptJson, decryptJson } = require('./src/crypto');
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
const c = encryptJson({ test: 1 });
console.log(decryptJson(c)); // { test: 1 }
```
**Depends on:** Step 1 (node_modules present for require to work)

---

### Step 4: Create initial database migration

**What:** SQL file defining all tables, indexes, and the `updated_at` trigger for `properties`.
**File:** `src/migrations/001.sql` (create)
**Change:**
```sql
CREATE TABLE IF NOT EXISTS properties (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  uprn         TEXT NOT NULL,
  calendar_type TEXT NOT NULL CHECK(calendar_type IN ('google', 'icloud')),
  calendar_id  TEXT,
  credentials  TEXT,
  created_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at   DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS properties_updated_at
AFTER UPDATE ON properties
BEGIN
  UPDATE properties SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  completed_at DATETIME,
  status       TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','skipped')),
  error        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_runs_running
ON sync_runs (status) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS sync_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  property_id    INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  events_added   INTEGER NOT NULL DEFAULT 0,
  events_skipped INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  started_at     DATETIME,
  completed_at   DATETIME
);

CREATE TABLE IF NOT EXISTS oauth_state (
  nonce       TEXT PRIMARY KEY,
  property_id INTEGER NOT NULL,
  expires_at  DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
);
```

**Verify:** File exists at `src/migrations/001.sql`. SQL is valid — copy/paste into `sqlite3 :memory:` and run; no errors.
**Depends on:** none

---

### Step 5: Create database module

**What:** Open the SQLite connection, run pending migrations on startup, and expose helper functions used across the app.
**File:** `src/db.js` (create)
**Change:**
```js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/app/data/bin-calendar.db';
let db;

function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations();
  recoverInterruptedSyncs();
  return db;
}

function applyMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = db.prepare('SELECT version FROM schema_version').pluck().all();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = parseInt(file, 10);
    if (applied.includes(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    console.log(`Applied migration ${file}`);
  }
}

function recoverInterruptedSyncs() {
  const result = db.prepare(
    `UPDATE sync_runs SET status = 'failed', error = 'Interrupted by restart', completed_at = datetime('now')
     WHERE status = 'running'`
  ).run();
  if (result.changes > 0) {
    console.warn(`Recovered ${result.changes} interrupted sync run(s)`);
  }
}

module.exports = { initDb, getDb };
```

**Verify:** `node -e "require('./src/db').initDb()"` — no errors, `bin-calendar.db` is created (set `DB_PATH=./test.db` temporarily).
**Depends on:** Steps 3 (crypto used later), 4 (migration file must exist)

---

### Step 6: Create ICS fetch and parse module

**What:** POST to EAC endpoint with retry/backoff, parse VEVENT blocks, return structured events.
**File:** `src/ics.js` (create)
**Change:**
```js
const ical = require('node-ical');

const EAC_URL = 'https://www.east-ayrshire.gov.uk/WasteCalendarICSDownload';
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

async function fetchWithRetry(uprn) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(EAC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `uprn=${encodeURIComponent(uprn)}&captchaResponse=`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`ICS fetch failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

function parseIcs(icsText) {
  const parsed = ical.sync.parseICS(icsText);
  const events = [];
  const warnings = [];

  for (const [, entry] of Object.entries(parsed)) {
    if (entry.type !== 'VEVENT') continue;
    if (!entry.uid) {
      warnings.push('VEVENT missing UID — skipped');
      continue;
    }
    events.push({
      uid: entry.uid,
      summary: entry.summary,
      start: entry.start,
      end: entry.end,
      description: entry.description || '',
    });
  }

  return { events, warnings };
}

async function fetchIcs(uprn) {
  const icsText = await fetchWithRetry(uprn);
  return parseIcs(icsText);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchIcs };
```

**Verify:** Run with a real UPRN (requires network):
```js
const { fetchIcs } = require('./src/ics');
fetchIcs('127053058').then(r => console.log(r.events.length, 'events')).catch(console.error);
```
Expect >0 events returned.
**Depends on:** Step 1 (`node-ical` installed)

---

### Step 7: Create UPRN lookup module

**What:** Server-side proxy to getAddress.io — takes a postcode, returns `[{ address, uprn }]`.
**File:** `src/uprn.js` (create)
**Change:**
```js
const TIMEOUT_MS = 5_000;

async function lookupPostcode(postcode) {
  const apiKey = process.env.GETADDRESS_API_KEY;
  if (!apiKey) throw new Error('GETADDRESS_API_KEY not configured');

  const url = `https://api.getAddress.io/autocomplete/${encodeURIComponent(postcode)}?api-key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 404) return []; // no results for postcode
    if (!res.ok) throw new Error(`getAddress.io error: HTTP ${res.status}`);
    const data = await res.json();
    // getAddress.io autocomplete returns { suggestions: [{ address, url }] }
    // UPRN is embedded in the url field: /get/{postcode}/{id}
    // We fetch each suggestion's detail to get the UPRN
    return (data.suggestions || []).map(s => ({
      address: s.address,
      id: s.url, // relative URL used to fetch full detail with UPRN
    }));
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Address lookup timed out');
    throw err;
  }
}

async function getAddressDetail(id) {
  const apiKey = process.env.GETADDRESS_API_KEY;
  const url = `https://api.getAddress.io${id}?api-key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { uprn: data.uprn, address: data.formatted_address?.join(', ') };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Address detail lookup timed out');
    throw err;
  }
}

module.exports = { lookupPostcode, getAddressDetail };
```

**Verify:** With `GETADDRESS_API_KEY` set and a valid UK postcode:
```js
const { lookupPostcode } = require('./src/uprn');
lookupPostcode('KA1 1AB').then(console.log).catch(console.error);
```
Expect array of address suggestions.
**Depends on:** Step 1

---

### Step 8: Create Google Calendar module

**What:** OAuth2 URL generation, token exchange, token refresh + persistence, event list and insert.
**File:** `src/google.js` (create)
**Change:**
```js
const { google } = require('googleapis');
const { encryptJson, decryptJson } = require('./crypto');
const { getDb } = require('./db');

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getAuthUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({ access_type: 'offline', scope: SCOPE, state, prompt: 'consent' });
}

async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date }
}

async function getAuthenticatedClient(property) {
  const creds = decryptJson(property.credentials);
  const client = createOAuthClient();
  client.setCredentials(creds);

  // Refresh if expired (expiry_date is ms since epoch)
  if (creds.expiry_date && Date.now() > creds.expiry_date - 60_000) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    // Persist updated tokens
    getDb()
      .prepare('UPDATE properties SET credentials = ? WHERE id = ?')
      .run(encryptJson(credentials), property.id);
  }

  return client;
}

async function listEvents(property, timeMin, timeMax) {
  const auth = await getAuthenticatedClient(property);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.list({
    calendarId: property.calendar_id,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
  });
  return res.data.items || [];
}

async function insertEvent(property, event) {
  const auth = await getAuthenticatedClient(property);
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.insert({
    calendarId: property.calendar_id,
    requestBody: {
      iCalUID: event.uid,
      summary: event.summary,
      start: { dateTime: event.start.toISOString() },
      end: { dateTime: event.end.toISOString() },
      description: event.description,
    },
  });
}

module.exports = { isGoogleConfigured, getAuthUrl, exchangeCode, listEvents, insertEvent };
```

**Verify:** Module loads without error: `node -e "require('./src/google')"` (requires env vars for full test).
**Depends on:** Steps 1, 3, 5

---

### Step 9: Create iCloud CalDAV module

**What:** Fetch calendar list from iCloud CalDAV, list existing events in a date range, write new events.
**File:** `src/icloud.js` (create)
**Change:**
```js
const { DAVClient } = require('tsdav');
const { decryptJson } = require('./crypto');

const CALDAV_URL = 'https://caldav.icloud.com';

async function createClient(credentials) {
  const { apple_id, app_specific_password } = credentials;
  const client = new DAVClient({
    serverUrl: CALDAV_URL,
    credentials: { username: apple_id, password: app_specific_password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  return client;
}

async function fetchCalendars(appleId, appPassword) {
  const client = await createClient({ apple_id: appleId, app_specific_password: appPassword });
  const account = await client.fetchPrincipalUrl();
  const collections = await client.fetchCalendars();
  return collections.map(c => ({ displayName: c.displayName, url: c.url }));
}

async function listEventUids(property, timeMin, timeMax) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  const objects = await client.fetchCalendarObjects({
    calendar: { url: property.calendar_id },
    timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() },
  });
  // Extract UIDs from iCalendar data
  const uids = new Set();
  for (const obj of objects) {
    const match = obj.data?.match(/^UID:(.+)$/m);
    if (match) uids.add(match[1].trim());
  }
  return uids;
}

async function insertEvent(property, event) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  const vcalendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bin-calendar//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SUMMARY:${event.summary}`,
    `DTSTART:${toIcsDate(event.start)}`,
    `DTEND:${toIcsDate(event.end)}`,
    event.description ? `DESCRIPTION:${event.description}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const url = `${property.calendar_id}${event.uid}.ics`;
  await client.createCalendarObject({
    calendar: { url: property.calendar_id },
    filename: `${event.uid}.ics`,
    iCalString: vcalendar,
  });
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

module.exports = { fetchCalendars, listEventUids, insertEvent };
```

**Verify:** Module loads: `node -e "require('./src/icloud')"`. Full test requires an Apple ID with app-specific password.
**Depends on:** Steps 1, 3

---

### Step 10: Create sync orchestrator

**What:** Full sync flow as specified — concurrency lock, per-property parallel execution, result recording, 90-day purge.
**File:** `src/sync.js` (create)
**Change:**
```js
const { getDb } = require('./db');
const { fetchIcs } = require('./ics');
const google = require('./google');
const icloud = require('./icloud');

async function runSync() {
  const db = getDb();

  // Acquire concurrency lock via exclusive transaction
  let runId;
  try {
    db.transaction(() => {
      const existing = db.prepare("SELECT id FROM sync_runs WHERE status = 'running'").get();
      if (existing) throw Object.assign(new Error('Sync already in progress'), { code: 'ALREADY_RUNNING' });
      const result = db.prepare("INSERT INTO sync_runs (status) VALUES ('running')").run();
      runId = result.lastInsertRowid;
    })();
  } catch (err) {
    if (err.code === 'ALREADY_RUNNING') return { status: 429, message: 'Sync already in progress' };
    throw err;
  }

  const updateRun = (status, error = null) =>
    db.prepare("UPDATE sync_runs SET status = ?, error = ?, completed_at = datetime('now') WHERE id = ?")
      .run(status, error, runId);

  try {
    // Collect eligible properties
    const properties = db.prepare(
      "SELECT * FROM properties WHERE credentials IS NOT NULL AND calendar_id IS NOT NULL"
    ).all();

    if (properties.length === 0) {
      updateRun('skipped');
      return { status: 200, message: 'Skipped — no properties configured' };
    }

    // Sync all properties in parallel
    const results = await Promise.all(properties.map(p => syncProperty(db, runId, p)));

    const failed = results.filter(r => r.error);
    const succeeded = results.filter(r => !r.error);
    const overallStatus = failed.length === 0 ? 'success'
      : succeeded.length === 0 ? 'failed' : 'partial';

    updateRun(overallStatus);
    purgeOldRecords(db);

    return { status: 200, runId, overallStatus, results };
  } catch (err) {
    updateRun('failed', err.message);
    throw err;
  }
}

async function syncProperty(db, runId, property) {
  const startedAt = new Date().toISOString();
  try {
    const { events, warnings } = await fetchIcs(property.uprn);

    if (events.length === 0) {
      writeResult(db, runId, property.id, 0, 0, warnings.join('; ') || null, startedAt);
      return { propertyId: property.id };
    }

    const dates = events.map(e => e.start);
    const timeMin = new Date(Math.min(...dates));
    const timeMax = new Date(Math.max(...dates));

    // Fetch existing event UIDs from target calendar
    let existingUids;
    if (property.calendar_type === 'google') {
      const existing = await google.listEvents(property, timeMin, timeMax);
      existingUids = new Set(existing.map(e => e.iCalUID));
    } else {
      existingUids = await icloud.listEventUids(property, timeMin, timeMax);
    }

    let added = 0, skipped = 0;
    for (const event of events) {
      if (existingUids.has(event.uid)) { skipped++; continue; }
      if (property.calendar_type === 'google') {
        await google.insertEvent(property, event);
      } else {
        await icloud.insertEvent(property, event);
      }
      added++;
    }

    writeResult(db, runId, property.id, added, skipped, warnings.join('; ') || null, startedAt);
    return { propertyId: property.id };
  } catch (err) {
    writeResult(db, runId, property.id, 0, 0, err.message, startedAt);
    return { propertyId: property.id, error: err.message };
  }
}

function writeResult(db, runId, propertyId, added, skipped, error, startedAt) {
  db.prepare(`
    INSERT INTO sync_results (run_id, property_id, events_added, events_skipped, error, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(runId, propertyId, added, skipped, error, startedAt);
}

function purgeOldRecords(db) {
  db.prepare("DELETE FROM sync_runs WHERE completed_at < datetime('now', '-90 days')").run();
}

module.exports = { runSync };
```

**Verify:** Module loads: `node -e "require('./src/sync')"`. End-to-end test requires configured DB and calendar credentials.
**Depends on:** Steps 5, 6, 8, 9

---

### Step 11: Create scheduler module

**What:** Configure `node-cron` to fire `runSync` at 00:00 on the 1st of each month.
**File:** `src/scheduler.js` (create)
**Change:**
```js
const cron = require('node-cron');
const { runSync } = require('./sync');

let task;

function startScheduler() {
  task = cron.schedule('0 0 1 * *', async () => {
    console.log('Scheduled sync starting...');
    try {
      const result = await runSync();
      console.log('Scheduled sync complete:', result.overallStatus || result.message);
    } catch (err) {
      console.error('Scheduled sync error:', err.message);
    }
  });
  console.log('Scheduler started — next sync on 1st of next month at 00:00');
}

function getNextSyncDate() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return next.toISOString();
}

function stopScheduler() {
  if (task) task.stop();
}

module.exports = { startScheduler, getNextSyncDate, stopScheduler };
```

**Verify:** Module loads: `node -e "const s = require('./src/scheduler'); console.log(s.getNextSyncDate())"` — prints the 1st of next month in ISO format.
**Depends on:** Steps 1, 10

---

### Step 12: Create Express server and all routes

**What:** Main entry point — startup sequence, all API routes, static file serving.
**File:** `src/server.js` (create)
**Change:**
```js
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

// ── Properties ─────────────────────────────────────────────────────────────
app.get('/api/properties', (req, res) => {
  const rows = getDb().prepare('SELECT id, label, uprn, calendar_type, calendar_id, created_at, updated_at, (credentials IS NOT NULL) as connected FROM properties').all();
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
  getDb().prepare('INSERT INTO oauth_state (nonce, property_id, expires_at) VALUES (?, ?, ?)')
    .run(nonce, req.params.propertyId, expiresAt);
  // Purge expired nonces
  getDb().prepare("DELETE FROM oauth_state WHERE expires_at < datetime('now')").run();
  const state = Buffer.from(JSON.stringify({ property_id: req.params.propertyId, nonce })).toString('base64url');
  res.redirect(getAuthUrl(state));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  let propertyId;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    propertyId = decoded.property_id;
    if (error) {
      getDb().prepare('DELETE FROM oauth_state WHERE property_id = ?').run(propertyId);
      return res.redirect('/properties?error=google_denied');
    }
    const row = getDb().prepare('SELECT * FROM oauth_state WHERE property_id = ? AND nonce = ?')
      .get(propertyId, decoded.nonce);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.redirect('/properties?error=oauth_expired');
    }
    getDb().prepare('DELETE FROM oauth_state WHERE nonce = ?').run(decoded.nonce);
    const tokens = await exchangeCode(code);
    getDb().prepare('UPDATE properties SET credentials = ? WHERE id = ?')
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
  const { apple_id, app_specific_password, calendar_url, calendar_name } = req.body;
  if (!apple_id || !app_specific_password || !calendar_url) return res.status(400).json({ error: 'Missing fields' });
  const creds = encryptJson({ apple_id, app_specific_password });
  getDb().prepare('UPDATE properties SET credentials = ?, calendar_id = ? WHERE id = ?')
    .run(creds, calendar_url, req.params.id);
  res.json({ ok: true });
});

// ── Sync ───────────────────────────────────────────────────────────────────
app.post('/api/sync', async (req, res) => {
  const result = await runSync();
  res.status(result.status).json(result);
});

app.get('/api/sync/runs', (req, res) => {
  const runs = getDb().prepare(
    'SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100'
  ).all();
  const results = getDb().prepare(
    'SELECT sr.*, p.label FROM sync_results sr LEFT JOIN properties p ON p.id = sr.property_id WHERE sr.run_id IN (SELECT id FROM sync_runs ORDER BY started_at DESC LIMIT 100)'
  ).all();
  res.json({ runs, results });
});

// ── UPRN Lookup ────────────────────────────────────────────────────────────
app.get('/api/uprn/lookup', async (req, res) => {
  if (!process.env.GETADDRESS_API_KEY) return res.status(503).json({ error: 'Address lookup not configured' });
  try {
    const suggestions = await lookupPostcode(req.query.postcode);
    res.json(suggestions);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/uprn/detail', async (req, res) => {
  if (!process.env.GETADDRESS_API_KEY) return res.status(503).json({ error: 'Address lookup not configured' });
  try {
    const detail = await getAddressDetail(req.query.id);
    res.json(detail);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Config endpoint (for UI feature flags) ─────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    googleConfigured: isGoogleConfigured(),
    addressLookupConfigured: !!process.env.GETADDRESS_API_KEY,
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => console.log(`bin-calendar running on port ${PORT}`));
```

**Verify:** `node src/server.js` starts without errors (requires `ENCRYPTION_KEY` set). `curl http://localhost:3000/health` returns `{"status":"ok","nextSync":"..."}`.
**Depends on:** Steps 3, 5, 7, 8, 9, 10, 11

---

### Step 13: Create HTML shell

**What:** Single-page HTML with sidebar layout — navigation and view containers for Dashboard, Properties, and Logs.
**File:** `public/index.html` (create)
**Change:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>bin-calendar</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <div class="sidebar-title">bin-calendar</div>
      <a href="#dashboard" class="nav-link active" data-view="dashboard">Dashboard</a>
      <a href="#properties" class="nav-link" data-view="properties">Properties</a>
      <a href="#logs" class="nav-link" data-view="logs">Logs</a>
    </nav>
    <main class="content">
      <div id="view-dashboard" class="view"></div>
      <div id="view-properties" class="view hidden"></div>
      <div id="view-logs" class="view hidden"></div>
    </main>
  </div>
  <script src="/app.js"></script>
  <script src="/dashboard.js"></script>
  <script src="/properties.js"></script>
  <script src="/logs.js"></script>
</body>
</html>
```

**Verify:** `open http://localhost:3000` (with server running) — page loads with sidebar visible. No JS errors in browser console.
**Depends on:** Step 12 (server must serve static files)

---

### Step 14: Create stylesheet

**What:** CSS for sidebar layout, cards, tables, forms, status badges, and responsive behaviour.
**File:** `public/style.css` (create)
**Change:**
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #212121; background: #f5f5f5; }

.layout { display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: 200px; background: #1e293b; color: #e2e8f0; display: flex; flex-direction: column; padding: 20px 0; flex-shrink: 0; }
.sidebar-title { font-size: 16px; font-weight: 700; padding: 0 20px 20px; color: #fff; }
.nav-link { display: block; padding: 10px 20px; color: #94a3b8; text-decoration: none; border-left: 3px solid transparent; }
.nav-link:hover { color: #e2e8f0; background: rgba(255,255,255,0.05); }
.nav-link.active { color: #fff; border-left-color: #3b82f6; background: rgba(255,255,255,0.08); }

/* Content */
.content { flex: 1; padding: 24px; overflow-y: auto; }
.view.hidden { display: none; }
h1 { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }

/* Cards */
.card { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 12px; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-bottom: 20px; }
.card-label { font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
.card-value { font-size: 15px; font-weight: 500; }

/* Status badges */
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.badge-success { background: #dcfce7; color: #166534; }
.badge-error { background: #fee2e2; color: #991b1b; }
.badge-warning { background: #fef9c3; color: #854d0e; }
.badge-running { background: #dbeafe; color: #1e40af; }
.badge-skipped { background: #f1f5f9; color: #475569; }

/* Table */
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
th { text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f8fafc; }

/* Buttons */
.btn { display: inline-block; padding: 7px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
.btn-primary { background: #3b82f6; color: #fff; }
.btn-primary:hover { background: #2563eb; }
.btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover { background: #dc2626; }
.btn-secondary { background: #f1f5f9; color: #334155; }
.btn-secondary:hover { background: #e2e8f0; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Forms */
.form-group { margin-bottom: 14px; }
label { display: block; font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 4px; }
input, select { width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }
input:focus, select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
.form-error { color: #dc2626; font-size: 12px; margin-top: 4px; }
.form-actions { display: flex; gap: 8px; margin-top: 18px; }

/* Modal overlay */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 10px; padding: 24px; width: 480px; max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.modal-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.modal-overlay.hidden { display: none; }

/* Sync status bar */
.sync-bar { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

/* Logs */
.log-run { background: #fff; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.07); overflow: hidden; }
.log-run-header { padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
.log-run-header:hover { background: #f8fafc; }
.log-run-body { display: none; border-top: 1px solid #f1f5f9; padding: 10px 14px; }
.log-run-body.open { display: block; }
.log-result { font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f8fafc; }
```

**Verify:** Refresh browser — sidebar has correct colours, layout has no overflow issues.
**Depends on:** Step 13

---

### Step 15: Create client-side app shell and routing

**What:** Client-side router, shared API helper, view switching logic, URL hash routing.
**File:** `public/app.js` (create)
**Change:**
```js
// ── Config ─────────────────────────────────────────────────────────────────
let CONFIG = {};
fetch('/api/config').then(r => r.json()).then(c => { CONFIG = c; });

// ── API helper ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Router ─────────────────────────────────────────────────────────────────
const views = { dashboard: null, properties: null, logs: null };

function navigate(view) {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('hidden', !el.id.endsWith(view));
  });
  location.hash = view;
  if (views[view]) views[view]();
}

document.querySelectorAll('.nav-link').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.view); });
});

// Handle URL hash on load and handle OAuth redirect query params
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  if (params.has('success') || params.has('error')) {
    history.replaceState({}, '', location.pathname + '#properties');
  }
  const hash = location.hash.replace('#', '') || 'dashboard';
  navigate(['dashboard', 'properties', 'logs'].includes(hash) ? hash : 'dashboard');
});

// ── Register view loaders ──────────────────────────────────────────────────
function registerView(name, loader) { views[name] = loader; }

// ── Toast notifications ────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:6px;color:#fff;font-size:13px;z-index:999;background:${type === 'error' ? '#ef4444' : '#22c55e'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
```

**Verify:** Browser console shows no errors. Clicking nav links switches views and updates URL hash.
**Depends on:** Steps 13, 14

---

### Step 16: Create Dashboard view

**What:** Property status cards, Sync Now button with in-progress state, next sync date.
**File:** `public/dashboard.js` (create)
**Change:**
```js
registerView('dashboard', loadDashboard);

async function loadDashboard() {
  const el = document.getElementById('view-dashboard');
  el.innerHTML = '<h1>Dashboard</h1><div id="sync-bar"></div><div id="property-cards" class="card-grid"></div>';
  await renderDashboard();
}

async function renderDashboard() {
  const [properties, { runs }] = await Promise.all([
    api('GET', '/api/properties'),
    api('GET', '/api/sync/runs'),
  ]);
  const lastRun = runs[0];
  const nextSync = await fetch('/health').then(r => r.json()).then(d => d.nextSync);

  const bar = document.getElementById('sync-bar');
  const isRunning = lastRun?.status === 'running';
  bar.innerHTML = `
    <div>
      <span>Next sync: <strong>${new Date(nextSync).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</strong></span>
      ${lastRun ? `&nbsp;·&nbsp; Last run: <span class="badge badge-${lastRun.status}">${lastRun.status}</span>` : ''}
    </div>
    <button class="btn btn-primary" id="sync-now-btn" ${isRunning ? 'disabled' : ''}>
      ${isRunning ? 'Sync in progress...' : 'Sync Now'}
    </button>`;

  document.getElementById('sync-now-btn')?.addEventListener('click', async () => {
    document.getElementById('sync-now-btn').disabled = true;
    document.getElementById('sync-now-btn').textContent = 'Sync in progress...';
    try {
      await api('POST', '/api/sync');
      showToast('Sync complete');
    } catch (err) {
      showToast(err.message, 'error');
    }
    await renderDashboard();
  });

  const cards = document.getElementById('property-cards');
  if (properties.length === 0) {
    cards.innerHTML = '<p style="color:#64748b">No properties configured. Go to <a href="#properties" onclick="navigate(\'properties\')">Properties</a> to add one.</p>';
    return;
  }
  cards.innerHTML = properties.map(p => {
    const connected = p.connected;
    return `<div class="card">
      <div class="card-label">${p.calendar_type === 'google' ? 'Google Calendar' : 'iCloud'}</div>
      <div class="card-value">${p.label}</div>
      <div style="margin-top:6px;font-size:12px;color:#64748b">UPRN: ${p.uprn}</div>
      <div style="margin-top:8px">
        ${connected ? '<span class="badge badge-success">Connected</span>' : '<span class="badge badge-warning">Not connected</span>'}
      </div>
    </div>`;
  }).join('');
}
```

**Verify:** Dashboard loads property cards. "Sync Now" button triggers sync and disables during run.
**Depends on:** Step 15

---

### Step 17: Create Properties view

**What:** Properties table with Add/Edit/Delete, modal form with Google OAuth trigger and iCloud Fetch Calendars, UPRN address lookup.
**File:** `public/properties.js` (create)
**Change:**
```js
registerView('properties', loadProperties);

// Show toast for OAuth redirect results
const params = new URLSearchParams(location.search);
if (params.get('success') === 'google_connected') showToast('Google Calendar connected');
if (params.get('error')) showToast({ oauth_expired: 'OAuth session expired', google_denied: 'Google access denied', oauth_failed: 'Connection failed' }[params.get('error')] || 'Error', 'error');

async function loadProperties() {
  const el = document.getElementById('view-properties');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Properties</h1>
      <button class="btn btn-primary" onclick="openPropertyModal()">+ Add Property</button>
    </div>
    <div id="properties-table"></div>
    <div class="modal-overlay hidden" id="property-modal">
      <div class="modal">
        <div class="modal-title" id="modal-title">Add Property</div>
        <div id="modal-body"></div>
      </div>
    </div>`;
  await renderPropertiesTable();
}

async function renderPropertiesTable() {
  const properties = await api('GET', '/api/properties');
  const el = document.getElementById('properties-table');
  if (properties.length === 0) {
    el.innerHTML = '<p style="color:#64748b;padding:16px 0">No properties yet.</p>';
    return;
  }
  el.innerHTML = `<table>
    <thead><tr><th>Label</th><th>UPRN</th><th>Calendar</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${properties.map(p => `<tr>
      <td>${p.label}</td>
      <td><code>${p.uprn}</code></td>
      <td>${p.calendar_type === 'google' ? 'Google' : 'iCloud'}</td>
      <td>${p.connected ? '<span class="badge badge-success">Connected</span>' : '<span class="badge badge-warning">Not connected</span>'}</td>
      <td>
        ${!p.connected && p.calendar_type === 'google' ? `<button class="btn btn-sm btn-secondary" onclick="reconnectGoogle(${p.id})">Reconnect</button> ` : ''}
        <button class="btn btn-sm btn-danger" onclick="deleteProperty(${p.id})">Delete</button>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function openPropertyModal(id) {
  document.getElementById('property-modal').classList.remove('hidden');
  renderPropertyForm(id);
}
function closeModal() { document.getElementById('property-modal').classList.add('hidden'); }

async function renderPropertyForm(id) {
  const body = document.getElementById('modal-body');
  const isGoogle = (type) => type === 'google';

  body.innerHTML = `
    ${CONFIG.addressLookupConfigured ? `
    <div class="form-group">
      <label>Find address by postcode</label>
      <div style="display:flex;gap:8px">
        <input id="postcode-input" placeholder="e.g. KA1 1AB">
        <button class="btn btn-secondary" type="button" onclick="lookupAddress()">Search</button>
      </div>
      <div id="address-results" style="margin-top:6px"></div>
    </div>` : ''}
    <div class="form-group"><label>Label</label><input id="prop-label" placeholder="e.g. Home"></div>
    <div class="form-group"><label>UPRN</label><input id="prop-uprn" placeholder="e.g. 127053058"></div>
    <div class="form-group">
      <label>Calendar type</label>
      <select id="prop-type" onchange="renderCalendarFields()">
        <option value="">Select...</option>
        <option value="google" ${!CONFIG.googleConfigured ? 'disabled' : ''}>Google Calendar${!CONFIG.googleConfigured ? ' (not configured)' : ''}</option>
        <option value="icloud">iCloud</option>
      </select>
    </div>
    <div id="calendar-fields"></div>
    <div id="form-error" class="form-error"></div>`;
}

function renderCalendarFields() {
  const type = document.getElementById('prop-type').value;
  const el = document.getElementById('calendar-fields');
  if (type === 'google') {
    el.innerHTML = `<div class="form-actions">
      <button class="btn btn-primary" onclick="saveAndConnectGoogle()">Save & Connect Google Calendar</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`;
  } else if (type === 'icloud') {
    el.innerHTML = `
      <div class="form-group"><label>Apple ID</label><input id="apple-id" type="email"></div>
      <div class="form-group"><label>App-specific password <a href="https://appleid.apple.com/account/manage" target="_blank" style="font-weight:normal;font-size:11px">(generate at appleid.apple.com)</a></label><input id="apple-pass" type="password"></div>
      <div class="form-group">
        <button class="btn btn-secondary" type="button" onclick="fetchIcloudCalendars()">Fetch Calendars</button>
        <div id="calendar-select" style="margin-top:8px"></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="saveIcloud()">Save</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

async function lookupAddress() {
  const postcode = document.getElementById('postcode-input').value.trim();
  const el = document.getElementById('address-results');
  el.textContent = 'Searching...';
  try {
    const suggestions = await api('GET', `/api/uprn/lookup?postcode=${encodeURIComponent(postcode)}`);
    if (suggestions.length === 0) { el.textContent = 'No addresses found for that postcode'; return; }
    el.innerHTML = `<select id="address-select" style="width:100%"><option value="">Select address...</option>
      ${suggestions.map(s => `<option value="${s.id}">${s.address}</option>`).join('')}
    </select>`;
    document.getElementById('address-select').addEventListener('change', async function() {
      if (!this.value) return;
      const detail = await api('GET', `/api/uprn/detail?id=${encodeURIComponent(this.value)}`);
      document.getElementById('prop-uprn').value = detail.uprn;
    });
  } catch (err) {
    el.textContent = `Address lookup unavailable — enter your UPRN manually`;
  }
}

async function saveAndConnectGoogle() {
  const label = document.getElementById('prop-label').value.trim();
  const uprn = document.getElementById('prop-uprn').value.trim();
  if (!label || !uprn) { document.getElementById('form-error').textContent = 'Label and UPRN are required'; return; }
  const { id } = await api('POST', '/api/properties', { label, uprn, calendar_type: 'google' });
  window.location.href = `/auth/google/start/${id}`;
}

async function fetchIcloudCalendars() {
  const appleId = document.getElementById('apple-id').value.trim();
  const pass = document.getElementById('apple-pass').value.trim();
  const el = document.getElementById('calendar-select');
  el.textContent = 'Fetching calendars...';
  try {
    const cals = await api('POST', '/api/icloud/calendars', { apple_id: appleId, app_specific_password: pass });
    el.innerHTML = `<select id="cal-url" style="width:100%"><option value="">Select calendar...</option>
      ${cals.map(c => `<option value="${c.url}">${c.displayName}</option>`).join('')}
    </select>`;
  } catch (err) {
    el.textContent = `Error: ${err.message}`;
  }
}

async function saveIcloud() {
  const label = document.getElementById('prop-label').value.trim();
  const uprn = document.getElementById('prop-uprn').value.trim();
  const appleId = document.getElementById('apple-id').value.trim();
  const pass = document.getElementById('apple-pass').value.trim();
  const calUrl = document.getElementById('cal-url')?.value;
  if (!label || !uprn || !appleId || !pass || !calUrl) {
    document.getElementById('form-error').textContent = 'All fields are required';
    return;
  }
  const { id } = await api('POST', '/api/properties', { label, uprn, calendar_type: 'icloud' });
  await api('POST', `/api/properties/${id}/icloud`, { apple_id: appleId, app_specific_password: pass, calendar_url: calUrl });
  closeModal();
  showToast('iCloud calendar connected');
  await renderPropertiesTable();
}

async function deleteProperty(id) {
  if (!confirm('Delete this property? Sync logs will be retained.')) return;
  await api('DELETE', `/api/properties/${id}`);
  await renderPropertiesTable();
}

function reconnectGoogle(id) {
  window.location.href = `/auth/google/start/${id}`;
}
```

**Verify:** Properties table renders. Add Property modal opens. Address lookup (if configured) populates UPRN. Google connect redirects to Google. iCloud flow fetches calendars and saves.
**Depends on:** Step 15

---

### Step 18: Create Logs view

**What:** Scrollable sync run list, expandable per-property results, status badges, duration display.
**File:** `public/logs.js` (create)
**Change:**
```js
registerView('logs', loadLogs);

async function loadLogs() {
  const el = document.getElementById('view-logs');
  el.innerHTML = '<h1>Logs</h1><div id="logs-list"></div>';
  const { runs, results } = await api('GET', '/api/sync/runs');

  const list = document.getElementById('logs-list');
  if (runs.length === 0) {
    list.innerHTML = '<p style="color:#64748b">No sync runs yet.</p>';
    return;
  }

  list.innerHTML = runs.map(run => {
    const runResults = results.filter(r => r.run_id === run.id);
    const duration = run.completed_at
      ? Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000) + 's'
      : '—';
    return `<div class="log-run">
      <div class="log-run-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="badge badge-${run.status}">${run.status}</span>
        <span style="font-size:13px">${new Date(run.started_at).toLocaleString('en-GB')}</span>
        <span style="font-size:12px;color:#64748b;margin-left:auto">${duration}</span>
        ${run.error ? `<span style="font-size:12px;color:#dc2626">${run.error}</span>` : ''}
      </div>
      <div class="log-run-body">
        ${runResults.length === 0
          ? '<div class="log-result" style="color:#64748b">No property results</div>'
          : runResults.map(r => {
              const label = r.label || '(deleted property)';
              const dur = r.started_at && r.completed_at
                ? Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 1000) + 's'
                : '';
              return `<div class="log-result">
                <strong>${label}</strong>
                — added: ${r.events_added}, skipped: ${r.events_skipped}
                ${dur ? `(${dur})` : ''}
                ${r.error ? `<span style="color:#dc2626"> — ${r.error}</span>` : ''}
              </div>`;
            }).join('')}
      </div>
    </div>`;
  }).join('');
}
```

**Verify:** Logs view renders run list. Clicking a run header expands/collapses results. Duration and status badges display correctly.
**Depends on:** Step 15

---

### Step 19: Create Dockerfile

**What:** Node.js Alpine image, non-root user, copies source, installs production dependencies.
**File:** `Dockerfile` (create)
**Change:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

CMD ["node", "src/server.js"]
```

**Verify:** `docker build -t bin-calendar .` completes without errors. `docker run --rm -e ENCRYPTION_KEY=$(openssl rand -hex 32) bin-calendar` starts and logs `bin-calendar running on port 3000`.
**Depends on:** Steps 1–18 (all source files must exist)

---

### Step 20: Create docker-compose file

**What:** Compose configuration for local and NAS deployment, with healthcheck and volume.
**File:** `docker-compose.yml` (create)
**Change:**
```yaml
services:
  bin-calendar:
    image: ghcr.io/${GITHUB_REPOSITORY_OWNER:-local}/bin-calendar:latest
    container_name: bin-calendar
    build: .
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:${PORT:-3000}"
    volumes:
      - ./data:/app/data
    environment:
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
      - GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI:-http://localhost:3000/auth/google/callback}
      - GETADDRESS_API_KEY=${GETADDRESS_API_KEY:-}
      - PORT=${PORT:-3000}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${PORT:-3000}/health"]
      interval: 60s
      timeout: 5s
      retries: 3
```

**Verify:** Copy `.env.example` to `.env`, fill in `ENCRYPTION_KEY`, run `docker compose up --build`. UI accessible at `http://localhost:3000`.
**Depends on:** Step 19

---

### Step 21: Create GitHub Actions workflow

**What:** Build and push Docker image to GHCR on every push to `main`, tagged with both `latest` and commit SHA.
**File:** `.github/workflows/build.yml` (create)
**Change:**
```yaml
name: Build and push

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/bin-calendar:latest
            ghcr.io/${{ github.repository_owner }}/bin-calendar:${{ github.sha }}
```

**Verify:** Push to `main` — Actions tab on GitHub shows workflow running. After completion, `ghcr.io/<owner>/bin-calendar:latest` is visible in GitHub Packages.
**Depends on:** Step 19 (Dockerfile must exist before pushing)

---

### Step 22: [MANUAL] Push project to GitHub

**What:** Push the local repository to `alanwaddington/bin-calendar` on GitHub to trigger the first CI build.
**File:** none (git operation)
**Change:**
```bash
git remote add origin https://github.com/alanwaddington/bin-calendar.git
git push -u origin main
```

**Verify:** GitHub Actions workflow starts automatically. After ~2 minutes, the image appears at `ghcr.io/alanwaddington/bin-calendar:latest`.
**Depends on:** Step 21

---

### Step 23: [MANUAL] Set up Google Cloud project

**What:** Create OAuth2 credentials in Google Cloud Console for the Calendar API.
**File:** none (external system)
**Change:**
1. Go to console.cloud.google.com → create a new project named `bin-calendar`
2. Enable **Google Calendar API**
3. Go to APIs & Services → OAuth consent screen → set to **Testing**, add your Google account as a test user
4. Go to Credentials → Create Credentials → **OAuth client ID** → type: **Web application**
5. Add authorised redirect URI: `http://<nas-ip>:3000/auth/google/callback`
6. Copy the **Client ID** and **Client Secret** into `docker-compose.yml`

**Verify:** Client ID and Secret copied to compose file. Test by running the app locally and visiting `/auth/google/start/<property-id>` — Google consent screen should appear.
**Depends on:** Step 22 (must have the redirect URI finalized)

---

### Step 24: [MANUAL] Deploy on Synology NAS

**What:** Pull the image from GHCR and start the container via Synology Container Manager.
**File:** none (NAS setup)
**Change:**
Follow the deployment steps from the spec:
1. SSH into NAS: `mkdir -p /volume1/docker/bin-calendar/data`
2. Generate encryption key: `openssl rand -hex 32` → save to password manager
3. Create `/volume1/docker/bin-calendar/docker-compose.yml` with all env vars filled in
4. `docker pull ghcr.io/alanwaddington/bin-calendar:latest`
5. `cd /volume1/docker/bin-calendar && docker compose up -d`
6. Open `http://<nas-ip>:3000`

**Verify:** `http://<nas-ip>:3000/health` returns `{"status":"ok","nextSync":"..."}`. Container Manager shows container as healthy.
**Depends on:** Steps 22, 23
