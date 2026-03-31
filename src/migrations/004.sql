CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS settings_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
END;

INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_cron', '0 0 1 * *');
