import type { Request, Response } from "express";
import type { Claim, InspectionSession, InspectionRoom, RoomAdjacency } from "@shared/schema";
import { storage } from "./storage";

export function isPrivilegedRole(role: string | undefined): boolean {
  return role === "admin" || role === "supervisor";
}

export function canAccessClaim(user: Request["user"] | undefined, claim: Pick<Claim, "assignedTo">): boolean {
  if (!user) return false;
  if (isPrivilegedRole(user.role)) return true;
  return claim.assignedTo === user.id;
}

export async function requireClaimAccess(
  req: Request,
  res: Response,
  claimId: number,
): Promise<Claim | null> {
  const claim = await storage.getClaim(claimId);
  if (!claim) {
    res.status(404).json({ message: "Claim not found" });
    return null;
  }
  if (!canAccessClaim(req.user, claim)) {
    res.status(403).json({ message: "Not authorized to access this claim" });
    return null;
  }
  return claim;
}

export async function requireSessionAccess(
  req: Request,
  res: Response,
  sessionId: number,
): Promise<InspectionSession | null> {
  const session = await storage.getInspectionSession(sessionId);
  if (!session) {
    res.status(404).json({ message: "Session not found" });
    return null;
  }
  const claim = await storage.getClaim(session.claimId);
  if (!claim) {
    res.status(404).json({ message: "Claim not found" });
    return null;
  }
  if (!canAccessClaim(req.user, claim)) {
    res.status(403).json({ message: "Not authorized to access this session" });
    return null;
  }
  return session;
}

export async function requireRoomAccess(
  req: Request,
  res: Response,
  roomId: number,
): Promise<InspectionRoom | null> {
  const room = await storage.getRoom(roomId);
  if (!room) {
    res.status(404).json({ message: "Room not found" });
    return null;
  }
  const session = await requireSessionAccess(req, res, room.sessionId);
  if (!session) return null;
  return room;
}

export async function requireAdjacencyAccess(
  req: Request,
  res: Response,
  adjacencyId: number,
): Promise<RoomAdjacency | null> {
  const adjacency = await storage.getAdjacency(adjacencyId);
  if (!adjacency) {
    res.status(404).json({ message: "Adjacency not found" });
    return null;
  }
  const session = await requireSessionAccess(req, res, adjacency.sessionId);
  if (!session) return null;
  return adjacency;
}
