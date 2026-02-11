import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest, authenticateSupabaseToken } from "../auth";
import { logger } from "../logger";
import { handleRouteError } from "../utils";

export function authRouter(): Router {
  const router = Router();

  router.post("/sync", authenticateSupabaseToken, async (req, res) => {
    try {
      const supabaseUser = req.supabaseUser;
      const { supabaseId, email, fullName } = req.body;
      if (!supabaseId || !email) {
        return res.status(400).json({ message: "supabaseId and email required" });
      }
      if (supabaseUser?.id !== supabaseId) {
        return res.status(403).json({ message: "Token does not match provided supabaseId" });
      }
      const user = await storage.syncSupabaseUser(supabaseId, email, fullName || "");
      res.json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        title: user.title,
        avatarUrl: user.avatarUrl,
      });
    } catch (error: unknown) {
      handleRouteError(res, error, "auth.sync");
    }
  });

  router.get("/me", authenticateRequest, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      res.json({
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        role: req.user.role,
        title: req.user.title,
        avatarUrl: req.user.avatarUrl,
      });
    } catch (error: unknown) {
      logger.apiError(req.method, req.path, error as Error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
