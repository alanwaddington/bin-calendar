const { getDb } = require('./db');
const { fetchIcs } = require('./ics');
const google = require('./google');
const icloud = require('./icloud');
const { matchesAnySegment, stripMatchingSegments, splitSummarySegments } = require('./bin-types');

// #35 Task 6: propertyId scopes a sync run to just that property - the
// scheduler and the global "Sync Now" button call this with no argument
// (unchanged), while a property's own opt-in toggle calls it with that
// property's id. Everything else is inherited as-is: the single-
// `running`-row lock, the sync_runs row, writeResult's shape, and the
// success/partial/failed rollup - a scoped run is not a second,
// differently-shaped calendar-mutation path.
async function runSync(propertyId = null) {
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
    // PR #37 review finding M2: scoped to just the requested property
    // when propertyId is given - this previously pruned EVERY property's
    // past events on a scoped run, which violates the scoping contract a
    // property-scoped sync is supposed to have (it can now fire far more
    // often than the global sync, once per opt-in toggle). Also moved
    // inside this try (was previously outside both try blocks) so a
    // failure here is caught and recorded via updateRun('failed') instead
    // of leaving the sync_runs row stuck at 'running' - which would 429
    // every subsequent sync until the process restarted.
    if (propertyId) {
      db.prepare("DELETE FROM events WHERE start_date < date('now') AND property_id = ?").run(propertyId);
    } else {
      db.prepare("DELETE FROM events WHERE start_date < date('now')").run();
    }

    // #35: scoped to a single property when propertyId is given. An
    // unknown id, or one without credentials/calendar_id, returns zero
    // rows and falls into the same "skipped" branch below as the global
    // "no properties configured" case - no special-casing needed, and it
    // can never be reported as a false success.
    const properties = propertyId
      ? db.prepare(
          "SELECT * FROM properties WHERE credentials IS NOT NULL AND calendar_id IS NOT NULL AND id = ?"
        ).all(propertyId)
      : db.prepare(
          "SELECT * FROM properties WHERE credentials IS NOT NULL AND calendar_id IS NOT NULL"
        ).all();

    if (properties.length === 0) {
      updateRun('skipped');
      // PR #37 review finding m2: a structured overallStatus field, not
      // just free-text message prose, so callers (frontend and dashboard)
      // can branch on skip state reliably instead of string-matching
      // copy that's free to be reworded independently.
      return { status: 200, message: 'Skipped — no properties configured', overallStatus: 'skipped' };
    }

    // #35: generalized from "bin_types is global, not per-property" (PR
    // #34 review finding S2) to cover the new per-property opt-in table
    // too - both are global, not per-property, so both are queried exactly
    // once per run regardless of how many properties are synced. The
    // per-property withheld-matcher list is computed purely in memory from
    // these two results inside syncProperty - no per-property SQL query.
    const flaggedBinTypes = db.prepare('SELECT id, summary_match FROM bin_types WHERE requires_opt_in = 1').all();
    const optInRows = db.prepare('SELECT property_id, bin_type_id FROM property_bin_type_opt_ins').all();
    const optInSet = new Set(optInRows.map(r => `${r.property_id}:${r.bin_type_id}`));

    const results = await Promise.all(properties.map(p => syncProperty(db, runId, p, flaggedBinTypes, optInSet)));

    const failed = results.filter(r => r.error);
    const succeeded = results.filter(r => !r.error);
    const overallStatus = failed.length === 0 ? 'success'
      : succeeded.length === 0 ? 'failed' : 'partial';

    updateRun(overallStatus);
    // PR #37 review finding M2: 90-day sync_runs history pruning is global
    // run-history maintenance, unrelated to any single property - a
    // scoped run must not perform it.
    if (!propertyId) purgeOldRecords(db);

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

// PR #34 review finding M2: the current remote summary of an already-
// pushed event, so the combined-day branch below can skip rewriting an
// event that already carries the correct (stripped) summary from a prior
// sync, instead of rewriting it identically on every single run.
function currentRemoteSummary(property, identifier) {
  return property.calendar_type === 'google' ? identifier.summary : icloud.extractSummary(identifier.data);
}

async function syncProperty(db, runId, property, flaggedBinTypes, optInSet) {
  const startedAt = new Date().toISOString();
  if (!property.ics_url) {
    const msg = 'No ICS URL configured — update the property with a calendar URL from the council website';
    writeResult(db, runId, property.id, { error: msg, startedAt });
    return { propertyId: property.id, error: msg };
  }
  try {
    const { events, warnings } = await fetchIcs(property.ics_url);

    if (events.length === 0) {
      updateCredentialStatus(db, property.id, 'ok');
      writeResult(db, runId, property.id, { error: warnings.join('; ') || null, startedAt });
      return { propertyId: property.id };
    }

    // PR #36 review finding S1: widened to always cover at least
    // [today, today+6 months] (matching cacheEvents' own bound), regardless
    // of how narrow or wide the current feed's own date range happens to
    // be - a pure widening, never narrower than the feed's own range. Without
    // this, a stale event could define the old edge of a feed-derived
    // window; removing it from the feed would then shrink the window along
    // with it, so existingByUid's listing call would never even see it and
    // the reconciliation pass below could never catch it.
    const dates = events.map(e => e.start);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sixMonthsAhead = new Date();
    sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);
    const timeMin = new Date(Math.min(...dates, today.getTime()));
    const timeMax = new Date(Math.max(...dates, sixMonthsAhead.getTime()));

    let existingByUid;
    if (property.calendar_type === 'google') {
      // PR #34 review finding M2: carries each event's current summary
      // alongside its id, so the combined-day branch can tell whether a
      // rewrite is actually needed before calling updateEventSummary.
      const existing = await google.listEvents(property, timeMin, timeMax);
      existingByUid = new Map(existing.map(e => [e.iCalUID, { id: e.id, summary: e.summary }]));
    } else {
      existingByUid = await icloud.listEventObjects(property, timeMin, timeMax);
    }

    // #35: the summary_match of every flagged bin type this property has
    // NOT opted into - computed purely in memory from the two once-per-run
    // queries, no per-property SQL.
    const withheldMatchers = flaggedBinTypes
      .filter(bt => !optInSet.has(`${property.id}:${bt.id}`))
      .map(bt => bt.summary_match);
    // ALL flagged bin types, opt-in state aside - whether an event
    // contains any flagged segment at all is independent of what this
    // property currently has withheld. This is what lets a fully
    // opted-in property still detect and restore a combined-day event
    // whose remote copy was stripped during a PRIOR opted-out period:
    // withheldMatchers is empty for such a property, so stripping alone
    // can't tell "nothing to touch" apart from "already correct, or
    // needs restoring" - this flag is what makes that distinction.
    const allFlaggedMatchers = flaggedBinTypes.map(bt => bt.summary_match);

    // #33: classified against the full in-memory feed below (whatever
    // range fetchIcs actually returned - often ~14 months), never against
    // the local cache, which only ever holds a 6-month window (cacheEvents
    // at the end of this function) and would silently under-filter
    // anything beyond it.
    let added = 0, skipped = 0, deleted = 0, updated = 0;
    for (const event of events) {
      const targetSummary = stripMatchingSegments(event.summary, withheldMatchers);
      const touchesAnyFlaggedType = matchesAnySegment(event.summary, allFlaggedMatchers);
      // PR #37 review finding m5: stripMatchingSegments always rejoins
      // with a canonical ' and ' separator, even when nothing was
      // actually removed - normalizing an irregular feed separator
      // ("AND", doubled whitespace) into pushed text that no longer
      // matches what cacheEvents stores locally for this same event.
      // Equal segment counts before/after means nothing was stripped (it
      // only ever removes whole segments, never rewrites one), so the
      // untouched original is what actually gets pushed in that case.
      const nothingStripped = splitSummarySegments(targetSummary).length === splitSummarySegments(event.summary).length;
      const finalSummary = nothingStripped ? event.summary : targetSummary;
      // Every segment withheld - nothing left to push at all. Requires
      // touchesAnyFlaggedType too (PR #37 review finding M1):
      // stripMatchingSegments('   ', []) returns '' for a degenerate
      // (e.g. whitespace-only) summary even with zero withheld matchers,
      // which would otherwise be misread as "fully withheld" and delete
      // an already-pushed event for a reason that has nothing to do with
      // opt-in gating.
      const isFullyWithheld = touchesAnyFlaggedType && targetSummary === '';

      if (isFullyWithheld) {
        if (existingByUid.has(event.uid)) {
          const identifier = existingByUid.get(event.uid);
          // PR #34 review finding m2: only count a CONFIRMED deletion -
          // if the provider call failed, nothing actually changed on the
          // external calendar, so it must not be reported as if it had.
          const ok = property.calendar_type === 'google'
            ? await google.deleteEvent(property, identifier.id)
            : await icloud.deleteEvent(property, identifier);
          if (ok) deleted++;
        }
        continue;
      }

      // #35: covers BOTH directions under one check now - a combined day
      // that needs stripping (some but not all segments withheld) AND a
      // fully-opted-in event whose remote copy might still be stale from
      // a prior opted-out period (targetSummary === event.summary here,
      // but the REMOTE text might not be - only the compare-before-write
      // check below can tell). PR #34 review finding M1's opted-in/
      // opted-out ternary collapses into targetSummary itself: opted into
      // everything relevant -> targetSummary is the untouched original;
      // opted into some but not all -> targetSummary has only the
      // withheld segment(s) removed.
      if (touchesAnyFlaggedType) {
        const eventToWrite = { ...event, summary: finalSummary };
        if (existingByUid.has(event.uid)) {
          const identifier = existingByUid.get(event.uid);
          if (currentRemoteSummary(property, identifier) === finalSummary) {
            // PR #34 review finding M2: already correct from a prior sync -
            // rewriting it again would be a no-op write that only bumps the
            // event's etag/sequence on the user's own devices.
            skipped++;
          } else {
            // PR #34 review finding M1: rewritten in place for BOTH
            // providers now - Google's events.patch is a documented,
            // ID-addressed, idempotent update (the original "no safe way
            // to update Google in place" rationale didn't actually hold).
            // Only a CONFIRMED update is counted; a failed one leaves the
            // event stale for this run, to be retried on the next sync.
            const ok = property.calendar_type === 'icloud'
              ? await icloud.updateEvent(property, identifier, eventToWrite)
              : await google.updateEventSummary(property, identifier.id, finalSummary);
            // PR #34 review finding m1 (new): a rewrite of an event that
            // already exists externally is a correction, not an addition -
            // counted separately so the audit trail isn't misleading.
            if (ok) updated++;
          }
        } else {
          if (property.calendar_type === 'google') {
            await google.insertEvent(property, eventToWrite);
          } else {
            await icloud.insertEvent(property, eventToWrite);
          }
          added++;
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

    // Bug report: an event that has vanished from the feed entirely (the
    // council changed or cancelled that collection) was never removed from
    // the external calendar - the loop above only ever inserts/updates
    // events that ARE in the feed, so a uid with nothing left to overwrite
    // it just sat there indefinitely as a stale, no-longer-valid uplift.
    // Disjoint from the withheld-delete branch above, which only ever
    // considers a uid that IS still in the feed - every uid reaching this
    // loop is, by construction, absent from `events`. #35: preserved
    // unmodified - bin-type-agnostic by construction, it never consults
    // withheldMatchers at all.
    const feedUids = new Set(events.map(e => e.uid));
    for (const [uid, identifier] of existingByUid) {
      if (feedUids.has(uid)) continue;
      const ok = property.calendar_type === 'google'
        ? await google.deleteEvent(property, identifier.id)
        : await icloud.deleteEvent(property, identifier);
      if (ok) deleted++;
    }

    updateCredentialStatus(db, property.id, 'ok');
    cacheEvents(db, property.id, events);
    writeResult(db, runId, property.id, { added, skipped, deleted, updated, error: warnings.join('; ') || null, startedAt });
    return { propertyId: property.id };
  } catch (err) {
    if (isAuthError(err)) {
      updateCredentialStatus(db, property.id, 'invalid');
    }
    writeResult(db, runId, property.id, { error: err.message, startedAt });
    return { propertyId: property.id, error: err.message };
  }
}

// PR #34 review finding S1: an options object rather than a growing list
// of positional booleans/numbers - three consecutive 0s made a transposed
// argument easy to introduce and hard to spot in a diff.
function writeResult(db, runId, propertyId, { added = 0, skipped = 0, deleted = 0, updated = 0, error = null, startedAt }) {
  db.prepare(`
    INSERT INTO sync_results (run_id, property_id, events_added, events_skipped, events_deleted, events_updated, error, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(runId, propertyId, added, skipped, deleted, updated, error, startedAt);
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
    // Bug report companion fix: the local cache must stop carrying a uid
    // the moment it's no longer in the feed, not just once its (now
    // stale) start_date happens to pass - otherwise it lingers as a
    // phantom "collection" in the app's own Dashboard/Calendar too.
    const feedUids = events.map(e => e.uid);
    if (feedUids.length > 0) {
      const placeholders = feedUids.map(() => '?').join(',');
      db.prepare(`DELETE FROM events WHERE property_id = ? AND uid NOT IN (${placeholders})`)
        .run(propertyId, ...feedUids);
    } else {
      db.prepare('DELETE FROM events WHERE property_id = ?').run(propertyId);
    }

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
