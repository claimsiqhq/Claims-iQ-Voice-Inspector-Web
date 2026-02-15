import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

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

    if (supabaseUrl && supabaseAnonKey && token.startsWith("eyJ")) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
        if (!error && supabaseUser) {
          const [user] = await db.select().from(users).where(eq(users.supabaseAuthId, supabaseUser.id)).limit(1);
          if (user) {
            req.user = {
              id: user.id,
              email: user.email || "",
              role: user.role,
              fullName: user.fullName,
              supabaseAuthId: user.supabaseAuthId,
            };
            next();
            return;
          }
        }
      } catch {
        /* fall through to custom token */
      }
    }

    {
      const parts = token.split(".");
      if (parts.length !== 3) {
        res.status(401).json({ message: "Invalid token format" });
        return;
      }
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      const userId = payload.sub || payload.userId;
      if (!userId) {
        res.status(401).json({ message: "Invalid token" });
        return;
      }

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
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
    }

    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
}
