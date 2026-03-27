jest.mock('googleapis', () => {
  const mockSetCredentials = jest.fn();
  const mockRefreshAccessToken = jest.fn();
  const mockCalendarListList = jest.fn();
  const MockOAuth2 = jest.fn().mockImplementation(() => ({
    setCredentials: mockSetCredentials,
    refreshAccessToken: mockRefreshAccessToken,
    credentials: {},
  }));
  const mockCalendar = jest.fn().mockReturnValue({
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
const { decryptJson, encryptJson } = require('../../src/crypto');
const { getDb } = require('../../src/db');
const { checkCredentials } = require('../../src/google');

describe('google.checkCredentials', () => {
  let mockCalendarListList;

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

    const calInstance = google.calendar();
    mockCalendarListList = calInstance.calendarList.list;
    mockCalendarListList.mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  test('checkCredentials_whenCredentialsNull_returnsUnknown', async () => {
    const property = { id: 1, credentials: null };
    const result = await checkCredentials(property);
    expect(result).toBe('unknown');
  });

  test('checkCredentials_whenListCalendarsSucceeds_returnsOk', async () => {
    const property = { id: 1, credentials: 'encrypted' };
    const result = await checkCredentials(property);
    expect(result).toBe('ok');
  });

  test('checkCredentials_whenListCalendarsFails_returnsInvalid', async () => {
    mockCalendarListList.mockRejectedValue(new Error('invalid_grant'));
    const property = { id: 1, credentials: 'encrypted' };
    const result = await checkCredentials(property);
    expect(result).toBe('invalid');
  });

  test('checkCredentials_whenTokenRefreshFails_returnsInvalid', async () => {
    decryptJson.mockReturnValue({
      access_token: 'old-token',
      refresh_token: 'ref-token',
      expiry_date: Date.now() - 120000,
    });
    const { google: gapis } = require('googleapis');
    const instance = new gapis.auth.OAuth2();
    instance.refreshAccessToken.mockRejectedValue(new Error('Token has been expired or revoked'));

    const property = { id: 1, credentials: 'encrypted' };
    const result = await checkCredentials(property);
    expect(result).toBe('invalid');
  });
});
