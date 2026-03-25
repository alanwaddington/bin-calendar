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
    db.exec(sql);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    console.log(`Applied migration ${file}`);
  }
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

module.exports = { initDb, getDb };
