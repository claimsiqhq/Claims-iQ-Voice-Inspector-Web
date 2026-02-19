/**
 * Regression tests for workflow quality fixes (P0-B, P0-C, P1-D, P1-E).
 * Locks the behavior introduced by the validation-report-driven fixes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock infrastructure modules to avoid env-var requirements
vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
}));
vi.mock("../../server/supabase", () => ({
  supabase: { storage: { from: vi.fn() } },
  PHOTOS_BUCKET: "test-photos",
}));

import { storage } from "../../server/storage";
import { runPhotoDamageGate } from "../../server/workflow/validators/photoDamageGate";
import { runScopeGate } from "../../server/workflow/validators/scopeGate";
import { runExportGate } from "../../server/workflow/validators/exportGate";
import {
  validateToolForWorkflow,
} from "../../server/workflow/orchestrator";
import { resolveToolName } from "../../server/routes/inspection";

afterEach(() => vi.restoreAllMocks());

// ─── P0-B: photoDamageGate reads matchConfidence, not confidence ────────────

describe("P0-B: photoDamageGate structured checks", () => {
  it("uses matchConfidence field (not confidence) for gate check", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([
      {
        id: 1,
        roomId: 1,
        matchesRequest: false,
        analysis: { matchConfidence: 0.95, damageVisible: [{ type: "crack" }] },
      },
    ] as any);

    const result = await runPhotoDamageGate(1);
    const confidenceIssue = result.issues.find((i) => i.code === "PHOTO_CONFIDENCE_GATE");
    expect(confidenceIssue).toBeDefined();
    expect(confidenceIssue!.message).toContain("Photo 1");
  });

  it("does NOT fire confidence gate when matchConfidence is low", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([
      {
        id: 2,
        roomId: 1,
        matchesRequest: false,
        analysis: { matchConfidence: 0.3, damageVisible: [] },
      },
    ] as any);

    const result = await runPhotoDamageGate(1);
    const confidenceIssue = result.issues.find((i) => i.code === "PHOTO_CONFIDENCE_GATE");
    expect(confidenceIssue).toBeUndefined();
  });

  it("detects damage hints via damageVisible array (not regex)", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([
      {
        id: 3,
        roomId: 1,
        matchesRequest: true,
        analysis: { matchConfidence: 0.8, damageVisible: [{ type: "water damage" }] },
      },
    ] as any);

    const result = await runPhotoDamageGate(1);
    const mappingIssue = result.issues.find((i) => i.code === "PHOTO_DAMAGE_MAPPING_LOW");
    expect(mappingIssue).toBeDefined();
  });

  it("does NOT flag damage mapping when damageVisible is empty", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([
      {
        id: 4,
        roomId: 1,
        matchesRequest: true,
        analysis: { matchConfidence: 0.5, damageVisible: [] },
      },
    ] as any);

    const result = await runPhotoDamageGate(1);
    const mappingIssue = result.issues.find((i) => i.code === "PHOTO_DAMAGE_MAPPING_LOW");
    expect(mappingIssue).toBeUndefined();
  });
});

// ─── P0-C: scopeGate uses damageId linkage, not string matching ─────────────

describe("P0-C: scopeGate damageId linkage", () => {
  it("marks damage as covered when lineItem has matching damageId", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([
      { id: 10, roomId: 1, damageType: "water_intrusion", severity: "moderate" },
    ] as any);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([
      { id: 50, roomId: 1, damageId: 10, category: "DRY", description: "Drywall repair" },
    ] as any);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([]);
    vi.spyOn(storage, "getRooms").mockResolvedValue([]);

    const result = await runScopeGate(1, "water");
    const uncovered = result.issues.find((i) => i.code === "SCOPE_DAMAGE_UNCOVERED");
    expect(uncovered).toBeUndefined();
  });

  it("marks damage as covered when scopeItem has matching damageId", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([
      { id: 10, roomId: 1, damageType: "water_intrusion", severity: "moderate" },
    ] as any);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([]);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([
      { id: 99, roomId: 1, damageId: 10, status: "active" },
    ] as any);
    vi.spyOn(storage, "getRooms").mockResolvedValue([]);

    const result = await runScopeGate(1, "water");
    const uncovered = result.issues.find((i) => i.code === "SCOPE_DAMAGE_UNCOVERED");
    expect(uncovered).toBeUndefined();
  });

  it("warns uncovered when no item has matching damageId (even if description matches)", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([
      { id: 10, roomId: 1, damageType: "water_intrusion", severity: "moderate" },
    ] as any);
    // Description contains "water_intrusion" but damageId doesn't match
    vi.spyOn(storage, "getLineItems").mockResolvedValue([
      { id: 50, roomId: 1, damageId: 99, category: "DRY", description: "Repair water_intrusion damage" },
    ] as any);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([]);
    vi.spyOn(storage, "getRooms").mockResolvedValue([]);

    const result = await runScopeGate(1, "water");
    const uncovered = result.issues.find((i) => i.code === "SCOPE_DAMAGE_UNCOVERED");
    expect(uncovered).toBeDefined();
  });

  it("dedup key includes damageId — same category+room different damage is not a duplicate", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([
      { id: 50, roomId: 1, damageId: 10, category: "DRY", description: "A" },
      { id: 51, roomId: 1, damageId: 11, category: "DRY", description: "B" },
    ] as any);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([]);
    vi.spyOn(storage, "getRooms").mockResolvedValue([]);

    const result = await runScopeGate(1, "water");
    const dup = result.issues.find((i) => i.code === "SCOPE_DUPLICATE_LINE");
    expect(dup).toBeUndefined();
  });

  it("dedup key catches true duplicate (same category+room+damageId)", async () => {
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([
      { id: 50, roomId: 1, damageId: 10, category: "DRY", description: "A" },
      { id: 51, roomId: 1, damageId: 10, category: "DRY", description: "B" },
    ] as any);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([]);
    vi.spyOn(storage, "getRooms").mockResolvedValue([]);

    const result = await runScopeGate(1, "water");
    const dup = result.issues.find((i) => i.code === "SCOPE_DUPLICATE_LINE");
    expect(dup).toBeDefined();
  });
});

// ─── P1-D: Tool allowlist enforcement ───────────────────────────────────────

describe("P1-D: validateToolForWorkflow enforcement", () => {
  it("returns null (allow) when no workflow state exists", async () => {
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue(null);
    const result = await validateToolForWorkflow(1, "create_room");
    expect(result).toBeNull();
  });

  it("returns null (allow) when tool is in phase allowlist", async () => {
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({
      id: 1,
      workflowStateJson: { phase: "interior_rooms", stepId: "interior.capture_rooms", context: {}, sessionId: "1", claimId: "1", peril: "water" },
    } as any);
    const result = await validateToolForWorkflow(1, "create_room");
    expect(result).toBeNull();
  });

  it("returns CONTEXT_ERROR when tool is NOT in phase allowlist", async () => {
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({
      id: 1,
      workflowStateJson: { phase: "briefing", stepId: "briefing.review", context: {}, sessionId: "1", claimId: "1", peril: "water" },
    } as any);
    const result = await validateToolForWorkflow(1, "add_damage");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error!.type).toBe("CONTEXT_ERROR");
    expect(result!.error!.code).toBe("TOOL_NOT_ALLOWED");
    expect(result!.error!.hint).toContain("set_phase");
  });

  it("returns CONTEXT_ERROR for missing room context on opening tools", async () => {
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({
      id: 1,
      workflowStateJson: { phase: "openings", stepId: "openings.capture", context: {}, sessionId: "1", claimId: "1", peril: "water" },
    } as any);
    const result = await validateToolForWorkflow(1, "add_opening", {});
    expect(result).not.toBeNull();
    expect(result!.error!.code).toBe("MISSING_CONTEXT");
  });
});

describe("P1-D: resolveToolName mapping", () => {
  it("maps POST /structures to create_structure", () => {
    expect(resolveToolName("POST", "/structures")).toBe("create_structure");
  });

  it("maps POST /rooms to create_room", () => {
    expect(resolveToolName("POST", "/rooms")).toBe("create_room");
  });

  it("maps POST /damages to add_damage", () => {
    expect(resolveToolName("POST", "/damages")).toBe("add_damage");
  });

  it("maps POST /line-items to add_line_item", () => {
    expect(resolveToolName("POST", "/line-items")).toBe("add_line_item");
  });

  it("maps POST /export/esx to export_esx", () => {
    expect(resolveToolName("POST", "/export/esx")).toBe("export_esx");
  });

  it("returns null for unmapped routes", () => {
    expect(resolveToolName("GET", "/rooms")).toBeNull();
    expect(resolveToolName("POST", "/somethingelse")).toBeNull();
  });
});

// ─── P1-E: exportGate composes photoDamageGate blockers ─────────────────────

describe("P1-E: exportGate includes photo gate issues", () => {
  it("propagates photo analysis missing warning to export gate", async () => {
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({ id: 1, claimId: 1 } as any);
    vi.spyOn(storage, "getClaim").mockResolvedValue({
      id: 1,
      claimNumber: "CLM-1",
      propertyAddress: "123 Main",
      perilType: "water",
    } as any);
    vi.spyOn(storage, "getRooms").mockResolvedValue([
      { id: 1, name: "Kitchen", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], viewType: "interior" },
    ] as any);
    vi.spyOn(storage, "getOpeningsForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([]);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([]);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([
      { id: 1, roomId: 1, analysis: null, matchesRequest: true },
      { id: 2, roomId: 1, analysis: null, matchesRequest: true },
    ] as any);

    const result = await runExportGate(1);
    const photoIssue = result.issues.find((i) => i.code.startsWith("EXPORT_PHOTO_"));
    expect(photoIssue).toBeDefined();
    expect(photoIssue!.code).toBe("EXPORT_PHOTO_PHOTO_ANALYSIS_MISSING");
  });

  it("exportGate still blocks on missing claim data", async () => {
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({ id: 1, claimId: 1 } as any);
    vi.spyOn(storage, "getClaim").mockResolvedValue({ id: 1 } as any);
    vi.spyOn(storage, "getRooms").mockResolvedValue([]);
    vi.spyOn(storage, "getOpeningsForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([]);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([]);
    vi.spyOn(storage, "getScopeItems").mockResolvedValue([]);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([]);

    const result = await runExportGate(1);
    expect(result.ok).toBe(false);
    const blocker = result.issues.find((i) => i.code === "EXPORT_REQUIRED_CLAIM_DATA");
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe("BLOCKER");
  });
});
