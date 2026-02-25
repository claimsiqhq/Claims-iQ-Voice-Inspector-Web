/**
 * photoScopeBridge.ts
 *
 * Bridges photo analysis results to damage observations.
 * When GPT-4o Vision detects damage in a photo, this service maps Vision damage
 * types to our damageType enum and returns suggested damage observations for
 * the voice agent to confirm.
 *
 * PROMPT-30 Part D: Confidence tiers filter suggestions by score.
 */

import { getTierForScore, getTierMetadata, type ConfidenceTier } from "./types/photoConfidence";

// ─── Vision Damage Type → Our Damage Type Mapping ──────────────────────────

const VISION_TO_DAMAGE_TYPE: Record<string, string> = {
  // Water damage
  "water damage": "water_intrusion",
  "water stain": "water_stain",
  "water staining": "water_stain",
  "moisture damage": "water_intrusion",
  "mold": "mold",
  "mildew": "mold",
  "swelling": "water_intrusion",
  "warping": "water_intrusion",
  "buckling": "water_intrusion",

  // Hail/Wind
  "hail damage": "hail_impact",
  "hail impact": "hail_impact",
  "dent": "dent",
  "denting": "dent",
  "wind damage": "wind_damage",
  "missing shingle": "missing",
  "missing shingles": "missing",
  "lifted shingle": "wind_damage",
  "creased shingle": "wind_damage",

  // Structural
  "crack": "crack",
  "cracking": "crack",
  "fracture": "crack",
  "rot": "rot",
  "wood rot": "rot",
  "decay": "rot",

  // General
  "wear": "wear_tear",
  "aging": "wear_tear",
  "deterioration": "wear_tear",
  "mechanical damage": "mechanical",
  "impact damage": "mechanical",
};

const VISION_SEVERITY_MAP: Record<string, string> = {
  "minor": "minor",
  "slight": "minor",
  "light": "minor",
  "moderate": "moderate",
  "medium": "moderate",
  "significant": "moderate",
  "severe": "severe",
  "heavy": "severe",
  "extensive": "severe",
  "major": "severe",
};

export interface PhotoAnalysis {
  description: string;
  damageVisible: Array<{
    type: string;
    severity?: string;
    notes?: string;
  }>;
  matchesExpected?: boolean;
  matchConfidence?: number;
}

export interface PhotoDamageSuggestion {
  description: string;
  damageType: string;
  severity: string;
  notes: string;
  confidence: number;
  confidenceTier?: ConfidenceTier;
  voicePresentation?: string;
  requiresConfirmation?: boolean;
  shouldAutoSuggest?: boolean;
}

/**
 * Process photo analysis results and generate damage suggestions.
 * Maps Vision damage types to our damageType enum for the voice agent to confirm.
 *
 * @param analysis - The GPT-4o Vision analysis result
 * @param sessionId - Current inspection session (for context)
 * @param roomId - Room where the photo was taken
 */
export function processPhotoAnalysis(
  analysis: PhotoAnalysis,
  _sessionId: number,
  _roomId: number
): PhotoDamageSuggestion[] {
  const suggestions: PhotoDamageSuggestion[] = [];

  if (!analysis.damageVisible || analysis.damageVisible.length === 0) {
    return suggestions;
  }

  const baseConfidence = analysis.matchConfidence ?? 0.5;

  for (const detected of analysis.damageVisible) {
    const normalizedType = (detected.type || "").toLowerCase().trim();
    const damageType = VISION_TO_DAMAGE_TYPE[normalizedType] || "other";
    const normalizedSeverity = (detected.severity || "moderate").toLowerCase().trim();
    const severity = VISION_SEVERITY_MAP[normalizedSeverity] || "moderate";

    const confidence = (detected as { confidence?: number }).confidence ?? baseConfidence;
    const tier = getTierForScore(confidence);
    const metadata = getTierMetadata(tier);
    const voicePresentation = metadata.voicePresentation
      ? metadata.voicePresentation.replace("{damageType}", detected.type || damageType)
      : undefined;

    suggestions.push({
      description: `[Photo-detected] ${detected.type}: ${detected.notes || analysis.description || ""}`.trim(),
      damageType,
      severity,
      notes: detected.notes || "",
      confidence,
      confidenceTier: tier,
      voicePresentation,
      requiresConfirmation: metadata.requiresConfirmation,
      shouldAutoSuggest: metadata.shouldAutoSuggest,
    });
  }

  return suggestions;
}

// ─── Material/Finish → Xactimate Code Mapping ─────────────────────────────

