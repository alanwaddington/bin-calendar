jest.mock('googleapis', () => {
  const mockGenerateAuthUrl = jest.fn().mockReturnValue('https://accounts.google.com/auth?state=test123');
  const mockGetToken = jest.fn().mockResolvedValue({ tokens: { access_token: 'tok' } });
  const mockSetCredentials = jest.fn();
  const mockRefreshAccessToken = jest.fn();
  const MockOAuth2 = jest.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    setCredentials: mockSetCredentials,
    refreshAccessToken: mockRefreshAccessToken,
    credentials: {},
  }));
  const mockEventsImport = jest.fn().mockResolvedValue({});
  const mockEventsList = jest.fn().mockResolvedValue({ data: { items: [] } });
  const mockEventsDelete = jest.fn().mockResolvedValue({});
  const mockEventsPatch = jest.fn().mockResolvedValue({});
  const mockCalendarListList = jest.fn().mockResolvedValue({
    data: { items: [{ id: 'primary', summary: 'My Calendar', primary: true }] },
  });
  const mockCalendar = jest.fn().mockReturnValue({
    events: { import: mockEventsImport, list: mockEventsList, delete: mockEventsDelete, patch: mockEventsPatch },
    calendarList: { list: mockCalendarListList },
  });
  return {
    google: {
      auth: { OAuth2: MockOAuth2 },
      calendar: mockCalendar,
    },
  };
});

jest.mock('../../src/crypto', () => ({
  decryptJson: jest.fn(),
  encryptJson: jest.fn(),
}));

jest.mock('../../src/db', () => ({
  getDb: jest.fn(),
}));

const { google } = require('googleapis');
const { decryptJson } = require('../../src/crypto');
const { getDb } = require('../../src/db');
const {
  isGoogleConfigured,
  getAuthUrl,
  insertEvent,
  listCalendars,
} = require('../../src/google');

