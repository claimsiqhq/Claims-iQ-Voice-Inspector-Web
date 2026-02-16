import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate schemas from routes.ts for validation tests

const createClaimSchema = z.object({
  claimNumber: z.string().min(1).max(50),
  insuredName: z.string().nullable().optional(),
  propertyAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  dateOfLoss: z.string().nullable().optional(),
  perilType: z.string().nullable().optional(),
  status: z.string().optional(),
});

const sessionUpdateSchema = z.object({
  currentPhase: z.number().int().positive().optional(),
  currentRoomId: z.number().int().positive().nullable().optional(),
  currentStructure: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  adjusterNotes: z.string().nullable().optional(),
});

const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  roomType: z.string().max(50).nullable().optional(),
  structure: z.string().max(100).nullable().optional(),
  structureId: z.number().int().positive().nullable().optional(),
  dimensions: z.any().optional(),
  phase: z.number().int().positive().nullable().optional(),
});

const lineItemCreateSchema = z.object({
  roomId: z.number().int().positive().nullable().optional(),
  damageId: z.number().int().positive().nullable().optional(),
  category: z.string().min(1).max(50),
  action: z.string().max(30).nullable().optional(),
  description: z.string().min(1),
  xactCode: z.string().max(30).nullable().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(20).nullable().optional(),
  unitPrice: z.number().nonnegative().optional(),
  depreciationType: z.string().max(30).nullable().optional(),
  wasteFactor: z.number().int().nonnegative().optional(),
});

describe("createClaimSchema", () => {
  it("accepts a minimal valid claim", () => {
    const result = createClaimSchema.safeParse({ claimNumber: "CLM-001" });
    expect(result.success).toBe(true);
  });

  it("accepts a full claim with all optional fields", () => {
    const result = createClaimSchema.safeParse({
      claimNumber: "CLM-001",
      insuredName: "John Doe",
      propertyAddress: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      dateOfLoss: "2025-03-15",
      perilType: "hail",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty claimNumber", () => {
    const result = createClaimSchema.safeParse({ claimNumber: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing claimNumber", () => {
    const result = createClaimSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects claimNumber exceeding 50 characters", () => {
    const result = createClaimSchema.safeParse({
      claimNumber: "A".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it("accepts null optional fields", () => {
    const result = createClaimSchema.safeParse({
      claimNumber: "CLM-001",
      insuredName: null,
      city: null,
      perilType: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("sessionUpdateSchema", () => {
  it("accepts partial update with phase only", () => {
    const result = sessionUpdateSchema.safeParse({ currentPhase: 3 });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive phase", () => {
    const result = sessionUpdateSchema.safeParse({ currentPhase: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer phase", () => {
    const result = sessionUpdateSchema.safeParse({ currentPhase: 2.5 });
    expect(result.success).toBe(false);
  });

  it("accepts null currentRoomId (leaving a room)", () => {
    const result = sessionUpdateSchema.safeParse({ currentRoomId: null });
    expect(result.success).toBe(true);
  });

  it("rejects empty status string", () => {
    const result = sessionUpdateSchema.safeParse({ status: "" });
    expect(result.success).toBe(false);
  });

  it("accepts empty object (no updates)", () => {
    const result = sessionUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("roomCreateSchema", () => {
  it("accepts minimal room with name only", () => {
    const result = roomCreateSchema.safeParse({ name: "Kitchen" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = roomCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 100 characters", () => {
    const result = roomCreateSchema.safeParse({ name: "R".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts room with all optional fields", () => {
    const result = roomCreateSchema.safeParse({
      name: "Master Bedroom",
      roomType: "bedroom",
      structure: "main",
      dimensions: { length: 12, width: 14, height: 8 },
      phase: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative phase", () => {
    const result = roomCreateSchema.safeParse({ name: "Room", phase: -1 });
    expect(result.success).toBe(false);
  });
});

describe("lineItemCreateSchema", () => {
  it("accepts minimal line item", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Drywall - Remove & Replace 1/2\"",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing category", () => {
    const result = lineItemCreateSchema.safeParse({
      description: "Some item",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Roofing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative unitPrice", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Item",
      unitPrice: -5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero unitPrice (free items like disposal)", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "General",
      description: "Debris disposal",
      unitPrice: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive quantity", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Item",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts line item with catalog code", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Roofing",
      description: "Architectural shingles",
      xactCode: "RFG-SHIN-AR",
      quantity: 24,
      unit: "SQ",
      unitPrice: 127.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects xactCode exceeding 30 characters", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Roofing",
      description: "Item",
      xactCode: "X".repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative wasteFactor", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Item",
      wasteFactor: -10,
    });
    expect(result.success).toBe(false);
  });
});
