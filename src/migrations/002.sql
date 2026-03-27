ALTER TABLE properties ADD COLUMN credential_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK(credential_status IN ('ok', 'invalid', 'unknown'));
ALTER TABLE properties ADD COLUMN credential_checked_at DATETIME;
