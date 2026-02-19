/**
 * BFS adjacency layout for interior floor plan.
 * Rooms are placed by adjacency; dimensions determine pixel size.
 */

export interface LayoutRoom {
  room: { id: number; name: string; status: string; damageCount: number; photoCount: number; dimensions?: any; annotations?: any[] };
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Adjacency {
  id: number;
  roomIdA: number;
  roomIdB: number;
  wallDirectionA?: string | null;
  wallDirectionB?: string | null;
}

function normalizeDirection(dir: string | null | undefined): "north" | "south" | "east" | "west" | null {
  if (!dir) return null;
  const d = dir.toLowerCase();
  if (d === "north" || d === "rear") return "north";
  if (d === "south" || d === "front") return "south";
  if (d === "east" || d === "right") return "east";
  if (d === "west" || d === "left") return "west";
  return null;
}

export function bfsLayout(
  rooms: Array<{ id: number; name: string; status?: string; damageCount?: number; photoCount?: number; dimensions?: any; annotations?: any[] }>,
  adjacencies: Adjacency[],
  scale: number,
  minW: number,
  minH: number,
): LayoutRoom[] {
  if (rooms.length === 0) return [];

  const roomMap = new Map<number, (typeof rooms)[0]>();
  for (const r of rooms) roomMap.set(r.id, r);

  const adjMap = new Map<number, Array<{ adj: Adjacency; otherId: number }>>();
  for (const a of adjacencies) {
    if (!roomMap.has(a.roomIdA) || !roomMap.has(a.roomIdB)) continue;
    if (!adjMap.has(a.roomIdA)) adjMap.set(a.roomIdA, []);
    if (!adjMap.has(a.roomIdB)) adjMap.set(a.roomIdB, []);
    adjMap.get(a.roomIdA)!.push({ adj: a, otherId: a.roomIdB });
    adjMap.get(a.roomIdB)!.push({ adj: a, otherId: a.roomIdA });
  }

  function getRoomSize(r: (typeof rooms)[0]): { w: number; h: number } {
    const d = r.dimensions as any;
    if (d?.length && d?.width) {
      const scaleW = minW / (d.length * scale);
      const scaleH = minH / (d.width * scale);
      const needsUpscale = scaleW > 1 || scaleH > 1;
      if (needsUpscale) {
        const upscale = Math.max(scaleW, scaleH);
        return { w: d.length * scale * upscale, h: d.width * scale * upscale };
      }
      return { w: d.length * scale, h: d.width * scale };
    }
    const w = d?.length ? Math.max(d.length * scale, minW) : minW + 8;
    const h = d?.width ? Math.max(d.width * scale, minH) : minH;
    return { w, h };
  }

  const placed = new Map<number, LayoutRoom>();
  const queue: number[] = [];

  const first = rooms[0];
  const firstSize = getRoomSize(first);
  placed.set(first.id, { room: first, x: 0, y: 0, w: firstSize.w, h: firstSize.h });
  queue.push(first.id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = placed.get(currentId)!;
    const neighbors = adjMap.get(currentId) || [];

    for (const { adj, otherId } of neighbors) {
      if (placed.has(otherId)) continue;

      const otherRoom = roomMap.get(otherId)!;
      const otherSize = getRoomSize(otherRoom);

      const dirA = currentId === adj.roomIdA
        ? normalizeDirection(adj.wallDirectionA)
        : normalizeDirection(adj.wallDirectionB);

      let nx: number, ny: number;

      switch (dirA) {
        case "east":
          nx = current.x + current.w;
          ny = current.y;
          break;
        case "west":
          nx = current.x - otherSize.w;
          ny = current.y;
          break;
        case "south":
          nx = current.x;
          ny = current.y + current.h;
          break;
        case "north":
          nx = current.x;
          ny = current.y - otherSize.h;
          break;
        default:
          nx = current.x + current.w;
          ny = current.y;
          break;
      }

      let hasCollision = false;
      for (const p of Array.from(placed.values())) {
        if (nx < p.x + p.w && nx + otherSize.w > p.x && ny < p.y + p.h && ny + otherSize.h > p.y) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        placed.set(otherId, { room: otherRoom, x: nx, y: ny, w: otherSize.w, h: otherSize.h });
        queue.push(otherId);
      }
    }
  }

  const placedArr = Array.from(placed.values());
  const unplaced = rooms.filter((r) => !placed.has(r.id));
  if (unplaced.length > 0) {
    const maxBfsY = placedArr.length > 0 ? Math.max(...placedArr.map((l) => l.y + l.h)) : 0;
    const gap = 6;
    let cx = 0;
    let cy = maxBfsY + (placedArr.length > 0 ? 18 : 0);
    let rowH = 0;

    for (const r of unplaced) {
      const d = r.dimensions as any;
      let w: number, h: number;
      if (d?.length && d?.width) {
        const scaleW = minW / (d.length * scale);
        const scaleH = minH / (d.width * scale);
        const needsUpscale = scaleW > 1 || scaleH > 1;
        if (needsUpscale) {
          const upscale = Math.max(scaleW, scaleH);
          w = d.length * scale * upscale;
          h = d.width * scale * upscale;
        } else {
          w = d.length * scale;
          h = d.width * scale;
        }
      } else {
        w = d?.length ? Math.max(d.length * scale, minW) : minW + 10;
        h = d?.width ? Math.max(d.width * scale, minH) : minH + 6;
      }

      if (cx + w > 400 && cx > 0) {
        cx = 0;
        cy += rowH + gap;
        rowH = 0;
      }
      placed.set(r.id, { room: r, x: cx, y: cy, w, h });
      cx += w + gap;
      rowH = Math.max(rowH, h);
    }
  }

  const all = Array.from(placed.values());
  const minX = Math.min(...all.map((l) => l.x));
  const minY = Math.min(...all.map((l) => l.y));
  return all.map((l) => ({
    ...l,
    x: l.x - minX,
    y: l.y - minY,
  }));
}

/** Hit test: which wall (north/east/south/west) was clicked. Returns 0..1 offset along wall. */
export function hitTestWall(roomX: number, roomY: number, roomW: number, roomH: number, px: number, py: number, hitPadding: number): { wall: "north" | "south" | "east" | "west"; offset: number } | null {
  const pad = hitPadding;

  if (py >= roomY - pad && py <= roomY + pad && px >= roomX && px <= roomX + roomW) {
    return { wall: "north", offset: (px - roomX) / roomW };
  }
  if (py >= roomY + roomH - pad && py <= roomY + roomH + pad && px >= roomX && px <= roomX + roomW) {
    return { wall: "south", offset: (px - roomX) / roomW };
  }
  if (px >= roomX + roomW - pad && px <= roomX + roomW + pad && py >= roomY && py <= roomY + roomH) {
    return { wall: "east", offset: (py - roomY) / roomH };
  }
  if (px >= roomX - pad && px <= roomX + pad && py >= roomY && py <= roomY + roomH) {
    return { wall: "west", offset: (py - roomY) / roomH };
  }

  return null;
}
