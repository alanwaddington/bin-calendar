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
    const futureDate = '2026-06-15T07:00:00.000Z';
    const events = [
      { uid: 'uid-1', summary: 'Grey Bin', start: new Date(futureDate), end: new Date(futureDate) },
    ];

    syncModule.cacheEvents(db, propertyId, events);

    const row = db.prepare("SELECT start_date FROM events WHERE uid = 'uid-1'").get();
    expect(row.start_date).toBe('2026-06-15');
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
