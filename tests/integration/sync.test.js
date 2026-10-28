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
    google.deleteEvent.mockResolvedValue(undefined);
    icloud.listEventUids.mockResolvedValue(new Set());
    icloud.listEventObjects.mockResolvedValue(new Map());
    icloud.insertEvent.mockResolvedValue(undefined);
    icloud.deleteEvent.mockResolvedValue(undefined);
    icloud.updateEvent.mockResolvedValue(undefined);
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

  test('runSync_withPropertyMissingIcsUrl_skipsPropertyWithWarning', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      ics_url: null,
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    const result = await runSync();

    expect(fetchIcs).not.toHaveBeenCalled();
    expect(result.overallStatus).toBe('failed');
  });

  test('runSync_withGoogleProperty_callsFetchIcsWithIcsUrl', async () => {
    const ICS_URL = 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics';
    const property = {
      id: 1,
      label: 'Home',
      ics_url: ICS_URL,
      calendar_type: 'google',
      calendar_id: 'primary',
      credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockResolvedValue({ events: [], warnings: [] });

    await runSync();

    expect(fetchIcs).toHaveBeenCalledWith(ICS_URL);
  });

  test('runSync_withGoogleProperty_callsGoogleInsertEvent', async () => {
    const property = {
      id: 1,
      label: 'Home',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      { id: 1, label: 'Home', uprn: '11111', ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/P1/services/50014/events.en-GB.ics', calendar_type: 'google', calendar_id: 'primary', credentials: 'enc1' },
      { id: 2, label: 'Work', uprn: '22222', ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/P2/services/50014/events.en-GB.ics', calendar_type: 'google', calendar_id: 'primary', credentials: 'enc2' },
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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

  test('runSync_atStart_prunesPastEventsFromDb', async () => {
    // Verify the DELETE FROM events WHERE start_date < date('now') is issued
    await runSync();

    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const pruneCall = calls.find(q => q.includes("DELETE FROM events") && q.includes("start_date"));
    expect(pruneCall).toBeDefined();
  });

  test('runSync_onSuccessfulPropertySync_cachesEvents', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);

    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-001', summary: 'Grey Bin',
        start: new Date(Date.now() + 86400000 * 30),
        end: new Date(Date.now() + 86400000 * 30),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    await runSync();

    // Verify an INSERT OR REPLACE INTO events was issued
    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const cacheCall = calls.find(q => q.includes('INSERT OR REPLACE INTO events'));
    expect(cacheCall).toBeDefined();
  });

  test('runSync_onPropertyFailure_doesNotCacheEvents', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
    };
    mockPrepareReturn.all.mockReturnValueOnce([property]);
    fetchIcs.mockRejectedValue(new Error('ICS fetch failed'));

    await runSync();

    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const cacheCall = calls.find(q => q.includes('INSERT OR REPLACE INTO events'));
    expect(cacheCall).toBeUndefined();
  });

  test('runSync_onHttp401Error_setsCredentialStatusInvalid', async () => {
    const property = {
      id: 1,
      label: 'Home',
      uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
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

  // --- #33 Task 5: gate push / reconcile deletions on garden_waste_opted_in ---

  test('runSync_gardenWasteOptedOut_doesNotPushPureGardenWasteEvent', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-garden', summary: 'Garden waste',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    await runSync();

    expect(google.insertEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedOut_deletesAlreadyPushedGardenWasteEventOnGoogle', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-garden', summary: 'Garden waste',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-garden', id: 'google-event-id-1' }]);

    await runSync();

    expect(google.deleteEvent).toHaveBeenCalledWith(property, 'google-event-id-1');
    expect(google.insertEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedOut_deletesAlreadyPushedGardenWasteEventOnIcloud', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'icloud', calendar_id: 'https://caldav.icloud.com/123', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-garden', summary: 'Garden waste',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    const davObject = { url: 'https://caldav.icloud.com/123/evt-garden.ics', etag: '"e1"' };
    icloud.listEventObjects.mockResolvedValue(new Map([['evt-garden', davObject]]));

    await runSync();

    expect(icloud.deleteEvent).toHaveBeenCalledWith(property, davObject);
    expect(icloud.insertEvent).not.toHaveBeenCalled();
  });

  // Confirms the opt-out -> sync -> opt-in -> sync acceptance criterion:
  // once opted in, a garden-waste event not yet present externally (i.e.
  // withheld during a prior opted-out period) is pushed through the same
  // new-vs-existing uid diff every other event already uses - no separate
  // backfill mechanism needed.
  test('runSync_gardenWasteOptedIn_pushesGardenWasteEventNotYetPresentExternally', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 1,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-garden', summary: 'Garden waste',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    await runSync();

    expect(google.insertEvent).toHaveBeenCalledTimes(1);
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedOut_neverDeletesNonGardenWasteEvents', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-grey', summary: 'Grey Bin',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-grey', id: 'google-event-id-2' }]);

    await runSync();

    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedOut_recordsDeletedCountInSyncResults', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-garden', summary: 'Garden waste',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-garden', id: 'google-event-id-1' }]);

    await runSync();

    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const resultInsertCall = calls.find(q => q.includes('INSERT INTO sync_results'));
    expect(resultInsertCall).toMatch(/events_deleted/);

    const runCalls = mockPrepareReturn.run.mock.calls;
    const resultRunCall = runCalls.find(args => args.length === 7 && args[2] === 0 && args[3] === 0 && args[4] === 1);
    expect(resultRunCall).toBeDefined();
  });

  // Classification must use the full in-memory feed (whatever range
  // fetchIcs actually returns), not the 6-month cache window - this would
  // be undetectable via the cache alone since cacheEvents already runs
  // regardless of opt-in status.
  test('runSync_gardenWasteOptedOut_stillCachesTheGardenWasteEventDespiteNotPushingIt', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-garden', summary: 'Garden waste',
        start: new Date(Date.now() + 86400000 * 10),
        end: new Date(Date.now() + 86400000 * 10),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    await runSync();

    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const cacheCall = calls.find(q => q.includes('INSERT OR REPLACE INTO events'));
    expect(cacheCall).toBeDefined();
    const runCalls = mockPrepareReturn.run.mock.calls;
    const cacheRunCall = runCalls.find(args => args[1] === 'evt-garden');
    expect(cacheRunCall).toBeDefined();
  });

  // --- #33 Task 6: strip garden-waste segments from combined-day pushes ---

  const COMBINED_SUMMARY = 'Garden waste and general waste+food (+food only after transition week)';

  test('runSync_gardenWasteOptedOut_newCombinedDayEvent_pushesWithGardenWasteSegmentStripped', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-combined', summary: COMBINED_SUMMARY,
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]); // not yet pushed

    await runSync();

    expect(google.insertEvent).toHaveBeenCalledWith(
      property,
      expect.objectContaining({ uid: 'evt-combined', summary: 'general waste+food (+food only after transition week)' })
    );
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedOut_alreadyPushedCombinedDayEventOnIcloud_updatesInPlaceWithStrippedSummary', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'icloud', calendar_id: 'https://caldav.icloud.com/123', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-combined', summary: COMBINED_SUMMARY,
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    const davObject = { url: 'https://caldav.icloud.com/123/evt-combined.ics', etag: '"e1"' };
    icloud.listEventObjects.mockResolvedValue(new Map([['evt-combined', davObject]]));

    await runSync();

    expect(icloud.updateEvent).toHaveBeenCalledWith(
      property,
      davObject,
      expect.objectContaining({ uid: 'evt-combined', summary: 'general waste+food (+food only after transition week)' })
    );
    expect(icloud.deleteEvent).not.toHaveBeenCalled();
    expect(icloud.insertEvent).not.toHaveBeenCalled();
  });

  // Google's events.import has no documented behaviour for re-importing an
  // existing iCalUID (confirmed: Google's own reference page doesn't say),
  // so rewriting an already-pushed combined event in place isn't attempted
  // for Google - risking either a duplicate or an incorrect overwrite is
  // worse than leaving it as a documented limitation. It's also never
  // deleted, since that would lose the General Waste half.
  test('runSync_gardenWasteOptedOut_alreadyPushedCombinedDayEventOnGoogle_leavesItUnchangedAsADocumentedLimitation', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-combined', summary: COMBINED_SUMMARY,
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-combined', id: 'google-event-id-1' }]);

    await runSync();

    expect(google.insertEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedIn_combinedDayEvent_pushesWithOriginalSummaryUnchanged', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 1,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-combined', summary: COMBINED_SUMMARY,
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);

    await runSync();

    expect(google.insertEvent).toHaveBeenCalledWith(
      property,
      expect.objectContaining({ uid: 'evt-combined', summary: COMBINED_SUMMARY })
    );
  });
});
