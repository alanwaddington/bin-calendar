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

  test('initDb_migration003_createsEventsTable', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('events');
  });

  test('initDb_migration003_eventsTableHasUniquePropertyUidConstraint', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    db.prepare("INSERT INTO properties (label, uprn, calendar_type) VALUES ('Home', '12345', 'google')").run();
    db.prepare("INSERT INTO events (property_id, uid, summary, start_date) VALUES (1, 'uid-1', 'Grey Bin', '2026-04-01')").run();
    expect(() =>
      db.prepare("INSERT INTO events (property_id, uid, summary, start_date) VALUES (1, 'uid-1', 'Grey Bin', '2026-04-01')").run()
    ).toThrow();
  });

  test('initDb_migration003_eventsCascadeDeletesOnPropertyRemoval', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    db.prepare("INSERT INTO properties (label, uprn, calendar_type) VALUES ('Home', '12345', 'google')").run();
    db.prepare("INSERT INTO events (property_id, uid, summary, start_date) VALUES (1, 'uid-1', 'Grey Bin', '2026-04-01')").run();
    db.prepare("DELETE FROM properties WHERE id = 1").run();

    const events = db.prepare("SELECT * FROM events").all();
    expect(events).toHaveLength(0);
  });

  test('initDb_migration003_createsBinTypesTable', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('bin_types');
  });

  test('initDb_migration003_seedsDefaultBinTypes', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const binTypes = db.prepare("SELECT summary_match FROM bin_types ORDER BY id").all().map(r => r.summary_match);
    expect(binTypes).toContain('Grey');
    expect(binTypes).toContain('Blue');
    expect(binTypes).toContain('Brown');
    expect(binTypes).toContain('Green');
  });

  test('initDb_migration003_binTypesSummaryMatchIsUnique', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    expect(() =>
      db.prepare("INSERT INTO bin_types (summary_match, label, colour) VALUES ('Grey', 'Duplicate', '#000000')").run()
    ).toThrow();
  });

  test('initDb_migration004_createsSettingsTable', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('settings');
  });

  test('initDb_migration004_seedsDefaultSyncCron', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const row = db.prepare("SELECT value FROM settings WHERE key = 'sync_cron'").get();
    expect(row).toBeDefined();
    expect(row.value).toBe('0 0 1 * *');
  });

  test('initDb_migration004_settingsKeyIsPrimaryKey', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    expect(() =>
      db.prepare("INSERT INTO settings (key, value) VALUES ('sync_cron', 'duplicate')").run()
    ).toThrow();
  });

  test('initDb_migration004_settingsHasUpdatedAt', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const row = db.prepare("SELECT updated_at FROM settings WHERE key = 'sync_cron'").get();
    expect(row).toBeDefined();
    expect(row.updated_at).toBeTruthy();
  });
});
