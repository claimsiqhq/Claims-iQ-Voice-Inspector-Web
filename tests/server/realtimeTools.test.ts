import { describe, it, expect } from "vitest";
import { realtimeTools, buildSystemInstructions } from "../../server/realtime";

describe("realtimeTools", () => {
  it("exports an array of tool definitions", () => {
    expect(Array.isArray(realtimeTools)).toBe(true);
    expect(realtimeTools.length).toBeGreaterThanOrEqual(10);
  });

  it("every tool has required fields", () => {
    for (const tool of realtimeTools) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("every tool has a unique name", () => {
    const names = realtimeTools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("tool names follow snake_case convention", () => {
    for (const tool of realtimeTools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("set_inspection_context accepts phase, structure, area", () => {
    const tool = realtimeTools.find((t) => t.name === "set_inspection_context");
    expect(tool).toBeDefined();
    const props = tool!.parameters.properties;
    expect(props.phase).toBeDefined();
    expect(props.structure).toBeDefined();
    expect(props.area).toBeDefined();
  });

  it("add_damage has required description and damageType params", () => {
    const tool = realtimeTools.find((t) => t.name === "add_damage");
    expect(tool).toBeDefined();
    expect(tool!.parameters.properties.description).toBeDefined();
    expect(tool!.parameters.properties.damageType).toBeDefined();
    expect(tool!.parameters.required).toContain("description");
    expect(tool!.parameters.required).toContain("damageType");
  });

  it("add_line_item has category and description as required", () => {
    const tool = realtimeTools.find((t) => t.name === "add_line_item");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain("category");
    expect(tool!.parameters.required).toContain("description");
  });

  it("trigger_photo_capture has label and photoType params", () => {
    const tool = realtimeTools.find((t) => t.name === "trigger_photo_capture");
    expect(tool).toBeDefined();
    const props = tool!.parameters.properties;
    expect(props.label).toBeDefined();
    expect(props.photoType).toBeDefined();
  });

  it("add_damage description mentions auto-scope (PROMPT-20)", () => {
    const tool = realtimeTools.find((t) => t.name === "add_damage");
    expect(tool).toBeDefined();
    expect(tool!.description.toLowerCase()).toContain("auto");
  });

  it("includes get_completeness tool", () => {
    const tool = realtimeTools.find((t) => t.name === "get_completeness");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toEqual([]);
  });

  it("includes confirm_damage_suggestion tool", () => {
    const tool = realtimeTools.find((t) => t.name === "confirm_damage_suggestion");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain("photoId");
    expect(tool!.parameters.required).toContain("damageType");
    expect(tool!.parameters.required).toContain("confirmed");
  });

  it("includes get_scope_gaps tool", () => {
    const tool = realtimeTools.find((t) => t.name === "get_scope_gaps");
    expect(tool).toBeDefined();
  });

  it("includes request_phase_validation tool", () => {
    const tool = realtimeTools.find((t) => t.name === "request_phase_validation");
    expect(tool).toBeDefined();
  });

  it("add_opening requires canonical widthFt/heightFt fields", () => {
    const tool = realtimeTools.find((t) => t.name === "add_opening");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain("widthFt");
    expect(tool!.parameters.required).toContain("heightFt");
    expect(tool!.parameters.properties.width).toBeDefined();
    expect(tool!.parameters.properties.height).toBeDefined();
  });

  it("includes update_opening and delete_opening tools", () => {
    expect(realtimeTools.find((t) => t.name === "update_opening")).toBeDefined();
    expect(realtimeTools.find((t) => t.name === "delete_opening")).toBeDefined();
  });

});

describe("buildSystemInstructions", () => {
  const testClaim = {
    id: 1,
    claimNumber: "CLM-001",
    insuredName: "Test Owner",
    propertyAddress: "123 Test St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    dateOfLoss: "2025-03-15",
    perilType: "hail",
    status: "active",
  };

  const testBriefing = {
    id: 1,
    claimId: 1,
    content: "Property is a single-story residential home with composition roof.",
    propertyProfile: {},
    coverageSnapshot: { deductible: 1000, coverageA: { limit: 250000 } },
    perilAnalysis: {},
    endorsementImpacts: {},
    inspectionChecklist: [],
    redFlags: [],
  };

  it("returns a non-empty string", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(500);
  });

  it("includes claim data in instructions", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("CLM-001");
    expect(instructions).toContain("123 Test St");
    expect(instructions).toContain("hail");
  });

  it("includes peril-specific guidance for hail claims", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions.toLowerCase()).toContain("shingles");
    expect(instructions.toLowerCase()).toContain("test square");
  });

  it("includes wind-specific guidance for wind claims", () => {
    const windClaim = { ...testClaim, perilType: "wind" };
    const instructions = buildSystemInstructions(testBriefing, windClaim as any);
    expect(instructions.toLowerCase()).toContain("creased");
    expect(instructions.toLowerCase()).toContain("elevation");
  });

  it("includes water-specific guidance for water claims", () => {
    const waterClaim = { ...testClaim, perilType: "water" };
    const instructions = buildSystemInstructions(testBriefing, waterClaim as any);
    expect(instructions.toLowerCase()).toContain("moisture");
    expect(instructions.toLowerCase()).toContain("iicrc");
  });

  it("includes briefing summary section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Briefing Summary");
    expect(instructions).toContain("Coverage");
  });

  it("includes core behavioral sections", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Guided Flow");
    expect(instructions).toContain("Photo Triggers");
    expect(instructions).toContain("Ambiguity Resolution");
    expect(instructions).toContain("Peril-Specific");
    expect(instructions).toContain("Photo Trigger");
    expect(instructions).toContain("Coverage");
    expect(instructions).toContain("Conversational");
    expect(instructions.toLowerCase()).toContain("draw it anyway");
  });

  it("includes auto-scope intelligence section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Auto-Scope Intelligence");
    expect(instructions).toContain("autoScope");
  });

  it("includes photo intelligence section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Photo Intelligence");
    expect(instructions).toContain("damageSuggestions");
  });

  it("includes phase transition protocol", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Phase Transition Protocol");
  });
});
