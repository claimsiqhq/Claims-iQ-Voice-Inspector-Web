import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { buildSystemInstructions, realtimeTools } from "../realtime";
import { logger } from "../logger";

export function realtimeRouter() {
  const router = Router();

  router.post("/session", authenticateRequest, async (req, res) => {
    try {
      const { claimId, sessionId } = req.body;
      if (!claimId) {
        return res.status(400).json({ message: "claimId is required" });
      }

      const claim = await storage.getClaim(claimId);
      const briefing = await storage.getBriefing(claimId);
      if (!claim || !briefing) {
        return res.status(400).json({ message: "Claim or briefing not found" });
      }

      const userSettings = await storage.getUserSettings(req.user!.id);
      const s = (userSettings?.settings as Record<string, any>) || {};

      const perilType = claim.perilType || "General";
      const flowId = req.body.flowId ? parseInt(req.body.flowId) : undefined;
      let inspectionFlow;
      if (flowId) {
        inspectionFlow = await storage.getInspectionFlow(flowId);
      } else {
        inspectionFlow = await storage.getDefaultFlowForPeril(perilType, req.user!.id);
      }

      const voiceModel = s.voiceModel || 'alloy';

      const vadConfig = {
        low:    { threshold: 0.85, silence_duration_ms: 1200, prefix_padding_ms: 600 },
        medium: { threshold: 0.75, silence_duration_ms: 800,  prefix_padding_ms: 400 },
        high:   { threshold: 0.60, silence_duration_ms: 500,  prefix_padding_ms: 300 },
      };
      const sensitivity = (s.silenceDetectionSensitivity || 'medium') as keyof typeof vadConfig;
      const vad = vadConfig[sensitivity] || vadConfig.medium;

      let verbosityHint = '';
      if (s.assistantVerbosity === 'concise') {
        verbosityHint = '\n\nIMPORTANT: Be extremely concise. Short sentences. Skip pleasantries. Just facts and actions.';
      } else if (s.assistantVerbosity === 'detailed') {
        verbosityHint = '\n\nThe adjuster prefers detailed explanations. Narrate what you observe, explain your reasoning for suggested items, and provide thorough guidance at each step.';
      }

      const instructions = buildSystemInstructions(briefing, claim, inspectionFlow || undefined) + verbosityHint;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "OpenAI API key not configured" });
      }

      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview",
          voice: voiceModel,
          instructions,
          tools: realtimeTools,
          input_audio_transcription: { model: "whisper-1", language: "en" },
          modalities: ["audio", "text"],
          turn_detection: s.pushToTalk
            ? null
            : {
                type: "server_vad",
                threshold: vad.threshold,
                prefix_padding_ms: vad.prefix_padding_ms,
                silence_duration_ms: vad.silence_duration_ms,
              },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error("RealtimeSession", "Realtime session error", data);
        return res.status(500).json({ message: "Failed to create Realtime session", details: data });
      }

      logger.voiceSession("created", { claimId, sessionId, voiceModel, flowId: inspectionFlow?.id });

      if (sessionId) {
        await storage.updateSession(sessionId, { voiceSessionId: data.id });
      }

      let transcriptSummary: string | null = null;
      if (sessionId) {
        try {
          const transcripts = await storage.getTranscript(sessionId);
          if (transcripts.length > 0) {
            const recentEntries = transcripts.slice(-80);
            const lines = recentEntries.map(t => `${t.speaker === "user" ? "Adjuster" : "Agent"}: ${t.content}`);
            let summary = lines.join("\n");
            if (summary.length > 12000) {
              summary = summary.slice(-12000);
              const firstNewline = summary.indexOf("\n");
              if (firstNewline > 0) summary = summary.slice(firstNewline + 1);
            }
            transcriptSummary = summary;
          }
        } catch (e) {
          logger.error("Realtime", "Failed to build transcript summary", e);
        }
      }

      res.json({
        clientSecret: data.client_secret.value,
        sessionId,
        transcriptSummary,
        activeFlow: inspectionFlow ? {
          id: inspectionFlow.id,
          name: inspectionFlow.name,
          perilType: inspectionFlow.perilType,
          stepCount: (inspectionFlow.steps as any[])?.length || 0,
        } : null,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
