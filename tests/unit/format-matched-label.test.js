const { formatMatchedLabel } = require('../../src/server');

describe('formatMatchedLabel', () => {
  test('formatMatchedLabel_summaryUnrelatedToLabel_appendsRawSummaryInParens', () => {
    expect(formatMatchedLabel('General Waste', 'Trolley+food')).toBe('General Waste (Trolley+food)');
  });

  test('formatMatchedLabel_summaryIdenticalToLabel_returnsLabelUnchanged', () => {
    expect(formatMatchedLabel('General Waste', 'General Waste')).toBe('General Waste');
  });

  test('formatMatchedLabel_summaryDiffersOnlyByCase_returnsLabelInConfiguredCasing', () => {
    expect(formatMatchedLabel('FOO COLLECTION', 'foo collection')).toBe('FOO COLLECTION');
  });

  test('formatMatchedLabel_summaryDiffersOnlyByWhitespace_returnsLabelUnchanged', () => {
    expect(formatMatchedLabel('General Waste', '  General Waste  ')).toBe('General Waste');
  });

  // Real-world bug report: East Ayrshire's feed sends "Trolley+food", but
  // the user's own bin_types config matches it with Match/Label both set
  // to "Trolley". The label and summary aren't equal, but the summary
  // contains the label - the feed is strictly more specific, so the feed
  // text alone should be shown rather than stuttering "Trolley (Trolley+food)".
  test('formatMatchedLabel_summaryContainsLabelButIsMoreSpecific_returnsRawSummaryAlone', () => {
    expect(formatMatchedLabel('Trolley', 'Trolley+food')).toBe('Trolley+food');
  });

  // PR #27's own motivating counter-example for why a naive splice was
  // rejected: this must NOT become "Garden Waste waste". Case-insensitive
  // containment collapses it to the plain equality case instead.
  test('formatMatchedLabel_summaryContainsLabelCaseInsensitively_returnsLabelCasingNotSplice', () => {
    expect(formatMatchedLabel('Garden Waste', 'Garden waste')).toBe('Garden Waste');
  });

  // Every other bin type's "feed is more specific" case just appends
  // "+food" (see Trolley above) - General Waste is no different, it just
  // happens to be lowercase in the feed ("waste" not "Waste"), which is
  // exactly what the case-insensitive containment check exists to handle.
  test('formatMatchedLabel_summaryAddsQualifierCaseInsensitively_returnsRawSummaryAlone', () => {
    expect(formatMatchedLabel('General Waste', 'General waste+food')).toBe('General waste+food');
  });

  test('formatMatchedLabel_summaryNeitherEqualNorContainsLabel_appendsRawSummaryInParens', () => {
    expect(formatMatchedLabel('Recycling', 'Blue Bin')).toBe('Recycling (Blue Bin)');
  });
});
