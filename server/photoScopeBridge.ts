/**
 * photoScopeBridge.ts
 *
 * Bridges photo analysis results to damage observations.
 * When GPT-4o Vision detects damage in a photo, this service maps Vision damage
 * types to our damageType enum and returns suggested damage observations for
 * the voice agent to confirm.
 */

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

  for (const detected of analysis.damageVisible) {
    // Map Vision damage type to our enum
    const normalizedType = (detected.type || "").toLowerCase().trim();
    const damageType = VISION_TO_DAMAGE_TYPE[normalizedType] || "other";

    // Map severity
    const normalizedSeverity = (detected.severity || "moderate").toLowerCase().trim();
    const severity = VISION_SEVERITY_MAP[normalizedSeverity] || "moderate";

    suggestions.push({
      description: `[Photo-detected] ${detected.type}: ${detected.notes || analysis.description || ""}`.trim(),
      damageType,
      severity,
      notes: detected.notes || "",
      confidence: analysis.matchConfidence ?? 0.5,
    });
  }

  return suggestions;
}
