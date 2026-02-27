import { storage } from "./storage";
import type { InspectionRoom, RoomAdjacency } from "../shared/schema";

export interface LayoutIssue {
  severity: "BLOCKER" | "WARNING" | "INFO";
  code: string;
  message: string;
  roomIds?: number[];
  suggestion?: string;
  details?: Record<string, unknown>;
}

export interface LayoutValidationResult {
  ok: boolean;
  issues: LayoutIssue[];
  summary: {
    totalRooms: number;
    placedRooms: number;
    orphanedRooms: number;
    totalFloorAreaSF: number;
    expectedAreaSF: number | null;
    areaDeltaPct: number | null;
    sharedWallMismatches: number;
    gapCount: number;
  };
}

interface RoomDims {
  length: number;
  width: number;
  height: number;
}

function getDims(room: InspectionRoom): RoomDims | null {
  const d = room.dimensions as any;
  if (!d || (!d.length && !d.width)) return null;
  return {
    length: Number(d.length) || 0,
    width: Number(d.width) || 0,
    height: Number(d.height) || 8,
  };
}

function wallLengthForDirection(dims: RoomDims, dir: string): number {
  const d = dir.toLowerCase();
  if (d === "north" || d === "south" || d === "front" || d === "rear") return dims.length;
  if (d === "east" || d === "west" || d === "left" || d === "right") return dims.width;
  return 0;
}

function normalizeDir(dir: string | null | undefined): string | null {
  if (!dir) return null;
  const d = dir.toLowerCase();
  if (d === "north" || d === "rear") return "north";
  if (d === "south" || d === "front") return "south";
  if (d === "east" || d === "right") return "east";
  if (d === "west" || d === "left") return "west";
  return null;
}

function oppositeDir(dir: string): string {
  switch (dir) {
    case "north": return "south";
    case "south": return "north";
    case "east": return "west";
    case "west": return "east";
    default: return "";
  }
}

interface PlacedRoom {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dims: RoomDims;
}

interface BfsResult {
  placed: PlacedRoom[];
  disconnected: InspectionRoom[];
  collided: InspectionRoom[];
}

