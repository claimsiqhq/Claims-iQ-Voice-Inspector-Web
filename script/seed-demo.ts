#!/usr/bin/env tsx
/**
 * Seed the database with realistic demo data for development and testing.
 *
 * Usage:
 *   tsx script/seed-demo.ts          # Seed all demo data
 *   tsx script/seed-demo.ts --clean  # Delete demo data first, then seed
 *
 * Creates:
 *   - 3 users (adjuster, supervisor, admin)
 *   - 8 claims across various statuses and peril types
 *   - 2 complete inspection sessions with rooms, damages, line items, photos
 *   - Pricing catalog (via existing seed endpoint)
 */

import bcrypt from "bcrypt";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../shared/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: SUPABASE_DATABASE_URL or DATABASE_URL required");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client, { schema });

const isClean = process.argv.includes("--clean");

// ─── Demo Users ───
const DEMO_USERS = [
  {
    username: "adjuster",
    password: "demo123",
    email: "adjuster@demo.claimsiq.com",
    fullName: "Alex Rivera",
    role: "adjuster",
    supabaseAuthId: "demo-adjuster-001",
  },
  {
    username: "supervisor",
    password: "demo123",
    email: "supervisor@demo.claimsiq.com",
    fullName: "Jordan Chen",
    role: "supervisor",
    supabaseAuthId: "demo-supervisor-001",
  },
  {
    username: "admin",
    password: "demo123",
    email: "admin@demo.claimsiq.com",
    fullName: "Sam Martinez",
    role: "admin",
    supabaseAuthId: "demo-admin-001",
  },
];

// ─── Demo Claims ───
const DEMO_CLAIMS = [
  {
    claimNumber: "DEMO-2025-001",
    insuredName: "Patricia Thompson",
    propertyAddress: "142 Oak Street",
    city: "Austin",
    state: "TX",
    zip: "78701",
    dateOfLoss: "2025-01-15",
    perilType: "water",
    status: "inspection_complete",
  },
  {
    claimNumber: "DEMO-2025-002",
    insuredName: "Robert Kim",
    propertyAddress: "8821 Maple Drive",
    city: "Denver",
    state: "CO",
    zip: "80202",
    dateOfLoss: "2025-02-01",
    perilType: "hail",
    status: "briefing_ready",
  },
  {
    claimNumber: "DEMO-2025-003",
    insuredName: "Maria Santos",
    propertyAddress: "55 Elm Avenue",
    city: "Miami",
    state: "FL",
    zip: "33101",
    dateOfLoss: "2025-01-28",
    perilType: "wind",
    status: "new",
  },
  {
    claimNumber: "DEMO-2025-004",
    insuredName: "James O'Brien",
    propertyAddress: "203 Pine Court",
    city: "Seattle",
    state: "WA",
    zip: "98101",
    dateOfLoss: "2025-02-05",
    perilType: "fire",
    status: "documents_uploaded",
  },
  {
    claimNumber: "DEMO-2025-005",
    insuredName: "Linda Washington",
    propertyAddress: "77 Birch Lane",
    city: "Nashville",
    state: "TN",
    zip: "37201",
    dateOfLoss: "2024-12-20",
    perilType: "water",
    status: "estimate_ready",
  },
  {
    claimNumber: "DEMO-2025-006",
    insuredName: "David Nakamura",
    propertyAddress: "510 Willow Way",
    city: "Portland",
    state: "OR",
    zip: "97201",
    dateOfLoss: "2025-01-10",
    perilType: "wind",
    status: "inspection_in_progress",
  },
  {
    claimNumber: "DEMO-2025-007",
    insuredName: "Sarah Mitchell",
    propertyAddress: "1200 Cedar Blvd",
    city: "Chicago",
    state: "IL",
    zip: "60601",
    dateOfLoss: "2025-02-08",
    perilType: "hail",
    status: "exported",
  },
  {
    claimNumber: "DEMO-2025-008",
    insuredName: "Michael Patel",
    propertyAddress: "340 Spruce Street",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    dateOfLoss: "2025-01-22",
    perilType: "fire",
    status: "new",
  },
];

