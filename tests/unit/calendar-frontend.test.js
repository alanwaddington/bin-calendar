const { createCalendarWindow, mockFetch, closeAllCalendarWindows } = require('../helpers/browserDom');

afterEach(() => {
  closeAllCalendarWindows();
});

describe('calendar.js pure functions', () => {
  let window;

  beforeEach(() => {
    window = createCalendarWindow(mockFetch([]));
  });

  describe('buildMonthMatrix', () => {
    test('buildMonthMatrix_monthStartingOnMonday_noLeadingBlanks', () => {
      // June 2026 starts on a Monday
      const weeks = window.buildMonthMatrix(2026, 5);
      expect(weeks[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    test('buildMonthMatrix_monthStartingMidWeek_padsLeadingBlanksToMonday', () => {
      // November 2026 starts on a Sunday -> 6 leading blanks (Mo..Sa)
      const weeks = window.buildMonthMatrix(2026, 10);
      expect(weeks[0]).toEqual([null, null, null, null, null, null, 1]);
    });

    test('buildMonthMatrix_padsTrailingBlanksToCompleteFinalWeek', () => {
      const weeks = window.buildMonthMatrix(2026, 10); // November 2026, 30 days
      const lastWeek = weeks[weeks.length - 1];
      expect(lastWeek).toHaveLength(7);
      expect(lastWeek.filter(d => d !== null).length).toBeGreaterThan(0);
    });

    test('buildMonthMatrix_februaryLeapYear_has29Days', () => {
      const weeks = window.buildMonthMatrix(2028, 1); // Feb 2028 is a leap year
      const allDays = weeks.flat().filter(d => d !== null);
      expect(Math.max(...allDays)).toBe(29);
    });

    test('buildMonthMatrix_februaryNonLeapYear_has28Days', () => {
      const weeks = window.buildMonthMatrix(2026, 1); // Feb 2026 is not a leap year
      const allDays = weeks.flat().filter(d => d !== null);
      expect(Math.max(...allDays)).toBe(28);
    });
  });

  describe('calDateStr', () => {
    test('calDateStr_padsMonthAndDay_returnsIsoDateString', () => {
      expect(window.calDateStr(2026, 0, 5)).toBe('2026-01-05');
    });

    test('calDateStr_doubleDigitMonthAndDay_returnsIsoDateString', () => {
      expect(window.calDateStr(2026, 10, 23)).toBe('2026-11-23');
    });
  });

  describe('getCalendarMonthsWithData', () => {
    test('getCalendarMonthsWithData_withEventsAcrossMonths_returnsSortedUniqueMonths', () => {
      const events = [
        { date: '2026-12-01' },
        { date: '2026-11-05' },
        { date: '2026-11-20' },
        { date: '2027-01-02' },
      ];
      const months = window.getCalendarMonthsWithData(events);
      // encoded as year*12+month0: Nov 2026 = 2026*12+10, Dec 2026 = 2026*12+11, Jan 2027 = 2027*12+0
      expect(months).toEqual([2026 * 12 + 10, 2026 * 12 + 11, 2027 * 12 + 0]);
    });

    test('getCalendarMonthsWithData_withNoEvents_returnsEmptyArray', () => {
      expect(window.getCalendarMonthsWithData([])).toEqual([]);
    });
  });

  describe('findNearestMonthWithData', () => {
    const monthsWithData = [2026 * 12 + 9, 2026 * 12 + 11]; // Oct 2026, Dec 2026 (Nov is a gap)

    test('findNearestMonthWithData_stepForwardAcrossGap_skipsToNextMonthWithData', () => {
      const result = window.findNearestMonthWithData(2026, 9, 1, monthsWithData); // from Oct, forward
      expect(result).toEqual({ year: 2026, month0: 11 }); // Dec, skipping Nov
    });

    test('findNearestMonthWithData_stepBackAcrossGap_skipsToPrevMonthWithData', () => {
      const result = window.findNearestMonthWithData(2026, 11, -1, monthsWithData); // from Dec, back
      expect(result).toEqual({ year: 2026, month0: 9 }); // Oct, skipping Nov
    });

    test('findNearestMonthWithData_noFurtherMonthInDirection_returnsNull', () => {
      expect(window.findNearestMonthWithData(2026, 11, 1, monthsWithData)).toBeNull();
      expect(window.findNearestMonthWithData(2026, 9, -1, monthsWithData)).toBeNull();
    });

    test('findNearestMonthWithData_singleMonthOfData_disabledBothDirectionsFromThatMonth', () => {
      const single = [2026 * 12 + 9];
      expect(window.findNearestMonthWithData(2026, 9, 1, single)).toBeNull();
      expect(window.findNearestMonthWithData(2026, 9, -1, single)).toBeNull();
    });
  });
});

describe('calendar.js rendering and state', () => {
  test('loadCalendar_withZeroProperties_showsAddPropertyPrompt', async () => {
    const window = createCalendarWindow(mockFetch([['/api/properties', []]]));

    await window.loadCalendar();

    const html = window.document.getElementById('view-calendar').innerHTML;
    expect(html).toMatch(/No properties configured/);
    expect(html).toMatch(/\+ Add property/);
  });

  test('loadCalendar_whenPropertiesFetchFails_showsInlineErrorNotBlankPage', async () => {
    const window = createCalendarWindow(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));

    await window.loadCalendar();

    const html = window.document.getElementById('view-calendar').innerHTML;
    expect(html).toMatch(/Could not load properties/);
    expect(html.trim().length).toBeGreaterThan(0);
  });

  test('selectCalendarProperty_whenEventsFetchFails_showsInlineErrorAndToast', async () => {
    const window = createCalendarWindow(async url => {
      if (url === '/api/properties') return { ok: true, json: async () => [{ id: 1, label: 'Home' }] };
      return { ok: false, status: 500, json: async () => ({ error: 'db exploded' }) };
    });

    await window.loadCalendar();

    const scheduleHtml = window.document.getElementById('cal-schedule').innerHTML;
    expect(scheduleHtml).toMatch(/Could not load this property's schedule/);
    expect(window.document.querySelector('.toast-error')).not.toBeNull();
  });

  test('selectCalendarProperty_withNoEventsForProperty_showsSyncHint', async () => {
    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [] }],
    ]));

    await window.loadCalendar();

    expect(window.document.getElementById('cal-schedule').innerHTML).toMatch(/No collections synced yet/);
  });

  test('renderCalendarGrid_eventOnFirstOfMonth_rendersOnDay1Cell_notPriorMonth', async () => {
    const now = new Date();
    const y = now.getFullYear(), m0 = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const thisMonthFirst = `${y}-${pad(m0 + 1)}-01`;

    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [
        { uid: 'u1', date: thisMonthFirst, summary: 'Grey Bin', label: 'General Waste', colour: '#6b7280', matched: true },
      ] }],
    ]));

    await window.loadCalendar();

    const gridHtml = window.document.getElementById('cal-grid').innerHTML;
    const day1Match = gridHtml.match(/<div class="cal-grid-cell">\s*<div class="cal-grid-date[^"]*">1<\/div>([\s\S]{0,300})/);
    expect(day1Match).not.toBeNull();
    expect(day1Match[1]).toMatch(/General Waste/);
  });

  test('renderCalendarMarker_matchedAndUnmatchedEvents_rendersCorrectLabelsWithNoDuplication', async () => {
    const now = new Date();
    const y = now.getFullYear(), m0 = now.getMonth();
    const pad = n => String(n).padStart(2, '0');

    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [
        { uid: 'u1', date: `${y}-${pad(m0 + 1)}-05`, summary: 'Grey Bin', label: 'General Waste', colour: '#6b7280', matched: true },
        { uid: 'u2', date: `${y}-${pad(m0 + 1)}-10`, summary: 'Mystery', label: 'Mystery', colour: '#6b7a99', matched: false },
      ] }],
    ]));

    await window.loadCalendar();

    const gridHtml = window.document.getElementById('cal-grid').innerHTML;
    expect(gridHtml).toMatch(/General Waste/);
    expect(gridHtml).not.toMatch(/General Waste.*\(uncategorised\)/);
    expect(gridHtml).toMatch(/Mystery[\s\S]*\(uncategorised\)/);
    expect((gridHtml.match(/cal-marker-dot/g) || [])).toHaveLength(2);
  });

  // PR #27 review finding m2: a matched label can now be considerably
  // longer than a plain configured label (feed summary appended, or shown
  // alone). CSS visually clamps it, but the full text must stay in the DOM
  // (for de-dup logic elsewhere and screen readers) and be recoverable via
  // title when clamped.
  test('renderCalendarMarker_longLabel_keepsFullTextInDomAndExposesItViaTitle', async () => {
    const now = new Date();
    const y = now.getFullYear(), m0 = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const longLabel = 'General Waste (Trolley, Garden Waste, Food Waste and Recycling all collected together this week due to a schedule change)';

    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [
        { uid: 'u1', date: `${y}-${pad(m0 + 1)}-05`, summary: longLabel, label: longLabel, colour: '#6b7280', matched: true },
      ] }],
    ]));

    await window.loadCalendar();

    const marker = window.document.querySelector('.cal-marker-label');
    expect(marker).not.toBeNull();
    expect(marker.textContent).toBe(longLabel);
    expect(marker.getAttribute('title')).toBe(longLabel);
  });

  test('renderCalendarMarker_withInvalidColourFromApi_fallsBackToNeutralRatherThanInjecting', async () => {
    const now = new Date();
    const y = now.getFullYear(), m0 = now.getMonth();
    const pad = n => String(n).padStart(2, '0');

    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [
        { uid: 'u1', date: `${y}-${pad(m0 + 1)}-05`, summary: 'Hack', label: 'Hack', colour: 'red;background-image:url(javascript:alert(1))', matched: true },
      ] }],
    ]));

    await window.loadCalendar();

    const gridHtml = window.document.getElementById('cal-grid').innerHTML;
    expect(gridHtml).toMatch(/background:#6b7a99/);
    expect(gridHtml).not.toMatch(/javascript:/);
  });

  test('calendarSwitcher_withMultipleProperties_isPresentAndReflectsSelection', async () => {
    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 7, label: 'Second House' }, { id: 1, label: 'First House' }]],
      [/\/api\/properties\/\d+\/events/, { events: [] }],
    ]));

    await window.loadCalendar();

    const select = window.document.getElementById('cal-property-select');
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(2);
  });

  test('calendarSwitcher_withSinglePropertyOnly_isEntirelyAbsentFromDom', async () => {
    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [] }],
    ]));

    await window.loadCalendar();

    expect(window.document.getElementById('cal-property-select')).toBeNull();
  });

  test('stepCalendarMonth_withGapMonthsEitherSide_skipsGapsAndDisablesAtRealBoundaries', async () => {
    const now = new Date();
    const y = now.getFullYear(), m0 = now.getMonth();

    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 1, label: 'Home' }]],
      [/\/api\/properties\/1\/events/, { events: [
        { uid: 'past', date: `${new Date(y, m0 - 2, 10).getFullYear()}-${String(new Date(y, m0 - 2, 10).getMonth() + 1).padStart(2, '0')}-10`, summary: 'A', label: 'A', colour: '#000000', matched: true },
        { uid: 'future', date: `${new Date(y, m0 + 2, 15).getFullYear()}-${String(new Date(y, m0 + 2, 15).getMonth() + 1).padStart(2, '0')}-15`, summary: 'B', label: 'B', colour: '#000000', matched: true },
      ] }],
    ]));

    await window.loadCalendar();

    window.stepCalendarMonth(1);
    expect(window.document.getElementById('cal-grid').innerHTML).toMatch(/>B<|B<\/span>/);
    expect(window.document.getElementById('cal-next-btn').disabled).toBe(true);

    window.stepCalendarMonth(-1);
    window.stepCalendarMonth(-1);
    expect(window.document.getElementById('cal-grid').innerHTML).toMatch(/>A<|A<\/span>/);
    expect(window.document.getElementById('cal-prev-btn').disabled).toBe(true);
  });

  test('stepCalendarMonth_doesNotTriggerAnyAdditionalNetworkRequest', async () => {
    let fetchCount = 0;
    const window = createCalendarWindow(async url => {
      fetchCount++;
      if (url === '/api/properties') return { ok: true, json: async () => [{ id: 1, label: 'Home' }] };
      return { ok: true, json: async () => ({ events: [
        { uid: 'a', date: '2026-01-05', summary: 'A', label: 'A', colour: '#000000', matched: true },
        { uid: 'b', date: '2026-12-05', summary: 'B', label: 'B', colour: '#000000', matched: true },
      ] }) };
    }, { includeDashboard: false });

    await window.loadCalendar();
    const afterLoad = fetchCount;
    window.stepCalendarMonth(1);
    window.stepCalendarMonth(-1);

    expect(fetchCount).toBe(afterLoad);
  });

  test('selectCalendarProperty_outOfOrderResponses_appliesOnlyTheLatestSelection', async () => {
    // Property 1's fetch resolves AFTER property 2's, simulating a slow first
    // request overtaken by a fast second one when switching quickly.
    const now = new Date();
    const thisMonthFirst = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    let resolveFirst;
    const firstPending = new Promise(res => { resolveFirst = res; });

    const window = createCalendarWindow(async url => {
      if (url === '/api/properties') return { ok: true, json: async () => [{ id: 1, label: 'One' }, { id: 2, label: 'Two' }] };
      if (url === '/api/properties/1/events') {
        await firstPending;
        return { ok: true, json: async () => ({ events: [{ uid: 'stale', date: thisMonthFirst, summary: 'Stale', label: 'Stale', colour: '#000', matched: true }] }) };
      }
      if (url === '/api/properties/2/events') {
        return { ok: true, json: async () => ({ events: [{ uid: 'fresh', date: thisMonthFirst, summary: 'Fresh', label: 'Fresh', colour: '#000', matched: true }] }) };
      }
      throw new Error('unexpected ' + url);
    }, { includeDashboard: false });

    // loadCalendar() awaits selectCalendarProperty(1) internally, which is
    // deliberately stalled on firstPending - don't await it yet, or this
    // test would hang. Let it start and reach the stalled fetch first.
    const loadPromise = window.loadCalendar();
    await new Promise(r => setTimeout(r, 20));

    await window.selectCalendarProperty(2); // overtakes it - not stalled, applies immediately
    resolveFirst(); // now let the stale first request resolve, after the second has already applied
    await loadPromise;
    await new Promise(r => setTimeout(r, 0));

    // calendar.js's selection state is private top-level `let`s - unlike
    // `function` declarations, `let` does not become a window property even
    // via window.eval(), so assert on observable DOM state instead (exactly
    // what a real caller/user would see).
    expect(window.document.getElementById('cal-property-select').value).toBe('2');
    const gridHtml = window.document.getElementById('cal-grid').innerHTML;
    expect(gridHtml).toMatch(/Fresh/);
    expect(gridHtml).not.toMatch(/Stale/);
  });
});

describe('calendar.js cross-view handoffs', () => {
  test('navigateToProperty_setsCalendarTargetAndNavigatesToCalendar', async () => {
    const window = createCalendarWindow(mockFetch([
      ['/api/properties', [{ id: 7, label: 'Second House' }, { id: 1, label: 'First House' }]],
      [/\/api\/properties\/\d+\/events/, { events: [] }],
    ]));

    window.navigateToProperty(7);

    expect(window._calendarTargetPropertyId).toBe(7);
    expect(window.location.hash).toBe('#calendar');

    await new Promise(r => setTimeout(r, 0));
    expect(window.document.getElementById('cal-property-select').value).toBe('7');
    expect(window._calendarTargetPropertyId).toBeNull(); // consumed and cleared
  });
});
