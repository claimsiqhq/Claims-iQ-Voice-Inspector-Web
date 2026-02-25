# PDF Report Generation Guide

This document covers how `server/pdfGenerator.ts` produces Xactimate-style insurance estimate PDFs, the common pitfalls encountered, and the rules for generating a correct report.

---

## Architecture

The PDF is built with **PDFKit** (`pdfkit` npm package), a low-level library that gives absolute positioning control over every text element on a US Letter page (612 × 792 points).

### Page Constants

| Constant        | Value | Description                          |
|-----------------|-------|--------------------------------------|
| `PAGE_WIDTH`    | 612   | Letter width in points               |
| `PAGE_HEIGHT`   | 792   | Letter height in points               |
| `MARGIN`        | 40    | Left/right/top margin                |
| `CONTENT_WIDTH` | 532   | `PAGE_WIDTH - 2 * MARGIN`            |
| `BOTTOM_MARGIN` | 60    | Reserved space for footer             |

### Coordinate System

PDFKit uses an origin at the **top-left** of the page. `x` increases rightward, `y` increases downward. Every render function manually tracks a `y` cursor and uses `checkPageBreak(doc, yNeeded, currentY)` to insert a new page when content would overflow past `PAGE_HEIGHT - BOTTOM_MARGIN`.

---

## Page Sequence

When `roomEstimate` data is available (the normal case after an inspection), the report renders in this order:

| Page | Function                       | Content                                            |
|------|--------------------------------|----------------------------------------------------|
| 1    | `renderCoverageSummaryPage`    | Insured info, claim/date, RCV/ACV summary, UOM key |
| 2    | `renderClaimInfoPage`          | Insured, claim rep, policy, coverage table, dates   |
| 3    | `renderEstimateRecapPage`      | Per-room RCV/depreciation/ACV breakdown             |
| 4+   | `renderLineItemPages`          | Line items grouped by room with depreciation detail |
| N    | `renderSettlementSummaryPage`  | RCV → ACV → Net Claim waterfall                    |
| N+1  | `renderMoistureReport` (opt)   | Moisture readings (water claims only)               |
| N+2  | `renderTranscript` (opt)       | Voice transcript two-column layout                  |
| N+3  | `renderPhotoAppendix` (opt)    | Photo reference table with AI analysis              |

If `roomEstimate` is absent, a simpler legacy format is used (`renderLegacyCoverPage` + `renderLegacyEstimate`).

---

## Data Flow

The route handler at `server/routes/inspection.ts` (the `/export/pdf` endpoint) assembles the `PDFReportData` object:

1. **Line items** are fetched from the database, grouped by room.
2. **Depreciation** is recalculated at export time using `depreciationEngine.ts` — the PDF always reflects the latest depreciation rules.
3. **Coverage data** comes from the briefing's `coverageSnapshot`, which stores parsed policy values.
4. **Transcript** entries come from `voice_transcripts` table.
5. The assembled object is passed to `generateInspectionPDF()` which returns a `Buffer`.

---

## Critical Formatting Rules

### 1. Coverage Values Are Objects, Not Numbers

The briefing stores coverage amounts as objects:

```json
{
  "coverageA": { "label": "Dwelling", "limit": 553000 },
  "coverageB": { "label": "Other Structures", "limit": 5000 }
}
```

**Never pass these directly to `fmt()`.** Always extract the numeric limit first:

```typescript
function extractLimit(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "object" && val !== null && "limit" in val)
    return Number((val as any).limit) || 0;
  return Number(val) || 0;
}
```

Without this, the PDF renders `$[object Object]` instead of dollar amounts.

### 2. Line Item Column Alignment

The line item detail pages use a shared `COL` constant for consistent column positioning across the header, data rows, room totals, and grand totals:

```
COL.qtyX (40)     → QUANTITY / UNIT PRICE (left-aligned, "36.00 SF @ 2.50")
COL.taxX (185)    → TAX (right-aligned)
COL.rcvX (235)    → RCV (right-aligned)
COL.ageX (300)    → AGE/LIFE (right-aligned, "22/70 yrs")
COL.condX (355)   → COND. (right-aligned, always "Avg.")
COL.depPctX (385) → DEP % (right-aligned)
COL.deprecX (425) → DEPREC. (right-aligned)
COL.acvX (502)    → ACV (right-aligned)
```

The quantity/unit/price is formatted as a single Xactimate-style string: `"36.00 SF @ 2.50"` under one combined "QUANTITY / UNIT PRICE" header. This prevents the unit abbreviation from overlapping the unit price value.

### 3. Description and Data on Separate Rows

