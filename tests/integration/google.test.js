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
  const mockCalendarListList = jest.fn().mockResolvedValue({
    data: { items: [{ id: 'primary', summary: 'My Calendar', primary: true }] },
  });
  const mockCalendar = jest.fn().mockReturnValue({
    events: { import: mockEventsImport, list: mockEventsList },
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
});