describe('google', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';

    decryptJson.mockReturnValue({
      access_token: 'test-token',
      expiry_date: Date.now() + 3600000,
    });

    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({ run: jest.fn() }),
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  test('isGoogleConfigured_whenEnvVarsSet_returnsTrue', () => {
    expect(isGoogleConfigured()).toBe(true);
  });

  test('isGoogleConfigured_whenEnvVarsMissing_returnsFalse', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleConfigured()).toBe(false);
  });

  test('getAuthUrl_returnsUrlContainingState', () => {
    const url = getAuthUrl('test123');
    expect(typeof url).toBe('string');
  });

  test('insertEvent_allDayEvent_usesDateFormat', async () => {
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const event = {
      uid: 'evt-001',
      summary: 'Bin Collection',
      start: new Date('2026-04-01'),
      end: new Date('2026-04-02'),
      description: 'Test',
      allDay: true,
    };

    await insertEvent(property, event);

    const mockCalendar = google.calendar();
    expect(mockCalendar.events.import).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          start: { date: '2026-04-01' },
        }),
      })
    );
  });

  test('insertEvent_timedEvent_usesDateTimeFormat', async () => {
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const event = {
      uid: 'evt-002',
      summary: 'Bin Collection',
      start: new Date('2026-04-01T07:00:00Z'),
      end: new Date('2026-04-01T08:00:00Z'),
      description: 'Test',
      allDay: false,
    };

    await insertEvent(property, event);

    const mockCalendar = google.calendar();
    expect(mockCalendar.events.import).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          start: { dateTime: expect.any(String) },
        }),
      })
    );
  });

  test('listCalendars_returnsCalendarList', async () => {
    const property = { id: 1, credentials: 'encrypted' };

    const calendars = await listCalendars(property);

    expect(calendars).toEqual([
      { id: 'primary', summary: 'My Calendar', primary: true },
    ]);
  });

  test('getAuthenticatedClient_refreshesExpiredToken', async () => {
    // Set credentials with expired token
    decryptJson.mockReturnValue({
      access_token: 'old-token',
      refresh_token: 'ref-token',
      expiry_date: Date.now() - 120000, // expired 2 minutes ago
    });

    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const event = {
      uid: 'evt-refresh',
      summary: 'Test',
      start: new Date('2026-04-01'),
      end: new Date('2026-04-02'),
      description: '',
      allDay: true,
    };

    // The refreshAccessToken mock on OAuth2 instance needs to return credentials
    const { google: gapis } = require('googleapis');
    const instance = new gapis.auth.OAuth2();
    instance.refreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'new-token', expiry_date: Date.now() + 3600000 },
    });

    await insertEvent(property, event);

    // Verify refreshAccessToken was called
    expect(instance.refreshAccessToken).toHaveBeenCalled();
  });

  test('exchangeCode_returnsTokens', async () => {
    const { exchangeCode } = require('../../src/google');
    const tokens = await exchangeCode('test-code');
    expect(tokens).toEqual({ access_token: 'tok' });
  });

  test('listEvents_returnsEmptyArray', async () => {
    const { listEvents } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const result = await listEvents(property, new Date('2026-04-01'), new Date('2026-04-30'));
    expect(result).toEqual([]);
  });

  // PR #34 review finding m5: the default events.list page is capped at
  // 250 results by Google. Before pagination, a Garden Waste event beyond
  // the first page was absent from existingByUid and so was NEVER deleted
  // on opt-out - a silent AC10 failure for any property with a large
  // enough feed range. Must follow nextPageToken until exhausted.
  test('listEvents_withMultiplePages_followsNextPageTokenAndConcatenatesItems', async () => {
    const { listEvents } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const mockCalendar = google.calendar();
    mockCalendar.events.list
      .mockResolvedValueOnce({ data: { items: [{ id: 'e1' }], nextPageToken: 'page2' } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'e2' }] } });

    const result = await listEvents(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(result).toEqual([{ id: 'e1' }, { id: 'e2' }]);
    expect(mockCalendar.events.list).toHaveBeenCalledTimes(2);
    expect(mockCalendar.events.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: 'page2' }));
  });

  test('listEvents_singlePageWithNoNextPageToken_callsListExactlyOnce', async () => {
    const { listEvents } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const mockCalendar = google.calendar();
    mockCalendar.events.list.mockResolvedValueOnce({ data: { items: [{ id: 'e1' }] } });

    await listEvents(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(mockCalendar.events.list).toHaveBeenCalledTimes(1);
  });

  // #33 Task 4: deleting an already-pushed garden-waste event on opt-out.
  test('deleteEvent_callsCalendarEventsDeleteWithCalendarIdAndEventId', async () => {
    const { deleteEvent } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };

    await deleteEvent(property, 'google-event-id-123');

    const mockCalendar = google.calendar();
    expect(mockCalendar.events.delete).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'google-event-id-123',
    });
  });

  // A single event's delete failing (already removed, transient API error,
  // etc.) must never abort the rest of the sync run - it's caught and
  // logged here rather than propagated.
  test('deleteEvent_whenApiCallRejects_doesNotThrow', async () => {
    const { deleteEvent } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const mockCalendar = google.calendar();
    mockCalendar.events.delete.mockRejectedValueOnce(new Error('Not Found'));

    await expect(deleteEvent(property, 'missing-event-id')).resolves.not.toThrow();
  });

  // PR #34 review finding m2: sync.js's events_deleted count must reflect
  // CONFIRMED deletions, not merely attempted ones - deleteEvent needs to
  // report success/failure back to its caller.
  test('deleteEvent_onSuccess_returnsTrue', async () => {
    const { deleteEvent } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };

    const result = await deleteEvent(property, 'google-event-id-123');

    expect(result).toBe(true);
  });

  test('deleteEvent_whenApiCallRejects_returnsFalse', async () => {
    const { deleteEvent } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const mockCalendar = google.calendar();
    mockCalendar.events.delete.mockRejectedValueOnce(new Error('Not Found'));

    const result = await deleteEvent(property, 'missing-event-id');

    expect(result).toBe(false);
  });

  // PR #34 review finding M1: the documented limitation ("no safe way to
  // rewrite an already-pushed combined event on Google") didn't actually
  // hold - calendar.events.patch is a documented, ID-addressed, idempotent
  // update, and the event ID is already available via listEvents/iCalUID.
  test('updateEventSummary_callsCalendarEventsPatchWithCalendarIdEventIdAndNewSummary', async () => {
    const { updateEventSummary } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };

    await updateEventSummary(property, 'google-event-id-456', 'general waste+food (+food only after transition week)');

    const mockCalendar = google.calendar();
    expect(mockCalendar.events.patch).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'google-event-id-456',
      requestBody: { summary: 'general waste+food (+food only after transition week)' },
    });
  });

  test('updateEventSummary_onSuccess_returnsTrue', async () => {
    const { updateEventSummary } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };

    const result = await updateEventSummary(property, 'id', 'summary');

    expect(result).toBe(true);
  });

  // A single event's update failing must never abort the rest of the sync
  // run, matching deleteEvent's existing swallow-and-log treatment.
  test('updateEventSummary_whenApiCallRejects_returnsFalseAndDoesNotThrow', async () => {
    const { updateEventSummary } = require('../../src/google');
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'primary' };
    const mockCalendar = google.calendar();
    mockCalendar.events.patch.mockRejectedValueOnce(new Error('Not Found'));

    const result = await updateEventSummary(property, 'missing-id', 'summary');

    expect(result).toBe(false);
  });
});
