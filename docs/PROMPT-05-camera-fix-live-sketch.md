# PROMPT-05 — Fix Camera Workflow & Add Live Floor Plan Sketch

> **Run this prompt in Replit after PROMPT-04 has been applied.**
> This prompt fixes four issues: (1) the photo capture workflow is fundamentally broken — the voice agent doesn't wait for the photo, captured photos don't display, and there's no AI analysis, (2) there's no visual representation of the inspection sketch being built during the voice session, (3) the voice agent is too sensitive to background noise in field environments, and (4) the inspection should always start with a mandatory front-of-house photo to verify the correct property against the claim file.

---

## ⛔ WHAT NOT TO CHANGE

The same frozen file list from PROMPT-04 applies. Additionally:

- Do NOT refactor the WebRTC connection logic (`connectVoice`, `disconnectVoice`, SDP negotiation)
- Do NOT change `server/realtime.ts` tool definitions
- Do NOT change Act 1 pages or Act 1 backend
- Do NOT change the data channel event listener structure

This prompt makes **surgical changes** to `ActiveInspection.tsx` (the tool execution flow and camera UI), adds a **new backend endpoint** for photo analysis, adds a **new component** for the floor plan sketch, and adds one column to the `inspectionPhotos` table.

---

## 1. SCHEMA MIGRATION — Add `analysis` Column to `inspectionPhotos`

The photo table currently has no field for AI analysis results. Add one.

### In `shared/schema.ts`

Find the `inspectionPhotos` table definition. Add an `analysis` column (jsonb, nullable) after the `annotations` field:

```typescript
export const inspectionPhotos = pgTable("inspection_photos", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => inspectionRooms.id, { onDelete: "set null" }),
  damageId: integer("damage_id").references(() => damageObservations.id, { onDelete: "set null" }),
  storagePath: text("storage_path"),
  autoTag: varchar("auto_tag", { length: 50 }),
  caption: text("caption"),
  photoType: varchar("photo_type", { length: 30 }),
  annotations: jsonb("annotations"),
  analysis: jsonb("analysis"),           // ← ADD THIS LINE
  matchesRequest: boolean("matches_request"),  // ← ADD THIS LINE
  createdAt: timestamp("created_at").defaultNow(),
});
```

Add `boolean` to the import from `drizzle-orm/pg-core` if not already there (it is already imported).

### Run Migration

After editing the schema, run `npx drizzle-kit push` to apply the migration to Supabase. The new columns are nullable so existing data is safe.

---

## 2. NEW BACKEND ENDPOINT — Photo Analysis via GPT-4o Vision

### In `server/routes.ts`

Add a new endpoint that accepts a photo (as base64) and sends it to GPT-4o Vision for analysis. This is called by the frontend after the camera capture, before returning the tool result to the voice agent.

Add this endpoint in the Photos section (after the existing `POST /api/inspection/:sessionId/photos` endpoint):

```typescript
// POST /api/inspection/:sessionId/photos/:photoId/analyze
app.post("/api/inspection/:sessionId/photos/:photoId/analyze", async (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId);
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
        model: "gpt-4o",
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
```

### Add `updatePhoto` to Storage

In `server/storage.ts`, add this method to the `IStorage` interface and `DatabaseStorage` class:

**Interface (add after `getPhotosForRoom`):**
```typescript
updatePhoto(id: number, updates: Partial<InspectionPhoto>): Promise<InspectionPhoto | undefined>;
```

**Implementation (add after `getPhotosForRoom` method):**
```typescript
async updatePhoto(id: number, updates: Partial<InspectionPhoto>): Promise<InspectionPhoto | undefined> {
  const [photo] = await db.update(inspectionPhotos).set(updates).where(eq(inspectionPhotos.id, id)).returning();
  return photo;
}
```

---

## 3. FIX THE CAMERA WORKFLOW IN `ActiveInspection.tsx`

This is the critical fix. The core problem: `trigger_photo_capture` immediately returns a tool result, so the voice agent keeps talking while the camera is open. The fix: **defer the tool response** until the photo is actually captured and analyzed.

### 3a. Add a Pending Photo Ref

Near the other refs (around line 99-107), add:

```typescript
const pendingPhotoCallRef = useRef<{ call_id: string; label: string; photoType: string } | null>(null);
```

### 3b. Change `trigger_photo_capture` Tool Handler

