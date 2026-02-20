import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  await db.execute(sql`CREATE INDEX IF NOT EXISTS room_openings_session_id_idx ON room_openings (session_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS room_openings_room_id_idx ON room_openings (room_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS room_adjacencies_session_id_idx ON room_adjacencies (session_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS room_adjacencies_room_id_a_idx ON room_adjacencies (room_id_a)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS room_adjacencies_room_id_b_idx ON room_adjacencies (room_id_b)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS moisture_readings_session_id_idx ON moisture_readings (session_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS moisture_readings_room_id_idx ON moisture_readings (room_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS regional_price_sets_region_id_idx ON regional_price_sets (region_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS regional_price_sets_line_item_code_idx ON regional_price_sets (line_item_code)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS regional_price_sets_region_line_item_idx ON regional_price_sets (region_id, line_item_code)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS scope_summary_session_id_idx ON scope_summary (session_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS policy_rules_claim_id_idx ON policy_rules (claim_id)`);

  await db.execute(sql`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scope_summary_session_trade_unique'
  ) THEN
    ALTER TABLE scope_summary
      ADD CONSTRAINT scope_summary_session_trade_unique UNIQUE (session_id, trade_code);
  END IF;
END $$;
  `);

  await db.execute(sql`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'policy_rules_claim_coverage_unique'
  ) THEN
    ALTER TABLE policy_rules
      ADD CONSTRAINT policy_rules_claim_coverage_unique UNIQUE (claim_id, coverage_type);
  END IF;
END $$;
  `);

  console.log("Migration 018 applied");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
