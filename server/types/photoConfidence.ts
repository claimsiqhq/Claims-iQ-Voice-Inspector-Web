/**
 * PROMPT-30 Part D: Photo Confidence Tiers
 * Classifies damage suggestions into four confidence bands
 */

export type ConfidenceTier = "HIGH" | "MODERATE" | "LOW" | "VERY_LOW";

export interface ConfidenceTierRange {
  tier: ConfidenceTier;
  minScore: number;
  maxScore: number;
  voicePresentation: string;
  requiresConfirmation: boolean;
  shouldAutoSuggest: boolean;
}

export const CONFIDENCE_TIERS: ConfidenceTierRange[] = [
  {
    tier: "HIGH",
    minScore: 0.85,
    maxScore: 1.0,
    voicePresentation: "I can see {damageType} with high confidence.",
    requiresConfirmation: false,
    shouldAutoSuggest: true,
  },
  {
    tier: "MODERATE",
    minScore: 0.5,
    maxScore: 0.849,
    voicePresentation: "This might be {damageType} — can you confirm?",
    requiresConfirmation: true,
    shouldAutoSuggest: true,
  },
  {
    tier: "LOW",
    minScore: 0.3,
    maxScore: 0.499,
    voicePresentation: "I'm not sure about this — it could be {damageType}. Want me to add it?",
    requiresConfirmation: true,
    shouldAutoSuggest: false,
  },
  {
    tier: "VERY_LOW",
    minScore: 0.0,
    maxScore: 0.299,
    voicePresentation: "",
    requiresConfirmation: false,
    shouldAutoSuggest: false,
  },
];

export function getTierForScore(score: number): ConfidenceTier {
  for (const tier of CONFIDENCE_TIERS) {
    if (score >= tier.minScore && score <= tier.maxScore) return tier.tier;
  }
  return "VERY_LOW";
}

export function getTierMetadata(tier: ConfidenceTier): ConfidenceTierRange {
  const found = CONFIDENCE_TIERS.find((t) => t.tier === tier);
  if (!found) throw new Error(`Unknown confidence tier: ${tier}`);
  return found;
}
