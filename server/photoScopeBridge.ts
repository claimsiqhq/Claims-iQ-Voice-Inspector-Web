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
