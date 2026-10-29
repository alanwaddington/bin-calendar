const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/ics');
jest.mock('../../src/google');
jest.mock('../../src/icloud');

// PR #37 review finding S2: AC 7 ("immediately after the migration, a
// sync run produces the same push/skip/delete decisions as it would
// have before") was previously satisfied only by composition - the
// backfill preserves state (db.test.js), and sync behaves correctly on
// that state (sync.test.js) - but no single test migrated a real pre-009
// database and then ran a real sync against the result. This seeds a
// database at the exact pre-009 schema (migrations 001-008, mirroring a
// real deployed NAS), upgrades it via the REAL initDb(), and runs the
// REAL runSync() against what comes out - the most faithful test of the
// actual upgrade path available, with only the network-facing modules
// (ics/google/icloud) mocked.
describe('migration behaviour preservation (PR #37 review S2)', () => {
  let tmpDir, dbPath;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-cal-migtest-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // best-effort cleanup of a temp dir, not worth failing the test over
    }
    delete process.env.DB_PATH;
  });

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

  test('runSync_afterMigratingAPreviouslyOptedInProperty_stillPushesTheFullCombinedSummaryUnchanged', async () => {
    const seedDb = seedPre009Database(dbPath);
    const propertyId = seedDb.prepare(
      `INSERT INTO properties (label, uprn, ics_url, calendar_type, calendar_id, credentials, garden_waste_opted_in)
       VALUES ('Home', '1', 'https://a.example/cal.ics', 'google', 'primary', 'encrypted', 1)`
    ).run().lastInsertRowid;
    seedDb.prepare(
      "INSERT INTO bin_types (summary_match, label, colour, is_garden_waste) VALUES ('Garden', 'Garden Waste', '#2e7d32', 1)"
    ).run();
    seedDb.close();

    const { initDb } = require('../../src/db');
    initDb(); // applies migration 009 for real, backfilling this property's opt-in

    const { fetchIcs } = require('../../src/ics');
    const google = require('../../src/google');
    const { runSync } = require('../../src/sync');

    const COMBINED_SUMMARY = 'Garden waste and general waste';
    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-combined', summary: COMBINED_SUMMARY,
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);
    google.insertEvent.mockResolvedValue(undefined);
    google.deleteEvent.mockResolvedValue(true);

    const result = await runSync(propertyId);

    expect(result.overallStatus).toBe('success');
    // Opted in before and after the migration - the full, untouched
    // combined summary is pushed, nothing stripped.
    expect(google.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: propertyId }),
      expect.objectContaining({ uid: 'evt-combined', summary: COMBINED_SUMMARY })
    );
  });

  test('runSync_afterMigratingAPreviouslyOptedOutProperty_stillStripsTheWithheldSegment', async () => {
    const seedDb = seedPre009Database(dbPath);
    const propertyId = seedDb.prepare(
      `INSERT INTO properties (label, uprn, ics_url, calendar_type, calendar_id, credentials, garden_waste_opted_in)
       VALUES ('Home', '1', 'https://a.example/cal.ics', 'google', 'primary', 'encrypted', 0)`
    ).run().lastInsertRowid;
    seedDb.prepare(
      "INSERT INTO bin_types (summary_match, label, colour, is_garden_waste) VALUES ('Garden', 'Garden Waste', '#2e7d32', 1)"
    ).run();
    seedDb.close();

    const { initDb } = require('../../src/db');
    initDb(); // applies migration 009 for real - this property gets NO opt-in row

    const { fetchIcs } = require('../../src/ics');
    const google = require('../../src/google');
    const { runSync } = require('../../src/sync');

    fetchIcs.mockResolvedValue({
      events: [{
        uid: 'evt-combined', summary: 'Garden waste and general waste',
        start: new Date('2026-04-01T07:00:00Z'), end: new Date('2026-04-01T08:00:00Z'),
        description: '', allDay: false,
      }],
      warnings: [],
    });
    google.listEvents.mockResolvedValue([]);
    google.insertEvent.mockResolvedValue(undefined);
    google.deleteEvent.mockResolvedValue(true);

    const result = await runSync(propertyId);

    expect(result.overallStatus).toBe('success');
    // Opted out before and after the migration - the Garden Waste
    // segment is stripped, the rest of the combined summary still pushed.
    expect(google.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: propertyId }),
      expect.objectContaining({ uid: 'evt-combined', summary: 'general waste' })
    );
  });
});
