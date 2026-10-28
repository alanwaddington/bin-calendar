const { getDb } = require('./db');
const { fetchIcs } = require('./ics');
const google = require('./google');
const icloud = require('./icloud');
const { isGardenWaste, stripGardenWasteSegments } = require('./bin-types');

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

  // Prune all past events at the start of each run
  db.prepare("DELETE FROM events WHERE start_date < date('now')").run();

  try {
    const properties = db.prepare(
      "SELECT * FROM properties WHERE credentials IS NOT NULL AND calendar_id IS NOT NULL"
    ).all();

    if (properties.length === 0) {
      updateRun('skipped');
      return { status: 200, message: 'Skipped — no properties configured' };
    }

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

const AUTH_ERROR_PATTERNS = [
  'invalid_grant', 'http 401', 'http 403', 'unauthorized', 'forbidden',
  'token has been expired or revoked', 'auth failed', 'authentication failed',
];

function isAuthError(err) {
  const msg = err.message.toLowerCase();
  return AUTH_ERROR_PATTERNS.some(p => msg.includes(p));
}

function updateCredentialStatus(db, propertyId, status) {
  db.prepare("UPDATE properties SET credential_status = ?, credential_checked_at = datetime('now') WHERE id = ?")
    .run(status, propertyId);
}

async function syncProperty(db, runId, property) {
  const startedAt = new Date().toISOString();
  if (!property.ics_url) {
    const msg = 'No ICS URL configured — update the property with a calendar URL from the council website';
    writeResult(db, runId, property.id, 0, 0, 0, msg, startedAt);
    return { propertyId: property.id, error: msg };
  }
  try {
    const { events, warnings } = await fetchIcs(property.ics_url);

    if (events.length === 0) {
      updateCredentialStatus(db, property.id, 'ok');
      writeResult(db, runId, property.id, 0, 0, 0, warnings.join('; ') || null, startedAt);
      return { propertyId: property.id };
    }

    const dates = events.map(e => e.start);
    const timeMin = new Date(Math.min(...dates));
    const timeMax = new Date(Math.max(...dates));

    // #33: classified against the full in-memory feed below (whatever
    // range fetchIcs actually returned - often ~14 months), never against
    // the local cache, which only ever holds a 6-month window (cacheEvents
    // at the end of this function) and would silently under-filter
    // anything beyond it.
    const gardenMatchers = db.prepare('SELECT summary_match FROM bin_types WHERE is_garden_waste = 1')
      .all().map(r => r.summary_match);

    let existingByUid;
    if (property.calendar_type === 'google') {
      const existing = await google.listEvents(property, timeMin, timeMax);
      existingByUid = new Map(existing.map(e => [e.iCalUID, e.id]));
    } else {
      existingByUid = await icloud.listEventObjects(property, timeMin, timeMax);
    }

    let added = 0, skipped = 0, deleted = 0;
    for (const event of events) {
      // A combined day (e.g. "Garden waste and general waste+food (...)")
      // is deliberately left alone here - stripping just the garden-waste
      // segment from an already-pushed combined event is handled
      // separately (Task 6), so it still falls through to the normal
      // push/skip path below, unchanged, for now.
      const isPureGardenWaste = isGardenWaste(event.summary, gardenMatchers)
        && stripGardenWasteSegments(event.summary, gardenMatchers) === '';

      if (!property.garden_waste_opted_in && isPureGardenWaste) {
        if (existingByUid.has(event.uid)) {
          const identifier = existingByUid.get(event.uid);
          if (property.calendar_type === 'google') {
            await google.deleteEvent(property, identifier);
          } else {
            await icloud.deleteEvent(property, identifier);
          }
          deleted++;
        }
        continue;
      }

      if (existingByUid.has(event.uid)) { skipped++; continue; }
      if (property.calendar_type === 'google') {
        await google.insertEvent(property, event);
      } else {
        await icloud.insertEvent(property, event);
      }
      added++;
    }

    updateCredentialStatus(db, property.id, 'ok');
    cacheEvents(db, property.id, events);
    writeResult(db, runId, property.id, added, skipped, deleted, warnings.join('; ') || null, startedAt);
    return { propertyId: property.id };
  } catch (err) {
    if (isAuthError(err)) {
      updateCredentialStatus(db, property.id, 'invalid');
    }
    writeResult(db, runId, property.id, 0, 0, 0, err.message, startedAt);
    return { propertyId: property.id, error: err.message };
  }
}

function writeResult(db, runId, propertyId, added, skipped, deleted, error, startedAt) {
  db.prepare(`
    INSERT INTO sync_results (run_id, property_id, events_added, events_skipped, events_deleted, error, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(runId, propertyId, added, skipped, deleted, error, startedAt);
}

function purgeOldRecords(db) {
  db.prepare("DELETE FROM sync_runs WHERE completed_at < datetime('now', '-90 days')").run();
}

// DTEND is third-party feed data with no format/range guarantee - a
// malformed or corrupt value (seen as far out as centuries ahead) would
// otherwise be persisted and, since src/server.js expands [start, end) into
// one calendar row per day, become the loop bound of a very large
// expansion. 31 days is generous - the real "Transition week" span is 5
// days - while still rejecting anything that couldn't plausibly represent a
// real multi-day collection marker. Falls back to null (no end date) rather
// than discarding the whole event, since start_date/summary are still
// perfectly good data either way.
const MAX_END_DAYS_AHEAD = 31;

function validEndDate(rawEnd, start) {
  if (!rawEnd) return null;
  const end = new Date(rawEnd);
  const daysAhead = (end - start) / (24 * 60 * 60 * 1000);
  return (daysAhead > 0 && daysAhead <= MAX_END_DAYS_AHEAD) ? end.toISOString().slice(0, 10) : null;
}

function cacheEvents(db, propertyId, events) {
  const sixMonthsAhead = new Date();
  sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upsert = db.prepare(
    "INSERT OR REPLACE INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, ?, ?, ?, ?)"
  );

  const insertAll = db.transaction(() => {
    for (const event of events) {
      const start = new Date(event.start);
      if (start < today || start > sixMonthsAhead) continue;
      const startDate = start.toISOString().slice(0, 10);
      const endDate = validEndDate(event.end, start);
      upsert.run(propertyId, event.uid, event.summary, startDate, endDate);
    }
  });

  insertAll();
}

module.exports = { runSync, cacheEvents };
