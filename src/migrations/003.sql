CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  uid         TEXT NOT NULL,
  summary     TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  UNIQUE(property_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);

CREATE TABLE IF NOT EXISTS bin_types (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  summary_match  TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  colour         TEXT NOT NULL DEFAULT '#6b7a99'
);

INSERT OR IGNORE INTO bin_types (summary_match, label, colour) VALUES
  ('Grey',  'General Waste', '#6b7280'),
  ('Blue',  'Recycling',     '#3b82f6'),
  ('Brown', 'Garden Waste',  '#92400e'),
  ('Green', 'Food Waste',    '#16a34a');
