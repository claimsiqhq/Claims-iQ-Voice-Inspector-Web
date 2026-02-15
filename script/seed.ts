import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users, claims } from "../shared/schema";

async function seed() {
  const [existing] = await db.select().from(users).where(eq(users.username, "demo")).limit(1);
  if (existing) {
    console.log("Demo user already exists");
    return;
  }

  const [user] = await db.insert(users).values({
    id: crypto.randomUUID(),
    username: "demo",
    password: "demo123",
    email: "demo@claimsiq.com",
    fullName: "Demo Adjuster",
    role: "adjuster",
  }).returning();

  if (user) {
    await db.insert(claims).values({
      claimNumber: "CLM-2024-001",
      insuredName: "Jane Smith",
      propertyAddress: "123 Oak St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      dateOfLoss: "2024-01-15",
      perilType: "hail",
      status: "draft",
      assignedTo: user.id,
    });
    console.log("Seeded demo user (demo/demo123) and sample claim");
  }
}

seed().catch(console.error).finally(() => process.exit(0));