// ─── Demo Rooms (phase: 1=Interior, 2=Exterior) ───
const DEMO_ROOMS = [
  { name: "Living Room", roomType: "living", structure: "Main Dwelling", phase: 1 },
  { name: "Master Bedroom", roomType: "bedroom", structure: "Main Dwelling", phase: 1 },
  { name: "Kitchen", roomType: "kitchen", structure: "Main Dwelling", phase: 1 },
  { name: "Bathroom 1", roomType: "bathroom", structure: "Main Dwelling", phase: 1 },
  { name: "Roof - North Slope", roomType: "exterior", structure: "Main Dwelling", phase: 2 },
];

// ─── Demo Damages ───
const DEMO_DAMAGES = [
  { description: "Water staining on ceiling drywall, approximately 4x3 feet", severity: "moderate", damageType: "water" },
  { description: "Warped hardwood flooring near baseboard, 6 linear feet", severity: "severe", damageType: "water" },
  { description: "Mold growth behind wallpaper near window frame", severity: "severe", damageType: "mold" },
  { description: "Cracked ceiling tiles from water saturation", severity: "moderate", damageType: "water" },
  { description: "Missing shingles on north slope, 3 tab style", severity: "severe", damageType: "wind" },
];

// ─── Demo Line Items ───
const DEMO_LINE_ITEMS = [
  { category: "Drywall", action: "Remove & Replace", description: "Remove and replace water-damaged drywall ceiling", xactCode: "DRY-REM-AR", quantity: 12, unit: "SF", unitPrice: 4.25, totalPrice: 51.0 },
  { category: "Flooring", action: "Remove & Replace", description: "Remove and replace warped hardwood flooring", xactCode: "FLR-HWD-AR", quantity: 6, unit: "LF", unitPrice: 12.5, totalPrice: 75.0 },
  { category: "Painting", action: "Repaint", description: "Prime and paint ceiling after drywall replacement", xactCode: "PNT-CLG-AR", quantity: 12, unit: "SF", unitPrice: 2.75, totalPrice: 33.0 },
  { category: "Roofing", action: "Replace", description: "Replace missing 3-tab asphalt shingles", xactCode: "RFG-SHIN-AR", quantity: 30, unit: "SF", unitPrice: 8.5, totalPrice: 255.0 },
  { category: "Remediation", action: "Treat", description: "Mold remediation treatment behind wallpaper", xactCode: "REM-MOLD-AR", quantity: 25, unit: "SF", unitPrice: 15.0, totalPrice: 375.0 },
];

