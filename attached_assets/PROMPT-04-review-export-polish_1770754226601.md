# PROMPT-04 — Review, Export, Progress Map & Polish

> **Run this prompt in Replit after PROMPT-03 has been applied.**
> This prompt adds Screen 7 (Review & Finalize), Screen 8 (Export), Screen 6 (Progress Map slide-over), Screen 5b (Moisture Map panel), enhanced error handling, and UI polish. It does NOT touch Act 1, the WebRTC voice engine, or the existing tool execution chain.

---

## ⛔ WHAT NOT TO CHANGE

These files are COMPLETE and WORKING. Do not modify them unless this prompt explicitly says to:

| File | Why it's frozen |
|---|---|
| `server/openai.ts` | Act 1 GPT-4o extraction — fully wired |
| `server/supabase.ts` | Supabase client + bucket constants — done |
| `server/db.ts` | Drizzle connection — done |
| `server/realtime.ts` | System instructions + 10 voice tool definitions — done |
| `client/src/pages/ClaimsList.tsx` | Act 1 screen — done |
| `client/src/pages/DocumentUpload.tsx` | Act 1 screen — done |
| `client/src/pages/ExtractionReview.tsx` | Act 1 screen — done |
| `client/src/pages/InspectionBriefing.tsx` | Act 1 screen — done |

**In `ActiveInspection.tsx`:** You will make TWO small surgical changes (described in Section 6). Do NOT refactor, restructure, or rewrite anything else in that file. The WebRTC connection, data channel, tool execution `switch` block, and camera capture logic are all working.

**In `shared/schema.ts`:** Do NOT add new tables. All 11 tables already exist and are sufficient. You may add new Zod schemas or type exports if needed.

---

## 1. NEW ROUTES — `client/src/App.tsx`

Add two new routes and their lazy imports. Keep all existing routes unchanged.

```typescript
// Add these imports at the top, below the existing page imports:
import ReviewFinalize from "@/pages/ReviewFinalize";
import ExportPage from "@/pages/ExportPage";

// Add these two routes BEFORE the NotFound catch-all:
<Route path="/inspection/:id/review" component={ReviewFinalize} />
<Route path="/inspection/:id/export" component={ExportPage} />
```

The final route list should be:
1. `/` → ClaimsList
2. `/upload/:id` → DocumentUpload
3. `/review/:id` → ExtractionReview
4. `/briefing/:id` → InspectionBriefing
5. `/inspection/:id` → ActiveInspection
6. `/inspection/:id/review` → ReviewFinalize ← NEW
7. `/inspection/:id/export` → ExportPage ← NEW
8. `*` → NotFound

---

## 2. NEW API ENDPOINTS — `server/routes.ts`

Add these endpoints at the bottom of the `registerRoutes` function, AFTER the existing inspection endpoints and BEFORE the `return httpServer` line.

### 2a. Completeness Check

```typescript
// GET /api/inspection/:sessionId/completeness
app.get("/api/inspection/:sessionId/completeness", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getInspectionSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const claim = await storage.getClaim(session.claimId);
    const briefing = await storage.getBriefing(session.claimId);
    const rooms = await storage.getRooms(sessionId);
    const allLineItems = await storage.getLineItems(sessionId);
    const allPhotos = await storage.getPhotos(sessionId);
    const allDamages = await storage.getDamagesForSession(sessionId);
    const moistureReadings = await storage.getMoistureReadingsForSession(sessionId);

    // Build checklist from peril type
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

    if (perilType === "wind") {
      checklist.push({
        item: "All four elevations documented",
        satisfied: rooms.filter(r => r.roomType?.startsWith("exterior_")).length >= 4,
        evidence: `${rooms.filter(r => r.roomType?.startsWith("exterior_")).length} exterior areas`,
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

    // Scope gap detection: rooms with damage but no line items
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

    // Missing photo alerts: rooms with damage but no photos
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
    res.status(500).json({ message: error.message });
  }
});
```

### 2b. Grouped Line Items (for Estimate hierarchy view)

