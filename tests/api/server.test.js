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
      .send({ label: 'Home', uprn: '12345', calendar_type: 'google' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
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
      .send({ label: 'Updated Home', uprn: '99999' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('PUT /api/properties/:id with missing fields returns 400', async () => {
    const res = await request(app)
      .put('/api/properties/1')
      .send({ label: 'Home' });

    expect(res.status).toBe(400);
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
      label: 'General Waste',
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
});
