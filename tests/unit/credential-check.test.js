jest.mock('../../src/db');
jest.mock('../../src/google');
jest.mock('../../src/icloud');

const { getDb } = require('../../src/db');
const google = require('../../src/google');
const icloud = require('../../src/icloud');
const { checkAllCredentials, checkSingleCredential } = require('../../src/credential-check');

describe('checkAllCredentials', () => {
  let mockPrepare;
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepare = {
      all: jest.fn().mockReturnValue([]),
      run: jest.fn(),
      get: jest.fn(),
    };
    mockDb = {
      prepare: jest.fn().mockReturnValue(mockPrepare),
    };
    getDb.mockReturnValue(mockDb);
    google.checkCredentials = jest.fn().mockResolvedValue('ok');
    icloud.checkCredentials = jest.fn().mockResolvedValue('ok');
  });

  test('checkAllCredentials_withNoProperties_completesWithoutError', async () => {
    mockPrepare.all.mockReturnValue([]);
    await expect(checkAllCredentials()).resolves.toBeUndefined();
  });

  test('checkAllCredentials_withGoogleProperty_callsGoogleCheck', async () => {
    mockPrepare.all.mockReturnValue([
      { id: 1, calendar_type: 'google', credentials: 'enc' },
    ]);

    await checkAllCredentials();

    expect(google.checkCredentials).toHaveBeenCalledWith({ id: 1, calendar_type: 'google', credentials: 'enc' });
  });

  test('checkAllCredentials_withIcloudProperty_callsIcloudCheck', async () => {
    mockPrepare.all.mockReturnValue([
      { id: 2, calendar_type: 'icloud', credentials: 'enc' },
    ]);

    await checkAllCredentials();

    expect(icloud.checkCredentials).toHaveBeenCalledWith({ id: 2, calendar_type: 'icloud', credentials: 'enc' });
  });

  test('checkAllCredentials_updatesCredentialStatusInDb', async () => {
    mockPrepare.all.mockReturnValue([
      { id: 1, calendar_type: 'google', credentials: 'enc' },
    ]);
    google.checkCredentials.mockResolvedValue('ok');

    await checkAllCredentials();

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('credential_status')
    );
    expect(mockPrepare.run).toHaveBeenCalledWith('ok', 1);
  });

  test('checkAllCredentials_onePropertyFailing_doesNotStopOthers', async () => {
    mockPrepare.all.mockReturnValue([
      { id: 1, calendar_type: 'google', credentials: 'enc' },
      { id: 2, calendar_type: 'icloud', credentials: 'enc' },
    ]);
    google.checkCredentials.mockRejectedValue(new Error('Unexpected crash'));
    icloud.checkCredentials.mockResolvedValue('ok');

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await checkAllCredentials();
    consoleSpy.mockRestore();

    expect(icloud.checkCredentials).toHaveBeenCalled();
  });

  test('checkAllCredentials_onPropertyError_logsButDoesNotThrow', async () => {
    mockPrepare.all.mockReturnValue([
      { id: 1, calendar_type: 'google', credentials: 'enc' },
    ]);
    google.checkCredentials.mockRejectedValue(new Error('Unexpected crash'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await expect(checkAllCredentials()).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('checkSingleCredential', () => {
  let mockPrepare;
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepare = {
      run: jest.fn(),
      get: jest.fn(),
    };
    mockDb = {
      prepare: jest.fn().mockReturnValue(mockPrepare),
    };
    getDb.mockReturnValue(mockDb);
    google.checkCredentials = jest.fn().mockResolvedValue('ok');
    icloud.checkCredentials = jest.fn().mockResolvedValue('ok');
  });

  test('checkSingleCredential_withGoogleProperty_returnsStatus', async () => {
    google.checkCredentials.mockResolvedValue('invalid');
    const property = { id: 1, calendar_type: 'google', credentials: 'enc' };

    const result = await checkSingleCredential(property);

    expect(result).toBe('invalid');
  });

  test('checkSingleCredential_withIcloudProperty_returnsStatus', async () => {
    icloud.checkCredentials.mockResolvedValue('ok');
    const property = { id: 2, calendar_type: 'icloud', credentials: 'enc' };

    const result = await checkSingleCredential(property);

    expect(result).toBe('ok');
  });

  test('checkSingleCredential_updatesDbWithStatusAndTimestamp', async () => {
    google.checkCredentials.mockResolvedValue('ok');
    const property = { id: 1, calendar_type: 'google', credentials: 'enc' };

    await checkSingleCredential(property);

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('credential_status')
    );
    expect(mockPrepare.run).toHaveBeenCalledWith('ok', 1);
  });
});
