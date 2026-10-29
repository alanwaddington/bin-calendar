-- #35: generalizes the Garden-Waste-specific opt-in mechanism (#33/#34)
-- into a per-bin-type opt-in capability, so any bin type can be flagged
-- opt-in-required, not just Garden Waste. Backfills live production state
-- (properties.garden_waste_opted_in, bin_types.is_garden_waste) before
-- dropping the old columns - order is load-bearing: create -> backfill ->
-- drop, so the backfill still has its source data when it runs. Verified
-- against a real migrated DB with mixed opted-in/opted-out properties
-- during /design (see issue #35's Design, Decision 2).
--
-- One old boolean (garden_waste_opted_in) covered ALL flagged bin types
-- collectively, so the CROSS JOIN below grants an opted-in property an
-- opt-in row for EVERY bin type that was flagged - not just one.

ALTER TABLE bin_types ADD COLUMN requires_opt_in INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS property_bin_type_opt_ins (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bin_type_id INTEGER NOT NULL REFERENCES bin_types(id) ON DELETE CASCADE,
  created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_id, bin_type_id)
);

UPDATE bin_types SET requires_opt_in = 1 WHERE is_garden_waste = 1;

INSERT OR IGNORE INTO property_bin_type_opt_ins (property_id, bin_type_id)
  SELECT p.id, bt.id
  FROM properties p
  CROSS JOIN bin_types bt
  WHERE p.garden_waste_opted_in = 1 AND bt.is_garden_waste = 1;

ALTER TABLE properties DROP COLUMN garden_waste_opted_in;
ALTER TABLE bin_types  DROP COLUMN is_garden_waste;
