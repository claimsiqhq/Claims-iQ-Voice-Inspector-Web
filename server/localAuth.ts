import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "claimsiq-local-dev-secret-change-in-production";
const JWT_EXPIRY = "7d";

export interface LocalTokenPayload {
  type: "local";
  userId: string;
  iat?: number;
  exp?: number;
}

export function createLocalToken(user: User): string {
  return jwt.sign(
    { type: "local", userId: user.id } satisfies Omit<LocalTokenPayload, "iat" | "exp">,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

export function verifyLocalToken(token: string): LocalTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as LocalTokenPayload;
    if (decoded?.type === "local" && decoded?.userId) return decoded;
    return null;
  } catch {
    return null;
  }
}
