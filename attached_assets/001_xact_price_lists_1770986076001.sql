-- Claims iQ: Xactimate Price List Import
-- Generated: 2026-02-13T12:31:49.334971
-- Source: FLFM8X_NOV22
-- This file creates the price list metadata record.
-- Run AFTER migration #3 (CREATE TABLE xact_price_lists)

INSERT INTO xact_price_lists (
  xact_name, region_description, effective_date, xact_version, item_count
) VALUES (
  'FLFM8X_NOV22',
  'Ft. Myers, FL',
  '2022-11-01T06:00:00Z',
  5,
  5427
) RETURNING id;

-- Store the returned UUID for use in seed 003
-- If running as a script, capture with:
--   \gset
-- Then reference as :id in subsequent inserts
