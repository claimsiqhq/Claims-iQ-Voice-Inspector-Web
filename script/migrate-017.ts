import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  await db.execute(
    sql`ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS op_eligible_default BOOLEAN DEFAULT TRUE`
  );
  await db.execute(
    sql`ALTER TABLE scope_line_items ADD COLUMN IF NOT EXISTS is_code_upgrade BOOLEAN DEFAULT FALSE`
  );
  console.log("Migration 017 applied");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
