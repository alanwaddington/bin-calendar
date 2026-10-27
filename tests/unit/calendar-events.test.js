const { createTestDb } = require('../helpers/testDb');
const { getPropertyEventsRows } = require('../../src/server');

describe('getPropertyEventsRows', () => {
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

  test('getPropertyEventsRows_withMultipleBinTypeMatches_returnsSingleRowWithLowestIdRule', () => {
    // 'Grey' and 'Blue' are both seeded bin_types (003.sql); Grey has the lower id.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u1', 'Grey/Blue Mixed Bin', '2026-11-05')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].label).toBe('General Waste');
    expect(events[0].colour).toBe('#6b7280');
    expect(events[0].matched).toBe(true);
  });

  test('getPropertyEventsRows_withNoBinTypeMatch_returnsRawSummaryAndUnmatched', () => {
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u2', 'Mystery Collection', '2026-11-06')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toEqual([{
      uid: 'u2',
      date: '2026-11-06',
      summary: 'Mystery Collection',
      label: 'Mystery Collection',
      colour: '#6b7a99',
      matched: false,
    }]);
  });

  test('getPropertyEventsRows_ordersEventsByDateAscending', () => {
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-later', 'Grey Bin', '2026-12-01')"
    ).run(propertyId);
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-earlier', 'Grey Bin', '2026-11-01')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.map(e => e.uid)).toEqual(['u-earlier', 'u-later']);
  });

  test('getPropertyEventsRows_withNoEvents_returnsEmptyArray', () => {
    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toEqual([]);
  });

  test('getPropertyEventsRows_onlyReturnsEventsForTheGivenProperty', () => {
    const otherPropertyId = db.prepare(
      "INSERT INTO properties (label, uprn, calendar_type) VALUES ('Other', '67890', 'google')"
    ).run().lastInsertRowid;
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'mine', 'Grey Bin', '2026-11-05')"
    ).run(propertyId);
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'not-mine', 'Grey Bin', '2026-11-05')"
    ).run(otherPropertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.map(e => e.uid)).toEqual(['mine']);
  });
});
