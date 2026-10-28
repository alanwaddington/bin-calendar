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

  // Real-world case: East Ayrshire's feed sent "Garden waste and general
  // waste+food (+food only after transition week)" as a SINGLE VEVENT
  // combining two genuinely separate collections into one textual summary,
  // rather than two VEVENTs. A summary matching multiple bin_types rules
  // now shows one marker per match (both rows sharing the same uid/date/
  // summary, since it's genuinely one event), rather than picking just the
  // lowest-id match and hiding the others.
  test('getPropertyEventsRows_withMultipleBinTypeMatches_returnsOneRowPerMatch', () => {
    // 'Grey' and 'Blue' are both seeded bin_types (003.sql); Grey has the lower id.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u1', 'Grey/Blue Mixed Bin', '2026-11-05')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(2);
    expect(events.every(e => e.uid === 'u1' && e.date === '2026-11-05')).toBe(true);
    expect(events.map(e => e.label)).toEqual([
      'General Waste (Grey/Blue Mixed Bin)',
      'Recycling (Grey/Blue Mixed Bin)',
    ]);
    expect(events.map(e => e.colour)).toEqual(['#6b7280', '#3b82f6']);
    expect(events.every(e => e.matched)).toBe(true);
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

  test('getPropertyEventsRows_withRealWorldAndCombinedSummary_attributesEachMatchToItsOwnSegment', () => {
    // The literal real feed text behind this test - East Ayrshire combines
    // two standalone summaries with " and " into one VEVENT ("Garden waste"
    // + " and " + "general waste+food (+food only after transition week)" -
    // both halves appear verbatim elsewhere in the same real feed as their
    // own single-day entries). The "+food only after transition week"
    // qualifier belongs ONLY to the General Waste half - it must not also
    // appear against the Garden Waste marker just because they share a
    // VEVENT that day.
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Garden', 'Garden Waste', '#92400e')"
    ).run();
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('waste+food', 'General Waste', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-combined', 'Garden waste and general waste+food (+food only after transition week)', '2026-11-26')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(2);
    const garden = events.find(e => e.colour === '#92400e');
    const general = events.find(e => e.colour === '#6b7280');
    expect(garden.label).toBe('Garden Waste'); // matches its own segment exactly - no qualifier attached
    expect(general.label).toBe('general waste+food (+food only after transition week)'); // keeps its own qualifier
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

  // East Ayrshire's real feed sends "Transition week" as a single VEVENT
  // spanning DTSTART=Mon..DTEND=Sat (ICS DTEND is exclusive, so the covered
  // days are Mon-Fri) rather than five separate VEVENTs - their own site
  // shows it on every weekday, so our calendar should too, not just the
  // first day.
  test('getPropertyEventsRows_withMultiDaySpanEvent_expandsToOneRowPerCoveredDay', () => {
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, 'u-span', 'Transition week', '2026-11-23', '2026-11-28')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.map(e => e.date)).toEqual([
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
    ]);
    // Every expanded day carries the same event's identity and label - it's
    // genuinely one event, just covering multiple days.
    expect(events.every(e => e.uid === 'u-span')).toBe(true);
    expect(events.every(e => e.summary === 'Transition week')).toBe(true);
  });

  test('getPropertyEventsRows_withNormalSingleDayEvent_returnsExactlyOneRowNotExpanded', () => {
    // Every other real event in the feed has end_date = start_date + 1 day
    // (the standard ICS all-day-event convention) - this must NOT expand
    // into two rows.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, 'u-normal', 'Grey Bin', '2026-11-05', '2026-11-06')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-11-05');
  });

  test('getPropertyEventsRows_withNullEndDate_returnsExactlyOneRowNotExpanded', () => {
    // end_date is nullable (cacheEvents stores null when the feed didn't
    // supply a DTEND) - must behave exactly like a single-day event, not
    // throw or expand indefinitely.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, 'u-no-end', 'Grey Bin', '2026-11-05', NULL)"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-11-05');
  });

  test('getPropertyEventsRows_withSpanEventOverlappingALaterSingleDayEvent_remainsDateSortedAfterExpansion', () => {
    // A span event expanding forward must not disturb overall date
    // ordering just because it was the "earliest" row before expansion -
    // the expanded days have to be re-sorted, not just flattened in place.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, 'u-span', 'Transition week', '2026-10-30', '2026-11-04')"
    ).run(propertyId); // expands to Oct 30, 31, Nov 1, 2, 3
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-single', 'Grey Bin', '2026-11-01')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.map(e => e.date)).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-01', '2026-11-02', '2026-11-03',
    ]);
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