const MATERIAL_XACT_CODES: Record<string, { xactCode: string; unit: string; category: string }> = {
  "crown molding":       { xactCode: "TRIM-CROWN-LF", unit: "LF", category: "TRIM" },
  "crown moulding":      { xactCode: "TRIM-CROWN-LF", unit: "LF", category: "TRIM" },
  "chair rail":          { xactCode: "TRIM-CHAIR-LF", unit: "LF", category: "TRIM" },
  "wainscoting":         { xactCode: "TRIM-WAINS-SF", unit: "SF", category: "TRIM" },
  "baseboard":           { xactCode: "TRIM-BASE-LF",  unit: "LF", category: "TRIM" },
  "base molding":        { xactCode: "TRIM-BASE-LF",  unit: "LF", category: "TRIM" },
  "casing":              { xactCode: "TRIM-CASE-LF",  unit: "LF", category: "TRIM" },
  "door casing":         { xactCode: "TRIM-CASE-LF",  unit: "LF", category: "TRIM" },
  "window casing":       { xactCode: "TRIM-CASE-LF",  unit: "LF", category: "TRIM" },
  "shoe molding":        { xactCode: "TRIM-SHOE-LF",  unit: "LF", category: "TRIM" },
  "quarter round":       { xactCode: "TRIM-SHOE-LF",  unit: "LF", category: "TRIM" },

  "interior paint":      { xactCode: "PNT-INT-SF",      unit: "SF", category: "PNT" },
  "wall paint":          { xactCode: "PNT-INT-SF",      unit: "SF", category: "PNT" },
  "ceiling paint":       { xactCode: "PNT-CEILING-SF",  unit: "SF", category: "PNT" },
  "trim paint":          { xactCode: "PNT-TRIM-LF",     unit: "LF", category: "PNT" },
  "exterior paint":      { xactCode: "PNT-EXT-SF",      unit: "SF", category: "PNT" },
  "accent wall":         { xactCode: "PNT-INT-SF",      unit: "SF", category: "PNT" },
  "custom paint":        { xactCode: "PNT-INT-SF",      unit: "SF", category: "PNT" },
  "faux finish":         { xactCode: "PNT-FAUX-SF",     unit: "SF", category: "PNT" },
  "stain":               { xactCode: "PNT-STAIN-SF",    unit: "SF", category: "PNT" },
  "wood stain":          { xactCode: "PNT-STAIN-SF",    unit: "SF", category: "PNT" },

  "hardwood floor":      { xactCode: "FLR-HDWD-SF",     unit: "SF", category: "FLR" },
  "hardwood":            { xactCode: "FLR-HDWD-SF",     unit: "SF", category: "FLR" },
  "laminate floor":      { xactCode: "FLR-LAMINATE-SF", unit: "SF", category: "FLR" },
  "laminate":            { xactCode: "FLR-LAMINATE-SF", unit: "SF", category: "FLR" },
  "vinyl plank":         { xactCode: "FLR-VINYL-SF",    unit: "SF", category: "FLR" },
  "lvp":                 { xactCode: "FLR-VINYL-SF",    unit: "SF", category: "FLR" },
  "tile floor":          { xactCode: "FLR-TILE-SF",     unit: "SF", category: "FLR" },
  "ceramic tile":        { xactCode: "FLR-TILE-SF",     unit: "SF", category: "FLR" },
  "porcelain tile":      { xactCode: "FLR-TILE-SF",     unit: "SF", category: "FLR" },
  "carpet":              { xactCode: "FLR-CARPET-SF",   unit: "SF", category: "FLR" },
  "carpet pad":          { xactCode: "FLR-PAD-SF",      unit: "SF", category: "FLR" },

  "drywall":             { xactCode: "DRY-X-1-2",       unit: "SF", category: "DRY" },
  "sheetrock":           { xactCode: "DRY-X-1-2",       unit: "SF", category: "DRY" },
  "ceiling texture":     { xactCode: "DRY-TEXT-SF",      unit: "SF", category: "DRY" },
  "knockdown texture":   { xactCode: "DRY-TEXT-SF",      unit: "SF", category: "DRY" },
  "popcorn ceiling":     { xactCode: "DRY-POPCORN-SF",  unit: "SF", category: "DRY" },
  "smooth ceiling":      { xactCode: "DRY-SMOOTH-SF",   unit: "SF", category: "DRY" },
  "coffered ceiling":    { xactCode: "DRY-COFFER-SF",   unit: "SF", category: "DRY" },

  "cabinet":             { xactCode: "CAB-BASE-LF",     unit: "LF", category: "CAB" },
  "base cabinet":        { xactCode: "CAB-BASE-LF",     unit: "LF", category: "CAB" },
  "wall cabinet":        { xactCode: "CAB-WALL-LF",     unit: "LF", category: "CAB" },
  "upper cabinet":       { xactCode: "CAB-WALL-LF",     unit: "LF", category: "CAB" },

  "granite countertop":  { xactCode: "CNTOP-GRAN-SF",   unit: "SF", category: "CNTOP" },
  "quartz countertop":   { xactCode: "CNTOP-QRTZ-SF",   unit: "SF", category: "CNTOP" },
  "laminate countertop": { xactCode: "CNTOP-LAM-LF",    unit: "LF", category: "CNTOP" },
  "marble countertop":   { xactCode: "CNTOP-MARB-SF",   unit: "SF", category: "CNTOP" },
  "countertop":          { xactCode: "CNTOP-LAM-LF",    unit: "LF", category: "CNTOP" },

  "wallpaper":           { xactCode: "WC-PAPER-SF",     unit: "SF", category: "WC" },
  "wall covering":       { xactCode: "WC-PAPER-SF",     unit: "SF", category: "WC" },

  "ceiling fan":         { xactCode: "ELE-CFAN-EA",     unit: "EA", category: "ELE" },
  "light fixture":       { xactCode: "ELE-LITE-EA",     unit: "EA", category: "ELE" },
  "recessed light":      { xactCode: "ELE-RECES-EA",    unit: "EA", category: "ELE" },
  "chandelier":          { xactCode: "ELE-CHAND-EA",    unit: "EA", category: "ELE" },

  "blinds":              { xactCode: "WIN-BLIND-EA",    unit: "EA", category: "WIN" },
  "shutters":            { xactCode: "WIN-SHUTT-EA",    unit: "EA", category: "WIN" },
  "window blind":        { xactCode: "WIN-BLIND-EA",    unit: "EA", category: "WIN" },
};

