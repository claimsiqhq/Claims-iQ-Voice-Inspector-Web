import { Router } from "express";
import bcrypt from "bcrypt";
import { storage } from "../storage";
import { authenticateRequest, authenticateSupabaseToken } from "../auth";
import { createLocalToken } from "../localAuth";
import { logger } from "../logger";
import { handleRouteError } from "../utils";

export function authRouter(): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    try {
      const { emailOrUsername, password } = req.body;
      if (!emailOrUsername || !password) {
        return res.status(400).json({ message: "Email/username and password are required" });
      }
      const user = await storage.getUserByEmailOrUsername(String(emailOrUsername).trim());
      if (!user) {
        return res.status(401).json({ message: "Invalid email/username or password" });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email/username or password" });
      }
      if (!user.isActive) {
        return res.status(403).json({ message: "Account is deactivated" });
      }
      await storage.updateUserLastLogin(user.id);
      const token = createLocalToken(user);
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email || "",
          fullName: user.fullName,
          role: user.role,
          title: user.title,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (error: unknown) {
      handleRouteError(res, error, "auth.login");
    }
  });

  router.post("/register", async (req, res) => {
    try {
      const { username, email, password, fullName } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const trimmedUsername = String(username).trim().toLowerCase();
      const trimmedEmail = email ? String(email).trim().toLowerCase() : null;
      if (trimmedUsername.length < 2) {
        return res.status(400).json({ message: "Username must be at least 2 characters" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const existingByUsername = await storage.getUserByUsername(trimmedUsername);
      if (existingByUsername) {
        return res.status(400).json({ message: "Username is already taken" });
      }
      if (trimmedEmail) {
        const existingByEmail = await storage.getUserByEmail(trimmedEmail);
        if (existingByEmail) {
          return res.status(400).json({ message: "Email is already registered" });
        }
      }
      const hashed = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username: trimmedUsername,
        password: hashed,
        email: trimmedEmail || undefined,
        fullName: fullName ? String(fullName).trim() : undefined,
        role: "adjuster",
      });
      const token = createLocalToken(user);
      res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email || "",
          fullName: user.fullName,
          role: user.role,
          title: user.title,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (error: unknown) {
      handleRouteError(res, error, "auth.register");
    }
  });

  router.post("/sync", authenticateSupabaseToken, async (req, res) => {
    try {
      const supabaseUser = req.supabaseUser;
      const { supabaseId, email, fullName } = req.body;
      console.log(`[auth.sync] supabaseId=${supabaseId} email=${email} tokenUser=${supabaseUser?.id}`);
      if (!supabaseId || !email) {
        return res.status(400).json({ message: "supabaseId and email required" });
      }
      if (supabaseUser?.id !== supabaseId) {
        console.log(`[auth.sync] token mismatch: tokenUser=${supabaseUser?.id} vs body=${supabaseId}`);
        return res.status(403).json({ message: "Token does not match provided supabaseId" });
      }
      const user = await storage.syncSupabaseUser(supabaseId, email, fullName || "");
      const token = createLocalToken(user);
      console.log(`[auth.sync] success userId=${user.id}`);
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email || "",
          fullName: user.fullName,
          role: user.role,
          title: user.title,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (error: unknown) {
      console.error(`[auth.sync] ERROR:`, error);
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
