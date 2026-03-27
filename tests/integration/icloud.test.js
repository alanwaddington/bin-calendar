jest.mock('tsdav', () => {
  const mockLogin = jest.fn().mockResolvedValue(undefined);
  const mockFetchCalendars = jest.fn().mockResolvedValue([
    { displayName: 'My Calendar', url: 'https://caldav.icloud.com/123' },
  ]);
  const mockFetchCalendarObjects = jest.fn().mockResolvedValue([]);
  const mockCreateCalendarObject = jest.fn().mockResolvedValue(undefined);
  const MockDAVClient = jest.fn().mockImplementation(() => ({
    login: mockLogin,
    fetchCalendars: mockFetchCalendars,
    fetchCalendarObjects: mockFetchCalendarObjects,
    createCalendarObject: mockCreateCalendarObject,
  }));
  return { DAVClient: MockDAVClient };
});

jest.mock('../../src/crypto', () => ({
  decryptJson: jest.fn(),
}));

const { DAVClient } = require('tsdav');
const { decryptJson } = require('../../src/crypto');
const { fetchCalendars, listEventUids, insertEvent } = require('../../src/icloud');

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
});
