jest.mock('tsdav', () => {
  const mockLogin = jest.fn().mockResolvedValue(undefined);
  const mockFetchCalendars = jest.fn().mockResolvedValue([
    { displayName: 'My Calendar', url: 'https://caldav.icloud.com/123' },
  ]);
  const mockFetchCalendarObjects = jest.fn().mockResolvedValue([]);
  const mockCreateCalendarObject = jest.fn().mockResolvedValue(undefined);
  const mockDeleteCalendarObject = jest.fn().mockResolvedValue(undefined);
  const mockUpdateCalendarObject = jest.fn().mockResolvedValue(undefined);
  const MockDAVClient = jest.fn().mockImplementation(() => ({
    login: mockLogin,
    fetchCalendars: mockFetchCalendars,
    fetchCalendarObjects: mockFetchCalendarObjects,
    createCalendarObject: mockCreateCalendarObject,
    deleteCalendarObject: mockDeleteCalendarObject,
    updateCalendarObject: mockUpdateCalendarObject,
  }));
  return { DAVClient: MockDAVClient };
});

jest.mock('../../src/crypto', () => ({
  decryptJson: jest.fn(),
}));

const { DAVClient } = require('tsdav');
const { decryptJson } = require('../../src/crypto');
const { fetchCalendars, insertEvent, listEventObjects, deleteEvent, updateEvent, extractSummary } = require('../../src/icloud');

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

  // PR #37 review suggestion S1: RFC 5545 content lines SHOULD be folded
  // at or before 75 octets. buildVCalendarString previously emitted
  // SUMMARY: with no folding at all - the real East Ayrshire combined
  // summary comfortably exceeds the limit once SUMMARY: is counted in,
  // and extractSummary's single-line regex can't see past a fold a
  // CalDAV server applies on storage. If the server folds and this code
  // doesn't unfold before parsing, the compare-before-write check in
  // sync.js would never find a match, rewriting the event every run.
  test('insertEvent_withASummaryLongerThan75Octets_foldsTheSummaryLineAndEveryPhysicalLineStaysWithinTheLimit', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const longSummary = 'Garden waste and general waste+food (+food only after transition week) at 123 Example Street';
    const event = {
      uid: 'evt-long', summary: longSummary,
      start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'), description: '',
    };

    await insertEvent(property, event);

    const call = DAVClient.mock.results[DAVClient.mock.results.length - 1].value.createCalendarObject.mock.calls[0][0];
    // Folded: at least one CRLF + single leading space/tab continuation
    // appears, and every resulting PHYSICAL line (including the fold
    // marker itself) is within the 75-octet limit.
    expect(call.iCalString).toMatch(/\r\n[ \t]/);
    for (const physicalLine of call.iCalString.split('\r\n')) {
      expect(Buffer.byteLength(physicalLine, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  test('insertEvent_withAShortSummary_doesNotFoldAnything', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const event = {
      uid: 'evt-short', summary: 'Blue Bin',
      start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'), description: '',
    };

    await insertEvent(property, event);

    const call = DAVClient.mock.results[DAVClient.mock.results.length - 1].value.createCalendarObject.mock.calls[0][0];
    expect(call.iCalString).not.toMatch(/\r\n[ \t]/);
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

  // #33 Task 4: deletion needs the dav object's url/etag, which is why
  // this returns the full dav object per uid.
  test('listEventObjects_withMatchingObjects_returnsMapOfUidToDavObjectPreservingUrlAndEtag', async () => {
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    const davObject = { url: 'https://caldav.icloud.com/123/evt-abc.ics', etag: '"etag-1"', data: 'BEGIN:VEVENT\r\nUID:abc123\r\nEND:VEVENT' };
    mockInstance.fetchCalendarObjects.mockResolvedValue([davObject]);

    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const objects = await listEventObjects(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(objects).toBeInstanceOf(Map);
    expect(objects.get('abc123')).toBe(davObject);
  });

  // PR #34 review finding m3: a calendar object with no parseable UID
  // (malformed data, or a non-VEVENT component) must be skipped rather
  // than poisoning the map with an undefined key.
  test('listEventObjects_withObjectThatHasNoParseableUid_isExcludedFromTheMap', async () => {
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    mockInstance.fetchCalendarObjects.mockResolvedValue([
      { url: 'u-good', etag: 'e1', data: 'BEGIN:VEVENT\r\nUID:good-uid\r\nEND:VEVENT' },
      { url: 'u-bad', etag: 'e2', data: 'BEGIN:VTODO\r\nSUMMARY:not a VEVENT\r\nEND:VTODO' },
    ]);

    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const objects = await listEventObjects(property, new Date('2026-04-01'), new Date('2026-04-30'));

    expect(objects.size).toBe(1);
    expect(objects.has('good-uid')).toBe(true);
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

  // PR #34 review finding m2: sync.js's events_deleted count must reflect
  // CONFIRMED deletions, not merely attempted ones.
  test('deleteEvent_onSuccess_returnsTrue', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-abc.ics', etag: '"etag-1"' };

    const result = await deleteEvent(property, davObject);

    expect(result).toBe(true);
  });

  test('deleteEvent_whenApiCallRejects_returnsFalse', async () => {
    const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-missing.ics', etag: '"etag-1"' };
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    mockInstance.deleteCalendarObject.mockRejectedValueOnce(new Error('404 Not Found'));

    const result = await deleteEvent(property, davObject);

    expect(result).toBe(false);
  });

  // #33 Task 6: rewriting an already-pushed combined-day event in place
  // (garden-waste segment now stripped out) rather than deleting and
  // reinserting it.
  test('updateEvent_callsUpdateCalendarObjectWithTheExistingUrlAndEtagAndNewIcsData', async () => {
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-combined.ics', etag: '"etag-1"' };
    const event = {
      uid: 'evt-combined',
      summary: 'general waste+food (+food only after transition week)',
      start: new Date('2026-04-01T07:00:00Z'),
      end: new Date('2026-04-01T08:00:00Z'),
      description: '',
    };

    await updateEvent(property, davObject, event);

    const lastInstance = DAVClient.mock.results[DAVClient.mock.results.length - 1].value;
    expect(lastInstance.updateCalendarObject).toHaveBeenCalledWith({
      calendarObject: expect.objectContaining({
        url: davObject.url,
        etag: davObject.etag,
        data: expect.stringContaining('SUMMARY:general waste+food (+food only after transition week)'),
      }),
    });
  });

  // PR #34 review finding m2: parity with deleteEvent's success/failure
  // reporting, so sync.js can count confirmed updates rather than attempts.
  test('updateEvent_onSuccess_returnsTrue', async () => {
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-combined.ics', etag: '"etag-1"' };
    const event = { uid: 'evt-combined', summary: 'summary', start: new Date(), end: new Date(), description: '' };

    const result = await updateEvent(property, davObject, event);

    expect(result).toBe(true);
  });

  // PR #34 review finding m1: updateEvent previously had no error handling
  // at all, unlike deleteEvent - a transient CalDAV failure (e.g. a 412
  // etag conflict) would propagate all the way to syncProperty's catch
  // block and abort every remaining event for that property's sync. Now
  // matches deleteEvent's swallow-and-log treatment.
  test('updateEvent_whenApiCallRejects_doesNotThrowAndReturnsFalse', async () => {
    const property = { id: 1, credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
    const davObject = { url: 'https://caldav.icloud.com/123/evt-combined.ics', etag: '"etag-1"' };
    const event = { uid: 'evt-combined', summary: 'summary', start: new Date(), end: new Date(), description: '' };
    const mockInstance = DAVClient.mock.results[0]?.value || DAVClient();
    mockInstance.updateCalendarObject.mockRejectedValueOnce(new Error('412 Precondition Failed'));

    const result = await updateEvent(property, davObject, event);

    expect(result).toBe(false);
  });

  // PR #34 review finding M2: lets sync.js check whether an already-pushed
  // event's remote summary already matches the stripped summary before
  // writing, so a combined-day event isn't rewritten identically on every
  // single sync run.
  describe('extractSummary', () => {
    test('extractSummary_withSummaryLine_returnsTrimmedSummary', () => {
      expect(extractSummary('BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:general waste+food (+food only after transition week)\r\nEND:VEVENT')).toBe('general waste+food (+food only after transition week)');
    });

    test('extractSummary_noSummaryLine_returnsNull', () => {
      expect(extractSummary('BEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT')).toBeNull();
    });

    test('extractSummary_undefinedData_returnsNull', () => {
      expect(extractSummary(undefined)).toBeNull();
    });

    // PR #37 review suggestion S1: a server-folded SUMMARY line (CRLF +
    // a single leading space before the continuation) must be unfolded
    // before the single-line regex runs, or a folded line's continuation
    // (everything after the fold) would be silently lost.
    test('extractSummary_withAFoldedSummaryLine_unfoldsAndReturnsTheFullText', () => {
      const data = 'BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Garden waste and general waste+food (+food \r\n only after transition week)\r\nEND:VEVENT';

      expect(extractSummary(data)).toBe('Garden waste and general waste+food (+food only after transition week)');
    });

    // Round-trips what buildVCalendarString actually produces for a long
    // summary, rather than a hand-folded fixture - proves fold-on-write
    // and unfold-on-read genuinely agree with each other.
    test('extractSummary_roundTripsTheExactTextThatInsertEventFolded', async () => {
      const property = { credentials: 'encrypted', calendar_id: 'https://caldav.icloud.com/123' };
      const longSummary = 'Garden waste and general waste+food (+food only after transition week) at 123 Example Street';
      const event = {
        uid: 'evt-roundtrip', summary: longSummary,
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'), description: '',
      };

      await insertEvent(property, event);

      const call = DAVClient.mock.results[DAVClient.mock.results.length - 1].value.createCalendarObject.mock.calls[0][0];
      expect(extractSummary(call.iCalString)).toBe(longSummary);
    });
  });
});
