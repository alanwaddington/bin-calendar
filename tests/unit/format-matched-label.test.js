const { formatMatchedLabel } = require('../../src/server');

describe('formatMatchedLabel', () => {
  test('formatMatchedLabel_summaryHasExtraInfo_appendsRawSummaryInParens', () => {
    expect(formatMatchedLabel('General Waste', 'Trolley+food')).toBe('General Waste (Trolley+food)');
  });

  test('formatMatchedLabel_summaryIdenticalToLabel_returnsLabelUnchanged', () => {
    expect(formatMatchedLabel('General Waste', 'General Waste')).toBe('General Waste');
  });

  test('formatMatchedLabel_summaryDiffersOnlyByCase_returnsLabelUnchanged', () => {
    expect(formatMatchedLabel('FOO COLLECTION', 'foo collection')).toBe('FOO COLLECTION');
  });

  test('formatMatchedLabel_summaryDiffersOnlyByWhitespace_returnsLabelUnchanged', () => {
    expect(formatMatchedLabel('General Waste', '  General Waste  ')).toBe('General Waste');
  });

  test('formatMatchedLabel_transitionalCaveatSummary_appendsFullRawSummary', () => {
    expect(formatMatchedLabel('General Waste', 'General waste+food (+food only after transition week)'))
      .toBe('General Waste (General waste+food (+food only after transition week))');
  });
});
