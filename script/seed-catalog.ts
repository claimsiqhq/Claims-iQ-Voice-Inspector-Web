/**
 * Run the catalog seed. Connects to DB and upserts all enhanced catalog items + regional prices.
 */
import { seedCatalog } from "../server/seed-catalog";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("ERROR: Refusing to run seed script against a production database.");
  console.error("       Set NODE_ENV to something other than 'production' or pass --force to override.");
  process.exit(1);
}

seedCatalog()
  .then(() => {
    console.log("Catalog seed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Catalog seed failed:", err);
    process.exit(1);
  });
