/**
 * Run the catalog seed. Connects to DB and upserts all enhanced catalog items + regional prices.
 */
import { seedCatalog } from "../server/seed-catalog";

seedCatalog()
  .then(() => {
    console.log("Catalog seed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Catalog seed failed:", err);
    process.exit(1);
  });
