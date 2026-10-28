-- #33: per-property opt-in for Garden Waste collection (a paid add-on from
-- East Ayrshire Council, not every property subscribes). Default is
-- opted-out for both existing and new properties, deliberately, per the
-- Analysis section of #33 - don't show/sync a paid service nobody has
-- confirmed they have.
ALTER TABLE properties ADD COLUMN garden_waste_opted_in INTEGER NOT NULL DEFAULT 0;

-- Which bin_types row(s) represent Garden Waste, so sync.js and server.js
-- can identify garden-waste events consistently (see src/bin-types.js).
ALTER TABLE bin_types ADD COLUMN is_garden_waste INTEGER NOT NULL DEFAULT 0;
