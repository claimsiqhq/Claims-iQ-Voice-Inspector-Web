import { type Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { supabase } from "./supabase";
import { verifyLocalToken } from "./localAuth";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        fullName: string | null;
        title: string | null;
        avatarUrl: string | null;
        supabaseAuthId: string | null;
      };
      supabaseUser?: { id: string; email?: string; [key: string]: unknown };
    }
  }
}

function setReqUser(req: Request, user: { id: string; email: string | null; role: string; fullName: string | null; title: string | null; avatarUrl: string | null; supabaseAuthId: string | null }) {
  req.user = {
    id: user.id,
    email: user.email || "",
    role: user.role,
    fullName: user.fullName,
    title: user.title ?? null,
    avatarUrl: user.avatarUrl ?? null,
    supabaseAuthId: user.supabaseAuthId,
  };
}

export async function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ message: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.substring(7);
    const reqPath = req.path;

    // Try local JWT first
    const localPayload = verifyLocalToken(token);
    if (localPayload) {
      const user = await storage.getUser(localPayload.userId);
      if (!user) {
        console.log(`[auth] 401 local-jwt user not found userId=${localPayload.userId} path=${reqPath}`);
        res.status(401).json({ message: "User not found" });
        return;
      }
      if (!user.isActive) {
        res.status(403).json({ message: "Account is deactivated" });
        return;
      }
      setReqUser(req, user);
      next();
      return;
    }

    // Fall back to Supabase
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      console.log(`[auth] 401 supabase-token-invalid path=${reqPath} error=${authError?.message || "no user"}`);
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    const supabaseAuthId = authData.user.id;
    const user = await storage.getUserBySupabaseId(supabaseAuthId);
    if (!user) {
      console.log(`[auth] 401 supabase user not in DB supabaseId=${supabaseAuthId} path=${reqPath}`);
      res.status(401).json({ message: "User not found" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ message: "Account is deactivated" });
      return;
    }

    setReqUser(req, user);
    next();
  } catch (error) {
    res.status(500).json({ message: "Authentication failed" });
  }
}

export async function authenticateSupabaseToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("[authenticateSupabaseToken] Missing auth header");
      res.status(401).json({ message: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.substring(7);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      console.log("[authenticateSupabaseToken] Token verification failed:", authError?.message || "no user");
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    req.supabaseUser = authData.user as unknown as { id: string; email?: string; [key: string]: unknown };
    next();
  } catch (error) {
    console.error("[authenticateSupabaseToken] ERROR:", error);
    res.status(500).json({ message: "Authentication failed" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "User not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = undefined;
      next();
      return;
    }

    const token = authHeader.substring(7);

    const localPayload = verifyLocalToken(token);
    if (localPayload) {
      const user = await storage.getUser(localPayload.userId);
      if (user && user.isActive) {
        setReqUser(req, user);
      } else {
        req.user = undefined;
      }
      next();
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      req.user = undefined;
      next();
      return;
    }

    const user = await storage.getUserBySupabaseId(authData.user.id);
    if (user) {
      setReqUser(req, user);
    } else {
      req.user = undefined;
    }

    next();
  } catch {
    req.user = undefined;
    next();
  }
}
