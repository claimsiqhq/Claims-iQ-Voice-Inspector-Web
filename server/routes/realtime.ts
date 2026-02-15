import { Router } from "express";
import { db } from "../db";
import { claims } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateRequest } from "../auth";

function buildSystemInstructions(claim: any): string {
  return `You are an expert insurance inspection assistant for Claims IQ. You are guiding a field adjuster through a property inspection via voice conversation.

## Your Identity
- Name: Claims IQ Inspector
- Voice: Professional, concise, efficient. Like a senior adjuster mentoring a colleague.
- Never use filler words. Be direct but friendly.
- Confirm every action you take with a brief spoken acknowledgment.

## This Claim
- Claim: ${claim.claimNumber}
- Insured: ${claim.insuredName || "Unknown"}
- Property: ${claim.propertyAddress || ""}, ${claim.city || ""}, ${claim.state || ""} ${claim.zip || ""}
- Date of Loss: ${claim.dateOfLoss || "Unknown"}
- Peril: ${claim.perilType || "Unknown"}

## Core Behaviors
1. **Location Awareness:** Always know which structure and room the adjuster is in.
2. **Guided Flow:** Follow the 8-phase inspection flow: Pre-Inspection, Setup, Exterior, Interior, Water/Moisture, Evidence Review, Estimate Assembly, Finalize.
3. **Proactive Prompting:** After documenting damage, suggest related items.
4. **Ambiguity Resolution:** If the adjuster is vague, ask for specifics.
5. **Photo Triggers:** Call trigger_photo_capture when entering a new area or when damage is described.
6. **Keep It Conversational:** 1-2 sentences max. Say "Got it" or "Added" for confirmations.`;
}

const realtimeTools = [
  {
    type: "function",
    name: "set_inspection_context",
    description: "Sets the current location context: which structure, area, and phase.",
    parameters: {
      type: "object",
      properties: {
        structure: { type: "string" },
        area: { type: "string" },
        phase: { type: "integer" },
      },
      required: ["area"],
    },
  },
  {
    type: "function",
    name: "create_room",
    description: "Creates a new room/area in the inspection with optional dimensions.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        roomType: { type: "string" },
        structure: { type: "string" },
        length: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        phase: { type: "integer" },
      },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "add_damage",
    description: "Records a damage observation in the current room.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        damageType: { type: "string", enum: ["hail_impact", "wind_damage", "water_stain", "water_intrusion", "crack", "dent", "missing", "rot", "mold", "mechanical", "wear_tear", "other"] },
        severity: { type: "string", enum: ["minor", "moderate", "severe"] },
        location: { type: "string" },
        extent: { type: "string" },
      },
      required: ["description", "damageType"],
    },
  },
  {
    type: "function",
    name: "add_line_item",
    description: "Adds an Xactimate-compatible estimate line item.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors", "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC", "Debris", "General", "Fencing"] },
        action: { type: "string", enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"] },
        description: { type: "string" },
        quantity: { type: "number" },
        unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "HR", "DAY"] },
        unitPrice: { type: "number" },
      },
      required: ["category", "action", "description"],
    },
  },
  {
    type: "function",
    name: "trigger_photo_capture",
    description: "Triggers camera to capture a photo.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string" },
        photoType: { type: "string", enum: ["overview", "damage_detail", "test_square", "moisture", "pre_existing"] },
      },
      required: ["label", "photoType"],
    },
  },
  {
    type: "function",
    name: "log_moisture_reading",
    description: "Records a moisture meter reading.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string" },
        reading: { type: "number" },
        materialType: { type: "string" },
      },
      required: ["location", "reading"],
    },
  },
  {
    type: "function",
    name: "complete_room",
    description: "Marks the current room as complete.",
    parameters: {
      type: "object",
      properties: { roomName: { type: "string" } },
      required: ["roomName"],
    },
  },
  {
    type: "function",
    name: "get_estimate_summary",
    description: "Returns the running estimate totals.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "add_opening",
    description: "Records a wall opening (door, window, pass-through, missing wall, overhead door) in the current room. Creates a MISS_WALL entry for sketch and ESX export.",
    parameters: {
      type: "object",
      properties: {
        openingType: { type: "string", enum: ["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening"] },
        wallDirection: { type: "string", enum: ["north", "south", "east", "west"] },
        widthFt: { type: "number", description: "Opening width in feet" },
        heightFt: { type: "number", description: "Opening height in feet" },
        quantity: { type: "integer", description: "Number of identical openings. Default 1." },
        opensInto: { type: "string", description: "Room name or E for exterior" },
      },
      required: ["openingType", "widthFt", "heightFt"],
    },
  },
  {
    type: "function",
    name: "set_room_adjacency",
    description: "Records that two rooms share a wall. Used for sketch rendering and ESX export.",
    parameters: {
      type: "object",
      properties: {
        roomNameA: { type: "string", description: "First room name" },
        roomNameB: { type: "string", description: "Second room name" },
        wallDirectionA: { type: "string", enum: ["north", "south", "east", "west"], description: "Which wall of room A faces room B" },
        sharedWallLengthFt: { type: "number", description: "Length of shared wall in feet" },
      },
      required: ["roomNameA", "roomNameB"],
    },
  },
  {
    type: "function",
    name: "update_room_dimensions",
    description: "Updates a room's dimensions (length, width, height, ceiling type). Call when the adjuster provides or corrects measurements.",
    parameters: {
      type: "object",
      properties: {
        roomName: { type: "string" },
        length: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        ceilingType: { type: "string", enum: ["flat", "cathedral", "tray", "vaulted"] },
      },
      required: ["roomName"],
    },
  },
  {
    type: "function",
    name: "complete_inspection",
    description: "Finalizes the inspection.",
    parameters: {
      type: "object",
      properties: { notes: { type: "string" } },
    },
  },
];

export function realtimeRouter() {
  const router = Router();

  router.post("/session", authenticateRequest, async (req, res) => {
    try {
      const { claimId, sessionId } = req.body;
      if (!claimId) return res.status(400).json({ message: "claimId required" });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(503).json({ message: "OPENAI_API_KEY not configured" });

      const [claim] = await db.select().from(claims).where(eq(claims.id, parseInt(String(claimId)))).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });

      const instructions = buildSystemInstructions(claim);

      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
        console.error("OpenAI Realtime error:", data);
        return res.status(500).json({ message: "Failed to create Realtime session", details: data });
      }

      res.json({
        clientSecret: data.client_secret?.value,
        sessionId: sessionId || null,
      });
    } catch (err) {
      console.error("realtime session error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
