const request = require('supertest');

jest.mock('../../src/db');
jest.mock('../../src/sync');
jest.mock('../../src/google');
jest.mock('../../src/icloud');
jest.mock('../../src/uprn');
jest.mock('../../src/scheduler');
jest.mock('../../src/crypto');

const { getDb } = require('../../src/db');
const { runSync } = require('../../src/sync');
const { isGoogleConfigured, getAuthUrl } = require('../../src/google');
const { getNextSyncDate } = require('../../src/scheduler');
const { encryptJson } = require('../../src/crypto');

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

  test('POST /api/properties with valid body returns 200 with id', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ label: 'Home', uprn: '12345', calendar_type: 'google' });

    expect(res.status).toBe(200);
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
});