```typescript
// GET /api/inspection/:sessionId/estimate-grouped
app.get("/api/inspection/:sessionId/estimate-grouped", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const items = await storage.getLineItems(sessionId);
    const rooms = await storage.getRooms(sessionId);

    // Build hierarchy: category → room → line items
    const hierarchy: Record<string, Record<string, any[]>> = {};

    for (const item of items) {
      const category = item.category || "General";
      const room = rooms.find(r => r.id === item.roomId);
      const roomName = room ? room.name : "Unassigned";

      if (!hierarchy[category]) hierarchy[category] = {};
      if (!hierarchy[category][roomName]) hierarchy[category][roomName] = [];
      hierarchy[category][roomName].push(item);
    }

    // Calculate subtotals per category
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
    res.status(500).json({ message: error.message });
  }
});
```

### 2c. Photos Grouped by Room

```typescript
// GET /api/inspection/:sessionId/photos-grouped
app.get("/api/inspection/:sessionId/photos-grouped", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const photos = await storage.getPhotos(sessionId);
    const rooms = await storage.getRooms(sessionId);

    const grouped: Record<string, any[]> = {};
    for (const photo of photos) {
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
      totalPhotos: photos.length,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});
```

### 2d. Export Validation & Generation Stubs

```typescript
// POST /api/inspection/:sessionId/export/validate
app.post("/api/inspection/:sessionId/export/validate", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getInspectionSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const rooms = await storage.getRooms(sessionId);
    const items = await storage.getLineItems(sessionId);
    const photos = await storage.getPhotos(sessionId);

    const warnings: string[] = [];
    const blockers: string[] = [];

    if (items.length === 0) blockers.push("No line items in estimate");
    if (photos.length === 0) warnings.push("No photos captured");
    if (rooms.filter(r => r.status === "complete").length === 0) {
      warnings.push("No rooms marked as complete");
    }

    // Check for line items without quantities
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
    res.status(500).json({ message: error.message });
  }
});

// POST /api/inspection/:sessionId/export/esx
app.post("/api/inspection/:sessionId/export/esx", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getInspectionSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const claim = await storage.getClaim(session.claimId);
    const items = await storage.getLineItems(sessionId);
    const rooms = await storage.getRooms(sessionId);

    // Build ESX-compatible XML structure
    // This is a simplified ESX skeleton — full Xactimate ESX requires their SDK
    const xmlLines: string[] = [];
    xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlLines.push('<Estimate>');
    xmlLines.push(`  <ClaimNumber>${claim?.claimNumber || ""}</ClaimNumber>`);
    xmlLines.push(`  <InsuredName>${claim?.insuredName || ""}</InsuredName>`);
    xmlLines.push(`  <PropertyAddress>${claim?.propertyAddress || ""}</PropertyAddress>`);
    xmlLines.push(`  <DateOfLoss>${claim?.dateOfLoss || ""}</DateOfLoss>`);
    xmlLines.push('  <LineItems>');

    for (const item of items) {
      const room = rooms.find(r => r.id === item.roomId);
      xmlLines.push('    <LineItem>');
      xmlLines.push(`      <Category>${item.category}</Category>`);
      xmlLines.push(`      <Action>${item.action || ""}</Action>`);
      xmlLines.push(`      <Description>${item.description}</Description>`);
      xmlLines.push(`      <Room>${room?.name || "Unassigned"}</Room>`);
      xmlLines.push(`      <Quantity>${item.quantity || 0}</Quantity>`);
      xmlLines.push(`      <Unit>${item.unit || "EA"}</Unit>`);
      xmlLines.push(`      <UnitPrice>${item.unitPrice || 0}</UnitPrice>`);
      xmlLines.push(`      <TotalPrice>${item.totalPrice || 0}</TotalPrice>`);
      xmlLines.push(`      <WasteFactor>${item.wasteFactor || 0}</WasteFactor>`);
      xmlLines.push(`      <DepreciationType>${item.depreciationType || "Recoverable"}</DepreciationType>`);
      xmlLines.push('    </LineItem>');
    }

    xmlLines.push('  </LineItems>');
    xmlLines.push('</Estimate>');

    const xml = xmlLines.join("\n");
    const fileName = `${claim?.claimNumber || "estimate"}_export.esx`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(xml);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/inspection/:sessionId/export/pdf
app.post("/api/inspection/:sessionId/export/pdf", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getInspectionSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const claim = await storage.getClaim(session.claimId);
    const rooms = await storage.getRooms(sessionId);
    const items = await storage.getLineItems(sessionId);
    const photos = await storage.getPhotos(sessionId);
    const damages = await storage.getDamagesForSession(sessionId);
    const moisture = await storage.getMoistureReadingsForSession(sessionId);
    const estimate = await storage.getEstimateSummary(sessionId);

    // Return structured JSON for client-side PDF generation
    // (The client will use a library like jsPDF or html2pdf to render)
    res.json({
      claim: {
        claimNumber: claim?.claimNumber,
        insuredName: claim?.insuredName,
        propertyAddress: claim?.propertyAddress,
        city: claim?.city,
        state: claim?.state,
        zip: claim?.zip,
        dateOfLoss: claim?.dateOfLoss,
        perilType: claim?.perilType,
      },
      inspection: {
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        roomCount: rooms.length,
        completedRooms: rooms.filter(r => r.status === "complete").length,
      },
      rooms: rooms.map(r => ({
        name: r.name,
        structure: r.structure,
        status: r.status,
        damages: damages.filter(d => d.roomId === r.id).map(d => ({
          description: d.description,
          damageType: d.damageType,
          severity: d.severity,
          location: d.location,
        })),
        lineItems: items.filter(li => li.roomId === r.id).map(li => ({
          category: li.category,
          action: li.action,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          unitPrice: li.unitPrice,
          totalPrice: li.totalPrice,
        })),
        photos: photos.filter(p => p.roomId === r.id).map(p => ({
          caption: p.caption,
          photoType: p.photoType,
          autoTag: p.autoTag,
        })),
      })),
      moistureReadings: moisture.map(m => ({
        location: m.location,
        reading: m.reading,
        materialType: m.materialType,
        dryStandard: m.dryStandard,
      })),
      estimate,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/inspection/:sessionId/status
app.patch("/api/inspection/:sessionId/status", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const { status } = req.body;
    const validStatuses = ["active", "review", "exported", "submitted", "approved"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }
    const session = await storage.updateSessionStatus(sessionId, status);
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});
```

