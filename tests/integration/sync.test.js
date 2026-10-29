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
    // PR #34 review finding m2: deleteEvent/updateEvent now report
    // success/failure so sync.js can count CONFIRMED actions rather than
    // merely attempted ones - default to success so existing count-based
    // assertions keep passing; failure is tested explicitly where it matters.
    google.deleteEvent.mockResolvedValue(true);
    google.updateEventSummary.mockResolvedValue(true);
    icloud.listEventUids.mockResolvedValue(new Set());
    icloud.listEventObjects.mockResolvedValue(new Map());
    icloud.insertEvent.mockResolvedValue(undefined);
    icloud.deleteEvent.mockResolvedValue(true);
    icloud.updateEvent.mockResolvedValue(true);
    icloud.extractSummary.mockImplementation(data => {
      const match = data?.match(/^SUMMARY:(.+)$/m);
      return match ? match[1].trim() : null;
    });
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

  // PR #34 review finding m2: events_deleted must reflect CONFIRMED
  // deletions - if the provider call fails (already removed, transient API
  // error), the attempt must not be counted, since nothing actually changed
  // on the external calendar.
  test('runSync_gardenWasteOptedOut_failedDeletionIsNotCountedInEventsDeleted', async () => {
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
    google.deleteEvent.mockResolvedValue(false);

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    const resultRunCall = runCalls.find(args => args.length === 8 && args[2] === 0 && args[3] === 0);
    expect(resultRunCall[4]).toBe(0); // deleted count stays 0, not 1
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
    const resultRunCall = runCalls.find(args => args.length === 8 && args[2] === 0 && args[3] === 0 && args[4] === 1);
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

  // PR #34 review finding M1: the original "documented limitation" didn't
  // actually hold - calendar.events.patch is a documented, ID-addressed,
  // idempotent update, and the event ID is already available via
  // listEvents/iCalUID (that's exactly how deleteEvent targets it too).
  // An already-pushed combined event on Google is now rewritten in place,
  // mirroring the iCloud path, instead of being left stale indefinitely.
  test('runSync_gardenWasteOptedOut_alreadyPushedCombinedDayEventOnGoogle_updatesInPlaceViaEventsPatch', async () => {
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
    // Remote still carries the OLD unstripped summary from before this
    // property opted out.
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-combined', id: 'google-event-id-1', summary: COMBINED_SUMMARY }]);

    await runSync();

    expect(google.updateEventSummary).toHaveBeenCalledWith(
      property, 'google-event-id-1', 'general waste+food (+food only after transition week)'
    );
    expect(google.insertEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  // PR #34 review finding M2: an already-pushed combined event whose
  // remote summary ALREADY equals the stripped summary (i.e. a previous
  // sync already rewrote it) must not be rewritten again on every single
  // run - that would needlessly bump the event's etag/sequence on the
  // user's own devices for literally no change.
  test('runSync_gardenWasteOptedOut_combinedDayAlreadyUpdatedOnGoogle_doesNotReWriteAgain', async () => {
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
    // Remote already carries the stripped summary from a prior sync.
    google.listEvents.mockResolvedValue([{
      iCalUID: 'evt-combined', id: 'google-event-id-1',
      summary: 'general waste+food (+food only after transition week)',
    }]);

    await runSync();

    expect(google.updateEventSummary).not.toHaveBeenCalled();
    expect(google.insertEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedOut_combinedDayAlreadyUpdatedOnIcloud_doesNotReWriteAgain', async () => {
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
    const davObject = {
      url: 'https://caldav.icloud.com/123/evt-combined.ics', etag: '"e1"',
      data: 'BEGIN:VEVENT\r\nUID:evt-combined\r\nSUMMARY:general waste+food (+food only after transition week)\r\nEND:VEVENT',
    };
    icloud.listEventObjects.mockResolvedValue(new Map([['evt-combined', davObject]]));

    await runSync();

    expect(icloud.updateEvent).not.toHaveBeenCalled();
    expect(icloud.insertEvent).not.toHaveBeenCalled();
  });

  // PR #34 review finding m3: the iCloud equivalent of the Google "new
  // combined-day event" coverage above (sync.js's icloud.insertEvent
  // branch for a not-yet-present combined event was previously uncovered).
  test('runSync_gardenWasteOptedOut_newCombinedDayEventOnIcloud_pushesWithGardenWasteSegmentStripped', async () => {
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
    icloud.listEventObjects.mockResolvedValue(new Map()); // not yet pushed

    await runSync();

    expect(icloud.insertEvent).toHaveBeenCalledWith(
      property,
      expect.objectContaining({ uid: 'evt-combined', summary: 'general waste+food (+food only after transition week)' })
    );
    expect(icloud.updateEvent).not.toHaveBeenCalled();
    expect(icloud.deleteEvent).not.toHaveBeenCalled();
  });

  // PR #34 review finding S2: bin_types is global, not per-property, so
  // querying it once per property inside the sync loop was wasteful - this
  // locks in that it's now queried exactly once per sync run regardless of
  // how many properties are synced.
  test('runSync_withMultipleProperties_queriesGardenMatchersExactlyOnce', async () => {
    const properties = [
      { id: 1, label: 'Home', ics_url: 'https://a.example/cal.ics', calendar_type: 'google', calendar_id: 'primary', credentials: 'enc1', garden_waste_opted_in: 0 },
      { id: 2, label: 'Flat', ics_url: 'https://b.example/cal.ics', calendar_type: 'google', calendar_id: 'primary', credentials: 'enc2', garden_waste_opted_in: 0 },
    ];
    mockPrepareReturn.all
      .mockReturnValueOnce(properties)
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({ events: [], warnings: [] });

    await runSync();

    const matcherQueryCalls = mockDb.prepare.mock.calls.filter(c => c[0].includes('bin_types') && c[0].includes('is_garden_waste'));
    expect(matcherQueryCalls).toHaveLength(1);
  });

  // PR #34 review finding M1 (new, full /pr-reviewer re-audit): opting a
  // property back IN must restore a combined-day event's full original
  // summary on the external calendar - previously the opted-in path had
  // no equivalent to the opted-out path's "compare before writing" check,
  // so it fell through to the generic "uid already exists -> skip" branch
  // and the stale stripped text (from a prior opted-out period) was never
  // corrected.
  test('runSync_gardenWasteOptedIn_alreadyPushedCombinedDayEventStillHasStrippedSummaryOnGoogle_restoresOriginalSummary', async () => {
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
    // Remote still carries the STRIPPED summary from the prior opted-out
    // period - never deleted, just rewritten, so its uid is still present.
    google.listEvents.mockResolvedValue([{
      iCalUID: 'evt-combined', id: 'google-event-id-1',
      summary: 'general waste+food (+food only after transition week)',
    }]);

    await runSync();

    expect(google.updateEventSummary).toHaveBeenCalledWith(property, 'google-event-id-1', COMBINED_SUMMARY);
    expect(google.insertEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  test('runSync_gardenWasteOptedIn_alreadyPushedCombinedDayEventStillHasStrippedSummaryOnIcloud_restoresOriginalSummary', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'icloud', calendar_id: 'https://caldav.icloud.com/123', credentials: 'encrypted',
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
    const davObject = {
      url: 'https://caldav.icloud.com/123/evt-combined.ics', etag: '"e1"',
      data: 'BEGIN:VEVENT\r\nUID:evt-combined\r\nSUMMARY:general waste+food (+food only after transition week)\r\nEND:VEVENT',
    };
    icloud.listEventObjects.mockResolvedValue(new Map([['evt-combined', davObject]]));

    await runSync();

    expect(icloud.updateEvent).toHaveBeenCalledWith(
      property, davObject, expect.objectContaining({ uid: 'evt-combined', summary: COMBINED_SUMMARY })
    );
    expect(icloud.insertEvent).not.toHaveBeenCalled();
    expect(icloud.deleteEvent).not.toHaveBeenCalled();
  });

  // Once already restored (by a prior sync, or because it was never
  // stripped in the first place), re-opted-in must not keep re-writing the
  // event identically on every run - mirrors the opted-out "already
  // updated" guard.
  test('runSync_gardenWasteOptedIn_combinedDayAlreadyHasOriginalSummary_doesNotReWriteAgain', async () => {
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
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-combined', id: 'google-event-id-1', summary: COMBINED_SUMMARY }]);

    await runSync();

    expect(google.updateEventSummary).not.toHaveBeenCalled();
    expect(google.insertEvent).not.toHaveBeenCalled();
  });

  // PR #34 review finding m1 (new, full /pr-reviewer re-audit): a genuine
  // combined-day summary rewrite (either direction - opt-out strip or
  // opt-in restore) is not an addition, it's a correction to an event that
  // already exists externally - must be counted via events_updated, not
  // events_added, so the audit trail in sync_results/Logs isn't misleading.
  test('runSync_gardenWasteOptedOut_combinedDayRewrite_isCountedAsEventsUpdatedNotEventsAdded', async () => {
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
    google.listEvents.mockResolvedValue([{ iCalUID: 'evt-combined', id: 'google-event-id-1', summary: COMBINED_SUMMARY }]);

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    // [runId, propertyId, added, skipped, deleted, updated, error, startedAt]
    const resultRunCall = runCalls.find(args => args.length === 8 && args[1] === 1);
    expect(resultRunCall[2]).toBe(0); // added stays 0
    expect(resultRunCall[5]).toBe(1); // updated is 1
  });

  test('runSync_gardenWasteOptedIn_combinedDayRestore_isCountedAsEventsUpdatedNotEventsAdded', async () => {
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
    google.listEvents.mockResolvedValue([{
      iCalUID: 'evt-combined', id: 'google-event-id-1',
      summary: 'general waste+food (+food only after transition week)',
    }]);

    await runSync();

    const runCalls = mockPrepareReturn.run.mock.calls;
    const resultRunCall = runCalls.find(args => args.length === 8 && args[1] === 1);
    expect(resultRunCall[2]).toBe(0); // added stays 0
    expect(resultRunCall[5]).toBe(1); // updated is 1
  });

  test('runSync_recordsUpdatedCountInSyncResults_includesEventsUpdatedColumnInInsertSql', async () => {
    const property = {
      id: 1, label: 'Home', uprn: '12345',
      ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics',
      calendar_type: 'google', calendar_id: 'primary', credentials: 'encrypted',
      garden_waste_opted_in: 0,
    };
    mockPrepareReturn.all
      .mockReturnValueOnce([property])
      .mockReturnValueOnce([{ summary_match: 'Garden' }]);
    fetchIcs.mockResolvedValue({ events: [], warnings: [] });

    await runSync();

    const calls = mockDb.prepare.mock.calls.map(c => c[0]);
    const resultInsertCall = calls.find(q => q.includes('INSERT INTO sync_results'));
    expect(resultInsertCall).toMatch(/events_updated/);
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
