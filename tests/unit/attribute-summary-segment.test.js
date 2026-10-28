const { attributeSummarySegment } = require('../../src/server');

describe('attributeSummarySegment', () => {
  // The literal real East Ayrshire case behind this whole function: a
  // combined-day summary is just two standalone summaries joined by " and ",
  // and a qualifier attached to one half ("+food only after transition
  // week") must not leak onto the other half's label just because they
  // share one VEVENT that day.
  test('attributeSummarySegment_combinedSummary_returnsOnlyTheSegmentContainingTheMatch', () => {
    const summary = 'Garden waste and general waste+food (+food only after transition week)';
    expect(attributeSummarySegment(summary, 'Garden')).toBe('Garden waste');
    expect(attributeSummarySegment(summary, 'waste+food')).toBe('general waste+food (+food only after transition week)');
  });

  test('attributeSummarySegment_noAndJoiner_returnsWholeSummaryUnchanged', () => {
    // The common case - nothing to split - must be a complete no-op, so
    // every non-combined event (the vast majority of real feed data) is
    // entirely unaffected by this function existing.
    expect(attributeSummarySegment('Trolley+food', 'Trolley')).toBe('Trolley+food');
  });

  test('attributeSummarySegment_ambiguousSubstringLikeGreyBlueMixedBin_fallsBackToWholeSummary', () => {
    // No " and " present, so this is a single segment regardless of how
    // many bin_types rules match it - matches the pre-existing
    // "Grey/Blue Mixed Bin" lowest-id-wins-removed (now fan-out) behaviour.
    expect(attributeSummarySegment('Grey/Blue Mixed Bin', 'Grey')).toBe('Grey/Blue Mixed Bin');
    expect(attributeSummarySegment('Grey/Blue Mixed Bin', 'Blue')).toBe('Grey/Blue Mixed Bin');
  });

  test('attributeSummarySegment_threeWayCombination_attributesEachMatchToItsOwnSegment', () => {
    const summary = 'Paper/card+food and plastic/cans+food and glass+food';
    expect(attributeSummarySegment(summary, 'Paper/card')).toBe('Paper/card+food');
    expect(attributeSummarySegment(summary, 'plastic/cans')).toBe('plastic/cans+food');
    expect(attributeSummarySegment(summary, 'Glass')).toBe('glass+food');
  });

  // Defensive fallback: if a match can't be attributed to exactly one
  // segment (shouldn't happen with real data, but must never crash or
  // silently drop information), fall back to the whole summary rather than
  // guessing.
  test('attributeSummarySegment_matchNotFoundInAnySegment_fallsBackToWholeSummary', () => {
    const summary = 'Garden waste and general waste+food';
    expect(attributeSummarySegment(summary, 'Glass')).toBe(summary);
  });

  test('attributeSummarySegment_matchIsCaseInsensitive', () => {
    const summary = 'Garden waste and general waste+food (+food only after transition week)';
    expect(attributeSummarySegment(summary, 'GARDEN')).toBe('Garden waste');
  });

  // "and" must only split on the whole word, surrounded by whitespace -
  // never as a substring inside another word (e.g. "Brand").
  test('attributeSummarySegment_andAsSubstringOfAnotherWord_doesNotSplit', () => {
    expect(attributeSummarySegment('Brand new bin', 'Brand')).toBe('Brand new bin');
  });
});
