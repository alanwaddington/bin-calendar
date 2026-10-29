-- #33 Task 5: record how many events a sync run deleted externally (Garden
-- Waste reconciliation on opt-out), so a run is auditable - not just how
-- many were added/skipped.
ALTER TABLE sync_results ADD COLUMN events_deleted INTEGER NOT NULL DEFAULT 0;