export interface LineItemSuggestion {
  item: string;
  category: string;
  reason: string;
  xactCode: string | null;
  unit: string;
  materialDetails: string;
}

export function resolveLineItemSuggestions(
  rawSuggestions: Array<{
    item?: string;
    category?: string;
    reason?: string;
    xactCode?: string | null;
    unit?: string;
    materialDetails?: string;
  }>
): LineItemSuggestion[] {
  if (!rawSuggestions || !Array.isArray(rawSuggestions)) return [];

  return rawSuggestions.map((raw) => {
    const itemLower = (raw.item || "").toLowerCase();

    let resolvedCode = raw.xactCode || null;
    let resolvedUnit = raw.unit || "EA";
    let resolvedCategory = raw.category || "GEN";

    if (!resolvedCode || resolvedCode === "null") {
      for (const [keyword, mapping] of Object.entries(MATERIAL_XACT_CODES)) {
        if (itemLower.includes(keyword)) {
          resolvedCode = mapping.xactCode;
          resolvedUnit = mapping.unit;
          resolvedCategory = mapping.category;
          break;
        }
      }
    }

    return {
      item: raw.item || "Unknown item",
      category: resolvedCategory,
      reason: raw.reason || "Identified in photo — document for like kind and quality",
      xactCode: resolvedCode,
      unit: resolvedUnit,
      materialDetails: raw.materialDetails || "",
    };
  });
}

/**
 * Filter suggestions by auto-suggest threshold (HIGH and MODERATE only).
 * VERY_LOW and LOW are excluded unless includeAll is true.
 */
export function filterPhotoSuggestions(
  suggestions: PhotoDamageSuggestion[],
  includeAll = false
): PhotoDamageSuggestion[] {
  if (includeAll) return suggestions;
  return suggestions.filter((s) => s.shouldAutoSuggest !== false);
}

/**
 * Build voice agent prompt text grouped by confidence tier.
 */
export function buildDamageSuggestionPrompt(suggestions: PhotoDamageSuggestion[]): string {
  if (suggestions.length === 0) return "I analyzed the photo but couldn't identify specific damage.";

  const high = suggestions.filter((s) => s.confidenceTier === "HIGH");
  const moderate = suggestions.filter((s) => s.confidenceTier === "MODERATE");
  const low = suggestions.filter((s) => s.confidenceTier === "LOW");

  let prompt = "";
  if (high.length > 0) {
    prompt += "I found damage with high confidence:\n";
    high.forEach((s) => { prompt += `  - ${s.voicePresentation || s.description}\n`; });
  }
  if (moderate.length > 0) {
    prompt += (prompt ? "\n" : "") + "I also see possible damage that I'm less certain about:\n";
    moderate.forEach((s) => { prompt += `  - ${s.voicePresentation || s.description}\n`; });
  }
  if (low.length > 0) {
    prompt += (prompt ? "\n" : "") + "I'm uncertain about these:\n";
    low.forEach((s) => { prompt += `  - ${s.voicePresentation || s.description}\n`; });
  }
  return prompt;
}
