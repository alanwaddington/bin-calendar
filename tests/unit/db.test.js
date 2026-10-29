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
    } catch {
      // ignore - best-effort cleanup of a temp dir, not worth failing the test over
    }
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
    initDb();

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

  // #35: migration 009 generalizes and then drops these two columns (see
  // below) - superseded, not just extended, so the old 006-specific tests
  // are replaced rather than kept alongside the new ones. initDb() always
  // runs the full chain to final state, so a test asserting an intermediate
  // migration's column exists in the FINAL schema is only ever meaningful
  // until a later migration removes it.

  test('initDb_migration007_addsEventsDeletedToSyncResults', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    db.prepare("INSERT INTO sync_runs (status) VALUES ('running')").run();
    const result = db.prepare(
      "INSERT INTO sync_results (run_id, events_added, events_skipped) VALUES (1, 0, 0)"
    ).run();
    const row = db.prepare('SELECT events_deleted FROM sync_results WHERE id = ?').get(result.lastInsertRowid);
    expect(row.events_deleted).toBe(0);
  });

  // PR #34 review finding m1 (new, full /pr-reviewer re-audit): a genuine
  // combined-day summary rewrite is a correction, not an addition - needs
  // its own counter rather than being lumped into events_added.
  test('initDb_migration008_addsEventsUpdatedToSyncResults', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    db.prepare("INSERT INTO sync_runs (status) VALUES ('running')").run();
    const result = db.prepare(
      "INSERT INTO sync_results (run_id, events_added, events_skipped) VALUES (1, 0, 0)"
    ).run();
    const row = db.prepare('SELECT events_updated FROM sync_results WHERE id = ?').get(result.lastInsertRowid);
    expect(row.events_updated).toBe(0);
  });

  // #35 Task 1 — Design Decision 7: applyMigrations() previously ran
  // db.exec(sql) with no transaction. Prototyped during /design: a failing
  // migration left partial DDL applied and the connection in an open
  // transaction - relying on process death (not an explicit rollback) to
  // discard it. Not acceptable for 009, the first migration that drops
  // columns. applyMigration() is exported specifically so this guarantee
  // is testable without needing a crafted bad file in the real migrations/
  // directory.
  test('applyMigration_whenSqlFailsPartway_rollsBackCompletelyWithNoOpenTransactionOrVersionRow', () => {
    const { initDb, applyMigration } = require('../../src/db');
    const db = initDb(); // real migrations 001-009 apply cleanly first

    const badSql = `
      ALTER TABLE bin_types ADD COLUMN test_atomicity_column INTEGER;
      ALTER TABLE properties DROP COLUMN this_column_does_not_exist;
    `;

    expect(() => applyMigration(999, badSql)).toThrow();
    expect(db.inTransaction).toBe(false);

    const cols = db.prepare('PRAGMA table_info(bin_types)').all().map(c => c.name);
    expect(cols).not.toContain('test_atomicity_column');
    const versionRow = db.prepare('SELECT * FROM schema_version WHERE version = 999').get();
    expect(versionRow).toBeUndefined();
  });

  // #35 Task 1 — Design Decision 1/2/6: the generalized per-bin-type
  // opt-in schema, replacing the Garden-Waste-specific columns.

  test('initDb_migration009_addsRequiresOptInToBinTypesDefaultingToZero', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    // 'Grey' is a default-seeded bin_types row (003.sql) - must come out
    // not flagged as opt-in-required by default.
    const row = db.prepare("SELECT requires_opt_in FROM bin_types WHERE summary_match = 'Grey'").get();
    expect(row.requires_opt_in).toBe(0);
  });

  test('initDb_migration009_createsPropertyBinTypeOptInsTable', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('property_bin_type_opt_ins');
  });

  test('initDb_migration009_removesGardenWasteOptedInFromProperties', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const cols = db.prepare('PRAGMA table_info(properties)').all().map(c => c.name);
    expect(cols).not.toContain('garden_waste_opted_in');
  });

  test('initDb_migration009_removesIsGardenWasteFromBinTypes', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const cols = db.prepare('PRAGMA table_info(bin_types)').all().map(c => c.name);
    expect(cols).not.toContain('is_garden_waste');
  });

  test('initDb_migration009_deletingPropertyCascadesItsOptInRows', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const propertyId = db.prepare(
      "INSERT INTO properties (label, uprn, calendar_type) VALUES ('Home', '1', 'google')"
    ).run().lastInsertRowid;
    const binTypeId = db.prepare("SELECT id FROM bin_types WHERE summary_match = 'Grey'").get().id;
    db.prepare('INSERT INTO property_bin_type_opt_ins (property_id, bin_type_id) VALUES (?, ?)').run(propertyId, binTypeId);

    db.prepare('DELETE FROM properties WHERE id = ?').run(propertyId);

    const optIns = db.prepare('SELECT * FROM property_bin_type_opt_ins WHERE property_id = ?').all(propertyId);
    expect(optIns).toHaveLength(0);
  });

  test('initDb_migration009_deletingBinTypeCascadesItsOptInRows', () => {
    const { initDb } = require('../../src/db');
    const db = initDb();

    const propertyId = db.prepare(
      "INSERT INTO properties (label, uprn, calendar_type) VALUES ('Home', '1', 'google')"
    ).run().lastInsertRowid;
    const binTypeId = db.prepare("SELECT id FROM bin_types WHERE summary_match = 'Grey'").get().id;
    db.prepare('INSERT INTO property_bin_type_opt_ins (property_id, bin_type_id) VALUES (?, ?)').run(propertyId, binTypeId);

    db.prepare('DELETE FROM bin_types WHERE id = ?').run(binTypeId);

    const optIns = db.prepare('SELECT * FROM property_bin_type_opt_ins WHERE bin_type_id = ?').all(binTypeId);
    expect(optIns).toHaveLength(0);
  });

  // #35 Task 1 — the backfill itself. Seeds a DB at the pre-009 schema
  // (migrations 001-008 only, with schema_version rows matching exactly
  // what a real deployed NAS would have), inserts mixed opted-in/opted-out
  // state, then runs the REAL initDb() to pick up where it left off and
  // apply 009 - the most faithful test of the actual upgrade path.

  function seedPre009Database(path_) {
    const seedDb = new Database(path_);
    seedDb.pragma('foreign_keys = ON');
    seedDb.exec(`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )`);
    const migrationsDir = path.join(__dirname, '../../src/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && parseInt(f, 10) <= 8)
      .sort();
    for (const file of files) {
      const version = parseInt(file, 10);
      seedDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      seedDb.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    }
    return seedDb;
  }

  test('initDb_migration009_backfillGrantsOptedInPropertyAnOptInRowForEachFlaggedBinType', () => {
    const seedDb = seedPre009Database(dbPath);
    const propertyAId = seedDb.prepare(
      "INSERT INTO properties (label, uprn, calendar_type, garden_waste_opted_in) VALUES ('A','1','google',1)"
    ).run().lastInsertRowid;
    seedDb.prepare("UPDATE bin_types SET is_garden_waste = 1 WHERE summary_match = 'Brown'").run();
    const gardenId = seedDb.prepare(
      "INSERT INTO bin_types (summary_match,label,colour,is_garden_waste) VALUES ('Garden waste','Garden Waste','#2e7d32',1)"
    ).run().lastInsertRowid;
    const brownId = seedDb.prepare("SELECT id FROM bin_types WHERE summary_match = 'Brown'").get().id;
    seedDb.close();

    const { initDb } = require('../../src/db');
    const db = initDb();

    const optInBinTypeIds = db.prepare(
      'SELECT bin_type_id FROM property_bin_type_opt_ins WHERE property_id = ? ORDER BY bin_type_id'
    ).all(propertyAId).map(r => r.bin_type_id);
    expect(optInBinTypeIds.sort((a, b) => a - b)).toEqual([brownId, gardenId].sort((a, b) => a - b));
  });

  test('initDb_migration009_backfillDoesNotGrantOptInForAnOptedOutProperty', () => {
    const seedDb = seedPre009Database(dbPath);
    const propertyBId = seedDb.prepare(
      "INSERT INTO properties (label, uprn, calendar_type, garden_waste_opted_in) VALUES ('B','2','google',0)"
    ).run().lastInsertRowid;
    seedDb.prepare("UPDATE bin_types SET is_garden_waste = 1 WHERE summary_match = 'Brown'").run();
    seedDb.close();

    const { initDb } = require('../../src/db');
    const db = initDb();

    const optIns = db.prepare('SELECT * FROM property_bin_type_opt_ins WHERE property_id = ?').all(propertyBId);
    expect(optIns).toHaveLength(0);
  });

  test('initDb_migration009_backfillDoesNotFlagABinTypeThatWasNeverIsGardenWaste', () => {
    const seedDb = seedPre009Database(dbPath);
    seedDb.prepare(
      "INSERT INTO properties (label, uprn, calendar_type, garden_waste_opted_in) VALUES ('A','1','google',1)"
    ).run();
    seedDb.close();

    const { initDb } = require('../../src/db');
    const db = initDb();

    // 'Grey' was never flagged is_garden_waste in this seed - must not
    // come out requires_opt_in regardless of any property's opt-in state.
    const row = db.prepare("SELECT requires_opt_in FROM bin_types WHERE summary_match = 'Grey'").get();
    expect(row.requires_opt_in).toBe(0);
  });
});
