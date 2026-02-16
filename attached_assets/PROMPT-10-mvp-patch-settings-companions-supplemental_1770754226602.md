# PROMPT-10 — MVP Patch: Settings Wiring, Companion Code Fix, Supplemental ESX Delta

## Context

The Claims IQ Voice Inspector codebase is feature-complete across PROMPT-01 through PROMPT-09. This patch addresses three narrow remaining issues found during the MVP completeness audit:

1. **estimateEngine.ts** references 5 wrong companion catalog codes and is missing 2 trade codes
2. **User settings** are saved to the database but never read back at runtime — pricing defaults, voice config, and export preferences are all ignored
3. **Supplemental ESX export** returns the full session export instead of a delta

All changes are surgical — no new tables, no new pages, no new dependencies.

---

## FIX 1: estimateEngine.ts — Companion Codes + Trade Codes

### 1A. Update TRADE_CODES array

The current array has 14 entries. Add HVAC and GEN to match the seeded catalog (122 items across 16 trades).

**Current code** (around line 39):
```typescript
const TRADE_CODES = [
  'MIT', 'DEM', 'DRY', 'PNT', 'FLR', 'INS',
  'CAR', 'CAB', 'CTR', 'RFG', 'WIN', 'EXT',
  'ELE', 'PLM',
] as const;
```

**Replace with:**
```typescript
const TRADE_CODES = [
  'MIT', 'DEM', 'DRY', 'PNT', 'FLR', 'INS',
  'CAR', 'CAB', 'CTR', 'RFG', 'WIN', 'EXT',
  'ELE', 'PLM', 'HVAC', 'GEN',
] as const;
```

### 1B. Fix getCompanionSuggestions()

The current function references catalog codes that don't exist in the seeded `scope_line_items` table. Replace the entire function body.

**Current function** (around line 229) references these wrong codes:
- `RFG-UNDER-SF` → does not exist (correct code: `RFG-FELT-SQ`)
- `DRY-TAPE-LF` → does not exist (correct code: `DRY-TAPE-SF`)
- `DRY-JOINT-SF` → does not exist (correct code: `DRY-TEXT-SF`)
- `EXT-WRAP-SF` → does not exist in catalog at all (replace with `RFG-ICE-SQ`)
- `FLR-PAD-SF` → does not exist (correct code: `FLR-ULAY-SF`)

**Replace the entire `getCompanionSuggestions()` function with:**

