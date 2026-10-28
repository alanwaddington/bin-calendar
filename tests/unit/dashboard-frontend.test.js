const { createCalendarWindow, mockFetch, closeAllCalendarWindows } = require('../helpers/browserDom');

afterEach(() => {
  closeAllCalendarWindows();
});

describe('dashboard.js hero card rendering', () => {
  // PR #27 review finding M2: previously de-duplicated by the *formatted*
  // display label, which only worked while labels were canonical. Now that
  // formatMatchedLabel can embed a property-specific raw summary, two
  // properties sharing a collection date under the same bin type but with
  // differently-worded feed summaries produce two different formatted
  // labels - de-duplication must use the stable `rawLabel` field instead.
  test('renderHeroCard_twoPropertiesSameBinTypeDifferentSummaryWording_collapsesToOneChip', async () => {
    const window = createCalendarWindow(mockFetch([
      ['/api/next-collection', { collections: [
        { date: '2026-11-05', daysUntil: 0, summary: 'Trolley', label: 'General Waste', rawLabel: 'General Waste', colour: '#6b7280', propertyId: 1, propertyLabel: 'Home' },
        { date: '2026-11-05', daysUntil: 0, summary: 'Trolley+food', label: 'Trolley+food', rawLabel: 'General Waste', colour: '#6b7280', propertyId: 2, propertyLabel: 'Flat' },
      ] }],
      ['/api/properties', []],
      ['/api/sync/runs', { runs: [], results: [] }],
      ['/health', { status: 'ok', nextSync: null }],
    ]));

    await window.loadDashboard();

    const html = window.document.getElementById('hero-card').innerHTML;
    expect((html.match(/hero-bin-chip/g) || [])).toHaveLength(1);
  });

  test('renderHeroCard_twoPropertiesDifferentBinTypes_showsBothChips', async () => {
    const window = createCalendarWindow(mockFetch([
      ['/api/next-collection', { collections: [
        { date: '2026-11-05', daysUntil: 0, summary: 'Grey Bin', label: 'General Waste', rawLabel: 'General Waste', colour: '#6b7280', propertyId: 1, propertyLabel: 'Home' },
        { date: '2026-11-05', daysUntil: 0, summary: 'Blue Bin', label: 'Recycling', rawLabel: 'Recycling', colour: '#3b82f6', propertyId: 2, propertyLabel: 'Flat' },
      ] }],
      ['/api/properties', []],
      ['/api/sync/runs', { runs: [], results: [] }],
      ['/health', { status: 'ok', nextSync: null }],
    ]));

    await window.loadDashboard();

    const html = window.document.getElementById('hero-card').innerHTML;
    expect((html.match(/hero-bin-chip/g) || [])).toHaveLength(2);
  });

  // PR #27 review finding m2: a matched label can now be considerably
  // longer than a plain configured label (feed summary appended, or shown
  // alone). The chip must carry the full text (via title, for discoverability
  // when visually truncated) rather than silently clipping with no way to
  // see what was cut off.
  test('renderHeroCard_longLabel_exposesFullTextViaTitleAttribute', async () => {
    const longLabel = 'General Waste (Trolley, Garden Waste, Food Waste and Recycling all collected together this week due to a schedule change)';
    const window = createCalendarWindow(mockFetch([
      ['/api/next-collection', { collections: [
        { date: '2026-11-05', daysUntil: 0, summary: longLabel, label: longLabel, rawLabel: longLabel, colour: '#6b7280', propertyId: 1, propertyLabel: 'Home' },
      ] }],
      ['/api/properties', []],
      ['/api/sync/runs', { runs: [], results: [] }],
      ['/health', { status: 'ok', nextSync: null }],
    ]));

    await window.loadDashboard();

    const chip = window.document.querySelector('.hero-bin-chip');
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('title')).toBe(longLabel);
    expect(chip.textContent).toBe(longLabel); // full text still in the DOM, not truncated server-side
  });
});
