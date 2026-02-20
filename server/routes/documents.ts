import { Router } from "express";
import { storage } from "../storage";
import { supabase, DOCUMENTS_BUCKET } from "../supabase";
import { authenticateRequest } from "../auth";
import { canAccessClaim, isPrivilegedRole } from "../authorization";
import { param, parseIntParam } from "../utils";
import { logger } from "../logger";

export function documentsRouter(): Router {
  const router = Router();

  router.get("/all", authenticateRequest, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      if (isPrivilegedRole(req.user?.role)) {
        return res.json(docs);
      }
      const userClaims = await storage.getClaimsForUser(req.user!.id);
      const claimIds = new Set(userClaims.map((claim) => claim.id));
      res.json(docs.filter((doc) => claimIds.has(doc.claimId)));
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/status-summary", authenticateRequest, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      const allClaims = isPrivilegedRole(req.user?.role)
        ? await storage.getClaims()
        : await storage.getClaimsForUser(req.user!.id);
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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id/signed-url", authenticateRequest, async (req, res) => {
    try {
      const docId = parseIntParam(param(req.params.id), res, "document id");
      if (docId === null) return;
      const doc = await storage.getDocumentById(docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (!doc.storagePath) return res.status(404).json({ message: "No file uploaded for this document" });
      const claim = await storage.getClaim(doc.claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (!canAccessClaim(req.user, claim)) {
        return res.status(403).json({ message: "Not authorized to access this document" });
      }

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
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