```typescript
export function getCompanionSuggestions(
  existingItems: Array<{ category: string; xactCode?: string }>,
): Array<{ code: string; reason: string }> {
  const suggestions: Array<{ code: string; reason: string }> = [];
  const existingCodes = new Set(existingItems.map((i) => i.xactCode).filter(Boolean));
  const existingCategories = new Set(existingItems.map((i) => i.category.toUpperCase()));

  // Roofing companions
  const hasRoofing = existingItems.some(
    (i) => i.xactCode?.startsWith('RFG-SHIN') || i.category?.toUpperCase() === 'ROOFING',
  );
  if (hasRoofing) {
    if (!existingCodes.has('RFG-FELT-SQ')) {
      suggestions.push({ code: 'RFG-FELT-SQ', reason: 'Roofing felt underlayment required with shingle replacement' });
    }
    if (!existingCodes.has('RFG-ICE-SQ')) {
      suggestions.push({ code: 'RFG-ICE-SQ', reason: 'Ice & water shield recommended at eaves and valleys' });
    }
    if (!existingCodes.has('RFG-DRIP-LF')) {
      suggestions.push({ code: 'RFG-DRIP-LF', reason: 'Drip edge typically replaced with new shingles' });
    }
    if (!existingCodes.has('RFG-RIDG-LF')) {
      suggestions.push({ code: 'RFG-RIDG-LF', reason: 'Ridge cap shingles needed for roof replacement' });
    }
  }

  // Drywall companions
  const hasDrywall = existingItems.some(
    (i) => i.xactCode?.startsWith('DRY-') && !i.xactCode?.startsWith('DRY-TAPE') && !i.xactCode?.startsWith('DRY-TEXT'),
  );
  if (hasDrywall) {
    if (!existingCodes.has('DRY-TAPE-SF')) {
      suggestions.push({ code: 'DRY-TAPE-SF', reason: 'Tape and finish required for new drywall' });
    }
    if (!existingCodes.has('DRY-TEXT-SF')) {
      suggestions.push({ code: 'DRY-TEXT-SF', reason: 'Texture match required after drywall replacement' });
    }
  }

  // Flooring companions
  const hasFlooring = existingItems.some(
    (i) =>
      i.xactCode?.startsWith('FLR-CAR') ||
      i.xactCode?.startsWith('FLR-VIN') ||
      i.xactCode?.startsWith('FLR-LAM') ||
      i.xactCode?.startsWith('FLR-HWD'),
  );
  if (hasFlooring) {
    if (!existingCodes.has('FLR-ULAY-SF')) {
      suggestions.push({ code: 'FLR-ULAY-SF', reason: 'Underlayment typically required with new flooring' });
    }
    if (!existingCodes.has('FLR-BASE-LF')) {
      suggestions.push({ code: 'FLR-BASE-LF', reason: 'Baseboard often replaced or reinstalled with new flooring' });
    }
  }

  // Carpet-specific: pad
  const hasCarpet = existingItems.some((i) => i.xactCode === 'FLR-CAR-SF');
  if (hasCarpet && !existingCodes.has('FLR-CAR-PAD')) {
    suggestions.push({ code: 'FLR-CAR-PAD', reason: 'Carpet pad required with carpet installation' });
  }

  // Painting companions — if drywall present, painting likely needed
  if (hasDrywall && !existingCategories.has('PAINTING') && !existingCategories.has('PNT')) {
    suggestions.push({ code: 'PNT-WALL-SF', reason: 'Paint required after drywall replacement' });
    suggestions.push({ code: 'PNT-PRIM-SF', reason: 'Primer/sealer recommended for new drywall' });
  }

  // Demo → Haul
  const hasDemo = existingItems.some((i) => i.xactCode?.startsWith('DEM-'));
  if (hasDemo && !existingCodes.has('DEM-HAUL-EA')) {
    suggestions.push({ code: 'DEM-HAUL-EA', reason: 'Debris haul-off needed for demolished materials' });
  }

  // General — floor protection if 3+ trades
  const uniqueTrades = new Set(
    existingItems
      .map((i) => {
        if (i.xactCode) return i.xactCode.split('-')[0];
        return null;
      })
      .filter(Boolean),
  );
  if (uniqueTrades.size >= 3 && !existingCodes.has('GEN-PROT-SF')) {
    suggestions.push({ code: 'GEN-PROT-SF', reason: 'Floor protection recommended for multi-trade projects' });
  }

  return suggestions;
}
```

### 1C. Accept overrides in calculateEstimateTotals()

The current function has hardcoded `overheadPct = 0.10` and `profitPct = 0.10`. Add optional parameters so user settings can flow through.

**Current signature** (around line 114):
```typescript
export function calculateEstimateTotals(
  items: Array<{ totalPrice: number; category: string }>,
  taxRate: number = 0.08,
)
```

**Replace with:**
```typescript
export function calculateEstimateTotals(
  items: Array<{ totalPrice: number; category: string }>,
  taxRate: number = 0.08,
  overheadPctOverride?: number,
  profitPctOverride?: number,
)
```

And update the hardcoded values inside (around lines 157-158):

**Current:**
```typescript
const overheadPct = 0.10;
const profitPct = 0.10;
```

**Replace with:**
```typescript
const overheadPct = overheadPctOverride ?? 0.10;
const profitPct = profitPctOverride ?? 0.10;
```

---

