jest.mock('../../src/db');
jest.mock('../../src/ics');
jest.mock('../../src/google');
jest.mock('../../src/icloud');

const { getDb } = require('../../src/db');
const { fetchIcs } = require('../../src/ics');
const google = require('../../src/google');
const icloud = require('../../src/icloud');
const { runSync } = require('../../src/sync');

describe('sync', () => {
  let mockPrepareReturn;
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrepareReturn = {
      get: jest.fn().mockReturnValue(null),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
      all: jest.fn().mockReturnValue([]),
    };
    mockDb = {
      prepare: jest.fn().mockReturnValue(mockPrepareReturn),
      transaction: jest.fn().mockImplementation(fn => () => fn()),
    };
    getDb.mockReturnValue(mockDb);

    fetchIcs.mockResolvedValue({ events: [], warnings: [] });
    google.listEvents.mockResolvedValue([]);
    google.insertEvent.mockResolvedValue(undefined);
    icloud.listEventUids.mockResolvedValue(new Set());
    icloud.insertEvent.mockResolvedValue(undefined);
  });

  test('runSync_withNoProperties_returnsSkipped', async () => {
    const result = await runSync();

    expect(result.message).toMatch(/Skipped/i);
  });

  test('runSync_withAlreadyRunningSync_returns429', async () => {
    // The transaction fn calls db.prepare("SELECT...").get() which returns a row
    // causing it to throw ALREADY_RUNNING
    mockPrepareReturn.get.mockReturnValue({ id: 1 });

    const result = await runSync();

    expect(result.status).toBe(429);
    expect(result.message).toMatch(/already in progress/i);
  });

  test('runSync_withGoogleProperty_callsGoogleInsertEvent', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    // First .all() call returns properties; subsequent calls return []
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    const start = new Date('2026-04-01T07:00:00Z');
    const end = new Date('2026-04-01T08:00:00Z');
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-001',
        summary: 'Blue Bin',
        start,
        end,
        description: '',
        allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    await runSync();

    expect(google.insertEvent).toHaveBeenCalledTimes(1);
  });

  test('runSync_withIcloudProperty_callsIcloudInsertEvent', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'icloud',
      calendar_id: 'https://caldav.icloud.com/123',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    const start = new Date('2026-04-01T07:00:00Z');
    const end = new Date('2026-04-01T08:00:00Z');
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-001',
        summary: 'Blue Bin',
        start,
        end,
        description: '',
        allDay: false,
      }],
      warnings: [],
    });
    icloud.listEventUids.mockResolvedValue(new Set());

    await runSync();

    expect(icloud.insertEvent).toHaveBeenCalledTimes(1);
  });

  test('runSync_whenEventUidAlreadyExists_skipsEvent', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-001',
        summary: 'Blue Bin',
        start: new Date('2026-04-01T07:00:00Z'),
        end: new Date('2026-04-01T08:00:00Z'),
        description: '',
        allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-001' }]);

    await runSync();

    expect(google.insertEvent).not.toHaveBeenCalled();
  });

  test('runSync_whenPropertyFails_continuesWithOthers', async () => {
    const properties = [
      { id: 1, label: 'Home', uprn: '11111', calendar_type: 'google', calendar_id: 'primary', credentials: 'enc1' },
      { id: 2, label: 'Work', uprn: '22222', calendar_type: 'google', calendar_id: 'primary', credentials: 'enc2' },
    ];
    mockPrepareReturn.all.mockReturnValueOnce(properties);

    fetchIcs
      .mockRejectedValueOnce(new Error('ICS fetch failed'))
      .mockResolvedValueOnce({
        events: [{
          uid: 'evt-002',
          summary: 'Green Bin',
          start: new Date('2026-04-01T07:00:00Z'),
          end: new Date('2026-04-01T08:00:00Z'),
          description: '',
          allDay: false,
        }],
        warnings: [],
      });
    google.listEvents.mockResolvedValue([]);

    const result = await runSync();

    expect(result.overallStatus).toBe('partial');
  });

  test('runSync_whenAllPropertiesFail_returnsFailedStatus', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    fetchIcs.mockRejectedValue(new Error('ICS fetch failed'));

    const result = await runSync();

    expect(result.overallStatus).toBe('failed');
  });

  test('runSync_onSuccess_returnsSuccessStatus', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-001',
        summary: 'Blue Bin',
        start: new Date('2026-04-01T07:00:00Z'),
        end: new Date('2026-04-01T08:00:00Z'),
        description: '',
        allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    const result = await runSync();

    expect(result.overallStatus).toBe('success');
  });

  test('runSync_onPropertySuccess_setsCredentialStatusOk', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockResolvedValue({ events: [], warnings: [] });

    await runSync();

    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const statusUpdate = calls.find(q => q.includes('credential_status'));
    expect(statusUpdate).toBeDefined();
    const runCalls = mockPrepareReturn.run.mock.calls;
    const statusRun = runCalls.find(args => args[0] === 'ok');
    expect(statusRun).toBeDefined();
  });

  test('runSync_onAuthError_setsCredentialStatusInvalid', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockResolvedValue({
      events: [{ uid: 'evt-1', summary: 'Bin', start: new Date(), end: new Date(), allDay: false, description: '' }],
      warnings: [],
    });
    google.listEvents.mockRejectedValue(new Error('invalid_grant: Token has been expired or revoked'));

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    const statusRun = runCalls.find(args => args[0] === 'invalid');
    expect(statusRun).toBeDefined();
  });

  test('runSync_onNonAuthError_doesNotChangeCredentialStatus', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockRejectedValue(new Error('ICS fetch failed after 3 attempts: ETIMEDOUT'));

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    const invalidRun = runCalls.find(args => args[0] === 'invalid');
    const okRun = runCalls.find(args => args[0] === 'ok');
    expect(invalidRun).toBeUndefined();
    expect(okRun).toBeUndefined();
  });

  test('runSync_onError401ContainingNonAuthText_doesNotSetInvalid', async () => {
    // Ensure bare '401' (e.g. "line 401") does NOT trigger auth detection
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockResolvedValue({
      events: [{ uid: 'evt-1', summary: 'Bin', start: new Date(), end: new Date(), allDay: false, description: '' }],
      warnings: [],
    });
    google.listEvents.mockRejectedValue(new Error('Parse error at position 401'));

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    const invalidRun = runCalls.find(args => args[0] === 'invalid');
    expect(invalidRun).toBeUndefined();
  });

  test('runSync_onHttp401Error_setsCredentialStatusInvalid', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockResolvedValue({
      events: [{ uid: 'evt-1', summary: 'Bin', start: new Date(), end: new Date(), allDay: false, description: '' }],
      warnings: [],
    });
    google.listEvents.mockRejectedValue(new Error('Request failed with HTTP 401: Unauthorized'));

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    const statusRun = runCalls.find(args => args[0] === 'invalid');
    expect(statusRun).toBeDefined();
  });
});
