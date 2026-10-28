jest.mock('tsdav', () => {
  const mockLogin = jest.fn().mockResolvedValue(undefined);
  const mockFetchCalendars = jest.fn().mockResolvedValue([
    { displayName: 'My Calendar', url: 'https://caldav.icloud.com/123' },
  ]);
  const mockFetchCalendarObjects = jest.fn().mockResolvedValue([]);
  const mockCreateCalendarObject = jest.fn().mockResolvedValue(undefined);
  const mockDeleteCalendarObject = jest.fn().mockResolvedValue(undefined);
  const MockDAVClient = jest.fn().mockImplementation(() => ({
    login: mockLogin,
    fetchCalendars: mockFetchCalendars,
    fetchCalendarObjects: mockFetchCalendarObjects,
    createCalendarObject: mockCreateCalendarObject,
    deleteCalendarObject: mockDeleteCalendarObject,
  }));
  return { DAVClient: MockDAVClient };
});

jest.mock('../../src/crypto', () => ({
  decryptJson: jest.fn(),
}));

const { DAVClient } = require('tsdav');
const { decryptJson } = require('../../src/crypto');
const { fetchCalendars, listEventUids, insertEvent, listEventObjects, deleteEvent } = require('../../src/icloud');

describe('icloud', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    decryptJson.mockReturnValue({
      apple_id: 'user@icloud.com',
      app_specific_password: 'app-pass',
    });
  });

  test('fetchCalendars_returnsMappedCalendars', async () => {
    const calendars = await fetchCalendars('user@icloud.com', 'app-pass');

    expect(calendars).toEqual([
      { displayName: 'My Calendar', url: 'https://caldav.icloud.com/123' },
    ]);
  });

  test('listEventUids_withMatchingObjects_returnsUidSet', async () => {
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    mockInstance.fetchCalendarObjects.mockResolvedValue([
      { data: 'BEGIN:VEVENT\r\nUID:abc123\r\nEND:VEVENT' },
    ]);

    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const uids = await listEventUids(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(uids).toBeInstanceOf(Set);
    expect(uids.has('abc123')).toBe(true);
  });

  test('insertEvent_createsCalendarObjectWithCorrectIcs', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const event = {
      uid: 'evt-001',
      summary: 'Blue Bin',
      start: new Date('2026-04-01T07:00:00Z'),
      end: new Date('2026-04-01T08:00:00Z'),
      description: 'Recycling',
    };

    await insertEvent(property, event);

    // Get the mock instance that was created during the call
    const lastInstance = DAVClient.mock.results[DAVClient.mock.results.length - 1].value;
    expect(lastInstance.createCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'evt-001.ics',
        iCalString: expect.stringContaining('UID:evt-001'),
      })
    );
    expect(lastInstance.createCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        iCalString: expect.stringContaining('SUMMARY:Blue Bin'),
      })
    );
  });

  test('insertEvent_includesDescriptionWhenPresent', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const event = {
      uid: 'evt-002',
      summary: 'Green Bin',
      start: new Date('2026-04-01T07:00:00Z'),
      end: new Date('2026-04-01T08:00:00Z'),
      description: 'Garden waste collection',
    };

    await insertEvent(property, event);

    const lastInstance = DAVClient.mock.results[DAVClient.mock.results.length - 1].value;
    const call = lastInstance.createCalendarObject.mock.calls[0][0];
    expect(call.iCalString).toContain('DESCRIPTION:Garden waste collection');
  });

  test('insertEvent_omitsDescriptionWhenEmpty', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const event = {
      uid: 'evt-003',
      summary: 'Brown Bin',
      start: new Date('2026-04-01T07:00:00Z'),
      end: new Date('2026-04-01T08:00:00Z'),
      description: '',
    };

    await insertEvent(property, event);

    const lastInstance = DAVClient.mock.results[DAVClient.mock.results.length - 1].value;
    const call = lastInstance.createCalendarObject.mock.calls[0][0];
    expect(call.iCalString).not.toContain('DESCRIPTION:');
  });

  // #33 Task 4: deletion needs the dav object's url/etag, which
  // listEventUids has always discarded after parsing out the uid.
  test('listEventObjects_withMatchingObjects_returnsMapOfUidToDavObjectPreservingUrlAndEtag', async () => {
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    const davObject = { url: 'https://caldav.icloud.com/123/evt-abc.ics', etag: '"etag-1"', data: 'BEGIN:VEVENT\r\nUID:abc123\r\nEND:VEVENT' };
    mockInstance.fetchCalendarObjects.mockResolvedValue([davObject]);

    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const objects = await listEventObjects(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(objects).toBeInstanceOf(Map);
    expect(objects.get('abc123')).toBe(davObject);
  });

  // listEventUids must keep working exactly as before - re-expressed in
  // terms of listEventObjects, but existing callers are unaffected.
  test('listEventUids_stillReturnsUidSet_whenReExpressedInTermsOfListEventObjects', async () => {
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    mockInstance.fetchCalendarObjects.mockResolvedValue([
      { url: 'u1', etag: 'e1', data: 'BEGIN:VEVENT\r\nUID:xyz789\r\nEND:VEVENT' },
    ]);

    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const uids = await listEventUids(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(uids).toBeInstanceOf(Set);
    expect(uids.has('xyz789')).toBe(true);
  });

  test('deleteEvent_callsDeleteCalendarObjectWithTheDavObject', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-abc.ics', etag: '"etag-1"' };

    await deleteEvent(property, davObject);

    const lastInstance = DAVClient.mock.results[DAVClient.mock.results.length - 1].value;
    expect(lastInstance.deleteCalendarObject).toHaveBeenCalledWith({ calendarObject: davObject });
  });

  // A single event's delete failing must never abort the rest of the sync
  // run - caught and logged here rather than propagated.
  test('deleteEvent_whenApiCallRejects_doesNotThrow', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-missing.ics', etag: '"etag-1"' };
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    mockInstance.deleteCalendarObject.mockRejectedValueOnce(new Error('404 Not Found'));

    await expect(deleteEvent(property, davObject)).resolves.not.toThrow();
  });
});
