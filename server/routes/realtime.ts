import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { buildSystemInstructions, realtimeTools } from "../realtime";
import { logger } from "../logger";
import { getAllowedTools, getWorkflowState, initSessionWorkflow } from "../workflow/orchestrator";

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
        low:    { threshold: 0.95, silence_duration_ms: 1500, prefix_padding_ms: 800 },
        medium: { threshold: 0.90, silence_duration_ms: 1000, prefix_padding_ms: 600 },
        high:   { threshold: 0.75, silence_duration_ms: 600,  prefix_padding_ms: 400 },
      };
      const sensitivity = (s.silenceDetectionSensitivity || 'medium') as keyof typeof vadConfig;
      const vad = vadConfig[sensitivity] || vadConfig.medium;

      let verbosityHint = '';
      if (s.assistantVerbosity === 'concise') {
        verbosityHint = '\n\nIMPORTANT: Be extremely concise. Short sentences. Skip pleasantries. Just facts and actions.';
      } else if (s.assistantVerbosity === 'detailed') {
        verbosityHint = '\n\nThe adjuster prefers detailed explanations. Narrate what you observe, explain your reasoning for suggested items, and provide thorough guidance at each step.';
      }

      let workflowState = sessionId ? await getWorkflowState(Number(sessionId)) : null;
      if (sessionId && !workflowState) {
        workflowState = await initSessionWorkflow({ claimId: Number(claimId), sessionId: Number(sessionId), peril: perilType });
      }
      const workflowHint = workflowState
        ? `\n\n## WORKFLOW CONTRACT\nCurrent Phase: ${workflowState.phase}\nStep: ${workflowState.stepId}\nAllowed tools now: ${getAllowedTools(workflowState).join(", ")}\nRules: tool-first, talk-after. If a tool is not allowed, ask to move step or call set_phase. Never execute tools out of context.`
        : "";
      const instructions = buildSystemInstructions(briefing, claim, inspectionFlow || undefined) + workflowHint + verbosityHint;

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
        const sessionUpdates: any = { voiceSessionId: data.id };
        if (inspectionFlow?.id) {
          sessionUpdates.activeFlowId = inspectionFlow.id;
        }
        await storage.updateSession(sessionId, sessionUpdates);
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

      const session = sessionId ? await storage.getInspectionSession(sessionId) : null;
      const flowSteps = inspectionFlow ? (inspectionFlow.steps as any[]) || [] : [];

      let hierarchySummary: string | null = null;
      if (sessionId) {
        try {
          const hierarchy = await storage.getInspectionHierarchy(sessionId);
          const parts: string[] = [];
          for (const struct of hierarchy.structures) {
            const roomNames = struct.rooms.map(r => {
              const details: string[] = [];
              if (r.damages.length > 0) details.push(`${r.damages.length} damages`);
              if (r.lineItemCount > 0) details.push(`${r.lineItemCount} items`);
              if (r.photoCount > 0) details.push(`${r.photoCount} photos`);
              return `${r.name}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
            });
            parts.push(`${struct.name}: ${roomNames.length > 0 ? roomNames.join(", ") : "no rooms yet"}`);
          }
          hierarchySummary = parts.length > 0 ? parts.join(" | ") : "No structures documented yet.";
        } catch (e) {
          logger.error("Realtime", "Failed to build hierarchy summary", e);
        }
      }

      res.json({
        clientSecret: data.client_secret.value,
        sessionId,
        transcriptSummary,
        hierarchySummary,
        sessionPhase: session?.currentPhase || 1,
        completedPhases: session?.completedPhases || [],
        sessionStructure: session?.currentStructure || "Main Dwelling",
        workflow: workflowState ? { phase: workflowState.phase, stepId: workflowState.stepId, allowedTools: getAllowedTools(workflowState) } : null,
        activeFlow: inspectionFlow ? {
          id: inspectionFlow.id,
          name: inspectionFlow.name,
          perilType: inspectionFlow.perilType,
          stepCount: flowSteps.length,
          steps: flowSteps.map((s: any, i: number) => ({
            phase: i + 1,
            name: s.phaseName || s.name,
          })),
        } : null,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return router;
}
