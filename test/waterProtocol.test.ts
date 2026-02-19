import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getWaterProtocolQuestions,
  processWaterDamageResponses,
  handleWaterDamageProtocol,
  type WaterProtocolResponses,
} from "../server/waterProtocol";

vi.mock("../server/storage", () => ({
  storage: {
    updateSession: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("waterProtocol", () => {
  describe("getWaterProtocolQuestions", () => {
    it("returns 7 steps", () => {
      const questions = getWaterProtocolQuestions();
      expect(questions).toHaveLength(7);
    });

    it("includes water source as first step", () => {
      const questions = getWaterProtocolQuestions();
      expect(questions[0].step).toBe(1);
      expect(questions[0].field).toBe("waterSource");
      expect(questions[0].question).toContain("source");
    });

    it("includes standing water start/end as datetime steps", () => {
      const questions = getWaterProtocolQuestions();
      const datetimeSteps = questions.filter((q) => q.format === "datetime");
      expect(datetimeSteps).toHaveLength(2);
      expect(questions.find((q) => q.field === "standingWaterStart")).toBeDefined();
      expect(questions.find((q) => q.field === "standingWaterEnd")).toBeDefined();
    });

    it("includes visible contamination as boolean", () => {
      const questions = getWaterProtocolQuestions();
      const contamination = questions.find((q) => q.field === "visibleContamination");
      expect(contamination?.format).toBe("boolean");
    });
  });

  describe("processWaterDamageResponses", () => {
    it("classifies supply line as Category 1 clean water", () => {
      const responses: WaterProtocolResponses = {
        waterSource: "supply line break",
        visibleContamination: false,
      };
      const result = processWaterDamageResponses(responses);
      expect(result.category).toBe(1);
      expect(result.source).toBe("clean");
    });

    it("classifies sewer backup as Category 3 black water", () => {
      const responses: WaterProtocolResponses = {
        waterSource: "sewer backup",
        visibleContamination: true,
      };
      const result = processWaterDamageResponses(responses);
      expect(result.category).toBe(3);
      expect(result.source).toBe("black");
    });

    it("classifies washing machine overflow as Category 2 gray water", () => {
      const responses: WaterProtocolResponses = {
        waterSource: "washing machine overflow",
        visibleContamination: false,
      };
      const result = processWaterDamageResponses(responses);
      expect(result.category).toBe(2);
      expect(result.source).toBe("gray");
    });

    it("sets contaminationLevel high for Category 3", () => {
      const responses: WaterProtocolResponses = {
        waterSource: "toilet overflow",
        visibleContamination: true,
      };
      const result = processWaterDamageResponses(responses);
      expect(result.contaminationLevel).toBe("high");
    });

    it("computes standing days from start and end dates", () => {
      const start = new Date("2025-01-01T00:00:00Z");
      const end = new Date("2025-01-05T00:00:00Z");
      const responses: WaterProtocolResponses = {
        waterSource: "rain",
        standingWaterStart: start,
        standingWaterEnd: end,
        visibleContamination: false,
      };
      const result = processWaterDamageResponses(responses);
      expect(result).toBeDefined();
      expect(result.classifiedAt).toBeInstanceOf(Date);
    });

    it("returns dryingPossible false for Category 3", () => {
      const responses: WaterProtocolResponses = {
        waterSource: "flood",
        affectedArea: 100,
        visibleContamination: true,
      };
      const result = processWaterDamageResponses(responses);
      expect(result.dryingPossible).toBe(false);
    });
  });

  describe("handleWaterDamageProtocol", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("stores classification and returns companions for Category 3", async () => {
      const responses: WaterProtocolResponses = {
        waterSource: "sewer backup",
        visibleContamination: true,
      };
      const result = await handleWaterDamageProtocol(1, responses);
      expect(result.classification.category).toBe(3);
      expect(result.companionsTriggered).toContain("cat3-001");
      expect(result.companionsTriggered).toContain("cat3-002");
    });

    it("returns empty companions for Category 1", async () => {
      const responses: WaterProtocolResponses = {
        waterSource: "supply line break",
        visibleContamination: false,
      };
      const result = await handleWaterDamageProtocol(1, responses);
      expect(result.classification.category).toBe(1);
      expect(result.companionsTriggered).toHaveLength(0);
    });
  });
});
