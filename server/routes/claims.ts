import { Router } from "express";
import { emit } from "../events";
import { storage } from "../storage";
import { supabase, DOCUMENTS_BUCKET, PHOTOS_BUCKET } from "../supabase";
import { authenticateRequest, requireRole } from "../auth";
import { extractFNOL, extractPolicy, extractEndorsements, generateBriefing } from "../openai";
import pdfParse from "pdf-parse";
import { param, parseIntParam, MAX_DOCUMENT_BYTES, decodeBase64Payload, uploadToSupabase, downloadFromSupabase } from "../utils";
import { logger } from "../logger";
import { z } from "zod";
import { getWeatherCorrelation } from "../weatherService";
import { initSessionWorkflow } from "../workflow/orchestrator";

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

const policyRuleUpdateSchema = z.object({
  coverageName: z.string().optional(),
  policyLimit: z.number().nonnegative().optional(),
  deductible: z.number().nonnegative().optional(),
  opRate: z.number().min(0).max(1).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  roofSchedule: z.boolean().optional(),
}).strict();

const taxRuleSchema = z.object({
  taxLabel: z.string().min(1).max(50),
  taxRate: z.number().nonnegative(),
  appliesToCategories: z.array(z.string()).default([]),
  appliesToCostType: z.enum(["material", "labor", "all"]).default("all"),
  isDefault: z.boolean().default(false),
});

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