function bfsPlace(
  rooms: InspectionRoom[],
  adjacencies: RoomAdjacency[],
): BfsResult {
  const roomMap = new Map<number, InspectionRoom>();
  for (const r of rooms) roomMap.set(r.id, r);

  const adjMap = new Map<number, Array<{ adj: RoomAdjacency; otherId: number }>>();
  for (const a of adjacencies) {
    if (!roomMap.has(a.roomIdA) || !roomMap.has(a.roomIdB)) continue;
    if (!adjMap.has(a.roomIdA)) adjMap.set(a.roomIdA, []);
    if (!adjMap.has(a.roomIdB)) adjMap.set(a.roomIdB, []);
    adjMap.get(a.roomIdA)!.push({ adj: a, otherId: a.roomIdB });
    adjMap.get(a.roomIdB)!.push({ adj: a, otherId: a.roomIdA });
  }

  const connectedIds = new Set<number>();
  for (const a of adjacencies) {
    if (roomMap.has(a.roomIdA)) connectedIds.add(a.roomIdA);
    if (roomMap.has(a.roomIdB)) connectedIds.add(a.roomIdB);
  }

  const placed = new Map<number, PlacedRoom>();
  const collidedIds = new Set<number>();

  const seed = rooms.find(r => connectedIds.has(r.id) && getDims(r)) || rooms.find(r => getDims(r));
  if (!seed) {
    return { placed: [], disconnected: rooms, collided: [] };
  }

  const seedDims = getDims(seed)!;
  placed.set(seed.id, {
    id: seed.id,
    name: seed.name,
    x: 0,
    y: 0,
    w: seedDims.length,
    h: seedDims.width,
    dims: seedDims,
  });

  const queue: number[] = [seed.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = placed.get(currentId)!;
    const neighbors = adjMap.get(currentId) || [];

    for (const { adj, otherId } of neighbors) {
      if (placed.has(otherId) || collidedIds.has(otherId)) continue;
      const otherRoom = roomMap.get(otherId)!;
      const otherDims = getDims(otherRoom);
      if (!otherDims || (otherDims.length === 0 && otherDims.width === 0)) continue;

      const dirFromCurrent = currentId === adj.roomIdA
        ? normalizeDir(adj.wallDirectionA)
        : normalizeDir(adj.wallDirectionB);

      if (!dirFromCurrent) continue;

      let nx: number, ny: number;
      switch (dirFromCurrent) {
        case "east":
          nx = current.x + current.w;
          ny = current.y;
          break;
        case "west":
          nx = current.x - otherDims.length;
          ny = current.y;
          break;
        case "south":
          nx = current.x;
          ny = current.y + current.h;
          break;
        case "north":
          nx = current.x;
          ny = current.y - otherDims.width;
          break;
        default:
          continue;
      }

      let hasCollision = false;
      for (const p of Array.from(placed.values())) {
        const eps = 0.1;
        if (
          nx < p.x + p.w - eps &&
          nx + otherDims.length > p.x + eps &&
          ny < p.y + p.h - eps &&
          ny + otherDims.width > p.y + eps
        ) {
          hasCollision = true;
          break;
        }
      }

      if (hasCollision) {
        collidedIds.add(otherId);
      } else {
        placed.set(otherId, {
          id: otherId,
          name: otherRoom.name,
          x: nx,
          y: ny,
          w: otherDims.length,
          h: otherDims.width,
          dims: otherDims,
        });
        queue.push(otherId);
      }
    }
  }

  const placedArr = Array.from(placed.values());
  const disconnected = rooms.filter(
    (r) => !placed.has(r.id) && !collidedIds.has(r.id) && getDims(r) !== null,
  );
  const collided = rooms.filter((r) => collidedIds.has(r.id));
  return { placed: placedArr, disconnected, collided };
}