---

## 3. NEW PAGE — `client/src/pages/ReviewFinalize.tsx`

Create this file at `client/src/pages/ReviewFinalize.tsx`.

This is Screen 7 from the UX spec: a tabbed interface with Estimate, Photos, Completeness, and Notes tabs.

### Design Requirements

- **Portrait orientation** (1024 × 1366)
- **Claims IQ brand colors:** Primary Purple `#7763B7`, Deep Purple `#342A4F`, Gold `#C6A54E`, Secondary Purple `#9D8BBF`
- **Typography:** Work Sans for headings, Source Sans 3 for body
- **Tabs:** Use shadcn Tabs component with Claims IQ styled active indicator (Primary Purple underline)
- **Sticky summary card** at the bottom of the Estimate tab

### Structure

```typescript
import React, { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft, ChevronDown, ChevronRight, DollarSign,
  Camera, CheckCircle2, AlertTriangle, FileText,
  Edit3, Trash2, ImageIcon, AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export default function ReviewFinalize({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
```

### Tab 1: Estimate

Fetch from `GET /api/inspection/:sessionId/estimate-grouped`.

Build a **collapsible hierarchy tree**: Category → Room → Line Items.

Each category row shows the category name and subtotal. Clicking expands to show room groups. Each room group shows room name and room subtotal. Clicking expands to show individual line items.

Each **line item row** displays:
- Description (primary text)
- Action badge (R&R, Repair, etc.) — small pill, Secondary Purple bg
- Quantity + Unit (e.g., "28 SQ")
- Unit Price
- Total Price (bold, right-aligned)
- Depreciation type as a small text label
- Provenance indicator: tiny "voice" or "manual" badge

Tapping a line item opens an **inline edit form** (not a modal — the row expands):
- Quantity input (number)
- Unit Price input (number)
- Notes textarea
- Save / Cancel buttons
- Delete button (red, with confirmation)

Use `PATCH /api/inspection/:sessionId/line-items/:id` for edits and `DELETE /api/inspection/:sessionId/line-items/:id` for deletion. Both endpoints already exist.

