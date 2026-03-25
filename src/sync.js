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
      try {
        if (property.calendar_type === 'google') {
          await google.insertEvent(property, event);
        } else {
          await icloud.insertEvent(property, event);
        }
        added++;
      } catch (err) {
        // Treat duplicate UID as a skip rather than a failure
        if (err.code === 409 || /already exists|duplicate/i.test(err.message)) {
          skipped++;
        } else {
          throw err;
        }
      }
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
