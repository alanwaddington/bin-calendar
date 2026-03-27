const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const sql = fs.readFileSync(path.join(__dirname, '../../src/migrations/001.sql'), 'utf8');
  db.exec(sql);
  return db;
}

module.exports = { createTestDb };
