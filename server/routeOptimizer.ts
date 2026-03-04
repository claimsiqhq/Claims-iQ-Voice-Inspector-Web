import { type Claim } from "@shared/schema";
import { logger } from "./logger";

export interface RouteStop {
  claimId: number;
  latitude: number;
  longitude: number;
  estimatedDurationMin: number;
  priority: string;
  order: number;
}

export interface OptimizedRoute {
  stops: RouteStop[];
  totalDistanceKm: number;
  totalDriveTimeMin: number;
  totalDurationMin: number;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

function haversineDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function estimateDriveTimeMin(distanceKm: number): number {
  const avgSpeedKmh = 50;
  return Math.round((distanceKm / avgSpeedKmh) * 60);
}

export function optimizeRoute(
  claims: Claim[],
  startLocation?: Coordinate | null,
): OptimizedRoute {
  const geocoded = claims.filter(
    (c) => c.latitude != null && c.longitude != null,
  );

  if (geocoded.length === 0) {
    return { stops: [], totalDistanceKm: 0, totalDriveTimeMin: 0, totalDurationMin: 0 };
  }

  if (geocoded.length === 1) {
    const c = geocoded[0];
    const stop: RouteStop = {
      claimId: c.id,
      latitude: c.latitude!,
      longitude: c.longitude!,
      estimatedDurationMin: c.estimatedDurationMin ?? 60,
      priority: c.priority ?? "normal",
      order: 1,
    };
    let driveTime = 0;
    let distance = 0;
    if (startLocation) {
      distance = haversineDistance(startLocation, { latitude: c.latitude!, longitude: c.longitude! });
      driveTime = estimateDriveTimeMin(distance);
    }
    return {
      stops: [stop],
      totalDistanceKm: Math.round(distance * 10) / 10,
      totalDriveTimeMin: driveTime,
      totalDurationMin: driveTime + (c.estimatedDurationMin ?? 60),
    };
  }

  const priorityWeight: Record<string, number> = {
    critical: 4,
    high: 3,
    normal: 2,
    low: 1,
  };

  const sorted = [...geocoded].sort((a, b) => {
    const wa = priorityWeight[(a.priority ?? "normal").toLowerCase()] ?? 2;
    const wb = priorityWeight[(b.priority ?? "normal").toLowerCase()] ?? 2;
    return wb - wa;
  });

  const visited = new Set<number>();
  const route: Claim[] = [];

  let current: Coordinate = startLocation ?? {
    latitude: sorted[0].latitude!,
    longitude: sorted[0].longitude!,
  };

  if (!startLocation) {
    const first = sorted[0];
    route.push(first);
    visited.add(first.id);
    current = { latitude: first.latitude!, longitude: first.longitude! };
  }

  while (visited.size < geocoded.length) {
    let bestClaim: Claim | null = null;
    let bestScore = Infinity;

    for (const c of geocoded) {
      if (visited.has(c.id)) continue;

      const dist = haversineDistance(current, {
        latitude: c.latitude!,
        longitude: c.longitude!,
      });

      const pw = priorityWeight[(c.priority ?? "normal").toLowerCase()] ?? 2;
      const score = dist / pw;

      if (score < bestScore) {
        bestScore = score;
        bestClaim = c;
      }
    }

    if (!bestClaim) break;

    route.push(bestClaim);
    visited.add(bestClaim.id);
    current = { latitude: bestClaim.latitude!, longitude: bestClaim.longitude! };
  }

  let totalDistanceKm = 0;
  let prevCoord: Coordinate = startLocation ?? {
    latitude: route[0].latitude!,
    longitude: route[0].longitude!,
  };

  const stops: RouteStop[] = route.map((c, idx) => {
    const coord: Coordinate = { latitude: c.latitude!, longitude: c.longitude! };
    if (idx > 0 || startLocation) {
      totalDistanceKm += haversineDistance(prevCoord, coord);
    }
    prevCoord = coord;

    return {
      claimId: c.id,
      latitude: c.latitude!,
      longitude: c.longitude!,
      estimatedDurationMin: c.estimatedDurationMin ?? 60,
      priority: c.priority ?? "normal",
      order: idx + 1,
    };
  });

  totalDistanceKm = Math.round(totalDistanceKm * 10) / 10;
  const totalDriveTimeMin = estimateDriveTimeMin(totalDistanceKm);
  const totalInspectionMin = stops.reduce((sum, s) => sum + s.estimatedDurationMin, 0);

  logger.info(
    `Route optimized: ${stops.length} stops, ${totalDistanceKm}km, ~${totalDriveTimeMin}min drive`,
  );

  return {
    stops,
    totalDistanceKm,
    totalDriveTimeMin,
    totalDurationMin: totalDriveTimeMin + totalInspectionMin,
  };
}

export function getDriveTimes(
  claims: Claim[],
  startLocation?: Coordinate | null,
): Array<{ claimId: number; driveTimeMin: number; distanceKm: number }> {
  const geocoded = claims.filter(
    (c) => c.latitude != null && c.longitude != null,
  );
  if (geocoded.length === 0) return [];

  const results: Array<{ claimId: number; driveTimeMin: number; distanceKm: number }> = [];
  let prev: Coordinate = startLocation ?? {
    latitude: geocoded[0].latitude!,
    longitude: geocoded[0].longitude!,
  };

  for (let i = 0; i < geocoded.length; i++) {
    const c = geocoded[i];
    const coord: Coordinate = { latitude: c.latitude!, longitude: c.longitude! };
    const dist = i === 0 && !startLocation ? 0 : haversineDistance(prev, coord);
    results.push({
      claimId: c.id,
      driveTimeMin: estimateDriveTimeMin(dist),
      distanceKm: Math.round(dist * 10) / 10,
    });
    prev = coord;
  }

  return results;
}
