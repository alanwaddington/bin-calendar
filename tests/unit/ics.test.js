jest.mock('node-ical', () => ({
  sync: { parseICS: jest.fn() },
}));

const ical = require('node-ical');
const { parseIcs, fetchIcs, normaliseIcsUrl } = require('../../src/ics');

describe('normaliseIcsUrl', () => {
  test('normaliseIcsUrl_withWebcalScheme_convertsToHttps', () => {
    expect(normaliseIcsUrl('webcal://example.com/events.ics')).toBe('https://example.com/events.ics');
  });

  test('normaliseIcsUrl_withHttpsScheme_returnsUnchanged', () => {
    expect(normaliseIcsUrl('https://example.com/events.ics')).toBe('https://example.com/events.ics');
  });

  test('normaliseIcsUrl_withHttpScheme_returnsUnchanged', () => {
    expect(normaliseIcsUrl('http://example.com/events.ics')).toBe('http://example.com/events.ics');
  });
});

describe('parseIcs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseIcs_withStandardEvent_returnsEventWithCorrectFields', () => {
    const start = new Date('2026-04-01T07:00:00Z');
    const end = new Date('2026-04-01T08:00:00Z');
    ical.sync.parseICS.mockReturnValue({
      'evt-001': {
        type: 'VEVENT',
        uid: 'evt-001@test',
        summary: 'Blue Bin Collection',
        start,
        end,
        description: 'Recycling collection',
        datetype: 'date-time',
      },
    });

    const { events, warnings } = parseIcs('fake ics text');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      uid: 'evt-001@test',
      summary: 'Blue Bin Collection',
      start,
      end,
      description: 'Recycling collection',
      allDay: false,
    });
    expect(warnings).toHaveLength(0);
  });

  test('parseIcs_withAllDayEvent_setsAllDayTrue', () => {
    ical.sync.parseICS.mockReturnValue({
      'evt-002': {
        type: 'VEVENT',
        uid: 'evt-002@test',
        summary: 'Green Bin Collection',
        start: new Date('2026-04-01'),
        end: new Date('2026-04-02'),
        description: 'Garden waste',
        datetype: 'date',
      },
    });

    const { events } = parseIcs('fake ics text');

    expect(events[0].allDay).toBe(true);
  });

  test('parseIcs_withParameterisedSummary_extractsSummaryText', () => {
    ical.sync.parseICS.mockReturnValue({
      'evt-003': {
        type: 'VEVENT',
        uid: 'evt-003@test',
        summary: { val: 'Garden Waste', params: { LANGUAGE: 'en-gb' } },
        start: new Date('2026-04-01'),
        end: new Date('2026-04-02'),
        description: '',
        datetype: 'date',
      },
    });

    const { events } = parseIcs('fake ics text');

    expect(events[0].summary).toBe('Garden Waste');
  });

  test('parseIcs_withMissingSummary_defaultsToBinCollection', () => {
    ical.sync.parseICS.mockReturnValue({
      'evt-004': {
        type: 'VEVENT',
        uid: 'evt-004@test',
        start: new Date('2026-04-01T07:00:00Z'),
        end: new Date('2026-04-01T08:00:00Z'),
        description: '',
        datetype: 'date-time',
      },
    });

    const { events } = parseIcs('fake ics text');

    expect(events[0].summary).toBe('Bin Collection');
  });

  test('parseIcs_withNoVevents_returnsEmptyEvents', () => {
    ical.sync.parseICS.mockReturnValue({
      vcalendar: { type: 'VCALENDAR' },
    });

    const { events } = parseIcs('fake ics text');

    expect(events).toHaveLength(0);
  });

  test('parseIcs_withMissingUid_addsWarning', () => {
    ical.sync.parseICS.mockReturnValue({
      'no-uid': {
        type: 'VEVENT',
        summary: 'Brown Bin Collection',
        start: new Date('2026-04-01T07:00:00Z'),
        end: new Date('2026-04-01T08:00:00Z'),
        description: '',
        datetype: 'date-time',
      },
    });

    const { events, warnings } = parseIcs('fake ics text');

    expect(events).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/missing UID/i);
  });
});

describe('fetchIcs', () => {
  const TEST_ICS_URL = 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics';
  let originalFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test('fetchIcs_whenFetchFails_retriesAndThrows', async () => {
    jest.useFakeTimers({ advanceTimers: true });

    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
    ical.sync.parseICS.mockReturnValue({});

    await expect(fetchIcs(TEST_ICS_URL)).rejects.toThrow('ICS fetch failed after 3 attempts');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('fetchIcs_whenServerError_retriesAndThrows', async () => {
    jest.useFakeTimers({ advanceTimers: true });

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    ical.sync.parseICS.mockReturnValue({});

    await expect(fetchIcs(TEST_ICS_URL)).rejects.toThrow('ICS fetch failed after 3 attempts');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('fetchIcs_whenClientError_throwsImmediatelyWithoutRetry', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    ical.sync.parseICS.mockReturnValue({});

    await expect(fetchIcs(TEST_ICS_URL)).rejects.toThrow('HTTP 404');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('fetchIcs_whenSuccessful_returnsEvents', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('fake ics content'),
    });

    const start = new Date('2026-04-01T07:00:00Z');
    const end = new Date('2026-04-01T08:00:00Z');
    ical.sync.parseICS.mockReturnValue({
      'evt-001': {
        type: 'VEVENT',
        uid: 'evt-001@test',
        summary: 'Blue Bin',
        start,
        end,
        description: '',
        datetype: 'date-time',
      },
    });

    const result = await fetchIcs(TEST_ICS_URL);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].uid).toBe('evt-001@test');
  });

  test('fetchIcs_performsGetRequest_withNoBody', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('fake ics content'),
    });
    ical.sync.parseICS.mockReturnValue({});

    await fetchIcs(TEST_ICS_URL);

    const [calledUrl, calledOptions] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe(TEST_ICS_URL);
    expect(calledOptions?.body).toBeUndefined();
    expect(calledOptions?.method).toBeUndefined();
  });

  test('fetchIcs_withWebcalUrl_convertsToHttpsBeforeFetching', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('fake ics content'),
    });
    ical.sync.parseICS.mockReturnValue({});

    const webcalUrl = 'webcal://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics';
    await fetchIcs(webcalUrl);

    const [calledUrl] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe('https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics');
  });
});
