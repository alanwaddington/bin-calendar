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
    expect(events[0].label).toBe('General Waste (Grey/Blue Mixed Bin)');
    expect(events[0].colour).toBe('#6b7280');
    expect(events[0].matched).toBe(true);
  });

  test('getPropertyEventsRows_whenSummaryHasExtraInfoBeyondTheMatch_appendsRawSummaryInParens', () => {
    // The label "General Waste" doesn't equal and isn't contained in the
    // summary "Grey Bin Plus Food" (the word "Grey" matched the rule, but
    // "Plus Food" isn't part of the configured label) - the extra info
    // must not be silently dropped.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u3', 'Grey Bin Plus Food', '2026-11-07')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events[0].label).toBe('General Waste (Grey Bin Plus Food)');
  });

  test('getPropertyEventsRows_whenConfiguredLabelEqualsMatchAndFeedAddsQualifier_returnsRawSummaryAlone', () => {
    // Real-world bug report: East Ayrshire's feed sends "Trolley+food", and
    // the user's actual bin_types row has Match AND Label both set to
    // "Trolley" (not a descriptive label like "General Waste"). The feed
    // text is strictly more specific than the label, so it should be shown
    // alone - "Trolley+food" - not stuttered as "Trolley (Trolley+food)".
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Trolley', 'Trolley', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u5', 'Trolley+food', '2026-11-09')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.find(e => e.uid === 'u5').label).toBe('Trolley+food');
  });

  test('getPropertyEventsRows_whenSummaryMatchesLabelCaseInsensitively_doesNotDuplicateInParens', () => {
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Foo', 'FOO COLLECTION', '#111111')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u4', 'foo collection', '2026-11-08')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.find(e => e.uid === 'u4').label).toBe('FOO COLLECTION');
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