## FIX 2: Wire User Settings to Runtime Behavior

User settings are saved via `PUT /api/settings` and stored in the `user_settings` table as JSONB. But no endpoint currently *reads* them to influence behavior. Three integration points need wiring:

### 2A. Pricing endpoints — read defaultRegion, defaultTaxRate, defaultOverheadPercent, defaultProfitPercent

**In `server/routes.ts`**, update the `POST /api/pricing/scope` handler (around line 1671).

**Current:**
```typescript
app.post("/api/pricing/scope", authenticateRequest, async (req, res) => {
  try {
    const { items, regionId, taxRate } = req.body;
    // ... uses taxRate || 0.08
    const totals = calculateEstimateTotals(pricedItems, taxRate || 0.08);
```

**Replace with:**
```typescript
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
    console.error("Server error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

### 2B. Voice session — read voiceModel, silenceDetectionSensitivity, assistantVerbosity

**In `server/routes.ts`**, update the `POST /api/realtime/session` handler (around line 1181).

**Current:** hardcodes `model: "gpt-4o-realtime-preview"`, `voice: "alloy"`, and `threshold: 0.75`, `silence_duration_ms: 800`.

**Replace the relevant section of the handler** (after fetching claim and briefing, before the fetch call):

```typescript
    // Load user preferences for voice configuration
    const userSettings = await storage.getUserSettings(req.user!.id);
    const s = (userSettings?.settings as Record<string, any>) || {};

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

    const instructions = buildSystemInstructions(briefing, claim) + verbosityHint;
```

Then update the fetch body:

```typescript
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview",
      voice: voiceModel,
      instructions,
      tools: realtimeTools,
      input_audio_transcription: { model: "whisper-1" },
      modalities: ["audio", "text"],
      turn_detection: s.pushToTalk
        ? null  // Push-to-talk = no server VAD
        : {
            type: "server_vad",
            threshold: vad.threshold,
            prefix_padding_ms: vad.prefix_padding_ms,
            silence_duration_ms: vad.silence_duration_ms,
          },
    }),
