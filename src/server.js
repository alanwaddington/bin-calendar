const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { initDb, getDb } = require('./db');
const { runSync } = require('./sync');
const cron = require('node-cron');
const { startScheduler, getNextSyncDate, restartSyncSchedule, DEFAULT_CRON } = require('./scheduler');
const { isGoogleConfigured, getAuthUrl, exchangeCode, listCalendars } = require('./google');
const { fetchCalendars } = require('./icloud');
const { encryptJson } = require('./crypto');
const { checkSingleCredential } = require('./credential-check');
const { matchesOutsideParentheses, splitSummarySegments } = require('./bin-types');

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
  });
});

// ── Properties ─────────────────────────────────────────────────────────────
app.get('/api/properties', (req, res) => {
  const rows = getDb().prepare(
    'SELECT id, label, ics_url, calendar_type, calendar_id, garden_waste_opted_in, created_at, updated_at, (credentials IS NOT NULL) as connected, credential_status, credential_checked_at FROM properties'
  ).all();
  res.json(rows);
});

function isValidIcsUrl(url) {
  return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('webcal://'));
}

// Coerces a client-supplied opt-in value to a clean SQLite-storable 0/1.
// Only an explicit true/1/'1'/'true' counts as opted-in - everything else
// (including the classic 'false' string footgun, which plain JS truthiness
// would get wrong) coerces to 0, never throws, so a malformed body can
// never 500 here.
function toBoolInt(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

app.post('/api/properties', (req, res) => {
  const { label, ics_url, calendar_type, garden_waste_opted_in } = req.body;
  if (!label || !ics_url || !calendar_type) return res.status(400).json({ error: 'Missing fields' });
  if (!isValidIcsUrl(ics_url)) return res.status(400).json({ error: 'Invalid ICS URL: must start with https:// or webcal://' });
  const result = getDb().prepare(
    'INSERT INTO properties (label, uprn, ics_url, calendar_type, calendar_id, garden_waste_opted_in) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(label, '', ics_url, calendar_type, calendar_type === 'google' ? 'primary' : null, toBoolInt(garden_waste_opted_in));
  res.status(201).json({ id: result.lastInsertRowid });
});

app.put('/api/properties/:id', (req, res) => {
  const { label, ics_url, garden_waste_opted_in } = req.body;
  if (!label || !ics_url) return res.status(400).json({ error: 'Missing fields' });
  if (!isValidIcsUrl(ics_url)) return res.status(400).json({ error: 'Invalid ICS URL: must start with https:// or webcal://' });
  // garden_waste_opted_in is only touched when the caller actually sends it
  // - omitting it must preserve whatever the property is already set to,
  // not reset it to a default (unlike POST, where there's no prior value
  // to preserve).
  if (garden_waste_opted_in === undefined) {
    getDb().prepare('UPDATE properties SET label = ?, ics_url = ? WHERE id = ?').run(label, ics_url, req.params.id);
  } else {
    getDb().prepare('UPDATE properties SET label = ?, ics_url = ?, garden_waste_opted_in = ? WHERE id = ?')
      .run(label, ics_url, toBoolInt(garden_waste_opted_in), req.params.id);
  }
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

// A bin_types rule's label can relate to the raw ICS summary it matched in
// three different ways, and each needs different treatment to never lose
// or fabricate information:
//   - label === summary (case/whitespace-insensitive): show the label in
//     its configured casing, e.g. "FOO COLLECTION" not "foo collection".
//   - summary contains the label: the feed is strictly more specific than
//     the label (e.g. "Trolley" matches "Trolley+food"), so show the feed
//     text alone rather than stuttering "Trolley (Trolley+food)". This
//     also covers case-insensitive duplicates like "Garden Waste" matching
//     "Garden waste" - containment, not splicing, so it can never produce
//     "Garden Waste waste".
//   - otherwise: label and summary say different things, so show both -
//     "General Waste (Trolley+food)" - never discard the raw summary by
//     assuming the label already covers it.
function formatMatchedLabel(label, summary) {
  const normalisedLabel = label.trim().toLowerCase();
  const trimmedSummary = summary.trim();
  const normalisedSummary = trimmedSummary.toLowerCase();
  if (normalisedSummary === normalisedLabel) return label;
  if (normalisedSummary.includes(normalisedLabel)) return trimmedSummary;
  return `${label} (${summary})`;
}

// Finds which segment of a (possibly "X and Y"-combined) summary a specific
// bin_types match actually belongs to, so formatMatchedLabel only sees the
// text relevant to THAT match. Falls back to the whole summary when there's
// nothing to split (the common case - no "and" present, e.g. the
// pre-existing "Grey/Blue Mixed Bin" multi-match case) or - defensively -
// when the match can't be attributed to exactly one segment, so this can
// never produce a worse result than passing the whole summary through.
function attributeSummarySegment(summary, matchText) {
  const segments = splitSummarySegments(summary);
  if (segments.length < 2) return summary;
  const lowerMatch = matchText.toLowerCase();
  const owner = segments.find(seg => seg.toLowerCase().includes(lowerMatch));
  return owner || summary;
}

// Fans out to one row per matching bin_types rule when an event's summary
// matches more than one, rather than silently picking one match over the
// others. Real feed data does this for a genuine reason: East Ayrshire
// sometimes combines two separate collections into one VEVENT's summary
// instead of sending two VEVENTs (e.g. "Garden waste and general
// waste+food (+food only after transition week)" on one transitional
// date). Both endpoints that join events to bin_types use this same join,
// so they agree on how many rows one event produces.
const BIN_TYPE_JOIN_SQL = `LEFT JOIN bin_types bt ON e.summary LIKE '%' || bt.summary_match || '%'`;

// The fan-out join above matches against the whole summary, parentheses
// included - so a bin_types rule whose Match text happens to appear only
// inside someone else's caveat (real-world case: a "Transition Week" rule
// matching the words "transition week" buried inside "(+food only after
// transition week)" on an unrelated General Waste day) produces a false
// positive: a second, spurious marker for a day that isn't actually a
// transition week. This removes exactly those candidate rows - per event
// (grouped by uid), keeping only matches whose text appears outside any
// parenthetical span. If that empties out every match for one event, falls
// back to a single unmatched row rather than silently dropping the event
// from the calendar - a real collection must never vanish just because its
// only visible bin_types match turned out to be a false positive.
function excludeParenthesesOnlyMatches(rows) {
  const byUid = new Map();
  for (const r of rows) {
    if (!byUid.has(r.uid)) byUid.set(r.uid, []);
    byUid.get(r.uid).push(r);
  }

  const result = [];
  for (const group of byUid.values()) {
    const kept = group.filter(r =>
      !r.binTypeMatch || matchesOutsideParentheses(r.summary, r.binTypeMatch)
    );
    if (kept.length > 0) {
      result.push(...kept);
    } else {
      result.push({ ...group[0], label: null, colour: null, binTypeMatch: null, is_garden_waste: 0 });
    }
  }
  return result;
}

// #33: Garden Waste is a paid, opt-in add-on. The fan-out join already
// produces one row per matched bin_types rule, so dropping just the
// garden-waste row for an opted-out property naturally leaves any other
// match for the same event (e.g. the General Waste half of a combined
// "Garden waste and general waste+food (...)" day) intact - no separate
// combined-day handling needed here.
function excludeOptedOutGardenWaste(rows) {
  return rows.filter(r => !(r.is_garden_waste === 1 && r.garden_waste_opted_in === 0));
}

// Two different bin_types rules can legitimately share a label and colour
// (e.g. two Match patterns both labelled "General Waste"), and the fan-out
// join above has no way to know that - it produces one row per match
// regardless of whether the results are visually distinguishable. This
// collapses rows that are identical in every field the given keys cover
// down to one, so two rules matching the same summary with the same label
// and colour render as a single marker rather than two indistinguishable
// duplicates. Any row that differs in even one key field is always kept,
// however similar otherwise - this never collapses genuinely distinct bin
// types, only true duplicates.
function dedupeIdenticalRows(rows, keyFields) {
  const seen = new Set();
  return rows.filter(r => {
    const key = keyFields.map(f => r[f]).join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Defense in depth alongside sync.js's own validEndDate() at ingestion
// (which should mean this limit is never actually hit in practice) - this
// bounds the blast radius here too, independent of how a bad end_date might
// reach the events table (a future regression in cacheEvents, a direct DB
// write, a migration). 31 days is generous - the real "Transition week"
// span is 5 days - while a single corrupt/malformed end_date (e.g. a
// multi-century DTEND) could otherwise expand to hundreds of thousands of
// rows in one response.
const MAX_SPAN_DAYS = 31;

// ICS DTEND is exclusive (the day AFTER the last covered day), so a normal
// single-day all-day event stores end_date = start_date + 1 day and this
// returns exactly one day - no change from today's behaviour. A genuine
// multi-day span (e.g. East Ayrshire's "Transition week", which their own
// site shows on every weekday it covers, not just the first) expands to one
// entry per covered day. No end_date (or one <= start_date, which should
// never happen but must not loop) also falls back to a single day.
// Date arithmetic uses Date.UTC throughout - start_date/end_date are always
// UTC calendar-date strings (sync.js derives them via toISOString()), and
// pure UTC millisecond stepping has no DST edge cases to worry about.
function expandDateRange(startDate, endDate) {
  if (!endDate) return [startDate];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  if (end <= start) return [startDate];
  const days = [];
  const pad = n => String(n).padStart(2, '0');
  for (let t = start, n = 0; t < end && n < MAX_SPAN_DAYS; t += MS_PER_DAY, n++) {
    const d = new Date(t);
    days.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return days;
}

function getPropertyEventsRows(db, propertyId) {
  const rows = db.prepare(`
    SELECT e.uid, e.start_date AS date, e.end_date AS endDate, e.summary, bt.label, bt.colour, bt.summary_match AS binTypeMatch, bt.is_garden_waste, p.garden_waste_opted_in
    FROM events e
    JOIN properties p ON p.id = e.property_id
    ${BIN_TYPE_JOIN_SQL}
    WHERE e.property_id = ?
    ORDER BY e.start_date ASC, e.uid ASC, bt.id ASC
  `).all(propertyId);

  const filteredRows = excludeOptedOutGardenWaste(excludeParenthesesOnlyMatches(rows));

  // Stable-sorted by date (and uid as a tiebreak for same-date different
  // events) - ties between multiple matched rows for the SAME event keep
  // the bt.id ASC order the SQL already produced, so fan-out markers render
  // in a consistent, predictable order rather than whatever order the join
  // happened to return them in.
  const expanded = filteredRows
    .flatMap(r => expandDateRange(r.date, r.endDate).map(date => ({ ...r, date })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));

  return dedupeIdenticalRows(expanded.map(r => ({
    uid: r.uid,
    date: r.date,
    summary: r.summary,
    label: r.label ? formatMatchedLabel(r.label, attributeSummarySegment(r.summary, r.binTypeMatch)) : r.summary,
    colour: r.colour || '#6b7a99',
    matched: r.label != null,
  })), ['uid', 'date', 'label', 'colour']);
}

app.get('/api/properties/:id/events', (req, res) => {
  const db = getDb();
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  try {
    const events = getPropertyEventsRows(db, req.params.id);
    res.json({ events });
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

// ── Next Collection ────────────────────────────────────────────────────────
app.get('/api/next-collection', (req, res) => {
  const rows = getDb().prepare(`
    SELECT
      e.uid                AS uid,
      e.start_date        AS date,
      e.end_date           AS endDate,
      CAST((julianday(e.start_date) - julianday(date('now'))) AS INTEGER) AS days_until,
      e.summary,
      bt.label            AS label,
      bt.colour           AS colour,
      bt.summary_match    AS binTypeMatch,
      bt.is_garden_waste  AS is_garden_waste,
      p.garden_waste_opted_in AS garden_waste_opted_in,
      e.property_id,
      p.label             AS property_label
    FROM events e
    JOIN properties p ON p.id = e.property_id
    ${BIN_TYPE_JOIN_SQL}
    WHERE e.start_date >= date('now')
       OR (e.end_date IS NOT NULL AND e.end_date > date('now'))
    ORDER BY e.start_date ASC, bt.id ASC
  `).all();

  const filteredRows = excludeOptedOutGardenWaste(excludeParenthesesOnlyMatches(rows));

  // Expand each row's [start_date, end_date) span into one entry per
  // covered day, offsetting the SQL-computed days_until by the day's
  // position within the span - day 0 is the row's own start_date (whose
  // days_until SQL already got right), day 1 is start_date+1 (days_until+1),
  // and so on. This is what lets a span event already in progress (started
  // in the past, per the WHERE clause above) surface dated and days-until'd
  // for TODAY - the correct point within the span - rather than for its
  // (by now past) start_date, or vanishing once that start_date has passed.
  const expanded = filteredRows
    .flatMap(r => expandDateRange(r.date, r.endDate).map((date, i) => ({ ...r, date, days_until: r.days_until + i })))
    .filter(r => r.days_until >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const collections = dedupeIdenticalRows(expanded
    .filter(r => expanded[0] && r.date === expanded[0].date)
    .map(r => ({
      date: r.date,
      daysUntil: r.days_until,
      summary: r.summary,
      label: r.label ? formatMatchedLabel(r.label, attributeSummarySegment(r.summary, r.binTypeMatch)) : r.summary,
      // The pre-formatting value (bare bin_types.label, or the summary when
      // unmatched) - a stable key for de-duplicating across properties,
      // since `label` above can now embed a property-specific raw summary.
      rawLabel: r.label || r.summary,
      colour: r.colour || '#6b7a99',
      propertyId: r.property_id,
      propertyLabel: r.property_label,
    })), ['propertyId', 'date', 'label', 'colour']);

  res.json({ collections });
});

// ── Bin Types ──────────────────────────────────────────────────────────────
app.get('/api/bin-types', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM bin_types ORDER BY id').all();
  res.json(rows);
});

const HEX_COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

function sanitiseBinTypeInput(body) {
  const { summary_match, label, colour, is_garden_waste } = body;
  if (!summary_match || !label || !colour) return { error: 'Missing fields: summary_match, label, colour required' };
  if (!HEX_COLOUR_RE.test(colour)) return { error: 'Invalid colour: must be a 6-digit hex value (e.g. #6b7280)' };
  return { summary_match: summary_match.replace(/[%_]/g, ''), label, colour, is_garden_waste: toBoolInt(is_garden_waste) };
}

app.post('/api/bin-types', (req, res) => {
  const input = sanitiseBinTypeInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  try {
    const result = getDb().prepare(
      'INSERT INTO bin_types (summary_match, label, colour, is_garden_waste) VALUES (?, ?, ?, ?)'
    ).run(input.summary_match, input.label, input.colour, input.is_garden_waste);
    res.status(201).json({ id: result.lastInsertRowid, summary_match: input.summary_match, label: input.label, colour: input.colour, is_garden_waste: input.is_garden_waste });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A bin type with that match text already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/bin-types/:id', (req, res) => {
  const input = sanitiseBinTypeInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  try {
    const result = getDb().prepare(
      'UPDATE bin_types SET summary_match = ?, label = ?, colour = ?, is_garden_waste = ? WHERE id = ?'
    ).run(input.summary_match, input.label, input.colour, input.is_garden_waste, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Bin type not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A bin type with that match text already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bin-types/:id', (req, res) => {
  const result = getDb().prepare('DELETE FROM bin_types WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Bin type not found' });
  res.status(204).send();
});

// ── Settings ───────────────────────────────────────────────────────────────
app.get('/api/settings/sync-schedule', (req, res) => {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('sync_cron');
    const cronExpression = (row && row.value) ? row.value : DEFAULT_CRON;
    res.json({ cronExpression, nextSync: getNextSyncDate() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/sync-schedule', (req, res) => {
  const { cronExpression } = req.body || {};
  if (!cronExpression) return res.status(400).json({ error: 'cronExpression is required' });
  if (!cron.validate(cronExpression)) return res.status(400).json({ error: 'Invalid cron expression' });
  try {
    getDb().prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('sync_cron', cronExpression);
    restartSyncSchedule(cronExpression);
    res.json({ cronExpression, nextSync: getNextSyncDate() });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

module.exports = { app, getPropertyEventsRows, formatMatchedLabel, attributeSummarySegment };
