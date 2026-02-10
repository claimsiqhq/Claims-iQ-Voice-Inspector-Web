import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { claims, inspectionSessions, inspectionPhotos, inspectionRooms, structures } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { generateESXFile } from "./esxGenerator";
import { reviewEstimate } from "./aiReview";
import { supabase, DOCUMENTS_BUCKET, PHOTOS_BUCKET } from "./supabase";
import { authenticateRequest, authenticateSupabaseToken, requireRole, optionalAuth } from "./auth";
import pdfParse from "pdf-parse";
import { extractFNOL, extractPolicy, extractEndorsements, generateBriefing } from "./openai";
import { buildSystemInstructions, realtimeTools } from "./realtime";
import { lookupCatalogItem, getRegionalPrice, calculateLineItemPrice, calculateEstimateTotals, validateEstimate, calculateDimVars, type RoomDimensions, type OpeningData } from "./estimateEngine";
import { z } from "zod";
import { logger } from "./logger";

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  fileBase64: z.string().min(1),
  documentType: z.enum(["fnol", "policy", "endorsements"]),
});

const batchUploadBodySchema = z.object({
  files: z.array(z.object({
    fileName: z.string().min(1),
    fileBase64: z.string().min(1),
  })).min(1).max(20),
  documentType: z.literal("endorsements"),
});

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

const structureUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  structureType: z.string().max(30).optional(),
}).strict();

const policyRuleUpdateSchema = z.object({
  coverageName: z.string().optional(),
  policyLimit: z.number().nonnegative().optional(),
  deductible: z.number().nonnegative().optional(),
  opRate: z.number().min(0).max(1).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  roofSchedule: z.boolean().optional(),
}).strict();

const structureCreateSchema = z.object({
  name: z.string().min(1).max(100),
  structureType: z.string().max(30).optional().default("dwelling"),
    // dwelling, garage, shed, fence, carport, pool, other
});

const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  roomType: z.string().max(50).nullable().optional(),
  structure: z.string().max(100).nullable().optional(),     // legacy
  structureId: z.number().int().positive().nullable().optional(),
  viewType: z.enum(["interior", "roof_plan", "elevation", "exterior_other"]).optional(),
  shapeType: z.enum(["rectangle", "gable", "hip", "l_shape", "custom"]).optional(),
  parentRoomId: z.number().int().positive().nullable().optional(),
  attachmentType: z.string().max(30).nullable().optional(),
  dimensions: z.any().optional(),
  polygon: z.any().optional(),
  position: z.any().optional(),
  floor: z.number().int().positive().optional(),
  facetLabel: z.string().max(10).nullable().optional(),
  pitch: z.string().max(10).nullable().optional(),
  roofPitch: z.string().max(10).nullable().optional(),
  phase: z.number().int().positive().nullable().optional(),
});

