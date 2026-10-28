const request = require('supertest');

jest.mock('../../src/db');
jest.mock('../../src/sync');
jest.mock('../../src/google');
jest.mock('../../src/icloud');
jest.mock('../../src/scheduler');
jest.mock('../../src/crypto');
jest.mock('../../src/credential-check');

const { getDb } = require('../../src/db');
const { runSync } = require('../../src/sync');
const { isGoogleConfigured, getAuthUrl, exchangeCode, listCalendars } = require('../../src/google');
const { fetchCalendars } = require('../../src/icloud');
const { getNextSyncDate } = require('../../src/scheduler');
const { encryptJson } = require('../../src/crypto');
const { checkSingleCredential } = require('../../src/credential-check');

const { app } = require('../../src/server');

describe('server API', () => {
  let mockPrepare;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepare = {
      get: jest.fn().mockReturnValue({ result: 1 }),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
      all: jest.fn().mockReturnValue([]),
    };
    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue(mockPrepare),
      transaction: jest.fn().mockImplementation(fn => () => fn()),
    });
    getNextSyncDate.mockReturnValue('2026-05-01T00:00:00.000Z');
    isGoogleConfigured.mockReturnValue(false);
    encryptJson.mockReturnValue('encrypted-creds');
    runSync.mockResolvedValue({ status: 200, overallStatus: 'success' });
    checkSingleCredential.mockResolvedValue('ok');
  });

  test('GET /health returns 200 with status and nextSync', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.nextSync).toBe('2026-05-01T00:00:00.000Z');
  });

  test('GET /api/properties returns 200 with array', async () => {
    const res = await request(app).get('/api/properties');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/properties with valid body returns 201 with id', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ label: 'Home', ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics', calendar_type: 'google' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test('POST /api/properties with webcal url returns 201', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ label: 'Home', ics_url: 'webcal://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics', calendar_type: 'google' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test('POST /api/properties without ics_url returns 400', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ label: 'Home', calendar_type: 'google' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing fields/i);
  });

  test('POST /api/properties with invalid ics_url format returns 400', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ label: 'Home', ics_url: 'ftp://not-a-valid-scheme.com/cal.ics', calendar_type: 'google' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid ICS URL/i);
  });

  test('POST /api/properties with missing fields returns 400', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ label: 'Home' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing fields/i);
  });

  test('DELETE /api/properties/:id returns 200 with ok', async () => {
    const res = await request(app).delete('/api/properties/1');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/sync returns 200 when sync succeeds', async () => {
    const res = await request(app).post('/api/sync');

    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBe('success');
  });

  test('POST /api/sync returns 429 when sync already running', async () => {
    runSync.mockResolvedValue({ status: 429, message: 'Sync already in progress' });

    const res = await request(app).post('/api/sync');

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/already in progress/i);
  });

  test('GET /api/sync/runs returns 200 with runs and results', async () => {
    const res = await request(app).get('/api/sync/runs');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('runs');
    expect(res.body).toHaveProperty('results');
  });

  test('GET /api/sync/runs with existing runs returns results', async () => {
    const mockDb = getDb();
    const mockAll = mockDb.prepare().all;
    mockAll
      .mockReturnValueOnce([{ id: 1, status: 'success', started_at: '2026-04-01' }])
      .mockReturnValueOnce([{ run_id: 1, property_id: 1, events_added: 2 }]);

    const res = await request(app).get('/api/sync/runs');

    expect(res.status).toBe(200);
  });

  test('GET /health returns 500 when db fails', async () => {
    getDb.mockImplementation(() => {
      throw new Error('DB error');
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });

  test('GET /api/config returns feature flags', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('googleConfigured');
    expect(res.body).not.toHaveProperty('addressLookupConfigured');
  });

  test('PUT /api/properties/:id with valid body returns ok', async () => {
    const res = await request(app)
      .put('/api/properties/1')
      .send({ label: 'Updated Home', ics_url: 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('PUT /api/properties/:id without ics_url returns 400', async () => {
    const res = await request(app)
      .put('/api/properties/1')
      .send({ label: 'Home' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing fields/i);
  });

  test('PUT /api/properties/:id with invalid ics_url format returns 400', async () => {
    const res = await request(app)
      .put('/api/properties/1')
      .send({ label: 'Home', ics_url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid ICS URL/i);
  });

  test('GET /api/google/auth-url/:propertyId returns auth URL when configured', async () => {
    isGoogleConfigured.mockReturnValue(true);
    getAuthUrl.mockReturnValue('https://accounts.google.com/auth?state=test');

    const res = await request(app).get('/api/google/auth-url/1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('authUrl');
  });

  test('GET /api/google/auth-url/:propertyId returns 503 when not configured', async () => {
    isGoogleConfigured.mockReturnValue(false);

    const res = await request(app).get('/api/google/auth-url/1');

    expect(res.status).toBe(503);
  });

  test('POST /api/google/complete with missing pastedUrl returns 400', async () => {
    const res = await request(app)
      .post('/api/google/complete')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pastedUrl/i);
  });

  test('POST /api/google/complete with error in URL returns 400', async () => {
    const state = Buffer.from(JSON.stringify({ property_id: 1, nonce: 'abc' })).toString('base64url');
    const pastedUrl = `http://localhost:3000/callback?state=${state}&error=access_denied`;

    const res = await request(app)
      .post('/api/google/complete')
      .send({ pastedUrl });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/denied/i);
  });

  test('POST /api/google/complete with missing state returns 400', async () => {
    const res = await request(app)
      .post('/api/google/complete')
      .send({ pastedUrl: 'http://localhost:3000/callback?code=abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing state/i);
  });

  test('POST /api/google/complete with expired session returns 400', async () => {
    const state = Buffer.from(JSON.stringify({ property_id: 1, nonce: 'abc' })).toString('base64url');
    const pastedUrl = `http://localhost:3000/callback?state=${state}&code=test-code`;

    // get() returns null for oauth_state lookup => expired
    mockPrepare.get.mockReturnValue(null);

    const res = await request(app)
      .post('/api/google/complete')
      .send({ pastedUrl });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('POST /api/google/complete with valid code succeeds', async () => {
    const state = Buffer.from(JSON.stringify({ property_id: 1, nonce: 'abc' })).toString('base64url');
    const pastedUrl = `http://localhost:3000/callback?state=${state}&code=test-code`;

    mockPrepare.get.mockReturnValue({ property_id: 1, nonce: 'abc', expires_at: new Date(Date.now() + 600000).toISOString() });
    exchangeCode.mockResolvedValue({ access_token: 'tok', refresh_token: 'ref' });

    const res = await request(app)
      .post('/api/google/complete')
      .send({ pastedUrl });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/google/complete with invalid URL returns 500', async () => {
    const res = await request(app)
      .post('/api/google/complete')
      .send({ pastedUrl: 'not-a-url' });

    expect(res.status).toBe(500);
  });

  test('GET /api/google/calendars/:propertyId returns calendars', async () => {
    mockPrepare.get.mockReturnValue({ id: 1, credentials: 'enc' });
    listCalendars.mockResolvedValue([{ id: 'primary', summary: 'My Cal' }]);

    const res = await request(app).get('/api/google/calendars/1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/google/calendars/:propertyId returns 404 if not found', async () => {
    mockPrepare.get.mockReturnValue(null);

    const res = await request(app).get('/api/google/calendars/999');

    expect(res.status).toBe(404);
  });

  test('GET /api/google/calendars/:propertyId returns 400 if not connected', async () => {
    mockPrepare.get.mockReturnValue({ id: 1, credentials: null });

    const res = await request(app).get('/api/google/calendars/1');

    expect(res.status).toBe(400);
  });

  test('GET /api/google/calendars/:propertyId returns 400 on error', async () => {
    mockPrepare.get.mockReturnValue({ id: 1, credentials: 'enc' });
    listCalendars.mockRejectedValue(new Error('Token expired'));

    const res = await request(app).get('/api/google/calendars/1');

    expect(res.status).toBe(400);
  });

  test('PUT /api/properties/:id/calendar updates calendar', async () => {
    const res = await request(app)
      .put('/api/properties/1/calendar')
      .send({ calendar_id: 'work-cal' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('PUT /api/properties/:id/calendar returns 400 without calendar_id', async () => {
    const res = await request(app)
      .put('/api/properties/1/calendar')
      .send({});

    expect(res.status).toBe(400);
  });

  test('POST /api/icloud/calendars returns calendars', async () => {
    fetchCalendars.mockResolvedValue([{ displayName: 'iCal', url: 'https://...' }]);

    const res = await request(app)
      .post('/api/icloud/calendars')
      .send({ apple_id: 'user@icloud.com', app_specific_password: 'pass' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/icloud/calendars returns 400 with missing fields', async () => {
    const res = await request(app)
      .post('/api/icloud/calendars')
      .send({ apple_id: 'user@icloud.com' });

    expect(res.status).toBe(400);
  });

  test('POST /api/icloud/calendars returns 400 on error', async () => {
    fetchCalendars.mockRejectedValue(new Error('Auth failed'));

    const res = await request(app)
      .post('/api/icloud/calendars')
      .send({ apple_id: 'user@icloud.com', app_specific_password: 'pass' });

    expect(res.status).toBe(400);
  });

  test('POST /api/properties/:id/icloud stores credentials', async () => {
    const res = await request(app)
      .post('/api/properties/1/icloud')
      .send({
        apple_id: 'user@icloud.com',
        app_specific_password: 'pass',
        calendar_url: 'https://caldav.icloud.com/123',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/properties/:id/icloud returns 400 with missing fields', async () => {
    const res = await request(app)
      .post('/api/properties/1/icloud')
      .send({ apple_id: 'user@icloud.com' });

    expect(res.status).toBe(400);
  });

  test('POST /api/sync returns 500 when sync throws', async () => {
    runSync.mockRejectedValue(new Error('Database locked'));

    const res = await request(app).post('/api/sync');

    expect(res.status).toBe(500);
  });


  test('GET /api/properties returns ics_url in response', async () => {
    const icsUrl = 'https://recollect-eu.global.ssl.fastly.net/api/places/ABC/services/50014/events.en-GB.ics';
    mockPrepare.all.mockReturnValue([
      { id: 1, label: 'Home', ics_url: icsUrl, calendar_type: 'google', connected: 1, credential_status: 'ok' },
    ]);

    const res = await request(app).get('/api/properties');

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('ics_url', icsUrl);
  });

  test('GET /api/properties returns credential_status in response', async () => {
    mockPrepare.all.mockReturnValue([
      { id: 1, label: 'Home', uprn: '12345', calendar_type: 'google', connected: 1, credential_status: 'ok' },
    ]);

    const res = await request(app).get('/api/properties');

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('credential_status');
  });

  test('GET /api/properties/:id/credential-status returns status when property found', async () => {
    mockPrepare.get.mockReturnValue({ id: 1, credentials: 'enc', calendar_type: 'google' });
    checkSingleCredential.mockResolvedValue('ok');

    const res = await request(app).get('/api/properties/1/credential-status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('checkedAt');
  });

  test('GET /api/properties/:id/credential-status returns 404 if not found', async () => {
    mockPrepare.get.mockReturnValue(null);

    const res = await request(app).get('/api/properties/999/credential-status');

    expect(res.status).toBe(404);
  });

  test('GET /api/properties/:id/credential-status returns 400 if no credentials', async () => {
    mockPrepare.get.mockReturnValue({ id: 1, credentials: null });

    const res = await request(app).get('/api/properties/1/credential-status');

    expect(res.status).toBe(400);
  });

  // --- GET /api/properties/:id/events ---

  test('getPropertyEvents_withEvents_returns200WithOrderedEvents', async () => {
    mockPrepare.get.mockReturnValueOnce({ id: 1 });
    mockPrepare.all.mockReturnValueOnce([
      { uid: 'uid-1', date: '2026-11-03', summary: 'Trolley+food', label: 'General Waste', colour: '#6b7280' },
      { uid: 'uid-2', date: '2026-11-10', summary: 'Trolley+food', label: 'General Waste', colour: '#6b7280' },
    ]);

    const res = await request(app).get('/api/properties/1/events');

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([
      { uid: 'uid-1', date: '2026-11-03', summary: 'Trolley+food', label: 'General Waste (Trolley+food)', colour: '#6b7280', matched: true },
      { uid: 'uid-2', date: '2026-11-10', summary: 'Trolley+food', label: 'General Waste (Trolley+food)', colour: '#6b7280', matched: true },
    ]);

    const eventsSql = getDb().prepare.mock.calls.map(c => c[0]).find(sql => sql.includes('FROM events'));
    expect(eventsSql).toMatch(/ORDER BY e\.start_date ASC/i);
  });

  test('getPropertyEvents_withUnknownId_returns404', async () => {
    mockPrepare.get.mockReturnValueOnce(null);

    const res = await request(app).get('/api/properties/999/events');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('getPropertyEvents_withDbError_returns500WithJsonError', async () => {
    mockPrepare.get.mockReturnValueOnce({ id: 1 });
    mockPrepare.all.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });

    const res = await request(app).get('/api/properties/1/events');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('database is locked');
  });

  test('getPropertyEvents_withNoEvents_returnsEmptyArray', async () => {
    mockPrepare.get.mockReturnValueOnce({ id: 1 });
    mockPrepare.all.mockReturnValueOnce([]);

    const res = await request(app).get('/api/properties/1/events');

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  test('getPropertyEvents_withMatchedSummaryMoreSpecificThanLabel_returnsRawSummaryAlone', async () => {
    mockPrepare.get.mockReturnValueOnce({ id: 1 });
    mockPrepare.all.mockReturnValueOnce([
      {
        uid: 'uid-general',
        date: '2026-11-12',
        summary: 'General waste+food',
        label: 'General Waste',
        colour: '#6b7280',
      },
    ]);

    const res = await request(app).get('/api/properties/1/events');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].label).toBe('General waste+food');
  });

  // A summary matching multiple bin_types rules shows one marker per match
  // (e.g. East Ayrshire's real "Garden waste and general waste+food..."
  // combining two genuinely separate collections into one VEVENT) - a
  // fan-out join, not the single-lowest-id-match subquery used elsewhere
  // for collapsing an AMBIGUOUS single match (see getPropertyEventsRows
  // real-DB tests for the full real-world case).
  test('getPropertyEvents_sqlUsesFanOutJoinNotSingleMatchSubquery', async () => {
    mockPrepare.all.mockReturnValueOnce([]);

    await request(app).get('/api/properties/1/events');

    const eventsSql = getDb().prepare.mock.calls.map(c => c[0]).find(sql => sql.includes('FROM events'));
    expect(eventsSql).toMatch(/LEFT JOIN bin_types bt ON e\.summary LIKE/i);
    expect(eventsSql).not.toMatch(/LIMIT 1/i);
  });

  test('getPropertyEvents_withNoBinTypeMatch_returnsRawSummaryAndNeutralColour', async () => {
    mockPrepare.get.mockReturnValueOnce({ id: 1 });
    mockPrepare.all.mockReturnValueOnce([
      { uid: 'uid-transition', date: '2026-11-23', summary: 'Transition week', label: null, colour: null },
    ]);

    const res = await request(app).get('/api/properties/1/events');

    expect(res.status).toBe(200);
    expect(res.body.events[0]).toEqual({
      uid: 'uid-transition',
      date: '2026-11-23',
      summary: 'Transition week',
      label: 'Transition week',
      colour: '#6b7a99',
      matched: false,
    });
  });

  test('POST /api/google/complete with valid code resets credential_status to ok', async () => {
    const state = Buffer.from(JSON.stringify({ property_id: 1, nonce: 'abc' })).toString('base64url');
    const pastedUrl = `http://localhost:3000/callback?state=${state}&code=test-code`;

    mockPrepare.get.mockReturnValue({ property_id: 1, nonce: 'abc', expires_at: new Date(Date.now() + 600000).toISOString() });
    exchangeCode.mockResolvedValue({ access_token: 'tok', refresh_token: 'ref' });

    const res = await request(app)
      .post('/api/google/complete')
      .send({ pastedUrl });

    expect(res.status).toBe(200);
    const calls = mockPrepare.run.mock.calls;
    const statusReset = calls.some(args => Array.from(args).includes('ok'));
    expect(statusReset).toBe(true);
  });

  test('POST /api/properties/:id/icloud resets credential_status to ok', async () => {
    const res = await request(app)
      .post('/api/properties/1/icloud')
      .send({
        apple_id: 'user@icloud.com',
        app_specific_password: 'pass',
        calendar_url: 'https://caldav.icloud.com/123',
      });

    expect(res.status).toBe(200);
    const calls = mockPrepare.run.mock.calls;
    const statusReset = calls.some(args => Array.from(args).includes('ok'));
    expect(statusReset).toBe(true);
  });

  // --- GET /api/next-collection ---

  test('getNextCollection_daysUntilSql_usesDateNowNotNow', async () => {
    mockPrepare.all.mockReturnValueOnce([]);

    await request(app).get('/api/next-collection');

    const prepareCalls = getDb().prepare.mock.calls.map(args => args[0]);
    const sql = prepareCalls.find(s => s.includes('days_until'));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/julianday\(date\('now'\)\)/);
    expect(sql).not.toMatch(/julianday\('now'\)/);
  });


  test('getNextCollection_withEvents_returns200WithCollections', async () => {
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-04-02',
        days_until: 4,
        summary: 'Grey Bin Collection',
        label: 'General Waste',
        colour: '#6b7280',
        property_id: 1,
        property_label: '12 Main St',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('collections');
    expect(Array.isArray(res.body.collections)).toBe(true);
    expect(res.body.collections[0]).toMatchObject({
      date: '2026-04-02',
      daysUntil: 4,
      summary: 'Grey Bin Collection',
      label: 'General Waste (Grey Bin Collection)',
      colour: '#6b7280',
      propertyId: 1,
      propertyLabel: '12 Main St',
    });
  });

  test('getNextCollection_withNoEvents_returnsEmptyArray', async () => {
    mockPrepare.all.mockReturnValueOnce([]);

    const res = await request(app).get('/api/next-collection');

    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(0);
  });

  // East Ayrshire's real feed sends "Transition week" as a single VEVENT
  // spanning DTSTART=Mon..DTEND=Sat (ICS DTEND exclusive -> Mon-Fri
  // covered) rather than five separate VEVENTs. next-collection must
  // recompute daysUntil per expanded day rather than reusing the
  // SQL-computed value for the event's original start_date.
  test('getNextCollection_withMultiDaySpanEventStartingToday_showsDayZeroOfTheSpan', async () => {
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-04-02',
        endDate: '2026-04-07', // spans Apr 2,3,4,5,6
        days_until: 0,
        summary: 'Transition week',
        label: null,
        colour: null,
        property_id: 1,
        property_label: '12 Main St',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(1);
    expect(res.body.collections[0]).toMatchObject({ date: '2026-04-02', daysUntil: 0 });
  });

  test('getNextCollection_withMultiDaySpanEventAlreadyInProgress_showsTodaysDayOfTheSpanNotTheStart', async () => {
    // The span started 2 days ago (days_until: -2 for its start_date) but
    // is still ongoing - the event must still surface, dated and
    // days-until'd for TODAY (the correct point within the span), not
    // silently disappear once its start_date is in the past.
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-04-01', // started 2 days before "now" in SQL's own days_until terms
        endDate: '2026-04-06', // spans Apr 1,2,3,4,5 -> today (days_until 0) is Apr 3
        days_until: -2,
        summary: 'Transition week',
        label: null,
        colour: null,
        property_id: 1,
        property_label: '12 Main St',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(1);
    expect(res.body.collections[0]).toMatchObject({ date: '2026-04-03', daysUntil: 0 });
  });

  test('getNextCollection_withNoBinTypeMatch_returnsRawSummaryAndNeutralColour', async () => {
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-04-02',
        days_until: 4,
        summary: 'Purple Bin Collection',
        label: null,
        colour: null,
        property_id: 1,
        property_label: '12 Main St',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.status).toBe(200);
    expect(res.body.collections[0].label).toBe('Purple Bin Collection');
    expect(res.body.collections[0].colour).toBe('#6b7a99');
  });

  // PR #27 review finding M2: the dashboard de-duplicates hero chips by
  // display label, which only worked while labels were canonical. Now that
  // a matched label can carry an appended/alternate raw summary, two
  // properties sharing a collection date with differently-worded summaries
  // for the same bin type produce two *different* formatted labels. rawLabel
  // exposes the pre-formatting value (the matched bin_types.label, or the
  // summary when unmatched) as a stable de-duplication key.
  test('getNextCollection_withMatchedBinType_includesRawLabelForStableDeduplication', async () => {
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-04-02',
        days_until: 4,
        summary: 'Grey Bin Collection',
        label: 'General Waste',
        colour: '#6b7280',
        property_id: 1,
        property_label: '12 Main St',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.body.collections[0].rawLabel).toBe('General Waste');
  });

  test('getNextCollection_withNoBinTypeMatch_rawLabelFallsBackToSummary', async () => {
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-04-02',
        days_until: 4,
        summary: 'Purple Bin Collection',
        label: null,
        colour: null,
        property_id: 1,
        property_label: '12 Main St',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.body.collections[0].rawLabel).toBe('Purple Bin Collection');
  });

  // next-collection and getPropertyEventsRows must agree on how many rows
  // one event produces when its summary matches multiple bin_types rules -
  // both now fan out (one row per match), rather than one deduplicating and
  // the other not (PR #27 review finding M2 was exactly that mismatch, the
  // other direction).
  test('getNextCollection_sqlUsesSameFanOutJoinAsPropertyEvents', async () => {
    mockPrepare.all.mockReturnValueOnce([]);

    await request(app).get('/api/next-collection');

    const sql = getDb().prepare.mock.calls.map(c => c[0]).find(s => s.includes('days_until'));
    expect(sql).toMatch(/LEFT JOIN bin_types bt ON e\.summary LIKE/i);
    expect(sql).not.toMatch(/LIMIT 1/i);
  });

  // The same real-world "X and Y" combined summary from
  // calendar-events.test.js, exercised through next-collection's own
  // separate query/mapping - the "+food only after transition week"
  // qualifier belongs only to the General Waste half.
  test('getNextCollection_withRealWorldAndCombinedSummary_attributesEachMatchToItsOwnSegment', async () => {
    const summary = 'Garden waste and general waste+food (+food only after transition week)';
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-11-26', endDate: null, days_until: 5, summary,
        label: 'Garden Waste', colour: '#92400e', binTypeMatch: 'Garden', property_id: 1, property_label: 'Home',
      },
      {
        date: '2026-11-26', endDate: null, days_until: 5, summary,
        label: 'General Waste', colour: '#6b7280', binTypeMatch: 'waste+food', property_id: 1, property_label: 'Home',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    const garden = res.body.collections.find(c => c.colour === '#92400e');
    const general = res.body.collections.find(c => c.colour === '#6b7280');
    expect(garden.label).toBe('Garden Waste');
    expect(general.label).toBe('general waste+food (+food only after transition week)');
  });

  // PR #31 review finding M1: two bin_types rules sharing a label and
  // colour, both matching the same summary, must collapse to one
  // collection - not render as two indistinguishable duplicates (which
  // would also disagree with the Calendar page's own dedup).
  test('getNextCollection_withTwoRulesSharingLabelAndColour_collapsesToOneCollection', async () => {
    const summary = 'Trolley+food';
    mockPrepare.all.mockReturnValueOnce([
      {
        date: '2026-10-29', endDate: null, days_until: 1, summary,
        label: 'General Waste', colour: '#6b7280', binTypeMatch: 'Trolley', property_id: 1, property_label: 'Home',
      },
      {
        date: '2026-10-29', endDate: null, days_until: 1, summary,
        label: 'General Waste', colour: '#6b7280', binTypeMatch: 'food', property_id: 1, property_label: 'Home',
      },
    ]);

    const res = await request(app).get('/api/next-collection');

    expect(res.body.collections).toHaveLength(1);
    expect(res.body.collections[0].label).toBe('General Waste (Trolley+food)');
  });

  // A span event whose start_date has already passed must still be found by
  // the WHERE clause as long as it's still ongoing (end_date still in the
  // future) - otherwise it would silently vanish from next-collection
  // partway through, even though it's still the current collection.
  test('getNextCollection_sqlIncludesStillOngoingSpanEventsNotJustFutureStartDates', async () => {
    mockPrepare.all.mockReturnValueOnce([]);

    await request(app).get('/api/next-collection');

    const sql = getDb().prepare.mock.calls.map(c => c[0]).find(s => s.includes('days_until'));
    expect(sql).toMatch(/e\.end_date\s+IS\s+NOT\s+NULL\s+AND\s+e\.end_date\s*>\s*date\('now'\)/i);
  });

  // --- GET /api/bin-types ---

  test('getBinTypes_returns200WithArray', async () => {
    mockPrepare.all.mockReturnValueOnce([
      { id: 1, summary_match: 'Grey', label: 'General Waste', colour: '#6b7280' },
    ]);

    const res = await request(app).get('/api/bin-types');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // --- POST /api/bin-types ---

  test('postBinType_withValidData_returns201WithId', async () => {
    const res = await request(app)
      .post('/api/bin-types')
      .send({ summary_match: 'Purple', label: 'Mixed', colour: '#7c3aed' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test('postBinType_withMissingSummaryMatch_returns400', async () => {
    const res = await request(app)
      .post('/api/bin-types')
      .send({ label: 'Mixed', colour: '#7c3aed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/i);
  });

  test('postBinType_withMissingLabel_returns400', async () => {
    const res = await request(app)
      .post('/api/bin-types')
      .send({ summary_match: 'Purple', colour: '#7c3aed' });

    expect(res.status).toBe(400);
  });

  test('postBinType_withMissingColour_returns400', async () => {
    const res = await request(app)
      .post('/api/bin-types')
      .send({ summary_match: 'Purple', label: 'Mixed' });

    expect(res.status).toBe(400);
  });

  test('postBinType_withInvalidColour_returns400', async () => {
    const res = await request(app)
      .post('/api/bin-types')
      .send({ summary_match: 'Purple', label: 'Mixed', colour: 'not-a-colour' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/colour/i);
  });

  test('postBinType_withSummaryMatchContainingWildcard_stripsWildcards', async () => {
    const res = await request(app)
      .post('/api/bin-types')
      .send({ summary_match: '%Gr_ey%', label: 'General', colour: '#6b7280' });

    expect(res.status).toBe(201);
    expect(res.body.summary_match).toBe('Grey');
  });

  test('postBinType_withDuplicateSummaryMatch_returns409WithJsonError', async () => {
    mockPrepare.run.mockImplementationOnce(() => {
      throw Object.assign(new Error('UNIQUE constraint failed: bin_types.summary_match'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
      });
    });

    const res = await request(app)
      .post('/api/bin-types')
      .send({ summary_match: 'Grey', label: 'General Waste', colour: '#6b7280' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  // --- PUT /api/bin-types/:id ---

  test('putBinType_withValidData_returns200', async () => {
    mockPrepare.run.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .put('/api/bin-types/1')
      .send({ summary_match: 'Grey', label: 'General Waste Updated', colour: '#6b7280' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('putBinType_withUnknownId_returns404', async () => {
    mockPrepare.run.mockReturnValueOnce({ changes: 0 });

    const res = await request(app)
      .put('/api/bin-types/999')
      .send({ summary_match: 'Grey', label: 'General Waste', colour: '#6b7280' });

    expect(res.status).toBe(404);
  });

  test('putBinType_withMissingFields_returns400', async () => {
    const res = await request(app)
      .put('/api/bin-types/1')
      .send({ summary_match: 'Grey' });

    expect(res.status).toBe(400);
  });

  test('putBinType_withInvalidColour_returns400', async () => {
    const res = await request(app)
      .put('/api/bin-types/1')
      .send({ summary_match: 'Grey', label: 'General Waste', colour: 'red' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/colour/i);
  });

  test('putBinType_withSummaryMatchContainingWildcard_stripsWildcards', async () => {
    mockPrepare.run.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .put('/api/bin-types/1')
      .send({ summary_match: '_Grey%', label: 'General Waste', colour: '#6b7280' });

    expect(res.status).toBe(200);
  });

  test('putBinType_withDuplicateSummaryMatch_returns409WithJsonError', async () => {
    mockPrepare.run.mockImplementationOnce(() => {
      throw Object.assign(new Error('UNIQUE constraint failed: bin_types.summary_match'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
      });
    });

    const res = await request(app)
      .put('/api/bin-types/1')
      .send({ summary_match: 'Grey', label: 'General Waste', colour: '#6b7280' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  // --- DELETE /api/bin-types/:id ---

  test('deleteBinType_returns204', async () => {
    mockPrepare.run.mockReturnValueOnce({ changes: 1 });

    const res = await request(app).delete('/api/bin-types/1');

    expect(res.status).toBe(204);
  });

  test('deleteBinType_withUnknownId_returns404', async () => {
    mockPrepare.run.mockReturnValueOnce({ changes: 0 });

    const res = await request(app).delete('/api/bin-types/999');

    expect(res.status).toBe(404);
  });

  // --- GET /api/settings/sync-schedule ---

  test('GET_syncSchedule_returns200WithCurrentExpression', async () => {
    mockPrepare.get.mockReturnValueOnce({ value: '0 0 1 * *' });
    getNextSyncDate.mockReturnValue('2026-05-01T00:00:00.000Z');

    const res = await request(app).get('/api/settings/sync-schedule');

    expect(res.status).toBe(200);
    expect(res.body.cronExpression).toBe('0 0 1 * *');
    expect(res.body.nextSync).toBe('2026-05-01T00:00:00.000Z');
  });

  test('GET_syncSchedule_returnsDefaultWhenNoRow', async () => {
    mockPrepare.get.mockReturnValueOnce(undefined);
    getNextSyncDate.mockReturnValue('2026-05-01T00:00:00.000Z');

    const res = await request(app).get('/api/settings/sync-schedule');

    expect(res.status).toBe(200);
    expect(res.body.cronExpression).toBe('0 0 1 * *');
  });

  // --- PUT /api/settings/sync-schedule ---

  test('PUT_syncSchedule_validExpression_returns200AndRestartsScheduler', async () => {
    const { restartSyncSchedule } = require('../../src/scheduler');
    getNextSyncDate.mockReturnValue('2026-06-01T00:00:00.000Z');

    const res = await request(app)
      .put('/api/settings/sync-schedule')
      .send({ cronExpression: '0 0 * * 1' });

    expect(res.status).toBe(200);
    expect(res.body.cronExpression).toBe('0 0 * * 1');
    expect(res.body.nextSync).toBe('2026-06-01T00:00:00.000Z');
    expect(restartSyncSchedule).toHaveBeenCalledWith('0 0 * * 1');
    expect(mockPrepare.run).toHaveBeenCalled();
  });

  test('PUT_syncSchedule_invalidExpression_returns400', async () => {
    const res = await request(app)
      .put('/api/settings/sync-schedule')
      .send({ cronExpression: 'not-a-cron' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid cron expression');
  });

  test('PUT_syncSchedule_missingCronExpression_returns400', async () => {
    const res = await request(app)
      .put('/api/settings/sync-schedule')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cronExpression is required');
  });

  test('PUT_syncSchedule_serverError_returns500', async () => {
    getDb.mockReturnValueOnce({
      prepare: jest.fn().mockImplementation(() => { throw new Error('DB error'); }),
    });

    const res = await request(app)
      .put('/api/settings/sync-schedule')
      .send({ cronExpression: '0 0 1 * *' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  // --- Integration edge cases ---

  test('health_returnsNextSyncFromScheduler', async () => {
    getNextSyncDate.mockReturnValue('2026-07-01T00:00:00.000Z');

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.nextSync).toBe('2026-07-01T00:00:00.000Z');
  });

  test('syncNow_withCustomSchedule_stillReturnsSuccess', async () => {
    runSync.mockResolvedValue({ status: 200, overallStatus: 'success' });

    const res = await request(app).post('/api/sync');

    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBe('success');
  });

  test('PUT_syncSchedule_callsRestartSyncScheduleWithNewExpression', async () => {
    const { restartSyncSchedule } = require('../../src/scheduler');
    getNextSyncDate.mockReturnValue('2026-05-15T00:00:00.000Z');

    await request(app)
      .put('/api/settings/sync-schedule')
      .send({ cronExpression: '0 0 15 * *' });

    expect(restartSyncSchedule).toHaveBeenCalledWith('0 0 15 * *');
  });

  test('PUT_syncSchedule_doesNotCallRestartOnInvalidExpression', async () => {
    const { restartSyncSchedule } = require('../../src/scheduler');

    await request(app)
      .put('/api/settings/sync-schedule')
      .send({ cronExpression: 'bad cron' });

    expect(restartSyncSchedule).not.toHaveBeenCalled();
  });

  test('GET_syncSchedule_serverError_returns500', async () => {
    getDb.mockReturnValueOnce({
      prepare: jest.fn().mockImplementation(() => { throw new Error('DB gone'); }),
    });

    const res = await request(app).get('/api/settings/sync-schedule');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
