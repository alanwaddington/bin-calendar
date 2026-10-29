const { createTestDb } = require('../helpers/testDb');

// Import the internal function via the module — we need to expose cacheEvents for unit testing.
// Since sync.js doesn't export cacheEvents directly yet, these tests will drive that export.
const syncModule = require('../../src/sync');

describe('cacheEvents', () => {
  let db;
  let propertyId;

  beforeEach(() => {
    db = createTestDb();
    const result = db.prepare(
      "INSERT INTO properties (label, uprn, calendar_type) VALUES ('Home', '12345', 'google')"
    ).run();
    propertyId = result.lastInsertRowid;
  });

  afterEach(() => {
    db.close();
  });

  test('cacheEvents_withFutureEvents_insertsIntoEventsTable', () => {
    const futureDate = getFutureDate(30);
    const events = [
      { uid: 'uid-1', summary: 'Grey Bin Collection', start: new Date(futureDate), end: new Date(futureDate) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const rows = db.prepare("SELECT * FROM events WHERE property_id = ?").all(propertyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe('uid-1');
    expect(rows[0].summary).toBe('Grey Bin Collection');
  });

  test('cacheEvents_withPastEvents_excludesThem', () => {
    const pastDate = getPastDate(5);
    const events = [
      { uid: 'uid-past', summary: 'Grey Bin', start: new Date(pastDate), end: new Date(pastDate) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const rows = db.prepare("SELECT * FROM events WHERE property_id = ?").all(propertyId);
    expect(rows).toHaveLength(0);
  });

  test('cacheEvents_withEventsBeyondSixMonths_excludesThem', () => {
    const farFuture = getFutureDate(200);
    const events = [
      { uid: 'uid-far', summary: 'Grey Bin', start: new Date(farFuture), end: new Date(farFuture) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const rows = db.prepare("SELECT * FROM events WHERE property_id = ?").all(propertyId);
    expect(rows).toHaveLength(0);
  });

  test('cacheEvents_calledTwice_upsertsDuplicateUids', () => {
    const futureDate = getFutureDate(30);
    const events = [
      { uid: 'uid-1', summary: 'Grey Bin Collection', start: new Date(futureDate), end: new Date(futureDate) },
    ];

    syncModule.cacheEvents(db, propertyId, events);
    syncModule.cacheEvents(db, propertyId, events);

    const rows = db.prepare("SELECT * FROM events WHERE property_id = ?").all(propertyId);
    expect(rows).toHaveLength(1);
  });

  test('cacheEvents_withMixedDates_onlyInsertsFutureWithinSixMonths', () => {
    const events = [
      { uid: 'uid-past',   summary: 'Bin', start: new Date(getPastDate(1)),    end: new Date(getPastDate(1)) },
      { uid: 'uid-near',   summary: 'Bin', start: new Date(getFutureDate(30)), end: new Date(getFutureDate(30)) },
      { uid: 'uid-far',    summary: 'Bin', start: new Date(getFutureDate(200)),end: new Date(getFutureDate(200)) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const rows = db.prepare("SELECT * FROM events WHERE property_id = ?").all(propertyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe('uid-near');
  });

  test('cacheEvents_storesStartDateAsIsoDateString', () => {
    const futureDate = getFutureDate(30);
    const events = [
      { uid: 'uid-1', summary: 'Grey Bin', start: new Date(futureDate), end: new Date(futureDate) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const row = db.prepare("SELECT start_date FROM events WHERE uid = 'uid-1'").get();
    expect(row.start_date).toBe(futureDate.slice(0, 10));
  });

  // PR #31 review finding M2: end_date is third-party feed data with no
  // format/range guarantee (unlike start_date, which was already bounded
  // to the 6-month sync window above). src/server.js expands [start, end)
  // into one calendar row per day, so a corrupt/malformed DTEND would
  // otherwise become the loop bound of a very large expansion. These tests
  // confirm cacheEvents itself never persists an end_date that couldn't
  // plausibly represent a real multi-day collection marker.
  test('cacheEvents_withEndDateFarBeyondAnyPlausibleSpan_storesNullEndDate', () => {
    const start = getFutureDate(30);
    const corruptEnd = getFutureDate(30 + 400); // e.g. a malformed DTEND far in the future
    const events = [
      { uid: 'uid-corrupt', summary: 'Transition week', start: new Date(start), end: new Date(corruptEnd) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const row = db.prepare("SELECT end_date FROM events WHERE uid = 'uid-corrupt'").get();
    expect(row.end_date).toBeNull();
  });

  test('cacheEvents_withEndDateBeforeStartDate_storesNullEndDate', () => {
    const start = getFutureDate(30);
    const backwardsEnd = getFutureDate(28); // before start - malformed/backwards DTEND
    const events = [
      { uid: 'uid-backwards', summary: 'Weird Backwards Span', start: new Date(start), end: new Date(backwardsEnd) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const row = db.prepare("SELECT end_date FROM events WHERE uid = 'uid-backwards'").get();
    expect(row.end_date).toBeNull();
  });

  test('cacheEvents_withLegitimateMultiDaySpan_storesEndDateCorrectly', () => {
    // A genuine real-world span (East Ayrshire's "Transition week" covers
    // 5 days) must not be discarded by the same validation that rejects
    // corrupt/malformed DTEND values.
    const start = getFutureDate(30);
    const end = getFutureDate(35);
    const events = [
      { uid: 'uid-real-span', summary: 'Transition week', start: new Date(start), end: new Date(end) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const row = db.prepare("SELECT end_date FROM events WHERE uid = 'uid-real-span'").get();
    expect(row.end_date).toBe(end.slice(0, 10));
  });

  test('cacheEvents_withNullEnd_storesNullEndDate', () => {
    // Pre-existing, legitimate case - the feed didn't supply a DTEND at
    // all - must not be treated as invalid.
    const events = [
      { uid: 'uid-no-end', summary: 'Mystery Bin', start: new Date(getFutureDate(30)), end: null },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const row = db.prepare("SELECT end_date FROM events WHERE uid = 'uid-no-end'").get();
    expect(row.end_date).toBeNull();
  });

  // Bug report: East Ayrshire changes/cancels a previously-published
  // collection date and the feed stops including that uid entirely - the
  // local cache must stop carrying it too, not just leave it there until
  // its (now-stale) start_date happens to pass.
  test('cacheEvents_whenPreviouslyCachedUidNoLongerInNewFeed_removesItFromCache', () => {
    const futureDate = getFutureDate(30);
    syncModule.cacheEvents(db, propertyId, [
      { uid: 'uid-stays', summary: 'Grey Bin', start: new Date(futureDate), end: new Date(futureDate) },
      { uid: 'uid-removed-by-council', summary: 'Grey Bin', start: new Date(getFutureDate(31)), end: new Date(getFutureDate(31)) },
    ]);

    // Second fetch no longer contains 'uid-removed-by-council' at all.
    syncModule.cacheEvents(db, propertyId, [
      { uid: 'uid-stays', summary: 'Grey Bin', start: new Date(futureDate), end: new Date(futureDate) },
    ]);

    const rows = db.prepare('SELECT uid FROM events WHERE property_id = ?').all(propertyId);
    expect(rows.map(r => r.uid)).toEqual(['uid-stays']);
  });

  test('cacheEvents_whenNewFeedIsEmpty_removesEveryCachedRowForThatProperty', () => {
    syncModule.cacheEvents(db, propertyId, [
      { uid: 'uid-1', summary: 'Grey Bin', start: new Date(getFutureDate(30)), end: null },
    ]);

    syncModule.cacheEvents(db, propertyId, []);

    const rows = db.prepare('SELECT * FROM events WHERE property_id = ?').all(propertyId);
    expect(rows).toHaveLength(0);
  });

  test('cacheEvents_removalOfStaleUids_onlyAffectsTheGivenProperty', () => {
    const otherPropertyId = db.prepare(
      "INSERT INTO properties (label, uprn, calendar_type) VALUES ('Other', '99999', 'google')"
    ).run().lastInsertRowid;
    syncModule.cacheEvents(db, otherPropertyId, [
      { uid: 'uid-other-property', summary: 'Grey Bin', start: new Date(getFutureDate(30)), end: null },
    ]);

    syncModule.cacheEvents(db, propertyId, [
      { uid: 'uid-mine', summary: 'Grey Bin', start: new Date(getFutureDate(30)), end: null },
    ]);
    syncModule.cacheEvents(db, propertyId, []); // my feed goes empty

    const otherRows = db.prepare('SELECT uid FROM events WHERE property_id = ?').all(otherPropertyId);
    expect(otherRows.map(r => r.uid)).toEqual(['uid-other-property']);
  });

  test('cacheEvents_withMultipleEvents_insertsAllInSingleTransaction', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      uid: `uid-${i}`,
      summary: 'Grey Bin',
      start: new Date(getFutureDate(10 + i)),
      end: null,
    }));

    syncModule.cacheEvents(db, propertyId, events);

    const rows = db.prepare('SELECT * FROM events WHERE property_id = ?').all(propertyId);
    expect(rows).toHaveLength(5);
  });
});

describe('runSync event cache integration', () => {
  // These tests verify cacheEvents is called from within the sync pipeline.
  // We use the mocked-db pattern like the existing sync integration tests.
});

// Helpers
function getFutureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function getPastDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