Each line item renders in two rows:
- **Row 1**: Line number + description (full width)
- **Row 2**: Numeric columns (quantity, tax, RCV, depreciation, ACV)

The description width should be `CONTENT_WIDTH - 10` to prevent it from running off the page. The height of the description text is measured with `doc.heightOfString()` to properly advance the y cursor for multi-line descriptions.

### 4. Skip Empty Rooms

Rooms with zero line items must be skipped in **both** the Estimate Recap page and the Line Item detail pages. Without this check, empty rooms (like "Front Elevation" with no scoped items) generate blank pages and zero-value rows in the recap.

```typescript
if (room.items.length === 0) continue;
```

### 5. Depreciation Display Conventions

Xactimate uses specific formatting for depreciation amounts:
- **Recoverable depreciation**: Parentheses → `(664.41)`
- **Non-recoverable depreciation**: Angle brackets → `<125.00>`
- **Depreciation percentage with [%] suffix**: Non-recoverable items show `31.43% [%]`

The `fmtDeprecAmount()`, `fmtParen()`, `fmtAngle()`, and `fmtDepPercent()` helper functions implement these conventions.

### 6. Age/Life Expectancy Display

Displayed as `AGE/LIFE yrs` (e.g., `22/70 yrs`). If life expectancy is unknown or zero, use `AGE/NA`. The age is the number of years since the property was built (derived from `yearBuilt` in the property profile), and life expectancy comes from the depreciation engine's category-specific tables.

### 7. Transcript Layout

The transcript uses a **two-column layout** instead of `continued: true`:
- Speaker label (75px wide) at `MARGIN`
- Content text at `MARGIN + 80` with remaining width

Each entry's height is pre-measured with `heightOfString()` to prevent overlap. Empty entries are skipped. Page breaks insert a "VOICE TRANSCRIPT (Continued)" header.

### 8. Footer on Every Page

Every page gets a footer via `addFooter()` with the date on the left and page number on the right. The first page calls `addFooter()` directly; subsequent pages use `newPage()` which calls `addFooter()` after `doc.addPage()`.

---

## Depreciation Engine Integration

The depreciation engine (`server/depreciationEngine.ts`) provides life expectancy tables by trade category. Key values:

| Category   | Keyword       | Life (years) |
|------------|---------------|--------------|
| Roofing    | asphalt       | 25           |
| Roofing    | metal         | 50           |
| Siding     | vinyl         | 40           |
| Drywall    | (default)     | 70           |
| Painting   | interior      | 15           |
| Painting   | exterior      | 10           |
| Flooring   | carpet        | 10           |
| Flooring   | hardwood      | 50           |
| Plumbing   | (default)     | 30           |
| Electrical | (default)     | 40           |

Depreciation percentage is calculated as: `min(100, (age / lifeExpectancy) * 100)`

The trade code prefix (e.g., `PNT` for painting) is mapped to the category name via the `TRADE_TO_CATEGORY` lookup.

---

## Number Formatting

All dollar amounts use `fmt()`:

```typescript
function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
```

This produces `"1,234.56"` format. Dollar signs are added explicitly where needed (`$${fmt(value)}`).

---

## Common Mistakes and How to Avoid Them

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Passing coverage objects to `fmt()` | `$[object Object]` in PDF | Use `extractLimit()` to get `.limit` |
| Same x-coordinate for unit label and unit price | Overlapping text columns | Use combined `QTY UNIT @ PRICE` format |
| Using `{ continued: true }` for multi-speaker text | Lines merge and overlap | Use fixed-position two-column layout |
| Not checking `room.items.length === 0` | Blank pages, zero rows in recap | Skip empty rooms with `continue` |
| Hardcoded column positions in totals rows | Totals misaligned with headers | Use shared `COL` constant object |
| `(doc as any).y` for cursor position | Unreliable after loops | Track `lastY` explicitly |
| Paint life expectancy of 7 years | 100% depreciation on recent paint | Use 15 years (interior) / 10 years (exterior) |
| Not measuring text height for wrapping | Text overlap on long descriptions | Use `doc.heightOfString()` before advancing y |

---

## Testing a PDF Export

1. Ensure the claim has at least one room with scoped line items.
2. Navigate to the claim's export page and download the PDF.
3. Verify:
   - Coverage amounts are numeric dollar values, not `[object Object]`.
   - Line item columns align with their headers.
   - Empty rooms do not appear in the recap or as separate pages.
   - Depreciation amounts use correct parentheses/angle bracket notation.
   - Transcript entries do not overlap.
   - Every page has a footer with date and page number.
   - Settlement summary math is correct: `RCV - Depreciation = ACV`, `ACV - Deductible = Net Claim`.
