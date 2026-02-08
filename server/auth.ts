import { type Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { supabase } from "./supabase";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        fullName: string | null;
        supabaseAuthId: string | null;
      };
    }
  }
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

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    const supabaseAuthId = authData.user.id;

    const user = await storage.getUserBySupabaseId(supabaseAuthId);
    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email || "",
      role: user.role,
      fullName: user.fullName,
      supabaseAuthId: user.supabaseAuthId,
    };

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
      res.status(401).json({ message: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.substring(7);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    (req as any).supabaseUser = authData.user;
    next();
  } catch (error) {
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

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      req.user = undefined;
      next();
      return;
    }

    const user = await storage.getUserBySupabaseId(authData.user.id);

    if (user) {
      req.user = {
        id: user.id,
        email: user.email || "",
        role: user.role,
        fullName: user.fullName,
        supabaseAuthId: user.supabaseAuthId,
      };
    } else {
      req.user = undefined;
    }

    next();
  } catch {
    req.user = undefined;
    next();
  }
}
