const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/app/data/bin-calendar.db';
let db;

function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations();
  recoverInterruptedSyncs();
  return db;
}

function applyMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = db.prepare('SELECT version FROM schema_version').pluck().all();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = parseInt(file, 10);
    if (applied.includes(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    applyMigration(version, sql);
    console.log(`Applied migration ${file}`);
  }
}

// #35 Task 1 - Design Decision 7: previously this was db.exec(sql) called
// directly with no transaction. Prototyped during /design: a failing
// migration left partial DDL applied and the connection in an open
// transaction - correctness depended on the process dying before anything
// else touched the database, not on an explicit rollback. Not acceptable
// once a migration can drop columns (009 is the first). Wrapping the DDL
// and its schema_version row in one transaction means either both happen
// or neither does. Exported so this guarantee is directly testable without
// needing a crafted bad file in the real migrations/ directory.
function applyMigration(version, sql) {
  db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
  })();
}

function recoverInterruptedSyncs() {
  const result = db.prepare(
    `UPDATE sync_runs SET status = 'failed', error = 'Interrupted by restart', completed_at = datetime('now')
     WHERE status = 'running'`
  ).run();
  if (result.changes > 0) {
    console.warn(`Recovered ${result.changes} interrupted sync run(s)`);
  }
}

module.exports = { initDb, getDb, applyMigration };
