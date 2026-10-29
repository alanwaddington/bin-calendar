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

  // PR #31 review finding M1: the removed correlated subquery made it
  // structurally impossible for one event to produce two identical
  // markers. The fan-out join removes that guarantee - if two bin_types
  // rules share a label and colour and both match one summary, the fan-out
  // produces two rows that render as the exact same marker twice. Confirmed
  // against the review's real-world-shaped case: Match "Trolley" and Match
  // "food" both -> Label "General Waste" / same colour, summary
  // "Trolley+food" matches both.
  test('getPropertyEventsRows_withTwoRulesSharingLabelAndColour_collapsesToOneMarker', () => {
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Trolley', 'General Waste', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('food', 'General Waste', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-dup', 'Trolley+food', '2026-10-29')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].label).toBe('General Waste (Trolley+food)');
  });

  // Two rules that match the same summary but have a DIFFERENT label or
  // colour must still both appear - the dedup is scoped to byte-for-byte
  // identical markers only, never to collapsing genuinely distinct bin
  // types (that would silently reintroduce the original pre-fan-out bug).
  test('getPropertyEventsRows_withTwoRulesSharingLabelButDifferentColour_keepsBothMarkers', () => {
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Trolley', 'General Waste', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('food', 'General Waste', '#111111')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-diff-colour', 'Trolley+food', '2026-10-29')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(2);
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

  // Real-world bug report: a user's own live config has a "Transition Week"
  // bin_types rule (purple, #9333ea) for the genuine standalone "Transition
  // week" event. That Match text is ALSO a literal substring of the
  // unrelated caveat "(+food only after transition week)" that appears on
  // every General Waste day - so the fan-out join was incidentally
  // matching "Transition Week" against a day that has nothing to do with
  // the actual transition week, rendering two markers (grey General Waste
  // + purple Transition Week) for what is really just one collection.
  test('getPropertyEventsRows_withMatchOnlyInsideParentheticalCaveat_excludesThatFalseMatch', () => {
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Waste+Food', 'General Waste', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Transition Week', 'Transition Week', '#9333ea')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-false-positive', 'General waste+food (+food only after transition week)', '2026-11-12')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].colour).toBe('#6b7280');
    expect(events[0].label).toBe('General waste+food (+food only after transition week)');
  });

  // The "Transition Week" rule must still work for the actual event it's
  // configured for - a standalone "Transition week" summary with no
  // parentheses at all.
  test('getPropertyEventsRows_withMatchOutsideAnyParentheses_stillMatchesNormally', () => {
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('Transition Week', 'Transition Week', '#9333ea')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-real-transition', 'Transition week', '2026-11-23')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].colour).toBe('#9333ea');
    expect(events[0].matched).toBe(true);
  });

  // Defensive fallback: if EVERY candidate match for an event turns out to
  // be parentheses-only, the event must still render as unmatched (raw
  // text, neutral colour) rather than silently vanishing from the
  // calendar - a real collection must never disappear just because its
  // only visible match was a false positive.
  test('getPropertyEventsRows_whenEveryMatchIsParenthesesOnly_fallsBackToUnmatchedRatherThanVanishing', () => {
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('widget', 'Widget Collection', '#111111')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-vanish-guard', 'Normal Bin (contains a widget reference)', '2026-11-13')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].matched).toBe(false);
    expect(events[0].label).toBe('Normal Bin (contains a widget reference)');
    expect(events[0].colour).toBe('#6b7a99');
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

  // PR #31 review finding M2: expandDateRange itself must bound how far it
  // will expand, independent of sync.js's own validation at ingestion -
  // defense in depth against data that reaches the events table some other
  // way (a future regression in cacheEvents, a direct DB write, a migration).
  // Without this, one event with a corrupt/malformed end_date would produce
  // hundreds of thousands of rows (measured during review: 355,077 rows,
  // 47MB, for a 2999-01-01 end_date).
  test('getPropertyEventsRows_withCorruptFarFutureEndDate_clampsExpansionInsteadOfProducingHundredsOfThousandsOfRows', () => {
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, 'u-corrupt', 'Malformed Long Span', '2026-11-01', '2999-01-01')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.length).toBeLessThanOrEqual(31);
    expect(events[0].date).toBe('2026-11-01');
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

  // PR #31 review finding S2: expansion (one event -> one row per covered
  // day) and fan-out (one event -> one row per matching bin_types rule)
  // are each tested in isolation elsewhere, but nothing locked in that they
  // compose correctly for an event that is BOTH a multi-day span AND a
  // multi-rule match - the interaction most likely to break under future
  // refactoring of either half. A 3-day span matching 2 distinct bin types
  // must produce 3 x 2 = 6 rows, correctly ordered: each day's two matches
  // adjacent (bt.id order), days themselves ascending.
  test('getPropertyEventsRows_withSpanEventMatchingMultipleBinTypes_producesDaysTimesMatchesRows', () => {
    // 'Grey' and 'Brown' are both seeded bin_types (003.sql) and both
    // substrings of this summary. Deliberately avoids the word "and" so
    // this test stays isolated to span x fan-out composition, without also
    // exercising the unrelated "X and Y" segment-splitting from S1.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?, 'u-span-multi', 'Grey & Brown combined', '2026-12-01', '2026-12-04')"
    ).run(propertyId); // 3-day span (Dec 1,2,3) x 2 matches (Grey->General Waste id 1, Brown->Garden Waste id 3)

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(6);
    expect(events.map(e => e.date)).toEqual([
      '2026-12-01', '2026-12-01',
      '2026-12-02', '2026-12-02',
      '2026-12-03', '2026-12-03',
    ]);
    // Each day pairs the same two bin types in the same (bt.id) order.
    expect(events.map(e => e.colour)).toEqual([
      '#6b7280', '#92400e',
      '#6b7280', '#92400e',
      '#6b7280', '#92400e',
    ]);
  });

  // #35: opt-in is now per-bin-type, not Garden-Waste-only. A property
  // that hasn't opted into a flagged bin type must never see its rows in
  // its own calendar, even though the local cache always holds them (so
  // opting in later needs no backfill wait).
  test('getPropertyEventsRows_optedOutOfAFlaggedBinType_excludesItsRow', () => {
    db.prepare("UPDATE bin_types SET requires_opt_in = 1 WHERE summary_match = 'Brown'").run();
    // No opt-in row inserted for this property - opted out by absence.
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-garden', 'Brown Bin', '2026-11-05')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toEqual([]);
  });

  test('getPropertyEventsRows_optedIntoAFlaggedBinType_includesItsRow', () => {
    db.prepare("UPDATE bin_types SET requires_opt_in = 1 WHERE summary_match = 'Brown'").run();
    const brownId = db.prepare("SELECT id FROM bin_types WHERE summary_match = 'Brown'").get().id;
    db.prepare('INSERT INTO property_bin_type_opt_ins (property_id, bin_type_id) VALUES (?, ?)').run(propertyId, brownId);
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-garden', 'Brown Bin', '2026-11-05')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].label).toBe('Garden Waste (Brown Bin)');
  });

  // A property can be opted into one flagged bin type but not another -
  // each is gated independently.
  test('getPropertyEventsRows_optedIntoOneFlaggedBinTypeButNotAnother_seesOnlyTheOptedInOne', () => {
    db.prepare("UPDATE bin_types SET requires_opt_in = 1 WHERE summary_match IN ('Brown', 'Green')").run();
    const brownId = db.prepare("SELECT id FROM bin_types WHERE summary_match = 'Brown'").get().id;
    db.prepare('INSERT INTO property_bin_type_opt_ins (property_id, bin_type_id) VALUES (?, ?)').run(propertyId, brownId);
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-brown', 'Brown Bin', '2026-11-05')"
    ).run(propertyId);
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-green', 'Green Bin', '2026-11-06')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events.map(e => e.uid)).toEqual(['u-brown']);
  });

  // Real-world combined day: an opted-out property must still see the
  // non-withheld half of "Brown waste and general waste+food (...)" - the
  // fan-out join already splits this into separate rows, so excluding the
  // withheld row must leave the other match intact rather than suppressing
  // the whole event.
  test('getPropertyEventsRows_optedOutOnCombinedDay_stillReturnsTheNonWithheldHalf', () => {
    db.prepare("UPDATE bin_types SET requires_opt_in = 1 WHERE summary_match = 'Brown'").run();
    db.prepare(
      "INSERT INTO bin_types (summary_match, label, colour) VALUES ('waste+food', 'General Waste', '#6b7280')"
    ).run();
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-combined', 'Brown waste and general waste+food (+food only after transition week)', '2026-11-26')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].colour).toBe('#6b7280');
    expect(events[0].label).toBe('general waste+food (+food only after transition week)');
  });

  // Bin types with requires_opt_in = 0 are completely unaffected - no opt-in
  // row is ever needed for them regardless of what else is flagged.
  test('getPropertyEventsRows_nonFlaggedBinType_unaffectedByOptInState', () => {
    db.prepare(
      "INSERT INTO events (property_id, uid, summary, start_date) VALUES (?, 'u-grey', 'Grey Bin', '2026-11-05')"
    ).run(propertyId);

    const events = getPropertyEventsRows(db, propertyId);

    expect(events).toHaveLength(1);
    expect(events[0].matched).toBe(true);
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
