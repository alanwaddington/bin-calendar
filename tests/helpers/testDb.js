const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Run every migration, same as src/db.js's own applyMigrations() - this
  // used to be a hardcoded ['001.sql', '002.sql', '003.sql'] list, which had
  // already silently fallen behind 004.sql/005.sql (real-DB tests just
  // happened not to touch anything those added). Reading the directory
  // keeps this helper from going stale again every time a migration ships.
  const migrationsDir = path.join(__dirname, '../../src/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
  }
  return db;
}

module.exports = { createTestDb };
