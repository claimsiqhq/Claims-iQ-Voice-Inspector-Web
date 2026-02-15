import { Router } from "express";
import { db } from "../db";
import { claims } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateRequest } from "../auth";
import { pgTable, serial, integer, varchar, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

const extractions = pgTable("extractions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull(),
  documentType: varchar("document_type", { length: 30 }).notNull(),
  extractedData: jsonb("extracted_data"),
  confidence: jsonb("confidence"),
  confirmedByUser: boolean("confirmed_by_user").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull(),
  propertyProfile: jsonb("property_profile"),
  coverageSnapshot: jsonb("coverage_snapshot"),
  perilAnalysis: jsonb("peril_analysis"),
  endorsementImpacts: jsonb("endorsement_impacts"),
  inspectionChecklist: jsonb("inspection_checklist"),
  dutiesAfterLoss: jsonb("duties_after_loss"),
  redFlags: jsonb("red_flags"),
  createdAt: timestamp("created_at").defaultNow(),
});

export function extractionRouter() {
  const router = Router();

  // Get extractions for claim
  router.get("/:claimId/extractions", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const list = await db.select().from(extractions).where(eq(extractions.claimId, claimId));
      res.json(list);
    } catch (err) {
      console.error("get extractions error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Confirm individual extraction
  router.post("/:claimId/extractions/:docType/confirm", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const docType = req.params.docType;
      const [updated] = await db.update(extractions)
        .set({ confirmedByUser: true })
        .where(and(eq(extractions.claimId, claimId), eq(extractions.documentType, docType)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Extraction not found" });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Confirm all extractions
  router.post("/:claimId/extractions/confirm-all", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      await db.update(extractions)
        .set({ confirmedByUser: true })
        .where(eq(extractions.claimId, claimId));
      await db.update(claims)
        .set({ status: "extractions_confirmed" })
        .where(eq(claims.id, claimId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update extraction data
  router.put("/:claimId/extractions/:docType", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const docType = req.params.docType;
      const { extractedData } = req.body;
      const [updated] = await db.update(extractions)
        .set({ extractedData: extractedData as any })
        .where(and(eq(extractions.claimId, claimId), eq(extractions.documentType, docType)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Extraction not found" });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Generate briefing from confirmed extractions using OpenAI
  router.post("/:claimId/briefing/generate", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const exts = await db.select().from(extractions).where(eq(extractions.claimId, claimId));
      const fnol = exts.find((e) => e.documentType === "fnol");
      const policy = exts.find((e) => e.documentType === "policy");
      const endorsements = exts.find((e) => e.documentType === "endorsements");

      let briefingData: any;

      // Use OpenAI to generate briefing if we have extraction data
      if (fnol?.extractedData || policy?.extractedData) {
        try {
          const { generateBriefing } = await import("../documentParser");
          briefingData = await generateBriefing(
            fnol?.extractedData || {},
            policy?.extractedData || {},
            endorsements?.extractedData || {}
          );
          briefingData.claimId = claimId;
        } catch (err) {
          console.error("AI briefing generation failed, using fallback:", err);
          briefingData = null;
        }
      }

      // Fallback if OpenAI fails or no data
      if (!briefingData) {
        const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
        briefingData = {
          claimId,
          propertyProfile: {
            address: claim?.propertyAddress,
            city: claim?.city, state: claim?.state, zip: claim?.zip,
            ...(fnol?.extractedData as any),
          },
          coverageSnapshot: (policy?.extractedData as any) || { deductible: "Unknown" },
          perilAnalysis: { perilType: claim?.perilType, dateOfLoss: claim?.dateOfLoss },
          endorsementImpacts: (endorsements?.extractedData as any)?.endorsements || [],
          inspectionChecklist: {
            exterior: ["Roof", "Siding", "Gutters", "Windows", "Doors"],
            roof: ["Shingles", "Flashing", "Ridge cap", "Vents", "Drip edge"],
            interior: ["Ceilings", "Walls", "Floors", "Fixtures"],
            systems: ["HVAC", "Plumbing", "Electrical"],
            documentation: ["Overview photos", "Damage details", "Test squares", "Measurements"],
          },
          dutiesAfterLoss: ["Protect property from further damage", "Document all damage with photos", "Keep receipts for emergency repairs"],
          redFlags: [],
        };
      }

      // Upsert briefing
      const [existing] = await db.select().from(briefings).where(eq(briefings.claimId, claimId)).limit(1);
      let result;
      if (existing) {
        [result] = await db.update(briefings).set(briefingData as any).where(eq(briefings.id, existing.id)).returning();
      } else {
        [result] = await db.insert(briefings).values(briefingData as any).returning();
      }

      await db.update(claims).set({ status: "briefing_ready" }).where(eq(claims.id, claimId));
      res.json(result);
    } catch (err) {
      console.error("generate briefing error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get briefing
  router.get("/:claimId/briefing", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(String(req.params.claimId));
      const [briefing] = await db.select().from(briefings).where(eq(briefings.claimId, claimId)).limit(1);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
