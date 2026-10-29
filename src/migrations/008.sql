-- PR #34 review finding m1 (new, full /pr-reviewer re-audit): a genuine
-- combined-day summary rewrite (opt-out strip, or opt-in restore - see
-- finding M1 new) is a correction to an event that already exists
-- externally, not an addition - was previously counted via events_added,
-- which made the audit trail misleading. Gets its own counter instead.
ALTER TABLE sync_results ADD COLUMN events_updated INTEGER NOT NULL DEFAULT 0;
