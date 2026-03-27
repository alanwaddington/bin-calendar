const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('db', () => {
  let tmpDir;
  let dbPath;

  beforeEach(() => {
    // Each test gets a fresh module and temp DB
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-cal-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
  });

  afterEach(() => {
    // Clean up
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {}
    delete process.env.DB_PATH;
  });

  test('getDb_beforeInit_throwsError', () => {
    const { getDb } = require('../../src/db');
    expect(() => getDb()).toThrow('Database not initialised');
  });

  test('initDb_createsTablesAndReturnsDb', () => {
    const { initDb, getDb } = require('../../src/db');
    const db = initDb();

    expect(db).toBeDefined();
    expect(() => getDb()).not.toThrow();

    // Verify tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('properties');
    expect(tableNames).toContain('sync_runs');
    expect(tableNames).toContain('sync_results');
  });

  test('initDb_recoversInterruptedSyncs', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    // Insert a running sync
    db.prepare("INSERT INTO sync_runs (status) VALUES ('running')").run();
    const running = db.prepare("SELECT * FROM sync_runs WHERE status = 'running'").get();
    expect(running).toBeTruthy();

    // Re-init should recover it
    jest.resetModules();
    process.env.DB_PATH = dbPath;
    const { initDb: initDb2 } = require('../../src/db');
    initDb2();

    const recovered = new Database(dbPath).prepare("SELECT * FROM sync_runs WHERE status = 'failed' AND error = 'Interrupted by restart'").get();
    expect(recovered).toBeTruthy();
  });

  test('initDb_skipsAlreadyAppliedMigrations', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    // Calling initDb again should not fail (migrations already applied)
    jest.resetModules();
    process.env.DB_PATH = dbPath;
    const { initDb: initDb2 } = require('../../src/db');
    expect(() => initDb2()).not.toThrow();
  });
});
