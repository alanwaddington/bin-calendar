const {
  stripParentheticals,
  matchesOutsideParentheses,
  splitSummarySegments,
  matchesAnySegment,
  stripMatchingSegments,
} = require('../../src/bin-types');

describe('stripParentheticals', () => {
  test('stripParentheticals_textWithParens_removesParenthesisedSpan', () => {
    expect(stripParentheticals('general waste+food (+food only after transition week)')).toBe('general waste+food ');
  });

  test('stripParentheticals_noParens_returnsUnchanged', () => {
    expect(stripParentheticals('Garden waste')).toBe('Garden waste');
  });
});

describe('matchesOutsideParentheses', () => {
  test('matchesOutsideParentheses_matchOutsideParens_returnsTrue', () => {
    expect(matchesOutsideParentheses('Garden waste', 'Garden')).toBe(true);
  });

  // The real bug this guards: a bin_types rule whose match text happens to
  // appear only inside someone else's parenthetical caveat must not count -
  // e.g. a word buried in "(+food only after transition week)" on an
  // unrelated General Waste day.
  test('matchesOutsideParentheses_matchOnlyInsideParens_returnsFalse', () => {
    expect(matchesOutsideParentheses('General waste+food (+food only after transition week)', 'transition week')).toBe(false);
  });

  test('matchesOutsideParentheses_isCaseInsensitive', () => {
    expect(matchesOutsideParentheses('Garden waste', 'GARDEN')).toBe(true);
  });

  // PR #34 review finding C1: String.prototype.includes('') is always
  // true, so a blank matchText (reachable if a bin_types row's
  // summary_match was ever persisted as '' - e.g. a Match of pure wildcard
  // characters, which the API boundary now also rejects) would otherwise
  // make this "match" every summary. This is the defense-in-depth layer:
  // even if a blank matcher reaches this function some other way (existing
  // bad data, a direct DB write, a future caller), it must never match.
  test('matchesOutsideParentheses_blankMatchText_returnsFalse', () => {
    expect(matchesOutsideParentheses('Grey Bin', '')).toBe(false);
  });

  test('matchesOutsideParentheses_whitespaceOnlyMatchText_returnsFalse', () => {
    expect(matchesOutsideParentheses('Grey Bin', '   ')).toBe(false);
  });
});

describe('splitSummarySegments', () => {
  test('splitSummarySegments_andJoinedSummary_splitsIntoTrimmedSegments', () => {
    const summary = 'Garden waste and general waste+food (+food only after transition week)';
    expect(splitSummarySegments(summary)).toEqual(['Garden waste', 'general waste+food (+food only after transition week)']);
  });

  test('splitSummarySegments_noAndJoiner_returnsSingleSegment', () => {
    expect(splitSummarySegments('Trolley+food')).toEqual(['Trolley+food']);
  });

  test('splitSummarySegments_andAsSubstringOfAnotherWord_doesNotSplit', () => {
    expect(splitSummarySegments('Brand new bin')).toEqual(['Brand new bin']);
  });
});

describe('matchesAnySegment', () => {
  test('matchesAnySegment_pureGardenWasteSummary_returnsTrue', () => {
    expect(matchesAnySegment('Garden waste', ['Garden'])).toBe(true);
  });

  test('matchesAnySegment_combinedWithGeneralWaste_returnsTrue', () => {
    const summary = 'Garden waste and general waste+food (+food only after transition week)';
    expect(matchesAnySegment(summary, ['Garden'])).toBe(true);
  });

  test('matchesAnySegment_generalWasteOnly_returnsFalse', () => {
    expect(matchesAnySegment('General waste+food (+food only after transition week)', ['Garden'])).toBe(false);
  });

  // Inherits the parenthetical-exclusion fix: a garden matcher that only
  // appears inside an unrelated caveat must not falsely flag the event.
  test('matchesAnySegment_matcherOnlyInsideParentheses_returnsFalse', () => {
    expect(matchesAnySegment('General waste (garden path closed)', ['garden'])).toBe(false);
  });

  test('matchesAnySegment_nonGardenSummary_returnsFalse', () => {
    expect(matchesAnySegment('Trolley+food', ['Garden'])).toBe(false);
  });

  // PR #34 review finding C1 (regression): this is the exact real-world
  // shape of the bug - a bin_types row with summary_match persisted as ''
  // (reachable, before the C1 fix, via a Match of pure wildcard characters)
  // flagged as Garden Waste. Before the fix, matchers=[''] made every event
  // classify as Garden Waste, which sync.js then treated as "delete this
  // from the user's real calendar" for every opted-out property.
  test('matchesAnySegment_blankMatcherInList_neverMatchesAnything', () => {
    expect(matchesAnySegment('Grey Bin', [''])).toBe(false);
    expect(matchesAnySegment('Trolley+food', [''])).toBe(false);
    expect(matchesAnySegment('Transition week', [''])).toBe(false);
  });

  test('matchesAnySegment_blankMatcherAlongsideARealOne_stillMatchesOnTheRealOne', () => {
    expect(matchesAnySegment('Garden waste', ['', 'Garden'])).toBe(true);
    expect(matchesAnySegment('Grey Bin', ['', 'Garden'])).toBe(false);
  });
});

describe('stripMatchingSegments', () => {
  test('stripMatchingSegments_combinedDay_removesOnlyTheGardenWasteSegment', () => {
    const summary = 'Garden waste and general waste+food (+food only after transition week)';
    expect(stripMatchingSegments(summary, ['Garden'])).toBe('general waste+food (+food only after transition week)');
  });

  test('stripMatchingSegments_pureGardenWaste_returnsEmptyString', () => {
    expect(stripMatchingSegments('Garden waste', ['Garden'])).toBe('');
  });

  test('stripMatchingSegments_noGardenWastePresent_returnsSummaryUnchanged', () => {
    expect(stripMatchingSegments('Trolley+food', ['Garden'])).toBe('Trolley+food');
  });

  // PR #34 review finding C1 (regression): a blank matcher must never
  // strip anything - this is what previously made stripMatchingSegments
  // return '' for EVERY summary, which sync.js read as "pure garden
  // waste" for literally every event.
  test('stripMatchingSegments_blankMatcherInList_neverStripsAnything', () => {
    expect(stripMatchingSegments('Grey Bin', [''])).toBe('Grey Bin');
    expect(stripMatchingSegments('Transition week', [''])).toBe('Transition week');
  });
});