Find the `trigger_photo_capture` case in `executeToolCall` (around line 308-316). Replace the ENTIRE case with:

```typescript
case "trigger_photo_capture": {
  // Store the pending call_id — DO NOT send tool result yet
  // The agent will wait for the photo capture before continuing
  pendingPhotoCallRef.current = {
    call_id,
    label: args.label,
    photoType: args.photoType,
  };
  setCameraMode({
    active: true,
    label: args.label,
    photoType: args.photoType,
    overlay: args.overlay || "none",
  });
  // IMPORTANT: Return early — skip the dcRef.current.send() below
  // The tool result will be sent from handleCameraCapture instead
  return;
}
```

**CRITICAL:** Note the `return` at the end. This exits `executeToolCall` before reaching the `dcRef.current.send()` block at lines 373-383. The tool response will be sent later by `handleCameraCapture` or `handleCameraCancel`.

### 3c. Replace `handleCameraCapture`

Replace the entire `handleCameraCapture` function (lines 543-577) with:

```typescript
const handleCameraCapture = async () => {
  if (!canvasRef.current || !videoRef.current) return;
  const canvas = canvasRef.current;
  const video = videoRef.current;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

  // Stop the camera stream
  const videoStream = videoRef.current.srcObject as MediaStream | null;
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
  }

  // Show a "processing" state while we save + analyze
  setCameraMode((prev) => ({ ...prev, label: "Analyzing photo..." }));

  let photoResult: any = { success: false, message: "Photo capture failed" };

  if (sessionId) {
    try {
      // Step 1: Save photo to backend (uploads to Supabase)
      const saveRes = await fetch(`/api/inspection/${sessionId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: currentRoomId,
          imageBase64: dataUrl,
          autoTag: cameraMode.label.replace(/\s+/g, "_").substring(0, 40),
          caption: cameraMode.label,
          photoType: cameraMode.photoType,
        }),
      });
      const savedPhoto = await saveRes.json();

      // Step 2: Send to GPT-4o Vision for analysis
      let analysis: any = null;
      try {
        const analyzeRes = await fetch(
          `/api/inspection/${sessionId}/photos/${savedPhoto.photoId}/analyze`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: dataUrl,
              expectedLabel: cameraMode.label,
              expectedPhotoType: cameraMode.photoType,
            }),
          }
        );
        analysis = await analyzeRes.json();
      } catch (e) {
        console.error("Photo analysis failed:", e);
      }

      // Step 3: Store in local state WITH thumbnail + analysis for gallery display
      setRecentPhotos((prev) => [
        {
          id: savedPhoto.photoId,
          storagePath: savedPhoto.storagePath,
          thumbnail: dataUrl,
          caption: cameraMode.label,
          photoType: cameraMode.photoType,
          analysis,
          matchesRequest: analysis?.matchesExpected ?? true,
        },
        ...prev,
      ].slice(0, 20));

      // Step 4: Build the tool result to send back to the voice agent
      photoResult = {
        success: true,
        photoId: savedPhoto.photoId,
        message: "Photo captured and saved.",
        analysis: analysis ? {
          description: analysis.description,
          damageVisible: analysis.damageVisible,
          matchesExpected: analysis.matchesExpected,
          matchExplanation: analysis.matchExplanation,
          qualityScore: analysis.qualityScore,
        } : undefined,
      };

      // If photo doesn't match what was requested, tell the agent
      if (analysis && !analysis.matchesExpected) {
        photoResult.warning = `Photo may not match requested capture "${cameraMode.label}". ${analysis.matchExplanation}`;
      }
    } catch (e: any) {
      console.error("Camera capture error:", e);
      photoResult = { success: false, message: e.message };
    }
  }

  // Step 5: NOW send the deferred tool result to the voice agent
  const pendingCall = pendingPhotoCallRef.current;
  if (pendingCall && dcRef.current && dcRef.current.readyState === "open") {
    dcRef.current.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: pendingCall.call_id,
        output: JSON.stringify(photoResult),
      },
    }));
    dcRef.current.send(JSON.stringify({ type: "response.create" }));
  }
  pendingPhotoCallRef.current = null;

  // Step 6: Close camera overlay
  setCameraMode({ active: false, label: "", photoType: "", overlay: "none" });
};
```

### 3d. Add Camera Cancel Handler

When the user closes the camera without taking a photo, we need to send a "cancelled" result so the agent doesn't hang. Find the camera Close button in the render (around line 1043-1055). Replace its onClick handler:

```typescript
onClick={() => {
  const videoStream = videoRef.current?.srcObject as MediaStream | null;
  if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
  setCameraMode({ active: false, label: "", photoType: "", overlay: "none" });

  // Send cancelled result to the voice agent so it doesn't hang
  const pendingCall = pendingPhotoCallRef.current;
  if (pendingCall && dcRef.current && dcRef.current.readyState === "open") {
    dcRef.current.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: pendingCall.call_id,
        output: JSON.stringify({
          success: false,
          message: "Photo capture cancelled by user. Ask if they want to try again or continue.",
        }),
      },
    }));
    dcRef.current.send(JSON.stringify({ type: "response.create" }));
  }
  pendingPhotoCallRef.current = null;
}}
```

---

## 4. UPGRADE THE PHOTO GALLERY IN THE RIGHT PANEL

The current right panel shows camera icons for photos. Replace with actual thumbnails and AI analysis.

### 4a. Replace Photo Display

Find the recent photos section in the right panel content (around line 753-764). Replace it entirely:

```typescript
{recentPhotos.length > 0 && (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
      Captured Photos ({recentPhotos.length})
    </p>
    <div className="space-y-2">
      {recentPhotos.map((photo: any, i: number) => (
        <motion.div
          key={photo.id || i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 rounded-lg border border-white/10 overflow-hidden"
        >
          {/* Thumbnail */}
          {photo.thumbnail ? (
            <div className="relative">
              <img
                src={photo.thumbnail}
                alt={photo.caption || "Inspection photo"}
                className="w-full h-32 object-cover"
              />
              {/* Match badge */}
              {photo.analysis && (
                <div className={cn(
                  "absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold",
                  photo.matchesRequest
                    ? "bg-green-500/90 text-white"
                    : "bg-amber-500/90 text-white"
                )}>
                  {photo.matchesRequest ? "✓ Match" : "⚠ Check"}
                </div>
              )}
              {/* Photo type badge */}
              <div className="absolute bottom-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[9px] text-white/80">
                {(photo.photoType || "photo").replace("_", " ")}
              </div>
            </div>
          ) : (
            <div className="h-20 bg-white/5 flex items-center justify-center">
              <Camera size={16} className="text-white/20" />
            </div>
          )}

          {/* Caption + Analysis */}
          <div className="px-2.5 py-2">
            <p className="text-xs font-medium truncate">{photo.caption || "Photo"}</p>
            {photo.analysis?.description && (
              <p className="text-[10px] text-white/50 mt-1 line-clamp-2">
                {photo.analysis.description}
              </p>
            )}
            {photo.analysis?.damageVisible?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {photo.analysis.damageVisible.map((d: any, j: number) => (
                  <span key={j} className="px-1.5 py-0.5 bg-red-500/20 text-red-300 rounded text-[9px]">
                    {d.type} — {d.severity}
                  </span>
                ))}
              </div>
            )}
            {photo.analysis && !photo.matchesRequest && (
              <div className="mt-1.5 px-2 py-1 bg-amber-500/10 rounded border border-amber-500/20">
                <p className="text-[9px] text-amber-300">
                  ⚠ {photo.analysis.matchExplanation}
                </p>
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  </div>
)}
```

---

## 5. NEW COMPONENT — `client/src/components/FloorPlanSketch.tsx`

This component renders a live floor plan that builds out as rooms are created during the voice inspection. It goes in the right panel or as a toggleable panel.

### Create `client/src/components/FloorPlanSketch.tsx`

```typescript
import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: { length?: number; width?: number; height?: number };
  structure?: string;
}

interface FloorPlanSketchProps {
  rooms: RoomData[];
  currentRoomId: number | null;
  onRoomClick?: (roomId: number) => void;
  className?: string;
}

// Map room status to colors
const STATUS_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  not_started: { fill: "#1F2937", stroke: "#374151", text: "#9CA3AF" },      // Gray
  in_progress: { fill: "#7763B7/15", stroke: "#7763B7", text: "#C4B5FD" },   // Purple
  complete: { fill: "#22C55E/15", stroke: "#22C55E", text: "#86EFAC" },       // Green
};

const SCALE = 6; // pixels per foot
const MIN_SIZE = 50; // minimum room rectangle size in pixels
const PADDING = 8;
const GAP = 6;

export default function FloorPlanSketch({ rooms, currentRoomId, onRoomClick, className }: FloorPlanSketchProps) {
  // Separate rooms by type: interior vs exterior
  const { interiorRooms, exteriorRooms } = useMemo(() => {
    const interior = rooms.filter(r => !r.roomType?.startsWith("exterior_"));
    const exterior = rooms.filter(r => r.roomType?.startsWith("exterior_"));
    return { interiorRooms: interior, exteriorRooms: exterior };
  }, [rooms]);

  // Calculate room rectangle dimensions (proportional to real dimensions where available)
  const getRoomSize = (room: RoomData) => {
    const dims = room.dimensions as any;
    if (dims?.length && dims?.width) {
      return {
        w: Math.max(dims.length * SCALE, MIN_SIZE),
        h: Math.max(dims.width * SCALE, MIN_SIZE),
      };
    }
    // Default size for rooms without dimensions
    return { w: MIN_SIZE + 20, h: MIN_SIZE + 10 };
  };

  // Simple bin-packing: arrange rooms in rows
  const layoutRooms = (roomList: RoomData[], maxWidth: number) => {
    const positioned: Array<{ room: RoomData; x: number; y: number; w: number; h: number }> = [];
    let currentX = PADDING;
    let currentY = PADDING;
    let rowHeight = 0;

    for (const room of roomList) {
      const size = getRoomSize(room);
      // If this room won't fit in the current row, start a new row
      if (currentX + size.w + PADDING > maxWidth && currentX > PADDING) {
        currentX = PADDING;
        currentY += rowHeight + GAP;
        rowHeight = 0;
      }
      positioned.push({ room, x: currentX, y: currentY, w: size.w, h: size.h });
      currentX += size.w + GAP;
      rowHeight = Math.max(rowHeight, size.h);
    }
    return { positioned, totalHeight: currentY + rowHeight + PADDING };
  };

  const SVG_WIDTH = 260;
  const interiorLayout = layoutRooms(interiorRooms, SVG_WIDTH);
  const exteriorLayout = layoutRooms(exteriorRooms, SVG_WIDTH);

  // Total height for the SVG
  const interiorSectionHeight = interiorRooms.length > 0 ? interiorLayout.totalHeight + 20 : 0;
  const exteriorSectionHeight = exteriorRooms.length > 0 ? exteriorLayout.totalHeight + 20 : 0;
  const totalHeight = interiorSectionHeight + exteriorSectionHeight + 10;

  if (rooms.length === 0) {
    return (
      <div className={cn("bg-white/5 rounded-lg border border-white/10 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Floor Plan</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-white/20">Rooms will appear here as they're created</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-white/5 rounded-lg border border-white/10 overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-white/10 flex justify-between items-center">
        <p className="text-[10px] uppercase tracking-widest text-white/40">Live Sketch</p>
        <p className="text-[10px] text-white/30">{rooms.length} area{rooms.length !== 1 ? "s" : ""}</p>
      </div>

      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${totalHeight}`}
        className="w-full"
        style={{ maxHeight: 300 }}
      >
        {/* Interior Rooms Section */}
        {interiorRooms.length > 0 && (
          <g>
            <text x={PADDING} y={12} className="fill-white/30" fontSize="8" fontFamily="Space Mono, monospace">
              INTERIOR
            </text>
            {interiorLayout.positioned.map(({ room, x, y, w, h }) => {
              const colors = STATUS_COLORS[room.status] || STATUS_COLORS.not_started;
              const isCurrent = room.id === currentRoomId;
              const dims = room.dimensions as any;

              return (
                <g
                  key={room.id}
                  onClick={() => onRoomClick?.(room.id)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Room rectangle */}
                  <motion.rect
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    x={x}
                    y={y + 16}
                    width={w}
                    height={h}
                    rx={3}
                    fill={room.status === "complete" ? "rgba(34,197,94,0.1)"
                      : room.status === "in_progress" ? "rgba(119,99,183,0.15)"
                      : "rgba(31,41,55,0.8)"}
                    stroke={isCurrent ? "#C6A54E"
                      : room.status === "complete" ? "#22C55E"
                      : room.status === "in_progress" ? "#7763B7"
                      : "#374151"}
                    strokeWidth={isCurrent ? 2 : 1}
                    strokeDasharray={room.status === "not_started" ? "3,3" : "none"}
                  />

                  {/* Room name */}
                  <text
                    x={x + w / 2}
                    y={y + 16 + h / 2 - (dims?.length ? 4 : 0)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8"
                    fontFamily="Work Sans, sans-serif"
                    fontWeight="600"
                    fill={isCurrent ? "#C6A54E"
                      : room.status === "complete" ? "#86EFAC"
                      : room.status === "in_progress" ? "#C4B5FD"
                      : "#9CA3AF"}
                  >
                    {room.name.length > 12 ? room.name.substring(0, 11) + "…" : room.name}
                  </text>

                  {/* Dimensions if available */}
                  {dims?.length && dims?.width && (
                    <text
                      x={x + w / 2}
                      y={y + 16 + h / 2 + 8}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="7"
                      fontFamily="Space Mono, monospace"
                      fill="#6B7280"
                    >
                      {dims.length}×{dims.width}
                    </text>
                  )}

                  {/* Damage count badge */}
                  {room.damageCount > 0 && (
                    <>
                      <circle cx={x + w - 6} cy={y + 22} r={6} fill="#EF4444" opacity={0.9} />
                      <text x={x + w - 6} y={y + 22} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="white" fontWeight="bold">
                        {room.damageCount}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Exterior Rooms Section */}
        {exteriorRooms.length > 0 && (
          <g transform={`translate(0, ${interiorSectionHeight})`}>
            <text x={PADDING} y={12} className="fill-white/30" fontSize="8" fontFamily="Space Mono, monospace">
              EXTERIOR
            </text>
            {exteriorLayout.positioned.map(({ room, x, y, w, h }) => {
              const isCurrent = room.id === currentRoomId;
              return (
                <g
                  key={room.id}
                  onClick={() => onRoomClick?.(room.id)}
                  style={{ cursor: "pointer" }}
                >
                  <motion.rect
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    x={x}
                    y={y + 16}
                    width={w}
                    height={h}
                    rx={3}
                    fill={room.status === "complete" ? "rgba(34,197,94,0.1)"
                      : room.status === "in_progress" ? "rgba(119,99,183,0.15)"
                      : "rgba(31,41,55,0.8)"}
                    stroke={isCurrent ? "#C6A54E"
                      : room.status === "complete" ? "#22C55E"
                      : room.status === "in_progress" ? "#7763B7"
                      : "#374151"}
                    strokeWidth={isCurrent ? 2 : 1}
                    strokeDasharray={room.status === "not_started" ? "3,3" : "none"}
                  />
                  <text
                    x={x + w / 2}
                    y={y + 16 + h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8"
                    fontFamily="Work Sans, sans-serif"
                    fontWeight="600"
                    fill={isCurrent ? "#C6A54E"
                      : room.status === "complete" ? "#86EFAC"
                      : "#9CA3AF"}
                  >
                    {room.name.length > 12 ? room.name.substring(0, 11) + "…" : room.name}
                  </text>
                  {room.damageCount > 0 && (
                    <>
                      <circle cx={x + w - 6} cy={y + 22} r={6} fill="#EF4444" opacity={0.9} />
                      <text x={x + w - 6} y={y + 22} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="white" fontWeight="bold">
                        {room.damageCount}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
```

### Add FloorPlanSketch to the Right Panel

In `ActiveInspection.tsx`, import the component at the top:

```typescript
import FloorPlanSketch from "@/components/FloorPlanSketch";
```

Then add it to the `rightPanelContent` variable. Insert it AFTER the Running Estimate card (the first `<div>` inside `rightPanelContent`) and BEFORE the Recent Line Items section. Find the line that starts `<div className="bg-white/5 rounded-lg p-3 border border-white/10">` for the running estimate, and after its closing `</div>`, add:

```typescript
<FloorPlanSketch
  rooms={rooms.map(r => ({
    ...r,
    dimensions: (r as any).dimensions,
  }))}
  currentRoomId={currentRoomId}
  onRoomClick={(roomId) => {
    setCurrentRoomId(roomId);
    setCurrentArea(rooms.find(r => r.id === roomId)?.name || "");
  }}
/>
```

**Note:** The `rooms` state currently stores `RoomData` objects. The `create_room` response from the backend includes `dimensions` (jsonb), but the current `RoomData` interface doesn't have a `dimensions` field. Update the `RoomData` interface (around line 41) to include it:

```typescript
interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  phase?: number;
  dimensions?: { length?: number; width?: number; height?: number };
  structure?: string;
}
```

Also update the `refreshRooms` callback. The backend already returns `dimensions` and `structure` — they just weren't being stored. Verify the `GET /api/inspection/:sessionId/rooms` endpoint returns all room fields (it does — `storage.getRooms(sessionId)` returns full `InspectionRoom` records).

---

## 6. CAMERA OVERLAY UX IMPROVEMENTS

Currently the camera overlay is functional but bare. Add visual feedback for the "analyzing" state and a clearer capture confirmation.

### Replace the Camera Overlay Render

Find the camera overlay `<AnimatePresence>` block (around line 1029-1078) and replace the bottom capture button section. Find the `<div className="bg-black/80 p-4 flex justify-center border-t border-white/10">` section and replace it with:

```typescript
<div className="bg-black/80 p-4 border-t border-white/10">
  {cameraMode.label === "Analyzing photo..." ? (
    <div className="flex flex-col items-center gap-2">
      <Loader2 className="h-8 w-8 text-accent animate-spin" />
      <p className="text-sm text-white/70">Analyzing photo with AI...</p>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleCameraCapture}
        className="h-16 w-16 rounded-full bg-white border-4 border-white/50 hover:scale-105 active:scale-95 transition-transform"
        data-testid="button-camera-capture"
      />
      <p className="text-[10px] text-white/40">Tap to capture</p>
    </div>
  )}
</div>
```

Add `Loader2` to the lucide imports at the top of the file if not already there (it is already imported).

---

## 7. SYSTEM INSTRUCTIONS UPDATE — Tell the Agent to Wait

In `server/realtime.ts`, update the `trigger_photo_capture` behavior description in the system instructions. Find item 6 in the Core Behaviors section and update it:

```typescript
6. **Photo Triggers:** Call trigger_photo_capture when:
   - Entering a new area (overview photo)
   - Adjuster describes visible damage (damage detail photo)
   - Test square count is mentioned (test square photo)
   - Moisture readings are abnormal (moisture documentation photo)
   - Adjuster says "take a photo" or "capture this"
   IMPORTANT: When you call trigger_photo_capture, the camera will open and WAIT for the adjuster to capture the photo. Do NOT continue talking until you receive the tool result. The result will include AI analysis of the captured photo — acknowledge what was captured and whether it matches what you expected. If the photo doesn't match, ask the adjuster to retake it.
```

---

## 8. VAD THRESHOLD TUNING — Reduce Background Noise Sensitivity

The OpenAI Realtime API uses server-side Voice Activity Detection (VAD) to decide when the user is speaking. The current session creation sends **no `turn_detection` configuration**, so it falls back to OpenAI defaults (threshold 0.5, silence duration 500ms). This is far too sensitive for field inspections where the adjuster is outside on a roof, near traffic, in wind, or around construction noise — the agent keeps interrupting itself or triggering on ambient sound.

### In `server/routes.ts`

Find the session creation body in the `POST /api/realtime/session` endpoint (around line 826-833). Add `turn_detection` to the request body:

```typescript
body: JSON.stringify({
  model: "gpt-4o-realtime-preview",
  voice: "alloy",
  instructions,
  tools: realtimeTools,
  input_audio_transcription: { model: "whisper-1" },
  modalities: ["audio", "text"],
  turn_detection: {
    type: "server_vad",
    threshold: 0.75,              // Higher = less sensitive to background noise (default 0.5)
    prefix_padding_ms: 400,       // Capture slightly more audio before detected speech onset
    silence_duration_ms: 800,     // Wait longer before considering the turn complete — adjusters pause mid-thought while inspecting
  },
}),
```

**Why these values:**
- `threshold: 0.75` — On a residential roof in wind, 0.5 fires constantly. 0.75 requires more confident speech detection. If the adjuster still has issues, they can speak slightly louder / more directly at the iPad.
- `prefix_padding_ms: 400` — Captures 400ms of audio before the VAD fires. Helps avoid clipping the first syllable of speech.
- `silence_duration_ms: 800` — Adjusters often pause while describing damage ("I see a... water stain... about four feet across"). 500ms would cut them off. 800ms gives natural breathing room while still being responsive.

---

## 9. MANDATORY FRONT-OF-HOUSE PHOTO — Property Verification on Start

Every inspection should begin with a front-of-property photo to verify the adjuster is at the correct address. The AI analysis of this photo validates it against the claim file data. This is insurance industry best practice and prevents costly "wrong property" errors.

### In `server/realtime.ts` — Update System Instructions

In the `buildSystemInstructions` function, update the **Guided Flow** section (Core Behavior #2). Replace the current Phase 1-8 list with a new mandatory Step 0 before Phase 1:

Find this text:
```
2. **Guided Flow:** Follow the 8-phase inspection flow:
   Phase 1: Pre-Inspection (review briefing highlights)
   Phase 2: Session Setup (confirm peril, price list, structures)
```

Replace with:
```
2. **Guided Flow:** Follow the inspection flow starting with mandatory property verification:

   **MANDATORY FIRST STEP — Property Verification Photo:**
   Before anything else, your FIRST action upon connecting must be:
   1. Greet the adjuster briefly: "Welcome to the ${claim.claimNumber} inspection. Before we begin, let's verify the property."
   2. Immediately call trigger_photo_capture with:
      - label: "Front of Property — ${claim.propertyAddress}, ${claim.city}, ${claim.state}"
      - photoType: "overview"
   3. When the photo result comes back with the AI analysis, compare what was captured against the claim data:
      - Does the visible structure match the property type from the briefing (e.g., single-family, townhome)?
      - Can you see a house number? Does it match the address on file?
      - Does the general condition match what's described in the claim?
   4. Confirm with the adjuster: "I can see [description from analysis]. This matches the property at [address] on the claim. We're good to proceed." OR if there's a mismatch: "The photo doesn't appear to match the property on file. Can you confirm we're at [address]?"
   5. Only after property verification is confirmed, proceed to Phase 1.

   Phase 1: Pre-Inspection (review briefing highlights)
   Phase 2: Session Setup (confirm peril, price list, structures)
```

**IMPORTANT:** The `${claim.propertyAddress}` and `${claim.city}` are already template literals in the system instructions — they will be interpolated with the actual claim data. The label passed to `trigger_photo_capture` will thus include the real address, which the GPT-4o Vision analysis endpoint will use to validate the photo (since the Vision prompt includes "This photo was requested as: [label]").

### Update the `trigger_photo_capture` Tool Description

In the `realtimeTools` array in `server/realtime.ts`, find the `trigger_photo_capture` tool definition (around line 143-156). Update its description to mention property verification:

Find:
```typescript
description: "Triggers the iPad camera to capture a photo. Call when evidence is needed for damage, overview, or test squares.",
```

Replace with:
```typescript
description: "Triggers the iPad camera to capture a photo. Call for property verification (mandatory first step), damage evidence, overview shots, or test squares. The camera will open and wait for the adjuster to capture — do NOT continue talking until you receive the result.",
```

### Add `address_verification` to photoType Enum

In the same tool definition, add `"address_verification"` to the `photoType` enum:

Find:
```typescript
photoType: { type: "string", enum: ["overview", "damage_detail", "test_square", "moisture", "pre_existing"] },
```

Replace with:
```typescript
photoType: { type: "string", enum: ["overview", "address_verification", "damage_detail", "test_square", "moisture", "pre_existing"] },
```

---

## 10. FILE CHECKLIST

| File | Action | What Changed |
|---|---|---|
| `shared/schema.ts` | MODIFIED | Added `analysis` (jsonb) and `matchesRequest` (boolean) columns to inspectionPhotos |
| `server/routes.ts` | MODIFIED | Added `POST /api/inspection/:sessionId/photos/:photoId/analyze` endpoint; Added `turn_detection` VAD config to Realtime session creation |
| `server/storage.ts` | MODIFIED | Added `updatePhoto()` method |
| `server/realtime.ts` | MODIFIED | Updated system instructions: mandatory front-of-house photo as first step, photo capture wait behavior in item 6; Updated `trigger_photo_capture` tool description and added `address_verification` to photoType enum |
| `client/src/pages/ActiveInspection.tsx` | MODIFIED | Deferred tool response for photo capture, new handleCameraCapture with analysis, camera cancel handler, photo gallery with thumbnails + analysis, FloorPlanSketch integration, RoomData interface update |
| `client/src/components/FloorPlanSketch.tsx` | NEW | Live SVG floor plan sketch with proportional room rectangles |

---

## 11. TESTING CHECKLIST

### Camera Workflow
1. Start a voice inspection and speak damage — when agent calls `trigger_photo_capture`:
   - Camera overlay opens ✓
   - Agent STOPS talking and waits ✓
   - "Tap to capture" text visible ✓

2. Capture a photo by pressing the shutter button:
   - "Analyzing photo..." spinner appears ✓
   - After 2-3 seconds, photo analysis completes ✓
   - Camera overlay closes ✓
   - Agent resumes speaking, acknowledges what was captured ✓
   - Photo appears in right panel with thumbnail ✓
   - AI analysis description shown under thumbnail ✓
   - Damage badges shown if damage detected ✓
   - Match/mismatch badge shown ✓

3. Close camera without capturing:
   - Agent receives "cancelled" result ✓
   - Agent asks if you want to retry ✓

4. If GPT-4o Vision API fails:
   - Photo still saves to Supabase ✓
   - Graceful fallback analysis stored ✓
   - Agent still resumes (never hangs) ✓

### Floor Plan Sketch
1. Before any rooms are created:
   - Empty state shows "Rooms will appear here as they're created" ✓

2. When voice agent creates a room with dimensions (e.g., "master bedroom 14 by 16"):
   - Room rectangle appears in the sketch with animation ✓
   - Dimensions label shows "14×16" ✓
   - Purple border for in-progress rooms ✓

3. When room is completed:
   - Border changes to green ✓

4. Current room highlighted:
   - Gold border on the currently active room ✓

5. Damage observations:
   - Red badge with count appears on room rectangle ✓

6. Click a room in the sketch:
   - Sets it as current room ✓
   - Room name updates in the area indicator ✓

### Background Noise / VAD
1. Start a voice session in a noisy environment (play ambient noise on another device):
   - Agent does NOT react to background noise ✓
   - Agent responds when you speak clearly ✓
   - Agent waits for natural pauses before responding (doesn't cut you off mid-sentence) ✓

2. Speak with natural pauses:
   - "I see a... water stain... about four feet across" → Agent waits for the full description ✓
   - Agent doesn't interpret pauses as end of turn ✓

### Mandatory Front-of-House Photo
1. Start a new inspection session and connect voice:
   - Agent's FIRST action is to greet and request a front-of-property photo ✓
   - Agent does NOT ask "where do you want to start?" before the property photo is taken ✓
   - Camera overlay opens with label showing the property address ✓

2. Capture a photo of the property front:
   - Agent acknowledges what it sees in the photo ✓
   - Agent confirms the property matches the claim data (address, property type) ✓
   - Agent then proceeds to Phase 1 (Pre-Inspection) ✓

3. If photo doesn't match (test with a photo of a different property):
   - Agent flags the mismatch ✓
   - Agent asks the adjuster to confirm they're at the correct address ✓

---

## Summary

PROMPT-05 addresses four issues:

**Camera Fix (the deeper problem):** The Realtime API tool call pattern requires a response before the agent continues. Previously, `trigger_photo_capture` returned "success" immediately — the agent kept talking while the camera was open, and had no idea what was photographed. Now the tool response is **deferred** via a `pendingPhotoCallRef` until the shutter is pressed, the photo is saved to Supabase, and GPT-4o Vision analyzes it. The agent receives the analysis result and can confirm what it sees, flag mismatches, or ask for a retake. The camera cancel button also sends a proper failure result so the agent never hangs.

**Live Sketch:** The `FloorPlanSketch` component renders an SVG floor plan in the right panel. Room rectangles are proportional to their real-world dimensions, color-coded by inspection status (gray=not started, purple=in progress, green=complete, gold border=current), and show damage count badges. The sketch builds out in real-time as the voice agent creates rooms, giving the adjuster a visual sense of the inspection taking shape.

**Background Noise Resilience:** The OpenAI Realtime session now includes explicit VAD (Voice Activity Detection) tuning: threshold raised from 0.5 → 0.75 to ignore ambient noise (wind, traffic, construction), silence duration extended to 800ms so the agent doesn't cut off adjusters mid-sentence, and prefix padding increased to 400ms to avoid clipping the first syllable of speech.

**Mandatory Front-of-House Photo:** Every inspection now begins with a mandatory property verification step before Phase 1. The agent's first action is to request a front-of-property photo, which GPT-4o Vision analyzes and the agent cross-references against the claim data (address, property type) to confirm the adjuster is at the correct location. If there's a mismatch, the agent flags it immediately — preventing costly "wrong property" errors.