export async function validateLayout(sessionId: number): Promise<LayoutValidationResult> {
  const [allRooms, adjacencies] = await Promise.all([
    storage.getRooms(sessionId),
    storage.getAdjacenciesForSession(sessionId),
  ]);

  const interiorRooms = allRooms.filter(
    (r) => !r.viewType || r.viewType === "interior",
  );

  const issues: LayoutIssue[] = [];

  if (interiorRooms.length === 0) {
    return {
      ok: true,
      issues: [],
      summary: {
        totalRooms: 0,
        placedRooms: 0,
        orphanedRooms: 0,
        totalFloorAreaSF: 0,
        expectedAreaSF: null,
        areaDeltaPct: null,
        sharedWallMismatches: 0,
        gapCount: 0,
      },
    };
  }

  const roomsWithoutDims = interiorRooms.filter((r) => {
    const d = getDims(r);
    return !d || (d.length === 0 && d.width === 0);
  });
  for (const r of roomsWithoutDims) {
    issues.push({
      severity: "WARNING",
      code: "ROOM_MISSING_DIMS",
      message: `${r.name} has no dimensions — it cannot be placed in the floor plan`,
      roomIds: [r.id],
      suggestion: "Provide length and width for this room",
    });
  }

  const roomsWithDims = interiorRooms.filter((r) => {
    const d = getDims(r);
    return d && (d.length > 0 || d.width > 0);
  });

  let sharedWallMismatches = 0;
  for (const adj of adjacencies) {
    const roomA = interiorRooms.find((r) => r.id === adj.roomIdA);
    const roomB = interiorRooms.find((r) => r.id === adj.roomIdB);
    if (!roomA || !roomB) continue;

    const dimsA = getDims(roomA);
    const dimsB = getDims(roomB);
    if (!dimsA || !dimsB) continue;

    const dirA = normalizeDir(adj.wallDirectionA);
    const dirB = normalizeDir(adj.wallDirectionB);

    if (dirA && dirB) {
      if (dirB !== oppositeDir(dirA)) {
        issues.push({
          severity: "WARNING",
          code: "ADJACENCY_DIR_MISMATCH",
          message: `${roomA.name} is ${dirA} of ${roomB.name}, but ${roomB.name} direction is "${dirB}" instead of "${oppositeDir(dirA)}"`,
          roomIds: [roomA.id, roomB.id],
          suggestion: `Update the adjacency so ${roomB.name}'s wall direction is "${oppositeDir(dirA)}"`,
        });
      }
    }

    if (dirA) {
      const wallLenA = wallLengthForDirection(dimsA, dirA);
      const perpDirB = dirB || oppositeDir(dirA);
      const wallLenB = wallLengthForDirection(dimsB, perpDirB);

      if (wallLenA > 0 && wallLenB > 0) {
        const tolerance = 0.5;
        const isNorthSouth = dirA === "north" || dirA === "south";

        const sharedDimA = isNorthSouth ? dimsA.length : dimsA.width;
        const sharedDimB = isNorthSouth ? dimsB.length : dimsB.width;

        if (Math.abs(sharedDimA - sharedDimB) > tolerance) {
          const diff = Math.abs(sharedDimA - sharedDimB);
          if (sharedDimA > 0 && sharedDimB > 0 && diff > sharedDimA * 0.5) {
            issues.push({
              severity: "WARNING",
              code: "SHARED_WALL_LENGTH_MISMATCH",
              message: `${roomA.name} and ${roomB.name} share a wall but their dimensions along that wall differ by ${diff.toFixed(1)}' (${sharedDimA.toFixed(1)}' vs ${sharedDimB.toFixed(1)}')`,
              roomIds: [roomA.id, roomB.id],
              suggestion: "Rooms sharing a wall should have matching dimensions along the shared edge, or use an offset/L-shape configuration",
              details: { sharedDimA, sharedDimB, direction: dirA, diff },
            });
            sharedWallMismatches++;
          } else if (sharedDimA > 0 && sharedDimB > 0) {
            issues.push({
              severity: "INFO",
              code: "SHARED_WALL_MINOR_MISMATCH",
              message: `${roomA.name} and ${roomB.name} have a ${diff.toFixed(1)}' difference along their shared wall (${sharedDimA.toFixed(1)}' vs ${sharedDimB.toFixed(1)}') — this creates a step in the floor plan`,
              roomIds: [roomA.id, roomB.id],
              details: { sharedDimA, sharedDimB, direction: dirA, diff },
            });
          }
        }
      }
    }
  }

  const { placed, disconnected, collided } = bfsPlace(roomsWithDims, adjacencies);

  for (const r of disconnected) {
    issues.push({
      severity: "WARNING",
      code: "ROOM_DISCONNECTED",
      message: `${r.name} has no adjacency connections — it cannot be positioned relative to other rooms`,
      roomIds: [r.id],
      suggestion: "Add adjacency relationships to connect this room to the floor plan",
    });
  }

  for (const r of collided) {
    issues.push({
      severity: "WARNING",
      code: "ROOM_COLLISION",
      message: `${r.name} could not be placed due to overlap with another room — dimensions or adjacencies may be incorrect`,
      roomIds: [r.id],
      suggestion: "Review dimensions and adjacency directions for this room",
    });
  }

  let gapCount = 0;
  if (placed.length >= 2) {
    for (const adj of adjacencies) {
      const pA = placed.find((p) => p.id === adj.roomIdA);
      const pB = placed.find((p) => p.id === adj.roomIdB);
      if (!pA || !pB) continue;

      const dirA = normalizeDir(adj.wallDirectionA);
      const dirB = normalizeDir(adj.wallDirectionB);
      const effectiveDir = dirA || (dirB ? oppositeDir(dirB) : null);
      if (!effectiveDir) continue;

      let expectedContact = false;
      const tolerance = 0.5;

      switch (effectiveDir) {
        case "east":
          expectedContact = Math.abs((pA.x + pA.w) - pB.x) < tolerance;
          break;
        case "west":
          expectedContact = Math.abs(pA.x - (pB.x + pB.w)) < tolerance;
          break;
        case "south":
          expectedContact = Math.abs((pA.y + pA.h) - pB.y) < tolerance;
          break;
        case "north":
          expectedContact = Math.abs(pA.y - (pB.y + pB.h)) < tolerance;
          break;
      }

      if (!expectedContact) {
        gapCount++;
        issues.push({
          severity: "INFO",
          code: "LAYOUT_GAP",
          message: `Gap detected between ${pA.name} and ${pB.name} — rooms are not flush along their shared wall`,
          roomIds: [pA.id, pB.id],
          details: {
            roomA: { x: pA.x, y: pA.y, w: pA.w, h: pA.h },
            roomB: { x: pB.x, y: pB.y, w: pB.w, h: pB.h },
          },
        });
      }
    }
  }

  const totalFloorAreaSF = interiorRooms.reduce((sum, r) => {
    const d = getDims(r);
    return sum + (d ? d.length * d.width : 0);
  }, 0);

  let expectedAreaSF: number | null = null;
  let areaDeltaPct: number | null = null;

  try {
    const session = await storage.getInspectionSession(sessionId);
    if (session?.claimId) {
      const claim = await storage.getClaim(session.claimId);
      const sqft = (claim as any)?.squareFootage;
      if (sqft && Number(sqft) > 0) {
        expectedAreaSF = Number(sqft);
      }
      if (!expectedAreaSF) {
        const briefing = await storage.getBriefing(session.claimId);
        const pp = briefing?.propertyProfile as any;
        if (pp?.squareFootage && Number(pp.squareFootage) > 0) {
          expectedAreaSF = Number(pp.squareFootage);
        }
      }
    }
  } catch {}

  if (expectedAreaSF && expectedAreaSF > 0 && totalFloorAreaSF > 0) {
    areaDeltaPct = ((totalFloorAreaSF - expectedAreaSF) / expectedAreaSF) * 100;

    if (areaDeltaPct > 30) {
      issues.push({
        severity: "WARNING",
        code: "AREA_EXCEEDS_DWELLING",
        message: `Total room area (${Math.round(totalFloorAreaSF)} SF) exceeds known dwelling size (${Math.round(expectedAreaSF)} SF) by ${Math.abs(areaDeltaPct).toFixed(0)}%`,
        suggestion: "Check room dimensions — total area seems too large for this dwelling",
        details: { totalFloorAreaSF: Math.round(totalFloorAreaSF), expectedAreaSF: Math.round(expectedAreaSF), deltaPct: Math.round(areaDeltaPct) },
      });
    } else if (areaDeltaPct < -40) {
      issues.push({
        severity: "INFO",
        code: "AREA_UNDER_DWELLING",
        message: `Total room area (${Math.round(totalFloorAreaSF)} SF) is ${Math.abs(areaDeltaPct).toFixed(0)}% less than the dwelling size (${Math.round(expectedAreaSF)} SF) — some rooms may be missing`,
        suggestion: "Consider whether all rooms have been added to the inspection",
        details: { totalFloorAreaSF: Math.round(totalFloorAreaSF), expectedAreaSF: Math.round(expectedAreaSF), deltaPct: Math.round(areaDeltaPct) },
      });
    }
  }

  const hasBlockers = issues.some((i) => i.severity === "BLOCKER");

  return {
    ok: !hasBlockers,
    issues,
    summary: {
      totalRooms: interiorRooms.length,
      placedRooms: placed.length,
      orphanedRooms: disconnected.length + collided.length,
      totalFloorAreaSF: Math.round(totalFloorAreaSF),
      expectedAreaSF: expectedAreaSF ? Math.round(expectedAreaSF) : null,
      areaDeltaPct: areaDeltaPct !== null ? Math.round(areaDeltaPct) : null,
      sharedWallMismatches,
      gapCount,
    },
  };
}