**Sticky Summary Card** at the bottom:
- Background: Deep Purple `#342A4F`
- Text: white
- Layout: 2×2 grid
  - RCV Total (large, Gold `#C6A54E`)
  - Depreciation
  - ACV Total
  - Deductible (from briefing's coverageSnapshot)
- Net Claim = ACV − Deductible (largest number, Gold)
- Policy limit comparison: thin horizontal bar showing claim amount vs Coverage A limit. Bar uses Primary Purple fill. If claim exceeds 80% of limit, bar turns Gold with a warning icon.

### Tab 2: Photos

Fetch from `GET /api/inspection/:sessionId/photos-grouped`.

**Gallery grid** organized by room:
- Room name header with photo count badge
- 3-column grid of photo thumbnails (use the base64 data or placeholder if no storagePath)
- Each thumbnail shows: auto-tag overlay at bottom, photoType icon badge at top-right corner
- Tapping expands to a **photo detail view** (motion.div overlay):
  - Full image
  - Caption (editable)
  - Auto-tag
  - Timestamp
  - Linked damage observation (if damageId exists, fetch and show the damage description)

**Filter bar** at the top:
- Pill buttons for: All, Overview, Damage Detail, Test Square, Moisture, Pre-Existing
- Filter by photoType field

**Missing Photo Alerts**: If completeness data indicates missing photos, show an amber (`#F59E0B`) alert card at the top:
- AlertTriangle icon
- "Missing: [room name] has damage documented but no photos"

### Tab 3: Completeness

Fetch from `GET /api/inspection/:sessionId/completeness`.

**Completeness Score** at top:
- Large circular progress indicator (SVG circle)
- Percentage in center (Work Sans bold)
- Ring color: Green if ≥80%, Gold if 50-79%, Red if <50%
- Text below: "X of Y items complete"

**Checklist**: Each item as a card:
- Left: CheckCircle2 (green) if satisfied, AlertCircle (red/amber) if not
- Center: Item text
- Right: Evidence text (gray, smaller)
- Unsatisfied items grouped at the top with red left-border accent

**Scope Gaps** section (if any):
- Section header: "AI-Detected Scope Gaps" with Gold left-border
- Each gap as a card: room name, issue description
- Two action buttons per gap: "Add Line Item" (navigates back to inspection) or "Dismiss"

**Missing Photos** section (if any):
- Similar to scope gaps, with camera icon
- "Return to Capture" button navigates back to ActiveInspection

### Tab 4: Notes

**Adjuster Notes** text area:
- Large textarea (min 6 rows)
- Placeholder: "Add any final observations, special circumstances, or notes for the reviewer..."
- Auto-saves on blur using `PATCH /api/inspection/:sessionId` with `{ notes: text }` — you'll need to add a `notes` field. Actually, use the existing `complete_inspection` notes mechanism: store notes in the voiceTranscripts table with speaker "adjuster_notes" or use a simple local state that gets sent on export.

**Voice Transcript** (read-only):
- Collapsible section: "View Full Transcript"
- Fetch from `GET /api/inspection/:sessionId/transcript`
- Alternating rows: user utterances (left-aligned, gray bg) and agent responses (right-aligned, purple-tinted bg `#EDEAFF`)
- Timestamp on each entry

### Navigation

**Header bar:**
- Back arrow → navigates to `/inspection/${claimId}` (resume inspection)
- Title: "Review & Finalize" + claim number
- Right side: "Export" button (Primary Purple) → navigates to `/inspection/${claimId}/export`

**Bottom action bar** (sticky):
- "Resume Inspection" button (outline) → `/inspection/${claimId}`
- "Proceed to Export" button (Primary Purple, filled) → `/inspection/${claimId}/export`

---

## 4. NEW PAGE — `client/src/pages/ExportPage.tsx`

Create this file at `client/src/pages/ExportPage.tsx`.

This is Screen 8 from the UX spec.

### Design Requirements

Same brand system. Portrait orientation. Three large cards, vertically stacked with generous spacing.

### Structure

```typescript
import React, { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  FileSpreadsheet, FileText, Send, CheckCircle2,
  AlertTriangle, Download, Loader2, ChevronLeft, ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export default function ExportPage({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
```

### Validation Gate

On mount, call `POST /api/inspection/:sessionId/export/validate`.

If there are **blockers** (canExport === false):
- Show a red-bordered modal/card that prevents proceeding
- List each blocker with an X icon
- "Return to Review" button

If there are **warnings** (canExport === true but warnings exist):
- Show an amber banner at the top listing warnings
- Allow proceeding but make the warnings visible

### Card 1: ESX for Xactimate

- Icon: FileSpreadsheet (lucide)
- Title: "ESX for Xactimate"
- Description: "Export estimate as Xactimate-compatible ESX file"
- Stats row: "X line items • Y structures • Z rooms"
- "Generate ESX" button (Primary Purple)
- On click: POST to `/api/inspection/:sessionId/export/esx`
- After generation: show a "Download" button and the file name
- Use `window.URL.createObjectURL` to create a downloadable blob

### Card 2: PDF Inspection Report

- Icon: FileText (lucide)
- Title: "PDF Inspection Report"
- Description: "Full inspection report with photos, damage documentation, and estimate"
- Stats row: "X photos • Y damages • Z moisture readings"
- "Generate PDF" button (Primary Purple)
- On click: POST to `/api/inspection/:sessionId/export/pdf` to get structured JSON
- Use the returned data to build a client-side HTML report, then trigger `window.print()` or use a library
- For now, render a styled report preview div and offer a "Print / Save as PDF" button that calls `window.print()`

### Card 3: Submit for Review

- Icon: Send (lucide)
- Title: "Submit for Review"
- Description: "Send to carrier or supervisor for approval"
- Status badge showing current status (Draft / Submitted / Under Review / Approved)
- "Submit" button (Gold `#C6A54E` background, Deep Purple text)
- On click: PATCH `/api/inspection/:sessionId/status` with `{ status: "submitted" }`
- After submission: card shows green check, status changes to "Submitted", button becomes disabled

### Navigation

**Header bar:**
- Back arrow → `/inspection/${claimId}/review`
- Title: "Export" + claim number

**Bottom:** "Back to Review" link

---

## 5. NEW COMPONENT — `client/src/components/ProgressMap.tsx`

This is Screen 6 from the UX spec. It renders as a **slide-over panel** inside ActiveInspection.

### Trigger

In ActiveInspection.tsx, the adjuster can:
1. Say "show me the progress map" (handled by the `get_progress` tool — extend the tool result to include a `showProgressMap: true` flag)
2. Tap a map icon button in the left sidebar

### Component Design

```typescript
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Circle, AlertTriangle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressMapProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: number;
  rooms: Array<{
    id: number;
    name: string;
    status: string;
    damageCount: number;
    photoCount: number;
    structure?: string;
    phase?: number;
  }>;
  currentPhase: number;
  onNavigateToRoom: (roomId: number) => void;
}
```

### Layout

- Slides in from the left, overlaying the left sidebar (width: 400px)
- Background: white with subtle shadow
- Header: "Progress Map" + close X button + completeness score badge

**Completeness Score Bar:**
- Horizontal progress bar at top
- Percentage label: "72% Complete — 3 areas remaining"
- Bar fill: Primary Purple `#7763B7`

**Structure Sections:**
Group rooms by `structure` field. Each structure is a collapsible section:
- Header: structure name (e.g., "Main Dwelling") with room count
- Room blocks in a 2-column grid:
  - Card with colored left border:
    - Gray border = `not_started`
    - Primary Purple `#7763B7` border = `in_progress`
    - Green `#22C55E` border = `complete`
    - Gold `#C6A54E` border = flagged
  - Room name (bold)
  - Damage count icon + number
  - Photo count icon + number
  - Tap to navigate: calls `onNavigateToRoom(roomId)`

**Exterior Sections:**
Group exterior rooms (phase 3) separately:
- Roof, Gutters, each elevation
- Same card style but arranged in a row

---

## 6. SURGICAL CHANGES TO `ActiveInspection.tsx`

Make ONLY these changes. Do not touch anything else in the file.

### 6a. Fix `complete_inspection` Navigation

Find this block (around line 347-353):

```typescript
case "complete_inspection": {
  if (!sessionId) { result = { success: false }; break; }
  await fetch(`/api/inspection/${sessionId}/complete`, { method: "POST" });
  result = { success: true, message: "Inspection finalized." };
  setTimeout(() => setLocation("/"), 2000);
  break;
}
```

Change the `setTimeout` line to:

```typescript
  setTimeout(() => setLocation(`/inspection/${claimId}/review`), 2000);
```

This sends the adjuster to the Review & Finalize screen instead of back to the claims list.

### 6b. Add Progress Map Toggle

Add this state variable near the other state declarations (around line 67-90):

```typescript
const [showProgressMap, setShowProgressMap] = useState(false);
```

Add the ProgressMap import at the top of the file:

```typescript
import ProgressMap from "@/components/ProgressMap";
```

Add a small map icon button at the bottom of the left sidebar's area list section. Find the left sidebar `<div>` and add before its closing tag:

```typescript
<Button
  variant="ghost"
  size="sm"
  className="w-full mt-2 text-xs"
  onClick={() => setShowProgressMap(true)}
>
  <MapPin className="h-3 w-3 mr-1" />
  Progress Map
</Button>
```

Render the ProgressMap component at the end of the component's return, just before the closing `</div>` of the outermost container:

```typescript
<ProgressMap
  isOpen={showProgressMap}
  onClose={() => setShowProgressMap(false)}
  sessionId={sessionId!}
  rooms={rooms}
  currentPhase={currentPhase}
  onNavigateToRoom={(roomId) => {
    setCurrentRoomId(roomId);
    setShowProgressMap(false);
  }}
/>
```

### 6c. Add "Review" Navigation Button

In the quick action bar at the bottom of center stage, add a Review button:

```typescript
<Button
  variant="ghost"
  size="sm"
  className="text-xs"
  onClick={() => setLocation(`/inspection/${claimId}/review`)}
>
  <FileText className="h-4 w-4 mr-1" />
  Review
</Button>
```

Add `FileText` to the lucide-react imports. Also add `MapPin` to the imports.

---

## 7. NEW COMPONENT — `client/src/components/MoistureMap.tsx`

This is Screen 5b from the UX spec. It renders as a **panel** that replaces the right sidebar during Phase 5, or as a dedicated section within the Review page.

### Component Design

```typescript
import React, { useMemo } from "react";
import { Droplets, Wind, Thermometer, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MoistureReading {
  id: number;
  location: string;
  reading: number;
  materialType?: string;
  dryStandard?: number;
}

interface MoistureMapProps {
  readings: MoistureReading[];
  roomName?: string;
  roomDimensions?: { length: number; width: number };
  showDryingCalculator?: boolean;
}
```

### Moisture Grid

- SVG-based room outline (simple rectangle using roomDimensions if available, or a generic 300×200 rectangle)
- Each reading plotted as a colored circle at an estimated position:
  - Parse the `location` string for positional hints (e.g., "north wall" → top of rectangle, "center" → middle)
  - If no positional hint can be parsed, distribute readings evenly
- Circle colors:
  - Green `#22C55E`: reading < 14% (dry)
  - Amber `#F59E0B`: reading 14-17% (caution)
  - Red `#EF4444`: reading > 17% (wet)
- Each circle shows the reading value as a label

### Reading List

Below the grid, a table:
- Columns: Location | Reading | Material | Dry Standard | Status
- Status column: colored badge (Dry/Caution/Wet)
- Rows sorted by reading descending (wettest first)

### IICRC Classification

If `showDryingCalculator` is true, add a section below the reading list:

**Water Category** (derive from damage observations — or let the user select):
- Category 1: Clean water (supply line break)
- Category 2: Gray water (dishwasher, washing machine)
- Category 3: Black water (sewage, flooding)
- Display as a selectable set of 3 cards

**Damage Class** (derive from moisture data):
- Class 1: <5% of room affected, materials with low porosity
- Class 2: 5-40% affected, carpet and cushion wet
- Class 3: >40% affected, walls wet from floor to ceiling
- Class 4: Specialty: hardwood, concrete, plaster
- Auto-suggest based on number of wet readings vs total readings

**Equipment Recommendation** (calculated):
Based on class + affected area (use room dimensions):
- Air movers: 1 per 10-16 LF of wall (Class 1-2) or 1 per 7 LF (Class 3)
- Dehumidifiers: 1 per 1000 SF for Class 1, 1 per 600 SF for Class 2-3
- Air scrubbers: 1 per 500 SF for Category 2-3

Display as a summary card:
- Equipment icon + name + recommended count
- Estimated drying duration: 3-5 days (Class 1-2), 5-7 days (Class 3-4)
- "Add Equipment to Estimate" button that generates line items:
  - Each piece of equipment as a line item with category "General", action "Install", unit "DAY", quantity = drying days

---

## 8. ENHANCED VOICE INDICATOR — `client/src/components/VoiceIndicator.tsx`

Replace the existing VoiceIndicator with an enhanced version that supports error and disconnected states.

```typescript
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WifiOff, AlertTriangle } from "lucide-react";

interface VoiceIndicatorProps {
  status: "idle" | "listening" | "processing" | "speaking" | "error" | "disconnected";
  className?: string;
}

export default function VoiceIndicator({ status, className }: VoiceIndicatorProps) {
  if (status === "disconnected") {
    return (
      <div className={cn("flex items-center justify-center gap-2 h-12", className)}>
        <WifiOff className="h-5 w-5 text-destructive animate-pulse" />
        <span className="text-sm text-destructive font-medium">Disconnected</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={cn("flex items-center justify-center gap-2 h-12", className)}>
        <AlertTriangle className="h-5 w-5 text-[#C6A54E] animate-pulse" />
        <span className="text-sm text-[#C6A54E] font-medium">Error — Retrying</span>
      </div>
    );
  }

  const barColor =
    status === "listening" ? "bg-[#7763B7]" :
    status === "speaking" ? "bg-[#C6A54E]" :
    status === "processing" ? "bg-[#9D8BBF]" :
    "bg-muted-foreground/30";

  return (
    <div className={cn("flex items-center justify-center gap-1 h-12", className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <motion.div
          key={i}
          className={cn("w-1.5 rounded-full", barColor)}
          initial={{ height: 8 }}
          animate={{
            height: status === "idle" ? 8 : [8, 28, 8],
            opacity: status === "idle" ? 0.4 : 1,
          }}
          transition={{
            duration: status === "idle" ? 0 : 0.7,
            repeat: Infinity,
            delay: i * 0.08,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
```

Key changes:
- Now handles `"error"` and `"disconnected"` states visually
- Uses exact Claims IQ brand hex values instead of CSS variable names
- Listening = Primary Purple `#7763B7` (adjuster is talking)
- Speaking = Gold `#C6A54E` (agent is talking — gold draws attention)
- Processing = Secondary Purple `#9D8BBF` (thinking)
- Error = Gold with AlertTriangle
- Disconnected = Red with WifiOff

---

## 9. ERROR RECOVERY PATTERNS

### 9a. Voice Reconnection

In `ActiveInspection.tsx`, find the `dc.onclose` handler (around line 467-470):

```typescript
dc.onclose = () => {
  setIsConnected(false);
  setVoiceState("disconnected");
};
```

Add auto-reconnect logic. Replace with:

```typescript
dc.onclose = () => {
  setIsConnected(false);
  setVoiceState("disconnected");
  // Auto-reconnect after 3 seconds
  setTimeout(() => {
    if (!pcRef.current || pcRef.current.connectionState === "closed") {
      connectVoice();
    }
  }, 3000);
};
```

### 9b. Disconnected Banner

In the ActiveInspection.tsx render, add a disconnected banner at the very top of the main container (inside the outermost div, before the three-panel layout):

```typescript
{voiceState === "disconnected" && !isConnecting && (
  <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between text-sm">
    <div className="flex items-center gap-2">
      <WifiOff className="h-4 w-4" />
      <span>Voice disconnected — Reconnecting...</span>
    </div>
    <Button
      variant="ghost"
      size="sm"
      className="text-white hover:text-white/80 hover:bg-white/10"
      onClick={connectVoice}
    >
      Reconnect Now
    </Button>
  </div>
)}
```

### 9c. Error Toast

In the `handleRealtimeEvent` error case (around line 419-422), add a toast notification:

```typescript
case "error":
  console.error("Realtime error:", event.error);
  setVoiceState("error");
  // Auto-recover after 5 seconds
  setTimeout(() => {
    if (voiceState === "error") setVoiceState("idle");
  }, 5000);
  break;
```

---

## 10. STYLING & THEME ALIGNMENT

### Tailwind Config

Ensure these CSS custom properties are defined in `client/src/index.css` (or wherever the theme is set). If they use shadcn defaults, override to match Claims IQ:

```css
:root {
  --primary: 259 42% 59%;       /* #7763B7 */
  --primary-foreground: 0 0% 100%;
  --secondary: 270 24% 71%;     /* #9D8BBF */
  --secondary-foreground: 260 30% 25%;
  --accent: 40 49% 54%;         /* #C6A54E */
  --accent-foreground: 260 30% 20%;
  --destructive: 0 84% 60%;
  --muted: 260 10% 95%;
  --muted-foreground: 260 10% 45%;
  --card: 0 0% 100%;
  --card-foreground: 260 30% 20%;
  --background: 260 10% 97%;    /* very light purple tint */
  --foreground: 260 30% 15%;    /* #342A4F */
  --radius: 0.5rem;
}
```

### Font Stack

If not already configured, add to `client/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
```

And in the Tailwind config or index.css:

```css
body {
  font-family: 'Source Sans 3', 'Source Sans Pro', system-ui, sans-serif;
}
h1, h2, h3, h4, h5, h6 {
  font-family: 'Work Sans', system-ui, sans-serif;
}
.font-mono, code, pre {
  font-family: 'Space Mono', monospace;
}
```

---

## 11. FILE CHECKLIST

When complete, verify these files exist and are functional:

| File | Action | Lines (approx) |
|---|---|---|
| `client/src/App.tsx` | MODIFIED — 2 new routes + imports | ~45 |
| `server/routes.ts` | MODIFIED — 6 new endpoints added at bottom | ~950 |
| `client/src/pages/ReviewFinalize.tsx` | NEW — Screen 7 | ~500-600 |
| `client/src/pages/ExportPage.tsx` | NEW — Screen 8 | ~350-400 |
| `client/src/components/ProgressMap.tsx` | NEW — Screen 6 slide-over | ~200-250 |
| `client/src/components/MoistureMap.tsx` | NEW — Screen 5b | ~300-350 |
| `client/src/components/VoiceIndicator.tsx` | REPLACED — enhanced version | ~55 |
| `client/src/pages/ActiveInspection.tsx` | MODIFIED — 3 surgical changes only | ~990 |
| `client/src/index.css` | MODIFIED — theme variables if needed | +15 |

---

## 12. TESTING CHECKLIST

After implementing, verify:

1. **Route Navigation:**
   - Completing an inspection via voice navigates to `/inspection/:id/review` (not "/")
   - Review page loads with all 4 tabs functional
   - "Proceed to Export" navigates to `/inspection/:id/export`
   - "Resume Inspection" navigates back to `/inspection/:id`
   - Back arrows work correctly on all new pages

2. **Estimate Tab:**
   - Hierarchy tree loads and collapses/expands
   - Line items can be edited inline (quantity, unit price)
   - Line items can be deleted with confirmation
   - Summary card shows correct RCV, depreciation, ACV, net claim
   - Totals update after edits

3. **Photos Tab:**
   - Photos grouped by room
   - Filter pills work (All, Overview, Damage Detail, etc.)
   - Photo detail expands on tap
   - Missing photo alerts appear when appropriate

4. **Completeness Tab:**
   - Completeness score renders correctly
   - Checklist items show satisfied/unsatisfied state
   - Scope gaps are listed with action buttons
   - "Return to capture" navigates correctly

5. **Export Page:**
   - Validation gate blocks export if no line items
   - Warnings shown but don't block
   - ESX download works (produces XML file)
   - PDF data endpoint returns structured JSON
   - Submit for Review changes status to "submitted"

6. **Progress Map:**
   - Opens as slide-over from left sidebar button
   - Shows rooms grouped by structure
   - Room cards color-coded by status
   - Completeness bar accurate
   - Tapping a room card closes the map and sets current room

7. **Moisture Map:**
   - Readings plotted on grid with correct colors
   - Reading list table renders all data
   - IICRC classification displays if enabled
   - Equipment calculator generates reasonable recommendations

8. **Voice Indicator:**
   - All 6 states render correctly
   - Listening = purple bars, Speaking = gold bars
   - Error = gold warning, Disconnected = red wifi-off

9. **Error Recovery:**
   - Disconnected banner appears when voice drops
   - Auto-reconnect fires after 3 seconds
   - Manual "Reconnect Now" button works
   - Error state auto-clears after 5 seconds

---

## Summary

PROMPT-04 adds **4 new files** (ReviewFinalize, ExportPage, ProgressMap, MoistureMap), **replaces 1 file** (VoiceIndicator), and makes **surgical edits** to 3 existing files (App.tsx, routes.ts, ActiveInspection.tsx). It does NOT touch Act 1, does NOT add database tables, and does NOT modify the WebRTC voice engine. The complete_inspection tool now properly routes to the Review screen, closing the loop from voice inspection → review → export.
