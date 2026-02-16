import { Router } from "express";
import { authenticateRequest } from "../auth";
import { logger } from "../logger";

export function logsRouter() {
  const router = Router();

  router.post("/voice-tool", authenticateRequest, async (req, res) => {
    try {
      const { toolName, type, data } = req.body;
      if (type === "call") {
        logger.voiceToolCall(toolName, data);
      } else if (type === "result") {
        logger.voiceToolResult(toolName, data);
      } else if (type === "error") {
        logger.voiceToolError(toolName, data);
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: "Log write failed" });
    }
  });

  return router;
}
