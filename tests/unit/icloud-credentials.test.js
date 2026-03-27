jest.mock('tsdav', () => {
  const mockLogin = jest.fn();
  const MockDAVClient = jest.fn().mockImplementation(() => ({
    login: mockLogin,
    fetchCalendars: jest.fn(),
    fetchCalendarObjects: jest.fn(),
    createCalendarObject: jest.fn(),
  }));
  return { DAVClient: MockDAVClient };
});

jest.mock('../../src/crypto', () => ({
  decryptJson: jest.fn(),
}));

const { DAVClient } = require('tsdav');
const { decryptJson } = require('../../src/crypto');
const { checkCredentials } = require('../../src/icloud');

describe('icloud.checkCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    decryptJson.mockReturnValue({
      apple_id: 'user@icloud.com',
      app_specific_password: 'app-pass',
    });
  });

  test('checkCredentials_whenCredentialsNull_returnsUnknown', async () => {
    const property = { id: 1, credentials: null };
    const result = await checkCredentials(property);
    expect(result).toBe('unknown');
  });

  test('checkCredentials_whenLoginSucceeds_returnsOk', async () => {
    const instance = new DAVClient();
    instance.login.mockResolvedValue(undefined);

    const property = { id: 1, credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const result = await checkCredentials(property);
    expect(result).toBe('ok');
  });

  test('checkCredentials_whenLoginFails_returnsInvalid', async () => {
    const instance = new DAVClient();
    instance.login.mockRejectedValue(new Error('Auth failed'));

    const property = { id: 1, credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const result = await checkCredentials(property);
    expect(result).toBe('invalid');
  });
});
