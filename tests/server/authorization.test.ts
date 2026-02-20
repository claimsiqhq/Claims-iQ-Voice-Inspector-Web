import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = {
  getClaim: vi.fn(),
  getInspectionSession: vi.fn(),
  getRoom: vi.fn(),
  getAdjacency: vi.fn(),
};

vi.mock("../../server/storage", () => ({
  storage: storageMock,
}));

const {
  canAccessClaim,
  requireClaimAccess,
  requireSessionAccess,
  requireRoomAccess,
  requireAdjacencyAccess,
} = await import("../../server/authorization");

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("authorization helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storageMock.getClaim.mockReset();
    storageMock.getInspectionSession.mockReset();
    storageMock.getRoom.mockReset();
    storageMock.getAdjacency.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows privileged users or assigned user to access a claim", () => {
    expect(canAccessClaim({ id: "u1", role: "admin" } as any, { assignedTo: "other" } as any)).toBe(true);
    expect(canAccessClaim({ id: "u1", role: "supervisor" } as any, { assignedTo: "other" } as any)).toBe(true);
    expect(canAccessClaim({ id: "u1", role: "adjuster" } as any, { assignedTo: "u1" } as any)).toBe(true);
    expect(canAccessClaim({ id: "u1", role: "adjuster" } as any, { assignedTo: "u2" } as any)).toBe(false);
  });

  it("denies claim access when claim is missing", async () => {
    storageMock.getClaim.mockResolvedValue(undefined);
    const req: any = { user: { id: "u1", role: "adjuster" } };
    const res = makeRes();

    const claim = await requireClaimAccess(req, res, 99);

    expect(claim).toBeNull();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("denies claim access for non-owner adjuster", async () => {
    storageMock.getClaim.mockResolvedValue({ id: 10, assignedTo: "u2" } as any);
    const req: any = { user: { id: "u1", role: "adjuster" } };
    const res = makeRes();

    const claim = await requireClaimAccess(req, res, 10);

    expect(claim).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("denies session access when session claim is not accessible", async () => {
    storageMock.getInspectionSession.mockResolvedValue({ id: 7, claimId: 55 } as any);
    storageMock.getClaim.mockResolvedValue({ id: 55, assignedTo: "u2" } as any);
    const req: any = { user: { id: "u1", role: "adjuster" } };
    const res = makeRes();

    const session = await requireSessionAccess(req, res, 7);

    expect(session).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows room and adjacency access when linked session is authorized", async () => {
    storageMock.getRoom.mockResolvedValue({ id: 4, sessionId: 7 } as any);
    storageMock.getAdjacency.mockResolvedValue({ id: 8, sessionId: 7 } as any);
    storageMock.getInspectionSession.mockResolvedValue({ id: 7, claimId: 55 } as any);
    storageMock.getClaim.mockResolvedValue({ id: 55, assignedTo: "u1" } as any);
    const req: any = { user: { id: "u1", role: "adjuster" } };

    const roomRes = makeRes();
    const adjacencyRes = makeRes();

    const room = await requireRoomAccess(req, roomRes, 4);
    const adjacency = await requireAdjacencyAccess(req, adjacencyRes, 8);

    expect(room?.id).toBe(4);
    expect(adjacency?.id).toBe(8);
    expect(roomRes.status).not.toHaveBeenCalled();
    expect(adjacencyRes.status).not.toHaveBeenCalled();
  });
});