const roomOpeningCreateSchema = z.object({
  openingType: z.enum(["door", "window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "sliding_door", "french_door"]),
  wallIndex: z.number().int().nonnegative().optional(),
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  positionOnWall: z.number().min(0).max(1).optional(),
  widthFt: z.number().positive().optional(),
  heightFt: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  quantity: z.number().int().positive().default(1),
  label: z.string().max(50).nullable().optional(),
  opensInto: z.string().max(100).nullable().optional(),
  goesToFloor: z.boolean().optional(),
  goesToCeiling: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const openingCreateSchema = z.object({
  roomId: z.number().int().positive(),
  openingType: z.enum(["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "door", "sliding_door", "french_door"]),
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  wallIndex: z.number().int().nonnegative().nullable().optional(),
  positionOnWall: z.number().min(0).max(1).optional(),
  widthFt: z.number().positive(),
  heightFt: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  opensInto: z.string().max(100).nullable().optional(),
  goesToFloor: z.boolean().optional(),
  goesToCeiling: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const sketchAnnotationCreateSchema = z.object({
  annotationType: z.enum(["hail_count", "wind_damage", "damage", "pitch", "storm_direction", "facet_label", "material_note", "custom"]),
  label: z.string().min(1).max(100),
  value: z.string().max(50).nullable().optional(),
  location: z.string().max(100).nullable().optional(),
  position: z.any().optional(),
});

const sketchAnnotationUpdateSchema = z.object({
  annotationType: z.enum(["hail_count", "wind_damage", "damage", "pitch", "storm_direction", "facet_label", "material_note", "custom"]).optional(),
  label: z.string().min(1).max(100).optional(),
  value: z.string().max(50).nullable().optional(),
  location: z.string().max(100).nullable().optional(),
  position: z.any().optional(),
});

const openingUpdateSchema = z.object({
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  wallIndex: z.number().int().nonnegative().nullable().optional(),
  positionOnWall: z.number().min(0).max(1).optional(),
  widthFt: z.number().positive().optional(),
  heightFt: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  quantity: z.number().int().positive().optional(),
  label: z.string().max(50).nullable().optional(),
  openingType: z.enum(["door", "window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "sliding_door", "french_door"]).optional(),
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
  depreciationRate: z.number().min(0).max(100).nullable().optional(),
  wasteFactor: z.number().int().nonnegative().optional(),
  coverageBucket: z.string().max(30).optional(),
  qualityGrade: z.string().max(30).nullable().optional(),
  applyOAndP: z.boolean().optional(),
  macroSource: z.string().max(50).nullable().optional(),
  // ── Financial / Depreciation fields ──
  age: z.number().nonnegative().nullable().optional(),
  lifeExpectancy: z.number().positive().nullable().optional(),
  depreciationPercentage: z.number().min(0).max(100).nullable().optional(),
});

const testSquareCreateSchema = z.object({
  roomId: z.number().int().positive().nullable().optional(),
  hailHits: z.number().int().nonnegative(),
  windCreases: z.number().int().nonnegative().optional(),
  pitch: z.string().min(1).max(10),
  result: z.enum(["pass", "fail", "brittle_test_failure"]).optional(),
  notes: z.string().nullable().optional(),
});

const smartMacroSchema = z.object({
  macroType: z.enum(["roof_replacement_laminated", "roof_replacement_3tab", "interior_paint_walls_ceiling", "water_mitigation_dryout"]),
  severity: z.enum(["average", "heavy", "premium"]).optional(),
  wasteFactor: z.number().nonnegative().optional(),
  roomId: z.number().int().positive().nullable().optional(),
});

const checkRelatedItemsSchema = z.object({
  primaryCategory: z.enum(["Cabinetry", "Roofing", "Drywall", "Siding", "Flooring", "Plumbing", "Electrical", "Windows", "Doors"]),
  actionTaken: z.string().optional(),
});

const policyRuleSchema = z.object({
  coverageType: z.enum(["Coverage A", "Coverage B", "Coverage C", "Coverage D"]),
  policyLimit: z.number().positive().nullable().optional(),
  deductible: z.number().nonnegative().nullable().optional(),
  applyRoofSchedule: z.boolean().optional(),
  roofScheduleAge: z.number().positive().nullable().optional(),
  overheadPct: z.number().nonnegative().default(10),
  profitPct: z.number().nonnegative().default(10),
  taxRate: z.number().nonnegative().default(8),
  opExcludedTrades: z.array(z.string()).default([]),
});

const taxRuleSchema = z.object({
  taxLabel: z.string().min(1).max(50),
  taxRate: z.number().nonnegative(),
  appliesToCategories: z.array(z.string()).default([]),
  appliesToCostType: z.enum(["material", "labor", "all"]).default("all"),
  isDefault: z.boolean().default(false),
});

const adjacencyCreateSchema = z.object({
  roomIdA: z.number().int().positive(),
  roomIdB: z.number().int().positive(),
  wallDirectionA: z.string().max(20).nullable().optional(),
  wallDirectionB: z.string().max(20).nullable().optional(),
  sharedWallLengthFt: z.number().positive().nullable().optional(),
  openingId: z.number().int().positive().nullable().optional(),
});

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Extracts top-level claim fields from a parsed FNOL extraction so they can be synced to the claims table. */
function claimFieldsFromFnol(data: any): Record<string, any> {
  const fields: Record<string, any> = {};
  if (data.insuredName) fields.insuredName = data.insuredName;
  if (data.perilType) fields.perilType = data.perilType;
  if (data.dateOfLoss) fields.dateOfLoss = data.dateOfLoss;
  if (data.propertyAddress) {
    if (typeof data.propertyAddress === "object") {
      if (data.propertyAddress.street) fields.propertyAddress = data.propertyAddress.street;
      if (data.propertyAddress.city) fields.city = data.propertyAddress.city;
      if (data.propertyAddress.state) fields.state = data.propertyAddress.state;
      if (data.propertyAddress.zip) fields.zip = data.propertyAddress.zip;
    } else if (typeof data.propertyAddress === "string") {
      fields.propertyAddress = data.propertyAddress;
    }
  }
  return fields;
}

function decodeBase64Payload(base64Input: string, maxBytes: number): { buffer: Buffer; wasTruncated: boolean } {
  const base64Data = base64Input.includes(",") ? base64Input.split(",")[1] : base64Input;
  const buffer = Buffer.from(base64Data, "base64");
  return { buffer, wasTruncated: buffer.length > maxBytes };
}

async function uploadToSupabase(
  claimId: number,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const storagePath = `claims/${claimId}/${documentType}/${fileName}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

async function downloadFromSupabase(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Auto-create default policy rules from briefing coverage data when none exist.
 */
async function ensurePolicyRules(claimId: number, userId?: number) {
  const existing = await storage.getPolicyRulesForClaim(claimId);
  if (existing.length > 0) return existing;

  // Load user settings for default O&P and tax rates
  let defaultOverhead = 10;
  let defaultProfit = 10;
  let defaultTax = 8;
  if (userId) {
    try {
      const userSettings = await storage.getUserSettings(userId);
      const s = (userSettings?.settings as Record<string, any>) || {};
      if (typeof s.defaultOverheadPercent === "number") defaultOverhead = s.defaultOverheadPercent;
      if (typeof s.defaultProfitPercent === "number") defaultProfit = s.defaultProfitPercent;
      if (typeof s.defaultTaxRate === "number") defaultTax = s.defaultTaxRate;
    } catch {}
  }

  // Seed from briefing
  const briefing = await storage.getBriefing(claimId);
  const coverage = briefing?.coverageSnapshot as any;

  const rules: Array<any> = [];

  // Coverage A — Dwelling
  rules.push({
    claimId,
    coverageType: "Coverage A",
    policyLimit: coverage?.coverageA?.limit || null,
    deductible: coverage?.deductible || 1000,
    applyRoofSchedule: coverage?.roofSchedule?.applies || false,
    roofScheduleAge: coverage?.roofSchedule?.ageThreshold || null,
    overheadPct: defaultOverhead,
    profitPct: defaultProfit,
    taxRate: defaultTax,
  });

  // Coverage B — Other Structures (if present)
  if (coverage?.coverageB) {
    rules.push({
      claimId,
      coverageType: "Coverage B",
      policyLimit: coverage.coverageB.limit || null,
      deductible: coverage.coverageB.deductible || coverage?.deductible || 0,
      applyRoofSchedule: false,
      overheadPct: defaultOverhead,
      profitPct: defaultProfit,
      taxRate: defaultTax,
    });
  }

  // Coverage C — Contents (if present)
  if (coverage?.coverageC) {
    rules.push({
      claimId,
      coverageType: "Coverage C",
      policyLimit: coverage.coverageC.limit || null,
      deductible: 0,
      applyRoofSchedule: false,
      overheadPct: defaultOverhead,
      profitPct: defaultProfit,
      taxRate: defaultTax,
    });
  }

  const created = [];
  for (const rule of rules) {
    created.push(await storage.createPolicyRule(rule));
  }

  // Also seed a default tax rule if none exist
  const existingTax = await storage.getTaxRulesForClaim(claimId);
  if (existingTax.length === 0) {
    await storage.createTaxRule({
      claimId,
      taxLabel: "Sales Tax",
      taxRate: coverage?.taxRate || defaultTax,
      appliesToCategories: [],
      appliesToCostType: "all",
      isDefault: true,
    });
  }

  return created;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const param = (v: string | string[]): string => Array.isArray(v) ? v[0] : v;

  /** Parse an integer route param and return NaN-safe result, or send 400 */
  function parseIntParam(value: string, res: any, label = "id"): number | null {
    const n = parseInt(value, 10);
    if (isNaN(n)) {
      res.status(400).json({ message: `Invalid ${label}: must be a number` });
      return null;
    }
    return n;
  }

  async function enrichClaimsWithDocCounts(claims: any[]) {
    return Promise.all(claims.map(async (claim) => {
      try {
        const docs = await storage.getDocuments(claim.id);
        return { ...claim, documentCount: docs.length };
      } catch {
        return { ...claim, documentCount: 0 };
      }
    }));
  }

  app.get("/api/claims", authenticateRequest, async (req, res) => {
    try {
      const claims = await storage.getClaims();
      const enriched = await enrichClaimsWithDocCounts(claims);
      res.json(enriched);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/my-claims", authenticateRequest, async (req: any, res) => {
    try {
      if (req.user) {
        const userClaims = await storage.getClaimsForUser(req.user.id);
        const enriched = await enrichClaimsWithDocCounts(userClaims);
        return res.json(enriched);
      }
      res.json([]);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims", authenticateRequest, async (req, res) => {
    try {
      const parsed = createClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid claim data", errors: parsed.error.flatten().fieldErrors });
      }
      const claimData = { ...parsed.data, assignedTo: req.user?.id ?? null };
      const claim = await storage.createClaim(claimData);
      res.status(201).json(claim);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await storage.getDocuments(id);
      const exts = await storage.getExtractions(id);
      const briefing = await storage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/claims/:id", authenticateRequest, async (req: any, res) => {
    try {
      const id = parseIntParam(param(req.params.id), res, "claim id");
      if (id === null) return;

      // Verify ownership or supervisor role
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (req.user?.role !== "supervisor" && req.user?.role !== "admin" && claim.assignedTo !== req.user?.id) {
        return res.status(403).json({ message: "Not authorized to modify this claim" });
      }

      const { status, ...otherFields } = req.body;
      if (status) {
        const updated = await storage.updateClaimStatus(id, status);
        return res.json(updated);
      }
      // Support updating other claim fields
      const editableFields: any = {};
      for (const key of ['insuredName', 'propertyAddress', 'city', 'state', 'zip', 'dateOfLoss', 'perilType']) {
        if (otherFields[key] !== undefined) editableFields[key] = otherFields[key];
      }
      if (Object.keys(editableFields).length > 0) {
        const updated = await storage.updateClaimFields(id, editableFields);
        return res.json(updated);
      }
      res.status(400).json({ message: "No valid update fields" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/claims/purge-all", authenticateRequest, requireRole("admin"), async (req, res) => {
    try {
      const allClaims = await storage.getClaims();
      for (const claim of allClaims) {
        const docs = await storage.getDocuments(claim.id);
        for (const doc of docs) {
          if (doc.storagePath) {
            const paths = doc.storagePath.split("|").map(p => p.trim()).filter(Boolean);
            if (paths.length > 0) {
              await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
            }
          }
        }
        const sessions = await storage.getInspectionSessionsForClaim(claim.id);
        for (const session of sessions) {
          const photos = await storage.getPhotos(session.id);
          const photoPaths = photos.map((p: any) => p.storagePath).filter(Boolean) as string[];
          if (photoPaths.length > 0) {
            await supabase.storage.from(PHOTOS_BUCKET).remove(photoPaths);
          }
        }
      }
      const count = await storage.deleteAllClaims();
      res.json({ message: `Purged ${count} claims and all related data` });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/claims/:id", authenticateRequest, async (req: any, res) => {
    try {
      const id = parseIntParam(param(req.params.id), res, "claim id");
      if (id === null) return;

      // Verify ownership or admin role
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (req.user?.role !== "admin" && req.user?.role !== "supervisor" && claim.assignedTo !== req.user?.id) {
        return res.status(403).json({ message: "Not authorized to delete this claim" });
      }

      const docs = await storage.getDocuments(id);
      for (const doc of docs) {
        if (doc.storagePath) {
          const paths = doc.storagePath.split("|").map(p => p.trim()).filter(Boolean);
          if (paths.length > 0) {
            await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
          }
        }
      }
      const sessions = await storage.getInspectionSessionsForClaim(id);
      for (const session of sessions) {
        const photos = await storage.getPhotos(session.id);
        const photoPaths = photos.map((p: any) => p.storagePath).filter(Boolean) as string[];
        if (photoPaths.length > 0) {
          await supabase.storage.from(PHOTOS_BUCKET).remove(photoPaths);
        }
      }
      const deleted = await storage.deleteClaim(id);
      if (!deleted) return res.status(404).json({ message: "Claim not found" });
      res.json({ message: "Claim and all related data deleted" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Policy Rules ───────────────────────────────

  app.post("/api/claims/:claimId/policy-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const parsed = policyRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy rule data", errors: parsed.error.flatten().fieldErrors });
      }
      const rule = await storage.createPolicyRule({ claimId, ...parsed.data });
      res.status(201).json(rule);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:claimId/policy-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const rules = await storage.getPolicyRulesForClaim(claimId);
      res.json(rules);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/claims/:claimId/policy-rules/:ruleId", authenticateRequest, async (req, res) => {
    try {
      const ruleId = parseInt(req.params.ruleId);
      const parsed = policyRuleUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy rule update", errors: parsed.error.flatten().fieldErrors });
      }
      const rule = await storage.updatePolicyRule(ruleId, parsed.data);
      res.json(rule);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Tax Rules ──────────────────────────────────

  app.post("/api/claims/:claimId/tax-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const parsed = taxRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid tax rule data", errors: parsed.error.flatten().fieldErrors });
      }
      const rule = await storage.createTaxRule({ claimId, ...parsed.data });
      res.status(201).json(rule);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:claimId/tax-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      const rules = await storage.getTaxRulesForClaim(claimId);
      res.json(rules);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/claims/:claimId/tax-rules/:ruleId", authenticateRequest, async (req, res) => {
    try {
      const ruleId = parseInt(req.params.ruleId);
      await storage.deleteTaxRule(ruleId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/documents/all", authenticateRequest, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      res.json(docs);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/documents/status-summary", authenticateRequest, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      const allClaims = await storage.getClaims();
      const summaries = [];
      for (const claim of allClaims) {
        const claimDocs = docs.filter(d => d.claimId === claim.id);
        if (claimDocs.length === 0) continue;
        const claimExtractions = await storage.getExtractions(claim.id);
        const docStatuses = claimDocs.map(doc => {
          const extraction = claimExtractions.find(e => e.documentType === doc.documentType);
          let stage: string;
          if (extraction?.confirmedByUser) {
            stage = "reviewed";
          } else if (doc.status === "parsed") {
            stage = "extracted";
          } else if (doc.status === "processing") {
            stage = "processing";
          } else if (doc.status === "uploaded") {
            stage = "uploaded";
          } else {
            stage = "empty";
          }
          return {
            documentId: doc.id,
            documentType: doc.documentType,
            fileName: doc.fileName,
            stage,
          };
        });
        summaries.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          insuredName: claim.insuredName,
          documents: docStatuses,
        });
      }
      res.json(summaries);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/documents", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const docs = await storage.getDocuments(claimId);
      res.json(docs);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/documents/:id/signed-url", authenticateRequest, async (req, res) => {
    try {
      const docId = parseInt(param(req.params.id));
      const doc = await storage.getDocumentById(docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (!doc.storagePath) return res.status(404).json({ message: "No file uploaded for this document" });

      const paths = doc.storagePath.split("|");
      const urls: string[] = [];
      for (const p of paths) {
        const { data, error } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .createSignedUrl(p.trim(), 3600);
        if (error) throw new Error(`Signed URL failed: ${error.message}`);
        urls.push(data.signedUrl);
      }
      res.json({ urls, fileName: doc.fileName, documentType: doc.documentType });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/upload", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const parsed = uploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid upload data", errors: parsed.error.flatten().fieldErrors });
      }
      const { fileName, fileBase64, documentType } = parsed.data;

      if (!fileName.toLowerCase().endsWith(".pdf") && !fileBase64.startsWith("data:application/pdf")) {
        return res.status(400).json({ message: "Only PDF uploads are supported" });
      }

      const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(fileBase64, MAX_DOCUMENT_BYTES);
      if (wasTruncated) {
        return res.status(413).json({ message: "File exceeds max upload size (25MB)" });
      }

      const storagePath = await uploadToSupabase(claimId, documentType, fileBuffer, fileName);

      const existing = await storage.getDocument(claimId, documentType);
      if (existing) {
        await storage.updateDocumentStoragePath(existing.id, storagePath, fileName, fileBuffer.length);
        await storage.updateDocumentStatus(existing.id, "uploaded");
        res.json({ documentId: existing.id, storagePath, status: "uploaded" });
        return;
      }

      const doc = await storage.createDocument({
        claimId,
        documentType,
        fileName,
        fileSize: fileBuffer.length,
        storagePath,
        status: "uploaded",
      });

      res.status(201).json({ documentId: doc.id, storagePath, status: "uploaded" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/upload-batch", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const parsed = batchUploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid batch upload data", errors: parsed.error.flatten().fieldErrors });
      }
      const { files, documentType } = parsed.data;

      const storagePaths: string[] = [];
      for (const file of files) {
        if (!file.fileName.toLowerCase().endsWith(".pdf") && !file.fileBase64.startsWith("data:application/pdf")) {
          return res.status(400).json({ message: "Only PDF uploads are supported" });
        }
        const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(file.fileBase64, MAX_DOCUMENT_BYTES);
        if (wasTruncated) {
          return res.status(413).json({ message: "One or more files exceed the 25MB limit" });
        }
        const storagePath = await uploadToSupabase(claimId, documentType, fileBuffer, file.fileName);
        storagePaths.push(storagePath);
      }

      const combinedFileName = files.map(f => f.fileName).join(", ");
      const totalSize = files.reduce((sum, f) => {
        const { buffer } = decodeBase64Payload(f.fileBase64, MAX_DOCUMENT_BYTES);
        return sum + buffer.length;
      }, 0);

      const existing = await storage.getDocument(claimId, documentType);
      if (existing) {
        await storage.updateDocumentStoragePath(existing.id, storagePaths.join("|"), combinedFileName, totalSize);
        await storage.updateDocumentStatus(existing.id, "uploaded");
        res.json({ documentId: existing.id, storagePaths, fileCount: files.length, status: "uploaded" });
        return;
      }

      const doc = await storage.createDocument({
        claimId,
        documentType,
        fileName: combinedFileName,
        fileSize: totalSize,
        storagePath: storagePaths.join("|"),
        status: "uploaded",
      });

      res.status(201).json({ documentId: doc.id, storagePaths, fileCount: files.length, status: "uploaded" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/:type/parse", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const documentType = param(req.params.type);

      const doc = await storage.getDocument(claimId, documentType);
      if (!doc) {
        return res.status(404).json({ message: "Document not found. Upload first." });
      }

      if (!doc.storagePath) {
        return res.status(400).json({ message: "Document has no uploaded file. Upload first." });
      }

      await storage.updateDocumentStatus(doc.id, "processing");

      let rawText = "";
      try {
        if (documentType === "endorsements" && doc.storagePath!.includes("|")) {
          const storagePaths = doc.storagePath!.split("|");
          const textParts: string[] = [];
          for (const sp of storagePaths) {
            const dataBuffer = await downloadFromSupabase(sp);
            const pdfData = await pdfParse(dataBuffer);
            textParts.push(pdfData.text);
          }
          rawText = textParts.join("\n\n--- NEXT DOCUMENT ---\n\n");
        } else {
          const dataBuffer = await downloadFromSupabase(doc.storagePath!);
          const pdfData = await pdfParse(dataBuffer);
          rawText = pdfData.text;
        }
      } catch (pdfError: any) {
        await storage.updateDocumentError(doc.id, "Failed to parse PDF: " + pdfError.message);
        return res.status(422).json({ message: "Failed to parse PDF text" });
      }

      await storage.updateDocumentStatus(doc.id, "processing", rawText);

      let extractResult: { extractedData: any; confidence: any };
      try {
        if (documentType === "fnol") {
          extractResult = await extractFNOL(rawText);
        } else if (documentType === "policy") {
          extractResult = await extractPolicy(rawText);
        } else if (documentType === "endorsements") {
          extractResult = await extractEndorsements(rawText);
        } else {
          return res.status(400).json({ message: "Invalid document type" });
        }
      } catch (aiError: any) {
        await storage.updateDocumentError(doc.id, "AI extraction failed: " + aiError.message);
        return res.status(500).json({ message: "AI extraction failed" });
      }

      const existing = await storage.getExtraction(claimId, documentType);
      let extraction;
      if (existing) {
        extraction = await storage.updateExtraction(existing.id, extractResult.extractedData);
      } else {
        extraction = await storage.createExtraction({
          claimId,
          documentType,
          extractedData: extractResult.extractedData,
          confidence: extractResult.confidence,
        });
      }

      await storage.updateDocumentStatus(doc.id, "parsed");

      // Always sync FNOL extracted fields to the claims table (both on create and re-parse)
      if (documentType === "fnol") {
        try {
          const fnolFields = claimFieldsFromFnol(extractResult.extractedData);
          if (Object.keys(fnolFields).length > 0) {
            await storage.updateClaimFields(claimId, fnolFields);
          }
        } catch (syncError: any) {
          console.error("Failed to sync FNOL fields to claim:", syncError.message);
        }
      }

      const allDocs = await storage.getDocuments(claimId);
      const allParsed = allDocs.length >= 3 && allDocs.every(d => d.status === "parsed");
      if (allParsed) {
        await storage.updateClaimStatus(claimId, "documents_uploaded");
      }

      res.json({ extraction, confidence: extractResult.confidence });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/extractions", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const exts = await storage.getExtractions(claimId);
      res.json(exts);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/extractions/:type", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const ext = await storage.getExtraction(claimId, param(req.params.type));
      if (!ext) return res.status(404).json({ message: "Extraction not found" });
      res.json(ext);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/claims/:id/extractions/:type", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const ext = await storage.getExtraction(claimId, param(req.params.type));
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      const updated = await storage.updateExtraction(ext.id, req.body.extractedData);
      await storage.confirmExtraction(ext.id);

      // Re-sync edited FNOL fields to the claims table
      if (param(req.params.type) === "fnol") {
        const fnolFields = claimFieldsFromFnol(req.body.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/extractions/:type/confirm", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const ext = await storage.getExtraction(claimId, param(req.params.type));
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      await storage.confirmExtraction(ext.id);

      if (param(req.params.type) === "fnol" && ext.extractedData) {
        const fnolFields = claimFieldsFromFnol(ext.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      res.json({ confirmed: true, documentType: param(req.params.type) });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/extractions/confirm-all", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const exts = await storage.getExtractions(claimId);
      for (const ext of exts) {
        await storage.confirmExtraction(ext.id);
      }

      // Ensure the latest FNOL data is synced to the claims table on confirmation
      const fnolExt = exts.find(e => e.documentType === "fnol");
      if (fnolExt?.extractedData) {
        const fnolFields = claimFieldsFromFnol(fnolExt.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      await storage.updateClaimStatus(claimId, "extractions_confirmed");
      res.json({ confirmed: exts.length });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/briefing/generate", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const exts = await storage.getExtractions(claimId);

      const fnolExt = exts.find(e => e.documentType === "fnol");
      const policyExt = exts.find(e => e.documentType === "policy");
      const endorsementsExt = exts.find(e => e.documentType === "endorsements");

      if (!fnolExt || !policyExt || !endorsementsExt) {
        return res.status(400).json({ message: "All 3 extractions required before generating briefing" });
      }

      const briefingData = await generateBriefing(
        fnolExt.extractedData,
        policyExt.extractedData,
        endorsementsExt.extractedData
      );

      const existing = await storage.getBriefing(claimId);
      const briefingFields = {
        claimId,
        propertyProfile: briefingData.propertyProfile,
        coverageSnapshot: briefingData.coverageSnapshot,
        perilAnalysis: briefingData.perilAnalysis,
        endorsementImpacts: briefingData.endorsementImpacts,
        inspectionChecklist: briefingData.inspectionChecklist,
        dutiesAfterLoss: briefingData.dutiesAfterLoss,
        redFlags: briefingData.redFlags,
      };
      let briefing;
      if (existing) {
        briefing = await storage.updateBriefing(claimId, briefingFields);
      } else {
        briefing = await storage.createBriefing(briefingFields);
      }

      await storage.updateClaimStatus(claimId, "briefing_ready");
      res.json(briefing);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/briefing", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const briefing = await storage.getBriefing(claimId);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Inspection Session Management ──────────────────

  app.get("/api/claims/:id/inspection/active", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const session = await storage.getActiveSessionForClaim(claimId);
      if (!session) {
        const latest = await storage.getLatestSessionForClaim(claimId);
        if (!latest) return res.status(404).json({ message: "No session for this claim" });
        return res.json({ sessionId: latest.id, session: latest });
      }
      res.json({ sessionId: session.id, session });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/inspection/start", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const existing = await storage.getActiveSessionForClaim(claimId);
      if (existing) {
        // Ensure policy rules exist even for existing sessions
        await ensurePolicyRules(claimId, req.user?.id);
        return res.json({ sessionId: existing.id, session: existing });
      }
      const session = await storage.createInspectionSession(claimId);
      if (req.user?.id) {
        await storage.updateSession(session.id, { inspectorId: req.user.id });
      }
      await storage.updateClaimStatus(claimId, "inspecting");
      // Seed default policy rules from briefing coverage data
      await ensurePolicyRules(claimId, req.user?.id);
      res.status(201).json({ sessionId: session.id, session });
    } catch (error: any) {
      console.error("INSPECTION_START_ERROR claim=", req.params.id, error);
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);
      res.json({ session, rooms, lineItemCount: allLineItems.length, photoCount: photos.length, estimate });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = sessionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid session update", errors: parsed.error.flatten().fieldErrors });
      }
      const updates = parsed.data;
      const session = await storage.updateSession(sessionId, updates);
      res.json(session);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/complete", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.completeSession(sessionId);
      if (session) {
        await storage.updateClaimStatus(session.claimId, "inspection_complete");
      }
      res.json(session);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Structures (L1 Hierarchy) ─────────────────────

  app.post("/api/inspection/:sessionId/structures", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = structureCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid structure data", errors: parsed.error.flatten().fieldErrors });
      }
      // Check for duplicate name in session
      const existing = await storage.getStructureByName(sessionId, parsed.data.name);
      if (existing) {
        return res.json(existing); // idempotent — return existing
      }
      const structure = await storage.createStructure({
        sessionId,
        name: parsed.data.name,
        structureType: parsed.data.structureType || "dwelling",
      });
      res.status(201).json(structure);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/structures", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const structs = await storage.getStructures(sessionId);
      res.json(structs);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/structures/:structureId", authenticateRequest, async (req, res) => {
    try {
      const structureId = parseInt(param(req.params.structureId));
      const parsed = structureUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid structure update", errors: parsed.error.flatten().fieldErrors });
      }
      const structure = await storage.updateStructure(structureId, parsed.data);
      res.json(structure);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/structures/:structureId", authenticateRequest, async (req, res) => {
    try {
      const structureId = parseInt(param(req.params.structureId));
      await storage.deleteStructure(structureId);
      res.status(204).send();
    } catch (error: any) {
      if (error?.message?.includes("Cannot delete structure")) {
        return res.status(400).json({ message: error.message });
      }
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Inspection Hierarchy (full tree for voice agent) ──

  app.get("/api/inspection/:sessionId/hierarchy", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const hierarchy = await storage.getInspectionHierarchy(sessionId);
      res.json(hierarchy);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Rooms (L2/L3 Hierarchy) ─────────────────────────

  app.post("/api/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = roomCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid room data", errors: parsed.error.flatten().fieldErrors });
      }
      const { name, roomType, structure, structureId, viewType, shapeType,
              parentRoomId, attachmentType, dimensions, polygon, position,
              floor, facetLabel, pitch, phase } = parsed.data;
      const structureName = structure || "Main Dwelling";

      // Resolve structureId: use provided ID, or auto-create from legacy structure string
      let resolvedStructureId = structureId || null;
      if (!resolvedStructureId && structure) {
        let existingStruct = await storage.getStructureByName(sessionId, structure);
        if (!existingStruct) {
          const sType = structure.toLowerCase().includes("garage") ? "garage"
            : structure.toLowerCase().includes("shed") ? "shed"
            : structure.toLowerCase().includes("fence") ? "fence"
            : "dwelling";
          existingStruct = await storage.createStructure({
            sessionId,
            name: structure,
            structureType: sType,
          });
        }
        resolvedStructureId = existingStruct.id;
      }

      // Validate parentRoomId if provided (L3 subroom)
      if (parentRoomId) {
        const parentRoom = await storage.getRoom(parentRoomId);
        if (!parentRoom || parentRoom.sessionId !== sessionId) {
          return res.status(400).json({ message: "Invalid parentRoomId: parent room not found in this session" });
        }
      }

      // Check for duplicate: elevation rooms update dimensions, others return existing
      const isElevation = roomType && roomType.startsWith("exterior_elevation_");
      if (isElevation) {
        const existingRooms = await storage.getRooms(sessionId);
        const duplicate = existingRooms.find(
          (r) => r.roomType === roomType && (r.structure || "Main Dwelling") === structureName
        );
        if (duplicate) {
          if (dimensions) {
            const updated = await storage.updateRoom(duplicate.id, { dimensions, status: "in_progress" });
            if (updated) {
              await storage.updateSessionRoom(sessionId, updated.id);
              return res.status(200).json(updated);
            }
          }
          await storage.updateSessionRoom(sessionId, duplicate.id);
          return res.status(200).json(duplicate);
        }
      } else {
        const existingRoom = await storage.getRoomByName(sessionId, name);
        if (existingRoom) {
          return res.json(existingRoom); // idempotent
        }
      }


      const room = await storage.createRoom({
        sessionId,
        name,
        roomType: roomType || null,
        structure: structureName,
        structureId: resolvedStructureId,
        viewType: viewType || "interior",
        shapeType: shapeType || "rectangle",
        parentRoomId: parentRoomId || null,
        attachmentType: attachmentType || null,
        dimensions: dimensions || null,
        polygon: polygon || null,
        position: position || null,
        floor: floor || 1,
        facetLabel: facetLabel || null,
        pitch: pitch || null,
        status: "in_progress",
        phase: phase || null,
      });
      await storage.updateSessionRoom(sessionId, room.id);

      // Return enriched response with hierarchy context
      const siblings = resolvedStructureId
        ? (await storage.getRoomsForStructure(resolvedStructureId)).filter(r => r.id !== room.id && !r.parentRoomId)
        : [];

      res.status(201).json({
        ...room,
        _context: {
          structureName: structure || "Main Dwelling",
          structureId: resolvedStructureId,
          siblingRooms: siblings.map(s => ({ id: s.id, name: s.name, status: s.status })),
          isSubArea: !!parentRoomId,
          parentRoomName: parentRoomId ? (await storage.getRoom(parentRoomId))?.name : null,
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const rooms = await storage.getRooms(sessionId);
      res.json(rooms);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/rooms/:roomId", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const { status, name, dimensions, roomType, viewType, shapeType, position } = req.body;
      const updates: any = {};
      if (status !== undefined) updates.status = status;
      if (name !== undefined) updates.name = name;
      if (dimensions !== undefined) updates.dimensions = dimensions;
      if (roomType !== undefined) updates.roomType = roomType;
      if (viewType !== undefined) updates.viewType = viewType;
      if (shapeType !== undefined) updates.shapeType = shapeType;
      if (position !== undefined) updates.position = position;
      const room = await storage.updateRoom(roomId, updates);
      res.json(room);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/rooms/:roomId", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      await storage.deleteRoom(roomId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/rooms/:roomId/complete", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const room = await storage.completeRoom(roomId);
      res.json(room);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // Save room geometry (polygon + position from sketch canvas)
  app.patch("/api/inspection/:sessionId/rooms/:roomId/geometry", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const { polygon, position } = req.body;
      const room = await storage.updateRoomGeometry(roomId, polygon, position);
      res.json(room);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Room Openings (L4: Deductions) ─────────────────

  app.post("/api/inspection/:sessionId/rooms/:roomId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = parseInt(param(req.params.roomId));
      const parsed = roomOpeningCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid opening data", errors: parsed.error.flatten().fieldErrors });
      }
      const data = parsed.data;
      // Resolve widthFt/heightFt from legacy width/height if needed
      const widthFt = data.widthFt || data.width || null;
      const heightFt = data.heightFt || data.height || null;
      // Auto-set goesToFloor for overhead doors
      const goesToFloor = data.openingType === "overhead_door" ? true : (data.goesToFloor || false);
      const opening = await storage.createOpening({
        sessionId,
        roomId,
        openingType: data.openingType,
        wallIndex: data.wallIndex ?? null,
        wallDirection: data.wallDirection || null,
        positionOnWall: data.positionOnWall,
        widthFt,
        heightFt,
        width: widthFt,
        height: heightFt,
        quantity: data.quantity || 1,
        label: data.label || null,
        opensInto: data.opensInto || null,
        goesToFloor,
        goesToCeiling: data.goesToCeiling || false,
        notes: data.notes || null,
      });
      res.status(201).json(opening);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms/:roomId/openings", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const openings = await storage.getRoomOpenings(roomId);
      res.json(openings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/rooms/:roomId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(param(req.params.openingId));
      const opening = await storage.getOpening(openingId);
      if (!opening) return res.status(404).json({ error: "Opening not found" });

      const parsed = openingUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });

      const updated = await storage.updateOpening(openingId, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/rooms/:roomId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(param(req.params.openingId));
      await storage.deleteOpening(openingId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Wall Openings (session-level endpoints) ──────────────────

  app.post("/api/inspection/:sessionId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = openingCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid opening data", errors: parsed.error.flatten().fieldErrors });
      }
      const data = parsed.data;
      // Auto-set goesToFloor for overhead doors
      const goesToFloor = data.openingType === "overhead_door" ? true : (data.goesToFloor || false);
      const opening = await storage.createOpening({
        sessionId,
        roomId: data.roomId,
        openingType: data.openingType,
        wallDirection: data.wallDirection || null,
        wallIndex: data.wallIndex ?? null,
        positionOnWall: data.positionOnWall,
        widthFt: data.widthFt,
        heightFt: data.heightFt,
        width: data.widthFt,
        height: data.heightFt,
        quantity: data.quantity || 1,
        opensInto: data.opensInto || null,
        goesToFloor,
        goesToCeiling: data.goesToCeiling || false,
        notes: data.notes || null,
      });
      res.status(201).json(opening);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const openings = await storage.getOpeningsForSession(sessionId);
      res.json(openings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(param(req.params.openingId));
      await storage.deleteOpening(openingId);
      res.status(204).send();
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Room Adjacency Endpoints ──────────────────────
  app.get("/api/sessions/:sessionId/adjacencies", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const adjacencies = await storage.getAdjacenciesForSession(sessionId);
      res.json(adjacencies);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/rooms/:roomId/adjacencies", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const adjacencies = await storage.getAdjacentRooms(roomId);
      res.json(adjacencies);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions/:sessionId/adjacencies", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = adjacencyCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const roomA = await storage.getRoom(parsed.data.roomIdA);
      const roomB = await storage.getRoom(parsed.data.roomIdB);
      if (!roomA || roomA.sessionId !== sessionId) return res.status(404).json({ error: "Room A not found in session" });
      if (!roomB || roomB.sessionId !== sessionId) return res.status(404).json({ error: "Room B not found in session" });
      if (parsed.data.roomIdA === parsed.data.roomIdB) return res.status(400).json({ error: "A room cannot be adjacent to itself" });

      const adjacency = await storage.createAdjacency({ ...parsed.data, sessionId });
      res.status(201).json(adjacency);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/adjacencies/:id", authenticateRequest, async (req, res) => {
    try {
      await storage.deleteAdjacency(parseInt(param(req.params.id)));
      res.status(204).send();
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Update Room Dimensions (for DIM_VARS recalculation) ──
  app.patch("/api/rooms/:roomId/dimensions", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      const existingDims = (room.dimensions as Record<string, any>) || {};
      const merged = { ...existingDims, ...req.body };

      // Recalculate DIM_VARS when length/width/height are present
      const dims = merged as RoomDimensions;
      if (dims.length && dims.width) {
        const openings = await storage.getOpeningsForRoom(roomId);
        const openingData: OpeningData[] = openings.map((o) => ({
          openingType: o.openingType,
          widthFt: o.widthFt ?? o.width ?? 0,
          heightFt: o.heightFt ?? o.height ?? 0,
          quantity: o.quantity ?? 1,
          opensInto: o.opensInto ?? null,
          goesToFloor: o.goesToFloor ?? false,
          goesToCeiling: o.goesToCeiling ?? false,
        }));
        const { beforeMW, afterMW } = calculateDimVars(dims, openingData);
        merged.dimVars = afterMW;
        merged.dimVarsBeforeMW = beforeMW;
      }

      const updated = await storage.updateRoomDimensions(roomId, merged);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Sketch Annotations (L5: Metadata overlays) ──────

  app.post("/api/inspection/:sessionId/rooms/:roomId/annotations", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const parsed = sketchAnnotationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid annotation data", errors: parsed.error.flatten().fieldErrors });
      }
      const annotation = await storage.createSketchAnnotation({ roomId, ...parsed.data });
      res.status(201).json(annotation);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms/:roomId/annotations", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(param(req.params.roomId));
      const annotations = await storage.getSketchAnnotations(roomId);
      res.json(annotations);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/annotations/:annotationId", authenticateRequest, async (req, res) => {
    try {
      const annotationId = parseInt(param(req.params.annotationId));
      const annotation = await storage.getSketchAnnotation(annotationId);
      if (!annotation) return res.status(404).json({ message: "Annotation not found" });

      const parsed = sketchAnnotationUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });

      const updated = await storage.updateSketchAnnotation(annotationId, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/annotations/:annotationId", authenticateRequest, async (req, res) => {
    try {
      const annotationId = parseInt(param(req.params.annotationId));
      const annotation = await storage.getSketchAnnotation(annotationId);
      if (!annotation) return res.status(404).json({ message: "Annotation not found" });

      const parsed = sketchAnnotationUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });

      const updated = await storage.updateSketchAnnotation(annotationId, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/annotations/:annotationId", authenticateRequest, async (req, res) => {
    try {
      const annotationId = parseInt(param(req.params.annotationId));
      await storage.deleteSketchAnnotation(annotationId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Sketch Templates ────────────────────────────────

  app.get("/api/sketch-templates", authenticateRequest, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = await storage.getSketchTemplates(category);
      res.json(templates);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Damage Observations ──────────────────────────

  app.post("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, description, damageType, severity, location, measurements } = req.body;
      if (!roomId || !description) {
        return res.status(400).json({ message: "roomId and description are required" });
      }
      const damage = await storage.createDamage({
        sessionId,
        roomId,
        description,
        damageType: damageType || null,
        severity: severity || null,
        location: location || null,
        measurements: measurements || null,
      });
      await storage.incrementRoomDamageCount(roomId);
      res.status(201).json(damage);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const damages = roomId
        ? await storage.getDamages(roomId)
        : await storage.getDamagesForSession(sessionId);
      res.json(damages);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Line Items ───────────────────────────────────

  app.post("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = lineItemCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid line item data", errors: parsed.error.flatten().fieldErrors });
      }
      const { roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, depreciationType, wasteFactor, coverageBucket, qualityGrade, applyOAndP, macroSource, age, lifeExpectancy, depreciationPercentage } = parsed.data;
      const wf = wasteFactor || 0;
      const qty = quantity || 1;
      const up = unitPrice || 0;
      let totalPrice = Math.round(qty * up * (1 + wf / 100) * 100) / 100;
      if (applyOAndP) {
        totalPrice = Math.round(totalPrice * 1.20 * 100) / 100; // 10% overhead + 10% profit (additive)
      }

      const item = await storage.createLineItem({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        category,
        action: action || null,
        description,
        xactCode: xactCode || null,
        quantity: qty,
        unit: unit || null,
        unitPrice: up,
        totalPrice,
        depreciationType: depreciationType || "Recoverable",
        wasteFactor: wf,
        coverageBucket: coverageBucket || "Coverage A",
        qualityGrade: qualityGrade || null,
        applyOAndP: applyOAndP || false,
        macroSource: macroSource || null,
        // ── Financial / Depreciation fields ──
        age: age || null,
        lifeExpectancy: lifeExpectancy || null,
        depreciationPercentage: depreciationPercentage || null,
      } as any);
      res.status(201).json(item);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getLineItems(sessionId);
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/estimate-summary", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const summary = await storage.getEstimateSummary(sessionId);
      res.json(summary);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/line-items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const allowedFields = z.object({
        category: z.string().optional(),
        action: z.string().optional(),
        description: z.string().optional(),
        xactCode: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        unitPrice: z.number().optional(),
        totalPrice: z.number().optional(),
        depreciationType: z.string().optional(),
        depreciationRate: z.number().min(0).max(100).nullable().optional(),
        wasteFactor: z.number().optional(),
        roomId: z.number().optional(),
        damageId: z.number().optional(),
        coverageBucket: z.string().optional(),
        qualityGrade: z.string().optional(),
        applyOAndP: z.boolean().optional(),
        macroSource: z.string().optional(),
      }).strict();
      const parsed = allowedFields.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update fields", errors: parsed.error.flatten() });
      }
      const item = await storage.updateLineItem(id, parsed.data);
      res.json(item);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/line-items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      await storage.deleteLineItem(id);
      res.status(204).send();
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Smart Macros ─────────────────────────────────

  const SMART_MACRO_BUNDLES: Record<string, Array<{ category: string; action: string; description: string; xactCode: string; unit: string; defaultWaste: number; depreciationType: string }>> = {
    roof_replacement_laminated: [
      { category: "Roofing", action: "Tear Off", description: "Remove composition shingles - laminated", xactCode: "RFG-TEAR-LM", unit: "SQ", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Laminated composition shingles (architectural)", xactCode: "RFG-SHIN-AR", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Roofing felt - 15 lb.", xactCode: "RFG-FELT-15", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ice & water barrier", xactCode: "RFG-ICE-WB", unit: "SQ", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "R&R", description: "Drip edge - aluminum", xactCode: "RFG-DRIP-AL", unit: "LF", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ridge vent - aluminum", xactCode: "RFG-RIDGE-V", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
    ],
    roof_replacement_3tab: [
      { category: "Roofing", action: "Tear Off", description: "Remove composition shingles - 3 tab", xactCode: "RFG-TEAR-3T", unit: "SQ", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "3-tab composition shingles", xactCode: "RFG-SHIN-3T", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Roofing felt - 15 lb.", xactCode: "RFG-FELT-15", unit: "SQ", defaultWaste: 10, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ice & water barrier", xactCode: "RFG-ICE-WB", unit: "SQ", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "R&R", description: "Drip edge - aluminum", xactCode: "RFG-DRIP-AL", unit: "LF", defaultWaste: 5, depreciationType: "Recoverable" },
      { category: "Roofing", action: "Install", description: "Ridge vent - aluminum", xactCode: "RFG-RIDGE-V", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
    ],
    interior_paint_walls_ceiling: [
      { category: "Painting", action: "Paint", description: "Seal/prime then paint walls - 2 coats", xactCode: "PTG-WALL-2C", unit: "SF", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Painting", action: "Paint", description: "Seal/prime then paint ceiling - 2 coats", xactCode: "PTG-CEIL-2C", unit: "SF", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Painting", action: "Paint", description: "Paint baseboard trim", xactCode: "PTG-TRIM-BS", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
      { category: "Painting", action: "Paint", description: "Paint door/window casing trim", xactCode: "PTG-TRIM-CS", unit: "LF", defaultWaste: 0, depreciationType: "Recoverable" },
    ],
    water_mitigation_dryout: [
      { category: "General", action: "Labor Only", description: "Water extraction - wet vacuum", xactCode: "WTR-EXTR-WV", unit: "SF", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Install", description: "Dehumidifier setup and monitoring", xactCode: "WTR-DEHU-SM", unit: "DAY", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Install", description: "Air mover / fan placement", xactCode: "WTR-AIRM-PL", unit: "DAY", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Labor Only", description: "Moisture monitoring and documentation", xactCode: "WTR-MONI-DC", unit: "HR", defaultWaste: 0, depreciationType: "Paid When Incurred" },
      { category: "General", action: "Clean", description: "Anti-microbial treatment", xactCode: "WTR-ANTI-MC", unit: "SF", defaultWaste: 0, depreciationType: "Paid When Incurred" },
    ],
  };

  app.post("/api/inspection/:sessionId/smart-macro", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = smartMacroSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid smart macro data", errors: parsed.error.flatten().fieldErrors });
      }
      const { macroType, severity, wasteFactor, roomId } = parsed.data;
      const bundle = SMART_MACRO_BUNDLES[macroType];
      if (!bundle) {
        return res.status(400).json({ message: `Unknown macro type: ${macroType}` });
      }

      const createdItems = [];
      for (const template of bundle) {
        const wf = wasteFactor ?? template.defaultWaste;

        // Look up catalog price for this line item
        let unitPrice = 0;
        let totalPrice = 0;
        const catalogItem = await lookupCatalogItem(template.xactCode);
        if (catalogItem) {
          const regionalPrice = await getRegionalPrice(template.xactCode, "US_NATIONAL");
          if (regionalPrice) {
            const materialCost = regionalPrice.materialCost || 0;
            const laborCost = regionalPrice.laborCost || 0;
            const equipmentCost = regionalPrice.equipmentCost || 0;
            unitPrice = Math.round((materialCost * (1 + wf / 100) + laborCost + equipmentCost) * 100) / 100;
            totalPrice = unitPrice; // quantity is 1
          }
        }

        const item = await storage.createLineItem({
          sessionId,
          roomId: roomId || null,
          damageId: null,
          category: template.category,
          action: template.action,
          description: severity === "premium" ? `${template.description} - Premium Grade` : template.description,
          xactCode: template.xactCode,
          quantity: 1,
          unit: template.unit,
          unitPrice,
          totalPrice,
          depreciationType: template.depreciationType,
          wasteFactor: wf,
          coverageBucket: "Dwelling",
          qualityGrade: severity === "premium" ? "High Grade" : severity === "heavy" ? "Standard" : null,
          applyOAndP: false,
          macroSource: macroType,
        });
        createdItems.push(item);
      }

      res.status(201).json({
        macroType,
        itemCount: createdItems.length,
        items: createdItems,
        message: `Applied ${macroType} bundle: ${createdItems.length} line items created.`,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Related Items (Waterfall Logic) ────────────

  const RELATED_ITEMS_MAP: Record<string, Record<string, string[]>> = {
    Cabinetry: {
      default: ["Detach/Reset Plumbing (angle stops, P-trap, supply lines)", "Disconnect/Reconnect Electrical (disposal, dishwasher)", "Countertop Detach & Reset", "Backsplash R&R if adhered to cabinet"],
      "Remove Vanity": ["Detach/Reset Plumbing (angle stops, P-trap, supply lines)", "Disconnect faucet and drain assembly", "Mirror removal if mounted to vanity"],
      "R&R Kitchen Cabinets": ["Detach/Reset Plumbing (angle stops, P-trap, supply lines)", "Disconnect/Reconnect Electrical (disposal, dishwasher)", "Countertop Detach & Reset", "Backsplash R&R", "Appliance pullout and reset"],
    },
    Roofing: {
      default: ["Drip edge R&R", "Ice & water barrier at eaves/valleys", "Pipe jack/roof boot replacement", "Step flashing at wall intersections", "Ridge cap shingles", "Satellite dish detach & reset"],
      "Tear Off Shingles": ["Felt/underlayment replacement", "Valley metal re-flash", "Pipe jack/boot replacement", "Drip edge inspection/replacement", "Starter strip shingles"],
    },
    Drywall: {
      default: ["Texture matching (knock-down, orange peel, smooth)", "Prime and paint to match (2 coats minimum)", "Baseboard R&R if removing lower drywall", "Outlet/switch plate removal and reset"],
      "R&R Drywall": ["Texture matching (knock-down, orange peel, smooth)", "Prime and paint to match (2 coats minimum)", "Baseboard R&R if removing lower drywall", "Outlet/switch plate removal and reset", "Insulation replacement behind drywall"],
    },
    Siding: {
      default: ["House wrap / moisture barrier behind siding", "J-channel and trim pieces", "Light fixture detach & reset", "Hose bib detach & reset", "Address numbers/mailbox detach & reset"],
    },
    Flooring: {
      default: ["Baseboard/shoe mold R&R", "Transition strips at doorways", "Furniture move-out and move-back", "Subfloor inspection/replacement if water damage", "Underlayment/padding replacement"],
    },
    Plumbing: {
      default: ["Access panel creation if behind wall", "Drywall repair after access", "Fixture detach & reset"],
    },
    Electrical: {
      default: ["Permit fees if code requires", "Outlet/switch upgrade to current code", "GFCI protection if near water source"],
    },
    Windows: {
      default: ["Interior casing/trim R&R", "Exterior trim/J-channel", "Flashing and sealant", "Window screen R&R", "Blinds/window treatment detach & reset"],
    },
    Doors: {
      default: ["Door hardware R&R (hinges, handle, deadbolt)", "Weatherstripping replacement", "Threshold R&R", "Door casing/trim R&R", "Lockset re-key if exterior door"],
    },
  };

  app.post("/api/inspection/:sessionId/check-related-items", authenticateRequest, async (req, res) => {
    try {
      const parsed = checkRelatedItemsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });
      }
      const { primaryCategory, actionTaken } = parsed.data;
      const categoryMap = RELATED_ITEMS_MAP[primaryCategory];
      if (!categoryMap) {
        return res.json({ suggestions: [], message: "No related items found for this category." });
      }

      const suggestions = (actionTaken && categoryMap[actionTaken])
        ? categoryMap[actionTaken]
        : categoryMap.default || [];

      res.json({
        primaryCategory,
        actionTaken: actionTaken || null,
        suggestions,
        message: suggestions.length > 0
          ? `Check for: ${suggestions.join("; ")}`
          : "No additional items suggested for this action.",
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Test Squares ────────────────────────────────

  app.post("/api/inspection/:sessionId/test-squares", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const parsed = testSquareCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid test square data", errors: parsed.error.flatten().fieldErrors });
      }
      const { roomId, hailHits, windCreases, pitch, result, notes } = parsed.data;

      const testSquare = await storage.createTestSquare({
        sessionId,
        roomId: roomId || null,
        hailHits,
        windCreases: windCreases || 0,
        pitch,
        result: result || (hailHits >= 8 ? "fail" : "pass"),
        notes: notes || null,
      });

      // Determine steep charge applicability
      const pitchParts = pitch.split("/");
      const pitchRise = parseInt(pitchParts[0]) || 0;
      const steepCharge = pitchRise > 7;

      res.status(201).json({
        ...testSquare,
        _analysis: {
          steepCharge,
          steepChargeNote: steepCharge ? `Pitch ${pitch} exceeds 7/12 — steep charge applies to labor.` : null,
          recommendation: hailHits >= 8
            ? "Test square FAILS — sufficient damage for full slope replacement."
            : hailHits >= 4
              ? "Borderline — consider additional test squares on this facet."
              : "Test square passes — damage below replacement threshold.",
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/test-squares", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const squares = roomId
        ? await storage.getTestSquaresForRoom(roomId)
        : await storage.getTestSquares(sessionId);
      res.json(squares);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Scope Assembly ─────────────────────────────────

  app.post("/api/inspection/:sessionId/scope/assemble", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, damageId } = req.body;

      if (!roomId || !damageId) {
        return res.status(400).json({ message: "roomId and damageId are required" });
      }

      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ message: "Room not found" });

      const damages = await storage.getDamages(roomId);
      const damage = damages.find(d => d.id === damageId);
      if (!damage) return res.status(404).json({ message: "Damage not found" });

      let netWallDeduction = 0;
      try {
        const openings = await storage.getOpeningsForRoom(roomId);
        const openingData: OpeningData[] = openings.map(o => ({
          openingType: o.openingType || "door",
          widthFt: (o.widthFt ?? o.width ?? 0) as number,
          heightFt: (o.heightFt ?? o.height ?? 0) as number,
          quantity: o.quantity ?? 1,
          opensInto: o.opensInto ?? null,
          goesToFloor: o.goesToFloor ?? false,
          goesToCeiling: o.goesToCeiling ?? false,
        }));
        const dims = room.dimensions as { length?: number; width?: number; height?: number } | null;
        if (dims?.length && dims?.width) {
          const grossWall = ((dims.length! + dims.width!) * 2) * (dims.height ?? 8);
          const { afterMW } = calculateDimVars(
            { length: dims.length!, width: dims.width!, height: dims.height ?? 8 },
            openingData
          );
          netWallDeduction = Math.max(0, grossWall - (afterMW?.W ?? 0));
        }
      } catch {
        // Use 0 if DIM_VARS calculation fails
      }

      const { assembleScope } = await import("./scopeAssemblyService");
      const result = await assembleScope(storage, sessionId, room, damage, netWallDeduction);

      res.json({
        created: result.created.length,
        companions: result.companionItems.length,
        manualNeeded: result.manualQuantityNeeded,
        warnings: result.warnings,
        items: [...result.created, ...result.companionItems],
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Scope assembly failed" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getScopeItems(sessionId);
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/scope/summary", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      let summary = await storage.getScopeSummary(sessionId);
      if (summary.length === 0) {
        summary = await storage.recalculateScopeSummary(sessionId);
      }
      res.json(summary);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/scope/items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const sessionId = parseInt(param(req.params.sessionId));
      const { quantity, description, wasteFactor, status } = req.body;
      const updates: Record<string, unknown> = {};
      if (quantity !== undefined) updates.quantity = quantity;
      if (description !== undefined) updates.description = description;
      if (wasteFactor !== undefined) updates.wasteFactor = wasteFactor;
      if (status !== undefined) updates.status = status;

      const item = await storage.updateScopeItem(id, updates as any);
      if (item) await storage.recalculateScopeSummary(sessionId);
      res.json(item);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photos ───────────────────────────────────────

  app.post("/api/inspection/:sessionId/photos", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, damageId, imageBase64, autoTag, caption, photoType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }
      if (!imageBase64.startsWith("data:image/")) {
        return res.status(400).json({ message: "Only image uploads are supported" });
      }

      const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(imageBase64, MAX_PHOTO_BYTES);
      if (wasTruncated) {
        return res.status(413).json({ message: "Image exceeds max upload size (10MB)" });
      }
      // Detect content type from data URI prefix
      const mimeMatch = imageBase64.match(/^data:(image\/\w+);/);
      const contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";

      const rawTag = autoTag || `photo_${Date.now()}`;
      const tag = rawTag
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_")
        .replace(/-+/g, "-")
        .substring(0, 60) || `photo_${Date.now()}`;
      const storagePath = `inspections/${sessionId}/${tag}${ext}`;

      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (error) {
        console.error("Photo upload error:", error);
        return res.status(502).json({ message: "Photo upload failed" });
      }

      const photo = await storage.createPhoto({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        storagePath,
        autoTag: tag,
        caption: caption || null,
        photoType: photoType || null,
      });

      if (roomId) {
        await storage.incrementRoomPhotoCount(roomId);
      }

      res.status(201).json({ photoId: photo.id, storagePath: photo.storagePath });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/photos", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const photos = await storage.getPhotos(sessionId);
      const photosWithUrls = await Promise.all(photos.map(async (photo) => {
        let signedUrl = null;
        if (photo.storagePath) {
          const { data } = await supabase.storage
            .from(PHOTOS_BUCKET)
            .createSignedUrl(photo.storagePath, 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        }
        return { ...photo, signedUrl };
      }));
      res.json(photosWithUrls);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // DELETE /api/inspection/:sessionId/photos/:photoId
  app.delete("/api/inspection/:sessionId/photos/:photoId", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(param(req.params.photoId));
      if (isNaN(photoId)) {
        return res.status(400).json({ message: "Invalid photoId" });
      }
      const deleted = await storage.deletePhoto(photoId);
      if (!deleted) return res.status(404).json({ message: "Photo not found" });

      if (deleted.storagePath) {
        await supabase.storage.from(PHOTOS_BUCKET).remove([deleted.storagePath]);
      }

      if (deleted.roomId) {
        const room = await storage.getRoom(deleted.roomId);
        if (room && (room.photoCount || 0) > 0) {
          await storage.updateRoom(deleted.roomId, { photoCount: (room.photoCount || 1) - 1 });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/inspection/:sessionId/photos/:photoId/analyze
  app.post("/api/inspection/:sessionId/photos/:photoId/analyze", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(param(req.params.photoId));
      if (isNaN(photoId)) {
        return res.status(400).json({ message: "Invalid photoId" });
      }
      const { imageBase64, expectedLabel, expectedPhotoType } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }

      // Call GPT-4o Vision to analyze the photo
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          messages: [
            {
              role: "system",
              content: `You are an insurance property inspection photo analyst. Analyze this photo and provide:
1. A brief description of what you see (1-2 sentences)
2. Any visible damage (type, severity, location in frame)
3. Whether this photo matches the expected capture: "${expectedLabel}" (type: ${expectedPhotoType})
4. Photo quality assessment (lighting, focus, framing)
Respond in JSON format:
{
  "description": "string",
  "damageVisible": [{ "type": "string", "severity": "string", "notes": "string" }],
  "matchesExpected": true/false,
  "matchConfidence": 0.0-1.0,
  "matchExplanation": "string",
  "qualityScore": 1-5,
  "qualityNotes": "string"
}`
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: imageBase64,
                    detail: "high"
                  }
                },
                {
                  type: "text",
                  text: `This photo was requested as: "${expectedLabel}" (type: ${expectedPhotoType}). Analyze it.`
                }
              ]
            }
          ],
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      });

      if (!openaiRes.ok) {
        const errBody = await openaiRes.text();
        console.error("Vision API error:", errBody);
        // Return a graceful fallback — don't block the workflow
        const fallbackAnalysis = {
          description: "Photo captured successfully. AI analysis unavailable.",
          damageVisible: [],
          matchesExpected: true,
          matchConfidence: 0.5,
          matchExplanation: "Analysis unavailable — assuming match.",
          qualityScore: 3,
          qualityNotes: "Unable to assess",
        };
        // Still save the fallback analysis
        await storage.updatePhoto(photoId, {
          analysis: fallbackAnalysis,
          matchesRequest: true,
        });
        return res.json(fallbackAnalysis);
      }

      const visionData = await openaiRes.json();
      const analysisText = visionData.choices?.[0]?.message?.content || "{}";

      let analysis: any;
      try {
        analysis = JSON.parse(analysisText);
      } catch {
        analysis = {
          description: analysisText,
          damageVisible: [],
          matchesExpected: true,
          matchConfidence: 0.5,
          matchExplanation: "Parse error — raw response stored.",
          qualityScore: 3,
          qualityNotes: "",
        };
      }

      // Update the photo record with analysis
      await storage.updatePhoto(photoId, {
        analysis,
        matchesRequest: analysis.matchesExpected ?? true,
      });

      res.json(analysis);
    } catch (error: any) {
      console.error("Photo analysis error:", error);
      // Don't block the workflow on analysis failure
      res.json({
        description: "Photo captured. Analysis failed.",
        damageVisible: [],
        matchesExpected: true,
        matchConfidence: 0.5,
        matchExplanation: "Analysis error — photo saved without analysis.",
        qualityScore: 3,
        qualityNotes: error.message,
      });
    }
  });

  // ── Moisture Readings ─────────────────────────────

  app.post("/api/inspection/:sessionId/moisture", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { roomId, location, reading, materialType, dryStandard } = req.body;
      if (!roomId || reading === undefined) {
        return res.status(400).json({ message: "roomId and reading are required" });
      }
      const entry = await storage.createMoistureReading({
        sessionId,
        roomId,
        location: location || null,
        reading,
        materialType: materialType || null,
        dryStandard: dryStandard || null,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/moisture", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const readings = roomId
        ? await storage.getMoistureReadings(roomId)
        : await storage.getMoistureReadingsForSession(sessionId);
      res.json(readings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Transcript ────────────────────────────────────

  app.post("/api/inspection/:sessionId/transcript", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { speaker, content } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ message: "speaker and content are required" });
      }
      const entry = await storage.addTranscript({ sessionId, speaker, content });
      res.status(201).json(entry);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/transcript", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const transcript = await storage.getTranscript(sessionId);
      res.json(transcript);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Inspection Flows (Peril-Specific Workflows) ───

  const flowBodySchema = z.object({
    name: z.string().min(1),
    perilType: z.string().min(1),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    steps: z.array(z.object({
      id: z.string(),
      phaseName: z.string(),
      agentPrompt: z.string(),
      requiredTools: z.array(z.string()),
      completionCriteria: z.string(),
    })),
  });

  app.get("/api/flows", authenticateRequest, async (req, res) => {
    try {
      const { perilType } = req.query;
      let flows = await storage.getInspectionFlows(req.user!.id);
      if (perilType && typeof perilType === "string") {
        flows = flows.filter(f => f.perilType === perilType);
      }
      res.json(flows);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/flows/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const flow = await storage.getInspectionFlow(id);
      if (!flow) return res.status(404).json({ message: "Flow not found" });
      res.json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/flows", authenticateRequest, async (req, res) => {
    try {
      const parsed = flowBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid flow data", errors: parsed.error.issues });
      }
      const flow = await storage.createInspectionFlow({
        ...parsed.data,
        userId: req.user!.id,
        isSystemDefault: false,
      });
      res.status(201).json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/flows/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getInspectionFlow(id);
      if (!existing) return res.status(404).json({ message: "Flow not found" });

      // Prevent editing system defaults directly — users should clone them
      if (existing.isSystemDefault && existing.userId !== req.user!.id) {
        return res.status(403).json({ message: "Cannot edit system default flows. Clone it first." });
      }

      const parsed = flowBodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid flow data", errors: parsed.error.issues });
      }

      const flow = await storage.updateInspectionFlow(id, parsed.data);
      res.json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/flows/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getInspectionFlow(id);
      if (!existing) return res.status(404).json({ message: "Flow not found" });
      if (existing.isSystemDefault) {
        return res.status(403).json({ message: "Cannot delete system default flows" });
      }
      if (existing.userId !== req.user!.id) {
        return res.status(403).json({ message: "Cannot delete flows owned by other users" });
      }
      await storage.deleteInspectionFlow(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Clone a system default flow into a user's custom flow
  app.post("/api/flows/:id/clone", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const source = await storage.getInspectionFlow(id);
      if (!source) return res.status(404).json({ message: "Flow not found" });

      const cloneName = req.body.name || `${source.name} (Custom)`;
      const flow = await storage.createInspectionFlow({
        name: cloneName,
        perilType: source.perilType,
        description: source.description,
        isDefault: false,
        isSystemDefault: false,
        userId: req.user!.id,
        steps: source.steps as any,
      });
      res.status(201).json(flow);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── OpenAI Realtime Session ───────────────────────

  app.post("/api/realtime/session", authenticateRequest, async (req, res) => {
    try {
      const { claimId, sessionId } = req.body;
      if (!claimId) {
        return res.status(400).json({ message: "claimId is required" });
      }

      const claim = await storage.getClaim(claimId);
      const briefing = await storage.getBriefing(claimId);
      if (!claim || !briefing) {
        return res.status(400).json({ message: "Claim or briefing not found" });
      }

      // Load user preferences for voice configuration
      const userSettings = await storage.getUserSettings(req.user!.id);
      const s = (userSettings?.settings as Record<string, any>) || {};

      // Load the appropriate inspection flow based on the claim's peril type
      const perilType = claim.perilType || "General";
      const flowId = req.body.flowId ? parseInt(req.body.flowId) : undefined;
      let inspectionFlow;
      if (flowId) {
        // User explicitly selected a flow
        inspectionFlow = await storage.getInspectionFlow(flowId);
      } else {
        // Auto-select based on peril type
        inspectionFlow = await storage.getDefaultFlowForPeril(perilType, req.user!.id);
      }

      // Voice model — user can choose between available models
      const voiceModel = s.voiceModel || 'alloy';

      // VAD sensitivity mapping
      const vadConfig = {
        low:    { threshold: 0.85, silence_duration_ms: 1200, prefix_padding_ms: 600 },
        medium: { threshold: 0.75, silence_duration_ms: 800,  prefix_padding_ms: 400 },
        high:   { threshold: 0.60, silence_duration_ms: 500,  prefix_padding_ms: 300 },
      };
      const sensitivity = (s.silenceDetectionSensitivity || 'medium') as keyof typeof vadConfig;
      const vad = vadConfig[sensitivity] || vadConfig.medium;

      // Verbosity hint — inject into system instructions
      let verbosityHint = '';
      if (s.assistantVerbosity === 'concise') {
        verbosityHint = '\n\nIMPORTANT: Be extremely concise. Short sentences. Skip pleasantries. Just facts and actions.';
      } else if (s.assistantVerbosity === 'detailed') {
        verbosityHint = '\n\nThe adjuster prefers detailed explanations. Narrate what you observe, explain your reasoning for suggested items, and provide thorough guidance at each step.';
      }

      const instructions = buildSystemInstructions(briefing, claim, inspectionFlow || undefined) + verbosityHint;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "OpenAI API key not configured" });
      }

      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview",
          voice: voiceModel,
          instructions,
          tools: realtimeTools,
          input_audio_transcription: { model: "whisper-1", language: "en" },
          modalities: ["audio", "text"],
          turn_detection: s.pushToTalk
            ? null
            : {
                type: "server_vad",
                threshold: vad.threshold,
                prefix_padding_ms: vad.prefix_padding_ms,
                silence_duration_ms: vad.silence_duration_ms,
              },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Realtime session error:", data);
        return res.status(500).json({ message: "Failed to create Realtime session", details: data });
      }

      logger.voiceSession("created", { claimId, sessionId, voiceModel, flowId: inspectionFlow?.id });

      if (sessionId) {
        await storage.updateSession(sessionId, { voiceSessionId: data.id });
      }

      let transcriptSummary: string | null = null;
      if (sessionId) {
        try {
          const transcripts = await storage.getTranscript(sessionId);
          if (transcripts.length > 0) {
            const recentEntries = transcripts.slice(-80);
            const lines = recentEntries.map(t => `${t.speaker === "user" ? "Adjuster" : "Agent"}: ${t.content}`);
            let summary = lines.join("\n");
            if (summary.length > 12000) {
              summary = summary.slice(-12000);
              const firstNewline = summary.indexOf("\n");
              if (firstNewline > 0) summary = summary.slice(firstNewline + 1);
            }
            transcriptSummary = summary;
          }
        } catch (e) {
          logger.error("Failed to build transcript summary", e);
        }
      }

      res.json({
        clientSecret: data.client_secret.value,
        sessionId,
        transcriptSummary,
        activeFlow: inspectionFlow ? {
          id: inspectionFlow.id,
          name: inspectionFlow.name,
          perilType: inspectionFlow.perilType,
          stepCount: (inspectionFlow.steps as any[])?.length || 0,
        } : null,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Completeness Check ────────────────────────────

  app.get("/api/inspection/:sessionId/completeness", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const allPhotos = await storage.getPhotos(sessionId);
      const allDamages = await storage.getDamagesForSession(sessionId);
      const moistureReadings = await storage.getMoistureReadingsForSession(sessionId);

      const perilType = claim?.perilType || "unknown";
      const checklist: Array<{ item: string; satisfied: boolean; evidence?: string }> = [];

      // Universal items
      checklist.push({
        item: "Property overview photos (4 corners)",
        satisfied: allPhotos.filter(p => p.photoType === "overview").length >= 4,
        evidence: `${allPhotos.filter(p => p.photoType === "overview").length} overview photos`,
      });
      checklist.push({
        item: "At least one room/area documented",
        satisfied: rooms.length > 0,
        evidence: `${rooms.length} rooms created`,
      });
      checklist.push({
        item: "At least one damage observation recorded",
        satisfied: allDamages.length > 0,
        evidence: `${allDamages.length} damage observations`,
      });
      checklist.push({
        item: "At least one line item in estimate",
        satisfied: allLineItems.length > 0,
        evidence: `${allLineItems.length} line items`,
      });

      // Peril-specific items
      if (perilType === "hail") {
        const testSquarePhotos = allPhotos.filter(p => p.photoType === "test_square");
        checklist.push({
          item: "Roof test square photos",
          satisfied: testSquarePhotos.length >= 2,
          evidence: `${testSquarePhotos.length} test square photos`,
        });
        checklist.push({
          item: "Soft metal inspection documented (gutters, AC, vents)",
          satisfied: allDamages.some(d => d.damageType === "dent" || d.damageType === "hail_impact"),
          evidence: allDamages.filter(d => d.damageType === "dent" || d.damageType === "hail_impact").length > 0
            ? "Hail/dent damage recorded" : undefined,
        });
      }

      if (perilType === "wind" || perilType === "hail") {
        const elevationRooms = rooms.filter(r => r.roomType?.startsWith("exterior_elevation_"));
        checklist.push({
          item: "All four elevations documented",
          satisfied: elevationRooms.length >= 4,
          evidence: elevationRooms.length > 0
            ? `${elevationRooms.length} elevations: ${elevationRooms.map(r => r.name).join(", ")}`
            : undefined,
        });
        const roofRooms = rooms.filter(r => r.roomType === "exterior_roof_slope");
        checklist.push({
          item: "Roof slopes documented",
          satisfied: roofRooms.length >= 2,
          evidence: roofRooms.length > 0
            ? `${roofRooms.length} slopes: ${roofRooms.map(r => r.name).join(", ")}`
            : undefined,
        });
      }

      if (perilType === "water") {
        checklist.push({
          item: "Moisture readings recorded",
          satisfied: moistureReadings.length >= 3,
          evidence: `${moistureReadings.length} moisture readings`,
        });
        checklist.push({
          item: "Water entry point documented",
          satisfied: allDamages.some(d => d.damageType === "water_intrusion"),
          evidence: allDamages.some(d => d.damageType === "water_intrusion")
            ? "Water intrusion recorded" : undefined,
        });
      }

      // Scope gap detection
      const scopeGaps: Array<{ room: string; issue: string }> = [];
      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        const roomItems = allLineItems.filter(li => li.roomId === room.id);
        if (roomDamages.length > 0 && roomItems.length === 0) {
          scopeGaps.push({
            room: room.name,
            issue: `${roomDamages.length} damage observation(s) but no line items`,
          });
        }
      }

      // Missing photo alerts
      const missingPhotos: Array<{ room: string; issue: string }> = [];
      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        const roomPhotos = allPhotos.filter(p => p.roomId === room.id);
        if (roomDamages.length > 0 && roomPhotos.length === 0) {
          missingPhotos.push({
            room: room.name,
            issue: `${roomDamages.length} damage(s) documented but no photos`,
          });
        }
      }

      const satisfiedCount = checklist.filter(c => c.satisfied).length;
      const completenessScore = checklist.length > 0
        ? Math.round((satisfiedCount / checklist.length) * 100) : 0;

      res.json({
        completenessScore,
        checklist,
        scopeGaps,
        missingPhotos,
        summary: {
          totalRooms: rooms.length,
          completedRooms: rooms.filter(r => r.status === "complete").length,
          totalDamages: allDamages.length,
          totalLineItems: allLineItems.length,
          totalPhotos: allPhotos.length,
          totalMoistureReadings: moistureReadings.length,
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Xactimate-Style Estimate by Room ────────────────

  app.get("/api/inspection/:sessionId/estimate-by-room", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getLineItems(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const roomSections = rooms.map(room => {
        const d = room.dimensions as any;
        const length = d?.length || 0;
        const width = d?.width || 0;
        const height = d?.height || 8;
        const floorArea = length * width;
        const perimeter = 2 * (length + width);
        const wallArea = perimeter * height;
        const ceilingArea = floorArea;

        const measurements = floorArea > 0 ? {
          sfWalls: parseFloat(wallArea.toFixed(2)),
          sfCeiling: parseFloat(ceilingArea.toFixed(2)),
          sfWallsAndCeiling: parseFloat((wallArea + ceilingArea).toFixed(2)),
          sfFloor: parseFloat(floorArea.toFixed(2)),
          syFlooring: parseFloat((floorArea / 9).toFixed(2)),
          lfFloorPerimeter: parseFloat(perimeter.toFixed(2)),
          lfCeilPerimeter: parseFloat(perimeter.toFixed(2)),
        } : null;

        const roomItems = items.filter(i => i.roomId === room.id);
        const roomTotal = roomItems.reduce((s, i) => s + (i.totalPrice || 0), 0);
        const roomTax = roomItems.reduce((s, i) => {
          const qty = i.quantity || 0;
          const up = i.unitPrice || 0;
          const tp = i.totalPrice || 0;
          const laborMaterial = qty * up;
          return s + Math.max(0, tp - laborMaterial);
        }, 0);

        return {
          id: room.id,
          name: room.name,
          roomType: room.roomType,
          structure: room.structure || "Main Dwelling",
          dimensions: { length, width, height },
          measurements,
          items: roomItems.map((item, idx) => ({
            lineNumber: idx + 1,
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            action: item.action,
            xactCode: item.xactCode,
            unitPrice: item.unitPrice || 0,
            totalPrice: item.totalPrice || 0,
          })),
          subtotal: parseFloat(roomTotal.toFixed(2)),
          status: room.status,
          damageCount: room.damageCount || 0,
          photoCount: room.photoCount || 0,
        };
      });

      const grandTotal = roomSections.reduce((s, r) => s + r.subtotal, 0);

      res.json({
        rooms: roomSections,
        grandTotal: parseFloat(grandTotal.toFixed(2)),
        totalLineItems: items.length,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Grouped Estimate ────────────────────────────────

  app.get("/api/inspection/:sessionId/estimate-grouped", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const items = await storage.getLineItems(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const hierarchy: Record<string, Record<string, any[]>> = {};

      for (const item of items) {
        const category = item.category || "General";
        const room = rooms.find(r => r.id === item.roomId);
        const roomName = room ? room.name : "Unassigned";

        if (!hierarchy[category]) hierarchy[category] = {};
        if (!hierarchy[category][roomName]) hierarchy[category][roomName] = [];
        hierarchy[category][roomName].push(item);
      }

      const categories = Object.entries(hierarchy).map(([category, roomGroups]) => {
        const roomEntries = Object.entries(roomGroups).map(([roomName, roomItems]) => ({
          roomName,
          items: roomItems,
          subtotal: roomItems.reduce((s: number, i: any) => s + (i.totalPrice || 0), 0),
        }));
        return {
          category,
          rooms: roomEntries,
          subtotal: roomEntries.reduce((s, r) => s + r.subtotal, 0),
        };
      });

      const estimateSummary = await storage.getEstimateSummary(sessionId);

      res.json({ categories, ...estimateSummary });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photos Grouped by Room ──────────────────────────

  app.get("/api/inspection/:sessionId/photos-grouped", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const photos = await storage.getPhotos(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const photosWithUrls = await Promise.all(photos.map(async (photo) => {
        let signedUrl = null;
        if (photo.storagePath) {
          const { data } = await supabase.storage
            .from(PHOTOS_BUCKET)
            .createSignedUrl(photo.storagePath, 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        }
        return { ...photo, signedUrl };
      }));

      const grouped: Record<string, any[]> = {};
      for (const photo of photosWithUrls) {
        const room = rooms.find(r => r.id === photo.roomId);
        const roomName = room ? room.name : "General";
        if (!grouped[roomName]) grouped[roomName] = [];
        grouped[roomName].push(photo);
      }

      res.json({
        groups: Object.entries(grouped).map(([roomName, roomPhotos]) => ({
          roomName,
          photos: roomPhotos,
          count: roomPhotos.length,
        })),
        totalPhotos: photosWithUrls.length,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Export Validation ───────────────────────────────

  app.post("/api/inspection/:sessionId/export/validate", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const rooms = await storage.getRooms(sessionId);
      const items = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const warnings: string[] = [];
      const blockers: string[] = [];

      if (items.length === 0) warnings.push("No line items in estimate");
      if (photos.length === 0) warnings.push("No photos captured");
      if (rooms.filter(r => r.status === "complete").length === 0) {
        warnings.push("No rooms marked as complete");
      }

      const missingQty = items.filter(i => !i.quantity || i.quantity <= 0);
      if (missingQty.length > 0) {
        warnings.push(`${missingQty.length} line item(s) missing quantity`);
      }

      res.json({
        canExport: blockers.length === 0,
        blockers,
        warnings,
        summary: {
          lineItemCount: items.length,
          photoCount: photos.length,
          roomCount: rooms.length,
          completedRooms: rooms.filter(r => r.status === "complete").length,
        },
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── ESX Export (Xactimate-compatible ZIP) ────────────

  app.post("/api/inspection/:sessionId/export/esx", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const esxBuffer = await generateESXFile(sessionId, storage);

      const fileName = `${claim?.claimNumber || "estimate"}_export.esx`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(esxBuffer);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── AI Estimate Review ──────────────────────────────

  app.post("/api/inspection/:sessionId/review/ai", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const review = await reviewEstimate(sessionId, storage);
      res.json(review);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── PDF Export Data ─────────────────────────────────

  app.post("/api/inspection/:sessionId/export/pdf", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      // Load user export preferences
      const userSettings = await storage.getUserSettings(req.user!.id);
      const exportPrefs = (userSettings?.settings as Record<string, any>) || {};

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const items = await storage.getLineItems(sessionId);
      const photos = exportPrefs.includePhotosInExport !== false ? await storage.getPhotos(sessionId) : [];
      const damages = await storage.getDamagesForSession(sessionId);
      const moisture = await storage.getMoistureReadingsForSession(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);
      const transcript = exportPrefs.includeTranscriptInExport ? await storage.getTranscript(sessionId) : [];

      // Import the PDF generator
      const { generateInspectionPDF } = await import("./pdfGenerator");

      // Build categories from line items
      const categoryMap = new Map<string, typeof items>();
      for (const item of items) {
        const cat = item.category || "General";
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(item);
      }
      const categories = Array.from(categoryMap.entries()).map(([category, catItems]) => ({
        category,
        subtotal: catItems.reduce((sum, i) => sum + (i.totalPrice || 0), 0),
        items: catItems,
      }));

      // Build the data object for PDF generation
      const pdfData = {
        claim: claim || null,
        session,
        rooms,
        damages,
        lineItems: items,
        photos,
        moistureReadings: moisture,
        estimate: {
          totalRCV: estimate?.totalRCV || 0,
          totalDepreciation: estimate?.totalDepreciation || 0,
          totalACV: estimate?.totalACV || 0,
          itemCount: items.length,
          categories,
        },
        inspectorName: (await storage.getUser(req.user!.id))?.fullName || 'Claims IQ Agent',
        transcript,
        companyName: exportPrefs.companyName || 'Claims IQ',
        adjusterLicense: exportPrefs.adjusterLicenseNumber || '',
      };

      // Generate the PDF buffer
      const pdfBuffer = await generateInspectionPDF(pdfData);

      // Send as attachment
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_report.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("PDF generation error:", error);
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Report Export (PDF) ────────────────────────

  app.post("/api/inspection/:sessionId/export/photo-report/pdf", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const userSettings = await storage.getUserSettings(req.user!.id);
      const exportPrefs = (userSettings?.settings as Record<string, any>) || {};
      const inspectorName = (await storage.getUser(req.user!.id))?.fullName || "Claims IQ Agent";

      const { generatePhotoReportPDF } = await import("./photoReportGenerator");

      const pdfBuffer = await generatePhotoReportPDF({
        claim: claim || null,
        session,
        rooms,
        photos,
        inspectorName,
        companyName: exportPrefs.companyName || "Claims IQ",
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_photo_report.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Photo report PDF error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Report Export (DOCX) ───────────────────────

  app.post("/api/inspection/:sessionId/export/photo-report/docx", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const userSettings = await storage.getUserSettings(req.user!.id);
      const exportPrefs = (userSettings?.settings as Record<string, any>) || {};
      const inspectorName = (await storage.getUser(req.user!.id))?.fullName || "Claims IQ Agent";

      const { generatePhotoReportDOCX } = await import("./photoReportGenerator");

      const docxBuffer = await generatePhotoReportDOCX({
        claim: claim || null,
        session,
        rooms,
        photos,
        inspectorName,
        companyName: exportPrefs.companyName || "Claims IQ",
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_photo_report.docx"`
      );
      res.send(docxBuffer);
    } catch (error: any) {
      console.error("Photo report DOCX error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Annotations Endpoint ──────────────────────

  app.put("/api/inspection/:sessionId/photos/:photoId/annotations", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(param(req.params.photoId));
      const { shapes, annotatedImageBase64 } = req.body;

      if (!shapes || !Array.isArray(shapes)) {
        return res.status(400).json({ message: "shapes array is required" });
      }

      // Save annotation data to the photo record
      const updatedPhoto = await storage.updatePhoto(photoId, {
        annotations: shapes,
      });

      res.json({ success: true, photo: updatedPhoto });
    } catch (error: any) {
      console.error("Photo annotation save error:", error);
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Session Status Update ───────────────────────────

  app.patch("/api/inspection/:sessionId/status", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { status } = req.body;
      const validStatuses = ["active", "review", "exported", "submitted", "approved", "completed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const session = await storage.updateSessionStatus(sessionId, status);
      if (!session) return res.status(404).json({ message: "Session not found" });
      res.json(session);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Pricing Catalog Endpoints ──────────────────────────────

  app.get("/api/pricing/catalog", authenticateRequest, async (req, res) => {
    try {
      const items = await storage.getScopeLineItems();
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/pricing/catalog/search", authenticateRequest, async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase();
      if (!q) {
        return res.status(400).json({ message: "q parameter required" });
      }
      const allItems = await storage.getScopeLineItems();
      const filtered = allItems.filter(item =>
        item.code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
      res.json(filtered);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/pricing/catalog/:tradeCode", authenticateRequest, async (req, res) => {
    try {
      const tradeCode = param(req.params.tradeCode);
      const items = await storage.getScopeLineItemsByTrade(tradeCode);
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/pricing/scope", authenticateRequest, async (req, res) => {
    try {
      const { items, regionId, taxRate, overheadPercent, profitPercent } = req.body;

      // Fall back to user settings, then system defaults
      let effectiveRegion = regionId;
      let effectiveTaxRate = taxRate;
      let effectiveOverhead = overheadPercent;
      let effectiveProfit = profitPercent;

      if (!effectiveRegion || effectiveTaxRate == null || effectiveOverhead == null || effectiveProfit == null) {
        const userSettings = await storage.getUserSettings(req.user!.id);
        const s = userSettings?.settings as Record<string, any> | undefined;
        if (s) {
          if (!effectiveRegion) effectiveRegion = s.defaultRegion || 'US_NATIONAL';
          if (effectiveTaxRate == null) effectiveTaxRate = s.defaultTaxRate ?? 0.08;
          if (effectiveOverhead == null) effectiveOverhead = s.defaultOverheadPercent != null ? s.defaultOverheadPercent / 100 : undefined;
          if (effectiveProfit == null) effectiveProfit = s.defaultProfitPercent != null ? s.defaultProfitPercent / 100 : undefined;
        }
      }

      effectiveRegion = effectiveRegion || 'US_NATIONAL';
      effectiveTaxRate = effectiveTaxRate ?? 0.08;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array required" });
      }

      const pricedItems = [];

      for (const item of items) {
        const catalogItem = await storage.getScopeLineItemByCode(item.code);
        if (!catalogItem) {
          return res.status(404).json({ message: `Catalog item ${item.code} not found` });
        }
        const regionalPrice = await storage.getRegionalPrice(item.code, effectiveRegion);
        if (!regionalPrice) {
          return res.status(404).json({ message: `Regional price for ${item.code} in region ${effectiveRegion} not found` });
        }
        const priced = calculateLineItemPrice(catalogItem, regionalPrice, item.quantity, item.wasteFactor);
        pricedItems.push(priced);
      }

      const totals = calculateEstimateTotals(pricedItems, effectiveTaxRate, effectiveOverhead, effectiveProfit);

      res.json({ items: pricedItems, totals, appliedSettings: { region: effectiveRegion, taxRate: effectiveTaxRate } });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/pricing/validate", authenticateRequest, async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array required" });
      }

      const validation = await validateEstimate(items);

      res.json(validation);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/pricing/regions", authenticateRequest, async (req, res) => {
    try {
      const allPrices = await storage.getRegionalPricesForRegion("US_NATIONAL");
      const regions = new Set(allPrices.map(p => p.regionId));
      res.json({
        regions: Array.from(regions).sort(),
        available: Array.from(regions).length > 0,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // Pricing Catalog Seed
  app.post("/api/pricing/seed", authenticateRequest, requireRole("admin"), async (req, res) => {
    try {
      const { seedCatalog } = require("./seed-catalog");
      await seedCatalog();
      res.json({ message: "Catalog seeded successfully" });
    } catch (error: any) {
      if (error.message.includes("unique constraint") || error.message.includes("duplicate key")) {
        return res.json({ message: "Catalog already seeded" });
      }
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // Inspection Flows Seed
  app.post("/api/flows/seed", authenticateRequest, async (req, res) => {
    try {
      const { seedInspectionFlows } = require("./seed-flows");
      const count = await seedInspectionFlows();
      res.json({ message: `Inspection flows seeded/updated. ${count} new flows created.` });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Authentication Routes ──────────────────────────

  app.post("/api/auth/sync", authenticateSupabaseToken, async (req, res) => {
    try {
      const supabaseUser = (req as any).supabaseUser;
      const { supabaseId, email, fullName } = req.body;
      if (!supabaseId || !email) {
        return res.status(400).json({ message: "supabaseId and email required" });
      }
      if (supabaseUser.id !== supabaseId) {
        return res.status(403).json({ message: "Token does not match provided supabaseId" });
      }
      const user = await storage.syncSupabaseUser(supabaseId, email, fullName || "");
      res.json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        title: user.title,
        avatarUrl: user.avatarUrl,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/auth/me", authenticateRequest, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      res.json({
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        role: req.user.role,
        title: req.user.title,
        avatarUrl: req.user.avatarUrl,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── User Profile ───────────────────────────────────

  const profileUpdateSchema = z.object({
    fullName: z.string().min(1).max(100).optional(),
    title: z.string().max(100).optional(),
    avatarUrl: z.string().url().max(2000).optional(),
  }).strict();

  app.patch("/api/profile", authenticateRequest, async (req, res) => {
    try {
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid profile data", errors: parsed.error.flatten().fieldErrors });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      const userId = req.user!.id;
      const updated = await storage.updateUserProfile(userId, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        role: updated.role,
        title: updated.title,
        avatarUrl: updated.avatarUrl,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const avatarUploadSchema = z.object({
    base64Data: z.string().min(1),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  });

  app.post("/api/profile/avatar", authenticateRequest, async (req, res) => {
    try {
      const parsed = avatarUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid avatar data" });
      }
      const userId = req.user!.id;
      const ext = parsed.data.mimeType === "image/png" ? "png" : parsed.data.mimeType === "image/webp" ? "webp" : "jpg";
      const storagePath = `avatars/${userId}/avatar.${ext}`;
      const fileBuffer = Buffer.from(parsed.data.base64Data, "base64");

      if (fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ message: "Avatar must be under 5MB" });
      }

      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: parsed.data.mimeType,
          upsert: true,
        });
      if (error) throw new Error(`Avatar upload failed: ${error.message}`);

      const { data: signedUrlData, error: signError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      if (signError) throw new Error(`Failed to create signed URL: ${signError.message}`);

      const avatarUrl = signedUrlData.signedUrl;
      const updated = await storage.updateUserProfile(userId, { avatarUrl });
      res.json({
        id: updated!.id,
        fullName: updated!.fullName,
        email: updated!.email,
        role: updated!.role,
        title: updated!.title,
        avatarUrl: updated!.avatarUrl,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Notifications (derived from activity) ──────────

  app.get("/api/notifications", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const notifications: Array<{
        id: string;
        type: string;
        title: string;
        message: string;
        claimId?: number;
        timestamp: string;
        read: boolean;
      }> = [];

      const userClaims = await storage.getClaimsForUser(userId);
      const allClaims = req.user!.role === "admin" || req.user!.role === "supervisor"
        ? await storage.getClaims()
        : userClaims;

      for (const claim of allClaims.slice(0, 20)) {
        if (claim.status === "in_progress") {
          const activeSession = await storage.getActiveSessionForClaim(claim.id);
          if (activeSession) {
            notifications.push({
              id: `session-active-${activeSession.id}`,
              type: "inspection",
              title: "Inspection In Progress",
              message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} has an active inspection session.`,
              claimId: claim.id,
              timestamp: (activeSession.startedAt || claim.updatedAt || claim.createdAt || new Date()).toISOString(),
              read: false,
            });
          }
        }

        if (claim.status === "review") {
          notifications.push({
            id: `claim-review-${claim.id}`,
            type: "review",
            title: "Ready for Review",
            message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} is ready for review.`,
            claimId: claim.id,
            timestamp: (claim.updatedAt || claim.createdAt || new Date()).toISOString(),
            read: false,
          });
        }

        const hoursSinceUpdate = claim.updatedAt
          ? (Date.now() - new Date(claim.updatedAt).getTime()) / (1000 * 60 * 60)
          : Infinity;
        if (claim.status === "draft" && hoursSinceUpdate < 48) {
          notifications.push({
            id: `claim-new-${claim.id}`,
            type: "new_claim",
            title: "New Claim Created",
            message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} needs documents uploaded.`,
            claimId: claim.id,
            timestamp: (claim.createdAt || new Date()).toISOString(),
            read: false,
          });
        }
      }

      notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json(notifications.slice(0, 15));
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── User Settings ──────────────────────────────────

  app.get("/api/settings", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const settings = await storage.getUserSettings(userId);
      res.json(settings || {});
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const settingsBodySchema = z.object({
    voiceModel: z.string().optional(),
    voiceSpeed: z.number().optional(),
    assistantVerbosity: z.enum(["concise", "normal", "detailed"]).optional(),
    pushToTalk: z.boolean().optional(),
    autoRecordOnRoomEntry: z.boolean().optional(),
    silenceDetectionSensitivity: z.enum(["low", "medium", "high"]).optional(),
    defaultRegion: z.string().optional(),
    defaultOverheadPercent: z.number().optional(),
    defaultProfitPercent: z.number().optional(),
    defaultTaxRate: z.number().optional(),
    defaultWasteFactor: z.number().optional(),
    measurementUnit: z.enum(["imperial", "metric"]).optional(),
    autoGenerateBriefing: z.boolean().optional(),
    requirePhotoVerification: z.boolean().optional(),
    photoQuality: z.enum(["low", "medium", "high"]).optional(),
    autoAnalyzePhotos: z.boolean().optional(),
    timestampWatermark: z.boolean().optional(),
    gpsTagging: z.boolean().optional(),
    companyName: z.string().optional(),
    adjusterLicenseNumber: z.string().optional(),
    includeTranscriptInExport: z.boolean().optional(),
    includePhotosInExport: z.boolean().optional(),
    exportFormat: z.enum(["esx", "pdf", "both"]).optional(),
    pushNotifications: z.boolean().optional(),
    soundEffects: z.boolean().optional(),
    claimStatusAlerts: z.boolean().optional(),
    inspectionReminders: z.boolean().optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    compactMode: z.boolean().optional(),
    fontSize: z.enum(["small", "medium", "large"]).optional(),
    showPhaseNumbers: z.boolean().optional(),
  }).strict();

  app.put("/api/settings", authenticateRequest, async (req, res) => {
    try {
      const parsed = settingsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten().fieldErrors });
      }
      const userId = req.user!.id;
      const result = await storage.upsertUserSettings(userId, parsed.data);
      res.json(result.settings);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Admin / Supervisor Routes ──────────────────────

  app.get("/api/admin/users", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allClaims = await storage.getClaims();
      // Build a map of userId -> count of active claims (non-completed/non-closed)
      const activeClaimCounts = new Map<string, number>();
      for (const claim of allClaims) {
        if (claim.assignedTo && claim.status !== "completed" && claim.status !== "closed") {
          activeClaimCounts.set(claim.assignedTo, (activeClaimCounts.get(claim.assignedTo) || 0) + 1);
        }
      }
      const teamMembers = allUsers
        .filter((u) => u.role === "adjuster" || u.role === "supervisor")
        .map((u) => ({
          id: u.id,
          fullName: u.fullName || u.username,
          email: u.email,
          role: u.role,
          activeClaims: activeClaimCounts.get(u.id) || 0,
        }));
      res.json(teamMembers);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/claims/assign", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const { claimId, userId } = req.body;
      if (!claimId || !userId) {
        return res.status(400).json({ message: "claimId and userId required" });
      }
      const claim = await storage.updateClaimFields(claimId, { assignedTo: userId });
      res.json(claim);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/dashboard", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const allClaims = await storage.getClaims();
      const sessions = await Promise.all(
        allClaims.map((c) => storage.getActiveSessionForClaim(c.id))
      );
      const activeSessions = sessions.filter((s) => s !== undefined).length;

      let totalEstimateValue = 0;
      const completedSessions = sessions.filter(Boolean);
      for (const session of completedSessions) {
        if (session) {
          const summary = await storage.getEstimateSummary(session.id);
          totalEstimateValue += summary.totalRCV;
        }
      }

      let avgInspectionTime = 0;
      const completedWithTimes = completedSessions.filter(
        (s) => s && s.completedAt && s.startedAt
      );
      if (completedWithTimes.length > 0) {
        const totalMinutes = completedWithTimes.reduce((sum, s) => {
          const start = new Date(s!.startedAt!).getTime();
          const end = new Date(s!.completedAt!).getTime();
          return sum + (end - start) / 60000;
        }, 0);
        avgInspectionTime = Math.round(totalMinutes / completedWithTimes.length);
      }

      res.json({
        totalClaims: allClaims.length,
        activeSessions,
        avgInspectionTime,
        totalEstimateValue,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/active-sessions", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const allSessions = [];
      const allClaims = await storage.getClaims();
      for (const claim of allClaims) {
        const session = await storage.getActiveSessionForClaim(claim.id);
        if (session) {
          const inspector = session.inspectorId ? await storage.getUser(session.inspectorId) : null;
          allSessions.push({
            id: session.id,
            claimNumber: claim.claimNumber,
            claimId: claim.id,
            adjusterName: inspector?.fullName || "Unknown",
            currentPhase: session.currentPhase,
            status: session.status,
            startedAt: session.startedAt,
          });
        }
      }
      res.json(allSessions);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Supplemental Claims ─────────────────────────────

  app.post("/api/inspection/:sessionId/supplemental", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const { reason, newLineItems, removedLineItemIds, modifiedLineItems } = req.body;

      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const supplemental = await storage.createSupplementalClaim({
        originalSessionId: sessionId,
        claimId: session.claimId,
        reason,
        newLineItems,
        removedLineItemIds,
        modifiedLineItems,
        status: "draft",
      });

      res.json(supplemental);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/supplementals", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(param(req.params.sessionId));
      const supplementals = await storage.getSupplementalsForSession(sessionId);
      res.json(supplementals);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/supplemental/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const allowedFields = z.object({
        reason: z.string().optional(),
        newLineItems: z.any().optional(),
        removedLineItemIds: z.any().optional(),
        modifiedLineItems: z.any().optional(),
        status: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
      }).strict();
      const parsed = allowedFields.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update fields", errors: parsed.error.flatten() });
      }
      const supplemental = await storage.updateSupplemental(id, parsed.data);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });
      res.json(supplemental);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/supplemental/:id/submit", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const supplemental = await storage.submitSupplemental(id);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });
      res.json(supplemental);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/supplemental/:id/export/esx", authenticateRequest, async (req, res) => {
    try {
      const supplementalId = parseInt(param(req.params.id));
      const supplemental = await storage.getSupplemental(supplementalId);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });

      const session = await storage.getInspectionSession(supplemental.originalSessionId);
      if (!session) return res.status(404).json({ message: "Original session not found" });

      const claim = await storage.getClaim(supplemental.claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found" });

      const rooms = await storage.getRooms(supplemental.originalSessionId);

      // Build delta line items: new + modified only
      const newItems = (supplemental.newLineItems as any[]) || [];
      const modifiedItems = (supplemental.modifiedLineItems as any[]) || [];
      const removedIds = new Set((supplemental.removedLineItemIds as number[]) || []);

      // Combine new + modified into a single line item array for ESX generation
      const deltaLineItems = [
        ...newItems.map((item: any) => ({
          ...item,
          id: item.id || 0,
          sessionId: supplemental.originalSessionId,
          provenance: 'supplemental_new' as const,
        })),
        ...modifiedItems.map((item: any) => ({
          ...item,
          sessionId: supplemental.originalSessionId,
          provenance: 'supplemental_modified' as const,
        })),
      ];

      if (deltaLineItems.length === 0) {
        return res.status(400).json({
          message: "No new or modified line items in this supplemental — nothing to export",
        });
      }

      const { generateESXFromData } = await import("./esxGenerator");

      // Generate ESX with supplemental metadata
      const esxBuffer = await generateESXFromData({
        claim,
        session,
        rooms,
        lineItems: deltaLineItems,
        isSupplemental: true,
        supplementalReason: supplemental.reason || 'Supplemental claim',
        removedItemIds: Array.from(removedIds),
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim.claimNumber || 'claim'}_supplemental_${supplementalId}.esx"`,
      );
      res.send(esxBuffer);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/logs/voice-tool", authenticateRequest, async (req, res) => {
    try {
      const { toolName, type, data } = req.body;
      if (type === "call") {
        logger.voiceToolCall(toolName, data);
      } else if (type === "result") {
        logger.voiceToolResult(toolName, data);
      } else if (type === "error") {
        logger.voiceToolError(toolName, data);
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: "Log write failed" });
    }
  });

  // ── Gallery: All Photos Across Claims ──────────────────────────
  app.get("/api/gallery/photos", authenticateRequest, async (req, res) => {
    try {
      const allClaims = await db.select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        insuredName: claims.insuredName,
        propertyAddress: claims.propertyAddress,
      }).from(claims).orderBy(desc(claims.id));

      const result: any[] = [];
      for (const claim of allClaims) {
        const sessions = await db.select({ id: inspectionSessions.id })
          .from(inspectionSessions)
          .where(eq(inspectionSessions.claimId, claim.id));

        let claimPhotos: any[] = [];
        for (const session of sessions) {
          const photos = await db.select().from(inspectionPhotos)
            .where(eq(inspectionPhotos.sessionId, session.id))
            .orderBy(desc(inspectionPhotos.createdAt));

          for (const photo of photos) {
            let signedUrl = null;
            if (photo.storagePath) {
              const { data } = await supabase.storage
                .from(PHOTOS_BUCKET)
                .createSignedUrl(photo.storagePath, 3600);
              if (data?.signedUrl) signedUrl = data.signedUrl;
            }
            claimPhotos.push({ ...photo, signedUrl });
          }
        }

        if (claimPhotos.length > 0) {
          result.push({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            insuredName: claim.insuredName,
            propertyAddress: claim.propertyAddress,
            photos: claimPhotos,
          });
        }
      }
      res.json(result);
    } catch (error: any) {
      logger.apiError("GET", "/api/gallery/photos", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Gallery: All Sketches/Rooms Across Claims ──────────────────────────
  app.get("/api/gallery/sketches", authenticateRequest, async (req, res) => {
    try {
      const allClaims = await db.select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        insuredName: claims.insuredName,
        propertyAddress: claims.propertyAddress,
      }).from(claims).orderBy(desc(claims.id));

      const result: any[] = [];
      for (const claim of allClaims) {
        const sessions = await db.select({ id: inspectionSessions.id })
          .from(inspectionSessions)
          .where(eq(inspectionSessions.claimId, claim.id));

        if (sessions.length === 0) continue;

        let claimStructures: any[] = [];
        for (const session of sessions) {
          const sessionStructures = await db.select().from(structures)
            .where(eq(structures.sessionId, session.id));

          for (const struct of sessionStructures) {
            const rooms = await db.select().from(inspectionRooms)
              .where(eq(inspectionRooms.structureId, struct.id));
            claimStructures.push({
              ...struct,
              rooms: rooms.map(r => ({
                id: r.id,
                name: r.name,
                roomType: r.roomType,
                viewType: r.viewType,
                shapeType: r.shapeType,
                dimensions: r.dimensions,
                status: r.status,
                position: r.position,
              })),
            });
          }
        }

        if (claimStructures.length > 0) {
          result.push({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            insuredName: claim.insuredName,
            propertyAddress: claim.propertyAddress,
            sessionId: sessions[0].id,
            structures: claimStructures,
          });
        }
      }
      res.json(result);
    } catch (error: any) {
      logger.apiError("GET", "/api/gallery/sketches", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
