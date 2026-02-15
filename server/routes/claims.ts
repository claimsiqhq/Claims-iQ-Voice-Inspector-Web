import { Router } from "express";
import { db } from "../db";
import { claims, documents } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { authenticateRequest } from "../auth";
import { supabase, DOCUMENTS_BUCKET } from "../supabase";
import { z } from "zod";

const uploadDocSchema = z.object({
  fileData: z.string().min(1),
  fileName: z.string().min(1),
  documentType: z.string().default("fnol"),
});

export function claimsRouter() {
  const router = Router();

  router.get("/my-claims", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const list = await db
        .select()
        .from(claims)
        .where(eq(claims.assignedTo, userId))
        .orderBy(desc(claims.createdAt));
      res.json(list);
    } catch (err) {
      console.error("my-claims error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const claimId = parseInt(String(req.params.id));
      if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (claim.assignedTo !== userId && req.user!.role !== "supervisor" && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.json(claim);
    } catch (err) {
      console.error("claim get error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;
      const list = role === "supervisor" || role === "admin"
        ? await db.select().from(claims).orderBy(desc(claims.createdAt))
        : await db.select().from(claims).where(eq(claims.assignedTo, userId)).orderBy(desc(claims.createdAt));
      res.json(list);
    } catch (err) {
      console.error("claims list error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/:claimId/documents/upload", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const claimId = parseInt(String(req.params.claimId));
      if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (claim.assignedTo !== userId && req.user!.role !== "supervisor" && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      if (!supabase) return res.status(503).json({ message: "File storage not configured" });

      const parsed = uploadDocSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "fileData and fileName required" });
      const { fileData, fileName, documentType } = parsed.data;

      const base64Match = fileData.match(/^data:(.+);base64,(.+)$/);
      if (!base64Match) return res.status(400).json({ message: "Invalid file data format" });
      const buffer = Buffer.from(base64Match[2], "base64");
      const ext = fileName.split(".").pop() || "pdf";
      const storagePath = `claims/${claimId}/${documentType}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

      if (uploadError) {
        console.error("Document upload error:", uploadError);
        return res.status(500).json({ message: "Failed to upload document" });
      }

      const [doc] = await db.insert(documents).values({
        claimId,
        documentType,
        fileName,
        storagePath,
        fileSize: buffer.length,
        status: "uploaded",
      }).returning();

      // Auto-parse PDF if it's fnol, policy, or endorsements
      if (["fnol", "policy", "endorsements"].includes(documentType) && ext === "pdf") {
        // Parse in background, don't block response
        (async () => {
          try {
            const { parsePdfBuffer } = await import("../documentParser");
            const { extractedData, confidence } = await parsePdfBuffer(buffer, documentType);

            // Import extractions table from extraction router's definition
            const { pgTable, serial, integer, varchar, jsonb, boolean, timestamp } = await import("drizzle-orm/pg-core");
            const extractions = pgTable("extractions", {
              id: serial("id").primaryKey(),
              claimId: integer("claim_id").notNull(),
              documentType: varchar("document_type", { length: 30 }).notNull(),
              extractedData: jsonb("extracted_data"),
              confidence: jsonb("confidence"),
              confirmedByUser: boolean("confirmed_by_user").default(false),
              createdAt: timestamp("created_at").defaultNow(),
            });

            // Upsert extraction
            const [existing] = await db.select().from(extractions)
              .where(and(eq(extractions.claimId, claimId), eq(extractions.documentType, documentType))).limit(1);

            if (existing) {
              await db.update(extractions)
                .set({ extractedData: extractedData as any, confidence: confidence as any })
                .where(eq(extractions.id, existing.id));
            } else {
              await db.insert(extractions).values({
                claimId, documentType,
                extractedData: extractedData as any,
                confidence: confidence as any,
              });
            }

            // Update document status
            await db.update(documents).set({ status: "parsed" }).where(eq(documents.id, doc.id));

            // Update claim status if all three docs are uploaded
            const allExtractions = await db.select().from(extractions).where(eq(extractions.claimId, claimId));
            if (allExtractions.length >= 1) {
              await db.update(claims).set({ status: "documents_uploaded" }).where(eq(claims.id, claimId));
            }

            // If FNOL parsed, auto-populate claim fields
            if (documentType === "fnol" && extractedData) {
              const fnol = extractedData as any;
              const updates: any = {};
              if (fnol.insuredName && !claim.insuredName) updates.insuredName = fnol.insuredName;
              if (fnol.propertyAddress && !claim.propertyAddress) updates.propertyAddress = fnol.propertyAddress;
              if (fnol.city && !claim.city) updates.city = fnol.city;
              if (fnol.state && !claim.state) updates.state = fnol.state;
              if (fnol.zip && !claim.zip) updates.zip = fnol.zip;
              if (fnol.dateOfLoss && !claim.dateOfLoss) updates.dateOfLoss = fnol.dateOfLoss;
              if (fnol.perilType && !claim.perilType) updates.perilType = fnol.perilType;
              if (Object.keys(updates).length > 0) {
                await db.update(claims).set(updates).where(eq(claims.id, claimId));
              }
            }

            console.log(`Parsed ${documentType} for claim ${claimId}`);
          } catch (err) {
            console.error(`PDF parse error for ${documentType}:`, err);
            await db.update(documents).set({ status: "parse_failed" }).where(eq(documents.id, doc.id));
          }
        })();
      }

      res.json(doc);
    } catch (err) {
      console.error("document upload error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:claimId/documents/:docId/url", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const claimId = parseInt(String(req.params.claimId));
      const docId = parseInt(String(req.params.docId));
      if (isNaN(claimId) || isNaN(docId)) return res.status(400).json({ message: "Invalid ID" });
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (claim.assignedTo !== userId && req.user!.role !== "supervisor" && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      const [doc] = await db.select().from(documents).where(and(eq(documents.id, docId), eq(documents.claimId, claimId))).limit(1);
      if (!doc || !doc.storagePath) return res.status(404).json({ message: "Document not found" });
      if (!supabase) return res.status(503).json({ message: "Storage not configured" });

      const { data } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.storagePath, 3600);
      if (!data?.signedUrl) return res.status(500).json({ message: "Could not generate URL" });
      res.json({ url: data.signedUrl });
    } catch (err) {
      console.error("document url error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:claimId/documents", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const claimId = parseInt(String(req.params.claimId));
      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (claim.assignedTo !== userId && req.user!.role !== "supervisor" && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      const list = await db.select().from(documents).where(eq(documents.claimId, claimId)).orderBy(desc(documents.createdAt));
      res.json(list);
    } catch (err) {
      console.error("documents error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
