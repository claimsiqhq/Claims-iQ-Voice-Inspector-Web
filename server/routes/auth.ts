import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateRequest } from "../auth";
import { z } from "zod";

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(1),
  password: z.string().min(6),
  fullName: z.string().optional(),
});

function toAuthUser(row: { id: string; email: string | null; fullName: string | null; role: string; title: string | null; avatarUrl: string | null }) {
  return {
    id: row.id,
    email: row.email || "",
    fullName: row.fullName,
    role: row.role,
    title: row.title,
    avatarUrl: row.avatarUrl,
  };
}

export function authRouter() {
  const router = Router();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  router.post("/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "emailOrUsername and password are required" });
      }
      const { emailOrUsername, password } = parsed.data;

      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        let email = emailOrUsername.includes("@") ? emailOrUsername : null;
        if (!email) {
          const [u] = await db.select().from(users).where(eq(users.username, emailOrUsername)).limit(1);
          email = u?.email || `${emailOrUsername}@claimsiq.local`;
        }
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          return res.status(401).json({ message: error.message || "Invalid credentials" });
        }

        const supaUser = data.user;
        if (!supaUser) {
          return res.status(401).json({ message: "Invalid credentials" });
        }

        const [existing] = await db.select().from(users).where(eq(users.supabaseAuthId, supaUser.id)).limit(1);
        let userRow = existing;

        if (!userRow) {
          const [inserted] = await db.insert(users).values({
            id: crypto.randomUUID(),
            username: supaUser.email?.split("@")[0] || `user_${Date.now()}`,
            password: "supabase",
            email: supaUser.email || null,
            fullName: supaUser.user_metadata?.full_name || null,
            supabaseAuthId: supaUser.id,
            role: "adjuster",
          }).returning();
          userRow = inserted;
        }

        return res.json({
          token: data.session?.access_token,
          user: toAuthUser(userRow),
        });
      }

      const [userRow] = await db.select().from(users).where(
        emailOrUsername.includes("@") ? eq(users.email, emailOrUsername) : eq(users.username, emailOrUsername)
      ).limit(1);

      if (!userRow || userRow.password !== password) {
        return res.status(401).json({ message: "Invalid email/username or password" });
      }

      const token = Buffer.from(JSON.stringify({
        sub: userRow.id,
        userId: userRow.id,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      })).toString("base64");
      const fakeJwt = `header.${token}.sig`;

      return res.json({
        token: fakeJwt,
        user: toAuthUser(userRow),
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid registration data" });
      }
      const { email, username, password, fullName } = parsed.data;

      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const signUpEmail = email || `${username}@claimsiq.local`;
        const { data, error } = await supabase.auth.signUp({
          email: signUpEmail,
          password,
          options: { data: { full_name: fullName } },
        });

        if (error) {
          return res.status(400).json({ message: error.message || "Registration failed" });
        }

        const supaUser = data.user;
        if (!supaUser) {
          return res.status(400).json({ message: "Registration failed" });
        }

        const [userRow] = await db.insert(users).values({
          id: crypto.randomUUID(),
          username,
          password: "supabase",
          email: signUpEmail,
          fullName: fullName || null,
          supabaseAuthId: supaUser.id,
          role: "adjuster",
        }).returning();

        return res.json({
          token: data.session?.access_token,
          user: toAuthUser(userRow),
        });
      }

      const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (existing) {
        return res.status(400).json({ message: "Username already taken" });
      }

      const [userRow] = await db.insert(users).values({
        id: crypto.randomUUID(),
        username,
        password,
        email: email || null,
        fullName: fullName || null,
        role: "adjuster",
      }).returning();

      const token = Buffer.from(JSON.stringify({
        sub: userRow.id,
        userId: userRow.id,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      })).toString("base64");
      const fakeJwt = `header.${token}.sig`;

      return res.json({
        token: fakeJwt,
        user: toAuthUser(userRow),
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/me", authenticateRequest, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const [userRow] = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
    if (!userRow) {
      return res.status(401).json({ message: "User not found" });
    }
    res.json(toAuthUser(userRow));
  });

  return router;
}
