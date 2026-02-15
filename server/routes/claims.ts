import { Router } from "express";
import { db } from "../db";
import { claims, documents } from "@shared/schema";
import { eq, or, desc } from "drizzle-orm";
import { authenticateRequest } from "../auth";

export function claimsRouter() {
  const router = Router();

  router.get("/my-claims", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const list = await db
        .select()
        .from(claims)
        .where(eq(claims.assignedTo, userId))
        .orderBy(desc(claims.createdAt));
      res.json(list);
    } catch (err) {
      console.error("my-claims error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:id", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const claimId = parseInt(String(req.params.id));
      if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (claim.assignedTo !== userId && req.user!.role !== "supervisor" && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.json(claim);
    } catch (err) {
      console.error("claim get error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;
      const list = role === "supervisor" || role === "admin"
        ? await db.select().from(claims).orderBy(desc(claims.createdAt))
        : await db.select().from(claims).where(eq(claims.assignedTo, userId)).orderBy(desc(claims.createdAt));
      res.json(list);
    } catch (err) {
      console.error("claims list error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/:claimId/documents", authenticateRequest, async (req, res) => {
    try {
      const userId = req.user!.id;
      const claimId = parseInt(String(req.params.claimId));
      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      if (claim.assignedTo !== userId && req.user!.role !== "supervisor" && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      const list = await db.select().from(documents).where(eq(documents.claimId, claimId)).orderBy(desc(documents.createdAt));
      res.json(list);
    } catch (err) {
      console.error("documents error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