```

### 2C. Export endpoints — read includeTranscriptInExport, includePhotosInExport, companyName, adjusterLicenseNumber

**In `server/routes.ts`**, update the `POST /api/inspection/:sessionId/export/pdf` handler.

Before calling the PDF generator, load user settings and pass them:

```typescript
app.post("/api/inspection/:sessionId/export/pdf", authenticateRequest, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    // Load user export preferences
    const userSettings = await storage.getUserSettings(req.user!.id);
    const s = (userSettings?.settings as Record<string, any>) || {};

    const claim = await storage.getClaim(session.claimId);
    const rooms = await storage.getRooms(sessionId);
    const lineItems = await storage.getLineItems(sessionId);
    const photos = s.includePhotosInExport !== false ? await storage.getPhotos(sessionId) : [];
    const damages = await storage.getDamages(sessionId);
    const moistureReadings = await storage.getMoistureReadings(sessionId);
    const transcript = s.includeTranscriptInExport ? await storage.getTranscript(sessionId) : [];

    const pdfBuffer = await generatePDFReport({
      claim,
      session,
      rooms,
      lineItems,
      photos,
      damages,
      moistureReadings,
      transcript,
      companyName: s.companyName || 'Claims IQ',
      adjusterLicense: s.adjusterLicenseNumber || '',
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${claim?.claimNumber || 'inspection'}_report.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

**Note:** The current PDF generator uses `generateInspectionPDF(data: PDFReportData)` where `PDFReportData` is defined in `pdfGenerator.ts`. You need to extend the `PDFReportData` interface and update the function.

**In `server/pdfGenerator.ts`**, find the `PDFReportData` interface (around line 5) and add three new optional fields:

```typescript
interface PDFReportData {
  claim: any;
  session: any;
  rooms: any[];
  damages: any[];
  lineItems: any[];
  photos: any[];
  moistureReadings: any[];
  estimate: any;
  inspectorName: string;
  transcript?: any[];        // NEW — optional transcript entries
  companyName?: string;      // NEW — from user settings
  adjusterLicense?: string;  // NEW — from user settings
}
```

Update the caller in `routes.ts` to pass the new fields when calling `generateInspectionPDF()`:

```typescript
    const pdfBuffer = await generateInspectionPDF({
      claim,
      session,
      rooms,
      damages,
      lineItems,
      photos,
      moistureReadings,
      estimate: await storage.getEstimateSummary(sessionId),
      inspectorName: req.user!.fullName || 'Claims IQ Agent',
      transcript,
      companyName: s.companyName || 'Claims IQ',
      adjusterLicense: s.adjusterLicenseNumber || '',
    });
```

Then in the PDF generation code itself:

**Cover page** — find where it hardcodes "Claims IQ" (around line 135: `"Generated by Claims IQ — Insurance Property Inspection Platform"`):
```typescript
// Replace hardcoded company name:
const company = data.companyName || 'Claims IQ';
doc.text(`Generated by ${company} — Insurance Property Inspection Platform`, { align: 'center' });
```

**Inspector info section** — find where it uses `data.inspectorName` (around line 120):
```typescript
// After the inspector name line, add license:
doc.text(data.inspectorName || "Claims IQ Agent", ...);
if (data.adjusterLicense) {
  doc.text(`License: ${data.adjusterLicense}`);
}
```

**Transcript appendix** — after the photo appendix section (and moisture section if present), add:
```typescript
if (data.transcript && data.transcript.length > 0) {
  doc.addPage();
  doc.fontSize(18).text('VOICE TRANSCRIPT', { align: 'center' });
  doc.moveDown();
  for (const entry of data.transcript) {
    const speaker = entry.speaker === 'agent' ? 'AI Inspector' : 'Adjuster';
    doc.fontSize(8).fillColor('#666').text(speaker, { continued: true });
    doc.fillColor('#333').text(`: ${entry.content}`);
    doc.moveDown(0.3);
  }
}
```

---

## FIX 3: Supplemental ESX Delta Export

The current `POST /api/supplemental/:id/export/esx` endpoint is a placeholder that exports the entire parent session's line items.

**Replace it with a proper delta export** that only includes the supplemental changes (new items, modified items) and flags removed items.

**In `server/routes.ts`**, find the supplemental ESX export handler and replace:

```typescript
app.post("/api/supplemental/:id/export/esx", authenticateRequest, async (req, res) => {
  try {
    const supplementalId = parseInt(req.params.id);
    const supplemental = await storage.getSupplemental(supplementalId);
    if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });

    const session = await storage.getSession(supplemental.originalSessionId);
    if (!session) return res.status(404).json({ message: "Original session not found" });

    const claim = await storage.getClaim(session.claimId);
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

    // Generate ESX with supplemental metadata using the new data-driven function
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
    console.error("Server error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

**In `server/esxGenerator.ts`**, the current function signature is:
```typescript
export async function generateESXFile(sessionId: number, storage: IStorage): Promise<Buffer>
```

It fetches its own data internally. For supplemental support, refactor to accept an options object so the caller can provide delta line items:

```typescript
interface ESXOptions {
  claim: any;
  session: any;
  rooms: any[];
  lineItems: any[];
  isSupplemental?: boolean;       // NEW
  supplementalReason?: string;    // NEW
  removedItemIds?: number[];      // NEW
}

// Keep the original signature as a wrapper for backward compatibility:
export async function generateESXFile(sessionId: number, storage: IStorage): Promise<Buffer> {
  const session = await storage.getSession(sessionId);
  const claim = await storage.getClaim(session!.claimId);
  const rooms = await storage.getRooms(sessionId);
  const lineItems = await storage.getLineItems(sessionId);
  return generateESXFromData({ claim, session, rooms, lineItems });
}

// New function that both the original and supplemental callers use:
export async function generateESXFromData(options: ESXOptions): Promise<Buffer> {
  // ... move existing generation logic here, using options.lineItems etc.
}
```

Then update the supplemental export route to call `generateESXFromData()` directly with the delta items.

In `generateXactdoc()`, when `isSupplemental` is true, change the control point:
```typescript
const estimateType = options.isSupplemental ? 'SUPPLEMENT' : 'ESTIMATE';

// In the CONTROL_POINTS section:
const controlPoints = `
  <CONTROL_POINTS>
    <CONTROL_POINT name="ASSIGNMENT" status="COMPLETE"/>
    <CONTROL_POINT name="${estimateType}" status="COMPLETE"/>
  </CONTROL_POINTS>`;
```

Add a `NOTES` section in the XACTDOC when supplemental:
```typescript
if (options.isSupplemental) {
  xactdoc += `
    <NOTES>
      <NOTE type="SUPPLEMENTAL" date="${new Date().toISOString().split('T')[0]}">
        <TEXT>${escapeXml(options.supplementalReason || 'Supplemental claim')}</TEXT>
      </NOTE>
    </NOTES>`;
}
```

In `generateRoughDraft()`, for supplemental exports mark items with their provenance:
```typescript
// When building each LINE_ITEM in the rough draft:
const actionCode = item.provenance === 'supplemental_new' ? 'ADD' :
                   item.provenance === 'supplemental_modified' ? 'MOD' :
                   (item.action?.[0] || '&');
```

---

## File Checklist

| File | Change | Size |
|------|--------|------|
| `server/estimateEngine.ts` | Update TRADE_CODES (add HVAC, GEN), replace getCompanionSuggestions(), add overheadPctOverride/profitPctOverride params to calculateEstimateTotals() | ~80 lines changed |
| `server/routes.ts` | Update POST /api/pricing/scope to read user settings for region/tax/O&P; Update POST /api/realtime/session to read voice/VAD settings; Update POST export/pdf to read export preferences; Replace POST supplemental/:id/export/esx with delta logic | ~120 lines changed |
| `server/pdfGenerator.ts` | Update function signature for companyName, adjusterLicense, transcript; Add company name to cover; Add license to info section; Add transcript appendix | ~30 lines added |
| `server/esxGenerator.ts` | Add isSupplemental/supplementalReason/removedItemIds to interface; Add SUPPLEMENT control point; Add NOTES section; Mark delta items with provenance action codes | ~25 lines added |

**No new files. No new tables. No new dependencies. No new client pages.**

---

## Testing After This Prompt

Run these verification checks:

```sql
-- Verify catalog is seeded (should return 122)
SELECT count(*) FROM scope_line_items;

-- Verify pricing is seeded (should return 122)
SELECT count(*) FROM regional_price_sets WHERE region_id = 'US_NATIONAL';

-- Verify trade codes (should return 16)
SELECT DISTINCT trade_code FROM scope_line_items ORDER BY trade_code;
```

Then test the wired settings:

1. **Pricing**: Set `defaultRegion` to `US_NATIONAL` in settings, then call `POST /api/pricing/scope` without a `regionId` — it should use US_NATIONAL from settings
2. **Voice**: Change `silenceDetectionSensitivity` to `low` in settings, create a new Realtime session — verify `silence_duration_ms` is 1200
3. **PDF**: Set `companyName` to your company, generate a PDF — verify cover page uses it
4. **Supplemental ESX**: Create a supplemental with 2 new line items, export it — verify the ZIP only contains those 2 items (not the full session)

---

## Summary

This is a **code-only patch** — no schema migrations, no UI changes, no new pages. The SettingsPage.tsx already has the full UI for all these preferences. After this prompt, every setting the user changes will actually affect the application behavior. The companion suggestions will reference real catalog codes. And supplemental exports will contain only the delta changes that carriers expect.

Total estimated changes: ~255 lines across 4 files.
