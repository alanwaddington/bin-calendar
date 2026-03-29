const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const file of ['001.sql', '002.sql', '003.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../../src/migrations', file), 'utf8');
    db.exec(sql);
  }
  return db;
}

module.exports = { createTestDb };
