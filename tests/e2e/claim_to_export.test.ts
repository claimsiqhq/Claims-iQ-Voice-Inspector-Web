import { describe, it, expect, vi, afterEach } from "vitest";
import { initSessionWorkflow, getAllowedTools } from "../../server/workflow/orchestrator";
import { runAllWorkflowGates } from "../../server/workflow/validators";
import { storage } from "../../server/storage";

afterEach(() => vi.restoreAllMocks());

describe("Holistic claim->export deterministic harness", () => {
  it("interior + openings + photo + scope + export gates", async () => {
    vi.spyOn(storage, "updateSession").mockResolvedValue({ id: 100 } as any);
    const state = await initSessionWorkflow({ claimId: 1, sessionId: 100, peril: "water" });
    expect(state.phase).toBe("inspection_setup");
    expect(getAllowedTools(state)).toContain("create_structure");

    vi.spyOn(storage, "getRooms").mockResolvedValue([
      { id: 1, name: "Kitchen", polygon: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], viewType: "interior", dimensions: { height: 8 } },
    ] as any);
    vi.spyOn(storage, "getOpeningsForSession").mockResolvedValue([
      { id: 1, roomId: 1, wallIndex: 0, widthFt: 3, heightFt: 7 },
    ] as any);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([
      { id: 10, roomId: 1, status: "confirmed", analysisResult: { confidence: 0.91, label: "water damage" } },
    ] as any);
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([
      { id: 9, roomId: 1, damageType: "water_intrusion", severity: "moderate" },
    ] as any);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([
      { id: 77, roomId: 1, description: "Repair water_intrusion wall", code: "WTR1", provenance: { source: "voice_confirmed" } },
    ] as any);
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({ id: 100, claimId: 1 } as any);
    vi.spyOn(storage, "getClaim").mockResolvedValue({ id: 1, claimNumber: "CLM-1", propertyAddress: "123 Main", perilType: "water" } as any);

    const gates = await runAllWorkflowGates(100, "water");
    expect(gates.sketch.ok).toBe(true);
    expect(gates.scope.ok).toBe(true);
    expect(gates.export.ok).toBe(true);
  });

  it("hail/wind roof + elevation fixture emits peril guidance warnings deterministically", async () => {
    vi.spyOn(storage, "getRooms").mockResolvedValue([
      { id: 20, name: "F1", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }], viewType: "roof_plan", dimensions: { height: 0 } },
      { id: 21, name: "Front Elevation", polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 0, y: 8 }], viewType: "elevation", dimensions: { height: 8 } },
    ] as any);
    vi.spyOn(storage, "getOpeningsForSession").mockResolvedValue([{ id: 99, roomId: 21, wallIndex: 0, widthFt: 3, heightFt: 4 }] as any);
    vi.spyOn(storage, "getPhotos").mockResolvedValue([{ id: 44, roomId: null, analysisResult: { confidence: 0.88, label: "hail damage" }, status: "requires_confirmation" }] as any);
    vi.spyOn(storage, "getDamagesForSession").mockResolvedValue([] as any);
    vi.spyOn(storage, "getLineItems").mockResolvedValue([] as any);
    vi.spyOn(storage, "getInspectionSession").mockResolvedValue({ id: 200, claimId: 2 } as any);
    vi.spyOn(storage, "getClaim").mockResolvedValue({ id: 2, claimNumber: "CLM-2", propertyAddress: "456 Oak", perilType: "hail" } as any);

    const gates = await runAllWorkflowGates(200, "hail");
    expect(gates.sketch.ok).toBe(true);
    expect(gates.photoDamage.summary.warnings).toBeGreaterThan(0);
    expect(gates.scope.summary.warnings).toBeGreaterThanOrEqual(0);
  });
});
