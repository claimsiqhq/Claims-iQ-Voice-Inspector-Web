import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import type { User } from "@shared/schema";

const configuredJwtSecret = process.env.JWT_SECRET?.trim();
if (!configuredJwtSecret && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production.");
}
if (!configuredJwtSecret && process.env.NODE_ENV !== "test") {
  console.warn("[auth] JWT_SECRET not set; using ephemeral in-memory secret for non-production runtime.");
}
const JWT_SECRET = configuredJwtSecret || randomBytes(32).toString("hex");
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