async function seedDemoData() {
  console.log("🌱 Seeding demo data...\n");

  if (isClean) {
    console.log("🧹 Cleaning existing demo data...");
    // Delete in reverse dependency order (claims cascade to sessions, rooms, etc.)
    for (const claim of DEMO_CLAIMS) {
      const existing = await db.query.claims.findFirst({
        where: eq(schema.claims.claimNumber, claim.claimNumber),
      });
      if (existing) {
        await db.delete(schema.claims).where(eq(schema.claims.id, existing.id));
        console.log(`  Deleted claim ${claim.claimNumber}`);
      }
    }
    for (const user of DEMO_USERS) {
      const existing = await db.query.users.findFirst({
        where: eq(schema.users.username, user.username),
      });
      if (existing) {
        await db.delete(schema.users).where(eq(schema.users.id, existing.id));
        console.log(`  Deleted user ${user.username}`);
      }
    }
    console.log("");
  }

  // ─── Create Users ───
  console.log("👤 Creating demo users...");
  const createdUsers: Record<string, string> = {};
  const hashedPassword = await bcrypt.hash("demo123", 10);
  for (const user of DEMO_USERS) {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.username, user.username),
    });
    if (existing) {
      // Update password in case we switched from plain to hashed
      await db
        .update(schema.users)
        .set({ password: hashedPassword })
        .where(eq(schema.users.id, existing.id));
      createdUsers[user.role] = existing.id;
      console.log(`  Exists: ${user.fullName} (${user.role})`);
    } else {
      const [created] = await db
        .insert(schema.users)
        .values({ ...user, password: hashedPassword })
        .returning();
      createdUsers[user.role] = created.id;
      console.log(`  Created: ${user.fullName} (${user.role})`);
    }
  }

  // ─── Create Claims ───
  console.log("\n📋 Creating demo claims...");
  const createdClaims: Array<{ id: number; claimNumber: string; status: string }> = [];
  for (const claim of DEMO_CLAIMS) {
    const existing = await db.query.claims.findFirst({
      where: eq(schema.claims.claimNumber, claim.claimNumber),
    });
    if (existing) {
      createdClaims.push({ id: existing.id, claimNumber: claim.claimNumber, status: claim.status });
      console.log(`  Exists: ${claim.claimNumber} (${claim.status})`);
    } else {
      const [created] = await db
        .insert(schema.claims)
        .values({
          ...claim,
          assignedTo: createdUsers.adjuster,
        })
        .returning();
      createdClaims.push({ id: created.id, claimNumber: claim.claimNumber, status: claim.status });
      console.log(`  Created: ${claim.claimNumber} (${claim.status})`);
    }
  }

  // ─── Create Inspection Sessions for completed claims ───
  const inspectionClaims = createdClaims.filter((c) =>
    ["inspection_complete", "estimate_ready", "exported"].includes(c.status)
  );

  for (const claim of inspectionClaims) {
    console.log(`\n🔍 Creating inspection data for ${claim.claimNumber}...`);

    const existingSession = await db.query.inspectionSessions.findFirst({
      where: eq(schema.inspectionSessions.claimId, claim.id),
    });
    if (existingSession) {
      console.log(`  Session already exists (id: ${existingSession.id})`);
      continue;
    }

    const [session] = await db
      .insert(schema.inspectionSessions)
      .values({
        claimId: claim.id,
        inspectorId: createdUsers.adjuster,
        status: "completed",
        currentPhase: 1,
        currentStructure: "Main Dwelling",
        startedAt: new Date(Date.now() - 3600000),
        completedAt: new Date(),
      })
      .returning();
    console.log(`  Session: id=${session.id}`);

    // Create rooms
    const roomIds: number[] = [];
    for (const room of DEMO_ROOMS) {
      const [created] = await db
        .insert(schema.inspectionRooms)
        .values({
          sessionId: session.id,
          ...room,
          status: "complete",
        })
        .returning();
      roomIds.push(created.id);
      console.log(`  Room: ${room.name} (id=${created.id})`);
    }

    // Create damages
    const damageIds: number[] = [];
    for (let i = 0; i < DEMO_DAMAGES.length; i++) {
      const [created] = await db
        .insert(schema.damageObservations)
        .values({
          sessionId: session.id,
          roomId: roomIds[i % roomIds.length],
          ...DEMO_DAMAGES[i],
        })
        .returning();
      damageIds.push(created.id);
      console.log(`  Damage: ${DEMO_DAMAGES[i].description.substring(0, 50)}...`);
    }

    // Create line items
    for (let i = 0; i < DEMO_LINE_ITEMS.length; i++) {
      await db.insert(schema.lineItems).values({
        sessionId: session.id,
        roomId: roomIds[i % roomIds.length],
        damageId: damageIds[i % damageIds.length],
        ...DEMO_LINE_ITEMS[i],
        provenance: "manual",
      });
      console.log(`  Line item: ${DEMO_LINE_ITEMS[i].description.substring(0, 50)}...`);
    }
  }

  console.log("\n✅ Demo data seeding complete!");
  console.log(`   Users: ${DEMO_USERS.length}`);
  console.log(`   Claims: ${DEMO_CLAIMS.length}`);
  console.log(`   Inspections: ${inspectionClaims.length}`);
  console.log(`   Rooms per inspection: ${DEMO_ROOMS.length}`);
  console.log(`   Damages per inspection: ${DEMO_DAMAGES.length}`);
  console.log(`   Line items per inspection: ${DEMO_LINE_ITEMS.length}`);
  console.log("\n   Note: Run POST /api/pricing/seed as admin to seed pricing catalog.");

  await client.end();
}

seedDemoData().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
