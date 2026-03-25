CREATE TABLE IF NOT EXISTS properties (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  uprn         TEXT NOT NULL,
  calendar_type TEXT NOT NULL CHECK(calendar_type IN ('google', 'icloud')),
  calendar_id  TEXT,
  credentials  TEXT,
  created_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at   DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS properties_updated_at
AFTER UPDATE ON properties
BEGIN
  UPDATE properties SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  completed_at DATETIME,
  status       TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','skipped')),
  error        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_runs_running
ON sync_runs (status) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS sync_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  property_id    INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  events_added   INTEGER NOT NULL DEFAULT 0,
  events_skipped INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  started_at     DATETIME,
  completed_at   DATETIME
);

CREATE TABLE IF NOT EXISTS oauth_state (
  nonce       TEXT PRIMARY KEY,
  property_id INTEGER NOT NULL,
  expires_at  DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
);