async function ensurePolicyRules(claimId: number, userId?: string) {
  const existing = await storage.getPolicyRulesForClaim(claimId);
  if (existing.length > 0) return existing;

  let defaultOverhead = 10;
  let defaultProfit = 10;
  let defaultTax = 8;
  if (userId) {
    try {
      const userSettings = await storage.getUserSettings(userId);
      const s = (userSettings as Record<string, any>) || {};
      if (typeof s.defaultOverheadPercent === "number") defaultOverhead = s.defaultOverheadPercent;
      if (typeof s.defaultProfitPercent === "number") defaultProfit = s.defaultProfitPercent;
      if (typeof s.defaultTaxRate === "number") defaultTax = s.defaultTaxRate;
    } catch {}
  }

  const briefing = await storage.getBriefing(claimId);
  const coverage = briefing?.coverageSnapshot as any;

  const rules: Array<any> = [];
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

async function enrichClaimsWithProgress(claims: any[]) {
  return Promise.all(claims.map(async (claim) => {
    try {
      const [docs, sessions] = await Promise.all([
        storage.getDocuments(claim.id),
        storage.getInspectionSessionsForClaim(claim.id),
      ]);
      const activeSession = sessions.find(s => s.status === "active" || s.status === "in_progress") || sessions[0];

      let inspectionProgress = null;
      if (activeSession) {
        const [rooms, damages, lineItems, photos] = await Promise.all([
          storage.getRooms(activeSession.id),
          storage.getDamagesForSession(activeSession.id),
          storage.getLineItems(activeSession.id),
          storage.getPhotos(activeSession.id),
        ]);
        const currentPhase = (activeSession as any).currentPhase || 1;
        const totalPhases = 8;
        const completedRooms = rooms.filter(r => r.status === "complete").length;
        const totalRooms = rooms.length;

        const completedPhases = currentPhase - 1;
        const phaseComponent = (completedPhases / totalPhases) * 50;
        const roomRatio = totalRooms > 0 ? completedRooms / totalRooms : 0;
        const roomComponent = roomRatio * 30;
        let docScore = 0;
        if (totalRooms > 0) {
          const damageDepth = Math.min((damages.length / totalRooms) / 2, 1);
          const itemDepth = Math.min((lineItems.length / totalRooms) / 5, 1);
          const photoDepth = Math.min((photos.length / totalRooms) / 2, 1);
          docScore = (damageDepth * 0.3) + (itemDepth * 0.4) + (photoDepth * 0.3);
        }
        const docComponent = docScore * 20;
        const rawScore = phaseComponent + roomComponent + docComponent;
        const phaseCap = ((currentPhase / totalPhases) * 100) + 15;
        const completenessScore = Math.min(Math.round(rawScore), Math.round(phaseCap));

        const PHASE_NAMES = ["", "Pre-Inspection", "Setup", "Exterior", "Interior", "Moisture", "Evidence", "Estimate", "Finalize"];
        const missing: string[] = [];
        if (rooms.length === 0) missing.push("Add rooms");
        if (damages.length === 0) missing.push("Document damages");
        if (lineItems.length === 0) missing.push("Add line items");
        if (photos.length === 0) missing.push("Take photos");

        inspectionProgress = {
          sessionId: activeSession.id,
          completenessScore,
          currentPhase,
          phaseName: PHASE_NAMES[currentPhase] || "Unknown",
          totalPhases,
          totalRooms,
          completedRooms,
          damageCount: damages.length,
          lineItemCount: lineItems.length,
          photoCount: photos.length,
          missing: missing.slice(0, 2),
        };
      }

      return { ...claim, documentCount: docs.length, inspectionProgress };
    } catch {
      return { ...claim, documentCount: 0, inspectionProgress: null };
    }
  }));
}

export function claimsRouter(): Router {
  const router = Router();

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const claims = await storage.getClaims();
      const enriched = await enrichClaimsWithProgress(claims);
      res.json(enriched);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/my-claims", authenticateRequest, async (req: any, res) => {
    try {
      if (req.user) {
        const userClaims = await storage.getClaimsForUser(req.user.id);
        const enriched = await enrichClaimsWithProgress(userClaims);
        return res.json(enriched);
      }
      res.json([]);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/", authenticateRequest, async (req, res) => {
    try {
      const parsed = createClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid claim data", errors: parsed.error.flatten().fieldErrors });
      }
      const claimData = { ...parsed.data, assignedTo: req.user?.id ?? null };
      const claim = await storage.createClaim(claimData);
      emit({ type: "claim.created", claimId: claim.id, userId: req.user?.id });
      res.status(201).json(claim);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(param(req.params.id));
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await storage.getDocuments(id);
      const exts = await storage.getExtractions(id);
      const briefing = await storage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.patch("/:id", authenticateRequest, async (req: any, res) => {
    try {
      const id = parseIntParam(param(req.params.id), res, "claim id");
      if (id === null) return;

      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (req.user?.role !== "supervisor" && req.user?.role !== "admin" && claim.assignedTo !== req.user?.id) {
        return res.status(403).json({ message: "Not authorized to modify this claim" });
      }

      const { status, ...otherFields } = req.body;
      if (status) {
        const updated = await storage.updateClaimStatus(id, status);
        emit({ type: "claim.statusChanged", claimId: id, userId: req.user?.id, meta: { status } });
        return res.json(updated);
      }
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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.delete("/purge-all", authenticateRequest, requireRole("admin"), async (req, res) => {
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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.delete("/:id", authenticateRequest, async (req: any, res) => {
    try {
      const id = parseIntParam(param(req.params.id), res, "claim id");
      if (id === null) return;

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
      emit({ type: "claim.deleted", claimId: id, userId: req.user?.id });
      res.json({ message: "Claim and all related data deleted" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Policy Rules ───────────────────────────────

  router.post("/:claimId/policy-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.claimId));
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

  router.get("/:claimId/policy-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.claimId));
      const rules = await storage.getPolicyRulesForClaim(claimId);
      res.json(rules);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.patch("/:claimId/policy-rules/:ruleId", authenticateRequest, async (req, res) => {
    try {
      const ruleId = parseInt(param(req.params.ruleId));
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

  router.post("/:claimId/tax-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.claimId));
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

  router.get("/:claimId/tax-rules", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.claimId));
      const rules = await storage.getTaxRulesForClaim(claimId);
      res.json(rules);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.delete("/:claimId/tax-rules/:ruleId", authenticateRequest, async (req, res) => {
    try {
      const ruleId = parseInt(param(req.params.ruleId));
      await storage.deleteTaxRule(ruleId);
      res.json({ success: true });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Documents (claim-scoped) ────────────────────

  router.get("/:id/documents", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const docs = await storage.getDocuments(claimId);
      res.json(docs);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/documents/upload", authenticateRequest, async (req, res) => {
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
      emit({ type: "document.uploaded", documentId: doc.id, claimId, userId: req.user?.id });

      res.status(201).json({ documentId: doc.id, storagePath, status: "uploaded" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/documents/upload-batch", authenticateRequest, async (req, res) => {
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
      emit({ type: "document.uploaded", documentId: doc.id, claimId, userId: req.user?.id });

      res.status(201).json({ documentId: doc.id, storagePaths, fileCount: files.length, status: "uploaded" });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/documents/:type/parse", authenticateRequest, async (req, res) => {
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

      if (documentType === "fnol") {
        try {
          const fnolFields = claimFieldsFromFnol(extractResult.extractedData);
          if (Object.keys(fnolFields).length > 0) {
            await storage.updateClaimFields(claimId, fnolFields);
          }
        } catch (syncError: any) {
          logger.warn("FNOL", "Failed to sync FNOL fields to claim", { message: syncError.message });
        }
      }

      const allDocs = await storage.getDocuments(claimId);
      const allParsed = allDocs.length >= 3 && allDocs.every(d => d.status === "parsed");
      if (allParsed) {
        await storage.updateClaimStatus(claimId, "documents_uploaded");
      }

      res.json({ extraction, confidence: extractResult.confidence });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Extractions ─────────────────────────────────

  router.get("/:id/extractions", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const exts = await storage.getExtractions(claimId);
      res.json(exts);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id/extractions/:type", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const ext = await storage.getExtraction(claimId, param(req.params.type));
      if (!ext) return res.status(404).json({ message: "Extraction not found" });
      res.json(ext);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.put("/:id/extractions/:type", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const ext = await storage.getExtraction(claimId, param(req.params.type));
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      const updated = await storage.updateExtraction(ext.id, req.body.extractedData);
      await storage.confirmExtraction(ext.id);

      if (param(req.params.type) === "fnol") {
        const fnolFields = claimFieldsFromFnol(req.body.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      res.json(updated);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/extractions/:type/confirm", authenticateRequest, async (req, res) => {
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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/extractions/confirm-all", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const exts = await storage.getExtractions(claimId);
      for (const ext of exts) {
        await storage.confirmExtraction(ext.id);
      }

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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Briefing ───────────────────────────────────

  router.post("/:id/briefing/generate", authenticateRequest, async (req, res) => {
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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id/briefing", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const briefing = await storage.getBriefing(claimId);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Inspection Session Management ───────────────

  router.get("/:id/inspection/active", authenticateRequest, async (req, res) => {
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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:id/inspection/start", authenticateRequest, async (req: any, res) => {
    try {
      const claimId = parseInt(param(req.params.id));
      const existing = await storage.getActiveSessionForClaim(claimId);
      if (existing) {
        await ensurePolicyRules(claimId, req.user?.id);
        return res.json({ sessionId: existing.id, session: existing });
      }
      const session = await storage.createInspectionSession(claimId);
      const claim = await storage.getClaim(claimId);
      await initSessionWorkflow({ claimId, sessionId: session.id, peril: claim?.perilType || "General" });
      if (req.user?.id) {
        await storage.updateSession(session.id, { inspectorId: req.user.id });
      }
      await storage.updateClaimStatus(claimId, "inspecting");
      emit({ type: "inspection.started", sessionId: session.id, claimId, userId: req.user?.id });
      await ensurePolicyRules(claimId, req.user?.id);
      res.status(201).json({ sessionId: session.id, session });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id/weather-correlation", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseIntParam(param(req.params.id), res, "claimId");
      if (claimId === null) return;
      const claim = await storage.getClaim(claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found" });

      const apiKey = process.env.VISUAL_CROSSING_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "Weather API not configured. Please add a Visual Crossing API key." });
      }

      const correlation = await getWeatherCorrelation({
        propertyAddress: claim.propertyAddress,
        city: claim.city,
        state: claim.state,
        zip: claim.zip,
        dateOfLoss: claim.dateOfLoss,
        perilType: claim.perilType,
      }, apiKey);

      res.json(correlation);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      if (error.message?.includes("Weather API")) {
        return res.status(502).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  return router;
}
