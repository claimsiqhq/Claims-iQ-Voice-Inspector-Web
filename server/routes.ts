import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { supabase, DOCUMENTS_BUCKET, PHOTOS_BUCKET } from "./supabase";
import * as pdfParseModule from "pdf-parse";
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import { extractFNOL, extractPolicy, extractEndorsements, generateBriefing } from "./openai";
import { buildSystemInstructions, realtimeTools } from "./realtime";
import { z } from "zod";

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  fileBase64: z.string().min(1),
  documentType: z.enum(["fnol", "policy", "endorsements"]),
});

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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/claims", async (_req, res) => {
    try {
      const claims = await storage.getClaims();
      res.json(claims);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims", async (req, res) => {
    try {
      const claim = await storage.createClaim(req.body);
      res.status(201).json(claim);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await storage.getDocuments(id);
      const exts = await storage.getExtractions(id);
      const briefing = await storage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/claims/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (status) {
        const claim = await storage.updateClaimStatus(id, status);
        return res.json(claim);
      }
      res.status(400).json({ message: "No valid update fields" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/documents", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const docs = await storage.getDocuments(claimId);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/documents/upload", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const parsed = uploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid upload data", errors: parsed.error.flatten().fieldErrors });
      }
      const { fileName, fileBase64, documentType } = parsed.data;

      const base64Data = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;
      const fileBuffer = Buffer.from(base64Data, "base64");

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
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/documents/:type/parse", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const documentType = req.params.type;

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
        const dataBuffer = await downloadFromSupabase(doc.storagePath);
        const pdfData = await pdfParse(dataBuffer);
        rawText = pdfData.text;
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

      const allDocs = await storage.getDocuments(claimId);
      const allParsed = allDocs.length >= 3 && allDocs.every(d => d.status === "parsed");
      if (allParsed) {
        await storage.updateClaimStatus(claimId, "documents_uploaded");
      }

      res.json({ extraction, confidence: extractResult.confidence });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/extractions", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);
      res.json(exts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/extractions/:type", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });
      res.json(ext);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/claims/:id/extractions/:type", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      const updated = await storage.updateExtraction(ext.id, req.body.extractedData);
      await storage.confirmExtraction(ext.id);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/extractions/confirm-all", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);
      for (const ext of exts) {
        await storage.confirmExtraction(ext.id);
      }
      await storage.updateClaimStatus(claimId, "extractions_confirmed");
      res.json({ confirmed: exts.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/briefing/generate", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
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
      let briefing;
      if (existing) {
        briefing = existing;
      } else {
        briefing = await storage.createBriefing({
          claimId,
          propertyProfile: briefingData.propertyProfile,
          coverageSnapshot: briefingData.coverageSnapshot,
          perilAnalysis: briefingData.perilAnalysis,
          endorsementImpacts: briefingData.endorsementImpacts,
          inspectionChecklist: briefingData.inspectionChecklist,
          dutiesAfterLoss: briefingData.dutiesAfterLoss,
          redFlags: briefingData.redFlags,
        });
      }

      await storage.updateClaimStatus(claimId, "briefing_ready");
      res.json(briefing);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/briefing", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const briefing = await storage.getBriefing(claimId);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Inspection Session Management ──────────────────

  app.post("/api/claims/:id/inspection/start", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const existing = await storage.getActiveSessionForClaim(claimId);
      if (existing) {
        return res.json({ sessionId: existing.id, session: existing });
      }
      const session = await storage.createInspectionSession(claimId);
      await storage.updateClaimStatus(claimId, "inspecting");
      res.status(201).json({ sessionId: session.id, session });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);
      res.json({ session, rooms, lineItemCount: allLineItems.length, photoCount: photos.length, estimate });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inspection/:sessionId", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const updates: any = {};
      if (req.body.currentPhase !== undefined) updates.currentPhase = req.body.currentPhase;
      if (req.body.currentRoomId !== undefined) updates.currentRoomId = req.body.currentRoomId;
      if (req.body.currentStructure !== undefined) updates.currentStructure = req.body.currentStructure;
      if (req.body.status !== undefined) updates.status = req.body.status;
      const session = await storage.updateSession(sessionId, updates);
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inspection/:sessionId/complete", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.completeSession(sessionId);
      if (session) {
        await storage.updateClaimStatus(session.claimId, "inspection_complete");
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Rooms ─────────────────────────────────────────

  app.post("/api/inspection/:sessionId/rooms", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { name, roomType, structure, dimensions, phase } = req.body;
      const room = await storage.createRoom({
        sessionId,
        name,
        roomType: roomType || null,
        structure: structure || "Main Dwelling",
        dimensions: dimensions || null,
        status: "in_progress",
        phase: phase || null,
      });
      await storage.updateSessionRoom(sessionId, room.id);
      res.status(201).json(room);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/rooms", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const rooms = await storage.getRooms(sessionId);
      res.json(rooms);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inspection/:sessionId/rooms/:roomId", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.updateRoomStatus(roomId, req.body.status);
      res.json(room);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inspection/:sessionId/rooms/:roomId/complete", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.completeRoom(roomId);
      res.json(room);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Damage Observations ──────────────────────────

  app.post("/api/inspection/:sessionId/damages", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
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
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/damages", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const damages = roomId
        ? await storage.getDamages(roomId)
        : await storage.getDamagesForSession(sessionId);
      res.json(damages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Line Items ───────────────────────────────────

  app.post("/api/inspection/:sessionId/line-items", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, depreciationType, wasteFactor } = req.body;
      if (!category || !description) {
        return res.status(400).json({ message: "category and description are required" });
      }
      const wf = wasteFactor || 0;
      const qty = quantity || 1;
      const up = unitPrice || 0;
      const totalPrice = qty * up * (1 + wf / 100);

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
      });
      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/line-items", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const items = await storage.getLineItems(sessionId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/estimate-summary", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const summary = await storage.getEstimateSummary(sessionId);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inspection/:sessionId/line-items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.updateLineItem(id, req.body);
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/inspection/:sessionId/line-items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLineItem(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Photos ───────────────────────────────────────

  app.post("/api/inspection/:sessionId/photos", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { roomId, damageId, imageBase64, autoTag, caption, photoType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }

      const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      const fileBuffer = Buffer.from(base64Data, "base64");
      const tag = autoTag || `photo_${Date.now()}`;
      const storagePath = `inspections/${sessionId}/${tag}.jpg`;

      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (error) {
        console.error("Photo upload error:", error);
      }

      const photo = await storage.createPhoto({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        storagePath: error ? null : storagePath,
        autoTag: tag,
        caption: caption || null,
        photoType: photoType || null,
      });

      if (roomId) {
        await storage.incrementRoomPhotoCount(roomId);
      }

      res.status(201).json({ photoId: photo.id, storagePath: photo.storagePath });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/photos", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const photos = await storage.getPhotos(sessionId);
      res.json(photos);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Moisture Readings ─────────────────────────────

  app.post("/api/inspection/:sessionId/moisture", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
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
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/moisture", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const readings = roomId
        ? await storage.getMoistureReadings(roomId)
        : await storage.getMoistureReadingsForSession(sessionId);
      res.json(readings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Transcript ────────────────────────────────────

  app.post("/api/inspection/:sessionId/transcript", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { speaker, content } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ message: "speaker and content are required" });
      }
      const entry = await storage.addTranscript({ sessionId, speaker, content });
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inspection/:sessionId/transcript", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const transcript = await storage.getTranscript(sessionId);
      res.json(transcript);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── OpenAI Realtime Session ───────────────────────

  app.post("/api/realtime/session", async (req, res) => {
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

      const instructions = buildSystemInstructions(briefing, claim);

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
          voice: "alloy",
          instructions,
          tools: realtimeTools,
          input_audio_transcription: { model: "whisper-1" },
          modalities: ["audio", "text"],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Realtime session error:", data);
        return res.status(500).json({ message: "Failed to create Realtime session", details: data });
      }

      if (sessionId) {
        await storage.updateSession(sessionId, { voiceSessionId: data.id });
      }

      res.json({
        clientSecret: data.client_secret.value,
        sessionId,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
