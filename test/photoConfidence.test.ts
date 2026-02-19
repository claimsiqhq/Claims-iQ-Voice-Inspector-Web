import { describe, it, expect } from "vitest";
import {
  getTierForScore,
  getTierMetadata,
  CONFIDENCE_TIERS,
} from "../server/types/photoConfidence";
import {
  processPhotoAnalysis,
  filterPhotoSuggestions,
  buildDamageSuggestionPrompt,
} from "../server/photoScopeBridge";

describe("photoConfidence", () => {
  it("classifies HIGH tier for score >= 0.85", () => {
    expect(getTierForScore(0.85)).toBe("HIGH");
    expect(getTierForScore(1.0)).toBe("HIGH");
  });

  it("classifies MODERATE tier for 0.5-0.84", () => {
    expect(getTierForScore(0.5)).toBe("MODERATE");
    expect(getTierForScore(0.7)).toBe("MODERATE");
  });

  it("classifies LOW tier for 0.3-0.499", () => {
    expect(getTierForScore(0.3)).toBe("LOW");
    expect(getTierForScore(0.4)).toBe("LOW");
  });

  it("classifies VERY_LOW tier for < 0.3", () => {
    expect(getTierForScore(0)).toBe("VERY_LOW");
    expect(getTierForScore(0.29)).toBe("VERY_LOW");
  });

  it("getTierMetadata returns tier config", () => {
    const meta = getTierMetadata("HIGH");
    expect(meta.shouldAutoSuggest).toBe(true);
    expect(meta.requiresConfirmation).toBe(false);
  });
});

describe("photoScopeBridge confidence", () => {
  it("adds confidence tier to suggestions", () => {
    const analysis = {
      description: "Water damage visible",
      damageVisible: [{ type: "water damage", severity: "moderate" }],
      matchConfidence: 0.9,
    };
    const suggestions = processPhotoAnalysis(analysis, 1, 1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].confidenceTier).toBe("HIGH");
    expect(suggestions[0].shouldAutoSuggest).toBe(true);
  });

  it("filterPhotoSuggestions excludes VERY_LOW by default", () => {
    const suggestions = [
      { damageType: "a", confidence: 0.9, shouldAutoSuggest: true } as any,
      { damageType: "b", confidence: 0.2, shouldAutoSuggest: false } as any,
    ];
    const filtered = filterPhotoSuggestions(suggestions);
    expect(filtered).toHaveLength(1);
  });

  it("buildDamageSuggestionPrompt groups by tier", () => {
    const suggestions = [
      { damageType: "water", confidenceTier: "HIGH", voicePresentation: "I can see water." } as any,
    ];
    const prompt = buildDamageSuggestionPrompt(suggestions);
    expect(prompt).toContain("high confidence");
    expect(prompt).toContain("water");
  });
});
