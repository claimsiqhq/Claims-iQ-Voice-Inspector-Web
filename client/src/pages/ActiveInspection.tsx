import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Mic,
  MicOff,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
  Flag,
  SkipForward,
  DollarSign,
  Loader2,
  AlertCircle,
  AlertTriangle,
  WifiOff,
  FileText,
  MapPin,
  Menu,
  BarChart3,
  Activity,
  Maximize2,
  X,
  Building2,
  Zap,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import VoiceIndicator from "@/components/VoiceIndicator";
import ProgressMap from "@/components/ProgressMap";
import InspectionProgressTracker from "@/components/InspectionProgressTracker";
import PropertySketch from "@/components/PropertySketch";
import SketchEditor from "@/components/SketchEditor";
import RoomEditorPanel, { AddRoomPanel } from "@/components/RoomEditorPanel";
import PhotoGallery from "@/components/PhotoGallery";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, resilientMutation } from "@/lib/queryClient";
import { supabase } from "@/lib/supabaseClient";
import { useSettings } from "@/hooks/use-settings";
import { logger } from "@/lib/logger";

type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error" | "disconnected";

interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
  timestamp: Date;
}

interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  openingCount: number;
  roomType?: string;
  phase?: number;
  dimensions?: { length?: number; width?: number; height?: number };
  structure?: string;
  viewType?: string;
  shapeType?: string;
  parentRoomId?: number | null;
  attachmentType?: string | null;
  facetLabel?: string | null;
  pitch?: string | null;
  floor?: number;
}

interface CameraMode {
  active: boolean;
  label: string;
  photoType: string;
  overlay: string;
}

const PHASES = [
  { id: 1, name: "Pre-Inspection" },
  { id: 2, name: "Setup" },
  { id: 3, name: "Exterior" },
  { id: 4, name: "Interior" },
  { id: 5, name: "Moisture" },
  { id: 6, name: "Evidence" },
  { id: 7, name: "Estimate" },
  { id: 8, name: "Finalize" },
];

export default function ActiveInspection({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const STORAGE_KEY = `inspection-session-${claimId}`;
  const [sessionId, setSessionId] = useState<number | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Date.now() - (parsed.timestamp || 0) < 86400000) {
          return parsed.sessionId ?? null;
        }
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    return null;
  });
  const [isResumedSession, setIsResumedSession] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return !!(parsed.sessionId && Date.now() - (parsed.timestamp || 0) < 86400000);
      } catch {}
    }
    return false;
  });
  const [voiceState, setVoiceState] = useState<VoiceState>("disconnected");
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnectingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const [currentPhase, setCurrentPhase] = useState(1);
  const [currentStructure, setCurrentStructure] = useState("Main Dwelling");
  const [currentArea, setCurrentArea] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const roomsRef = useRef<RoomData[]>([]);
  // Keep roomsRef in sync so tool handlers always have fresh data
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [agentPartialText, setAgentPartialText] = useState("");
  const [recentLineItems, setRecentLineItems] = useState<any[]>([]);
  const [estimateSummary, setEstimateSummary] = useState({ totalRCV: 0, totalACV: 0, itemCount: 0 });
  const [recentPhotos, setRecentPhotos] = useState<any[]>([]);
  // Auto-scope notification (PROMPT-19)
  const [autoScopeNotification, setAutoScopeNotification] = useState<{
    visible: boolean;
    count: number;
    items: Array<{ code: string; description: string; quantity: number; unit: string; unitPrice: number; totalPrice: number; source: string }>;
    warnings: string[];
  }>({ visible: false, count: 0, items: [], warnings: [] });
  // Photo-detected damage suggestions (PROMPT-19)
  const [photoDamageSuggestions, setPhotoDamageSuggestions] = useState<any[]>([]);
  // Phase validation (PROMPT-19)
  const [phaseValidation, setPhaseValidation] = useState<{
    visible: boolean;
    currentPhase: number;
    nextPhase: number;
    warnings: string[];
    missingItems: string[];
    completionScore: number;
  } | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddStructure, setShowAddStructure] = useState(false);
  const [addStructureName, setAddStructureName] = useState("");
  const [addStructureType, setAddStructureType] = useState("dwelling");
  const [creatingStructure, setCreatingStructure] = useState(false);
  const [deletingStructureId, setDeletingStructureId] = useState<number | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>({ active: false, label: "", photoType: "", overlay: "none" });
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const { settings } = useSettings();
  const [isPaused, setIsPaused] = useState(false);
  const [showProgressMap, setShowProgressMap] = useState(false);
  const [showProgressTracker, setShowProgressTracker] = useState(false);
  const [sketchCollapsed, setSketchCollapsed] = useState(false);
  const [sketchExpanded, setSketchExpanded] = useState(false);
  const [sketchEditMode, setSketchEditMode] = useState(false);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  const isMobile = useIsMobile();

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const pendingPhotoCallRef = useRef<{ call_id: string; label: string; photoType: string } | null>(null);
  const hasGreetedRef = useRef(false);
  const elapsedRef = useRef(0);
  const elapsedInitialized = useRef(false);
  if (!elapsedInitialized.current) {
    elapsedInitialized.current = true;
    const saved = localStorage.getItem(`inspection-session-${claimId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        elapsedRef.current = parsed.elapsedSeconds ?? 0;
      } catch {}
    }
  }
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [elapsed, setElapsed] = useState(() => {
    const saved = localStorage.getItem(`inspection-session-${claimId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.elapsedSeconds ?? 0;
      } catch {}
    }
    return 0;
  });

  const { data: claimData } = useQuery({
    queryKey: [`/api/claims/${claimId}`],
    enabled: !!claimId,
  });

  const { data: structuresList = [] } = useQuery<Array<{ id: number; name: string; structureType: string }>>({
    queryKey: [`/api/inspection/${sessionId}/structures`],
    enabled: !!sessionId && showAddStructure,
  });

  const sessionStartedRef = useRef(false);

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/claims/${claimId}/inspection/start`);
      return res.json();
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: data.sessionId,
          timestamp: Date.now(),
          elapsedSeconds: elapsedRef.current,
        })
      );
    },
  });

  // Validate restored session (from localStorage) - skip for freshly created sessions
  useEffect(() => {
    if (!sessionId || !claimId || !isResumedSession) return;
    apiRequest("GET", `/api/inspection/${sessionId}`)
      .then((res: Response) => res.json())
      .then((session: any) => {
        if (session?.status === "completed") {
          localStorage.removeItem(STORAGE_KEY);
          setSessionId(null);
          setIsResumedSession(false);
          setLocation(`/inspection/${claimId}/review`);
        }
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setSessionId(null);
        setIsResumedSession(false);
        if (!sessionStartedRef.current) {
          sessionStartedRef.current = true;
          startSessionMutation.mutate();
        }
      });
  }, [sessionId, claimId, isResumedSession]);

  useEffect(() => {
    if (!sessionStartedRef.current && claimId && !sessionId) {
      sessionStartedRef.current = true;
      startSessionMutation.mutate();
    }
  }, [claimId, sessionId]);

  useEffect(() => {
    if (isConnected && !isPaused) {
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isConnected, isPaused]);

  // Persist session state periodically (elapsed time, etc.)
  useEffect(() => {
    if (!sessionId || !isConnected) return;
    const persistInterval = setInterval(() => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId,
          timestamp: Date.now(),
          elapsedSeconds: elapsedRef.current,
        })
      );
    }, 30000);
    return () => clearInterval(persistInterval);
  }, [sessionId, isConnected]);

  const getAuthHeaders = useCallback(async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      if (!supabase) return headers;
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch (e) { logger.error("Voice", "Auth header error", e); }
    return headers;
  }, []);

  const sendLogToServer = useCallback(async (toolName: string, type: "call" | "result" | "error", data: any) => {
    try {
      const headers = await getAuthHeaders();
      fetch("/api/logs/voice-tool", {
        method: "POST", headers, body: JSON.stringify({ toolName, type, data }),
      }).catch(() => {});
    } catch {}
  }, [getAuthHeaders]);

  const refreshEstimate = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/estimate-summary`, { headers });
      const data = await res.json();
      setEstimateSummary(data);
    } catch (e) { logger.error("Voice", "Refresh estimate error", e); }
  }, [sessionId, getAuthHeaders]);

  const refreshLineItems = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/line-items`, { headers });
      if (!res.ok) return;
      const items = await res.json();
      if (Array.isArray(items)) {
        setRecentLineItems(items.slice(-5).reverse());
      }
      refreshEstimate();
    } catch (e) { logger.error("Voice", "Refresh line items error", e); }
  }, [sessionId, refreshEstimate, getAuthHeaders]);

  const fetchFreshRooms = useCallback(async (): Promise<RoomData[]> => {
    if (!sessionId) return roomsRef.current;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/rooms`, { headers });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (e) {
      logger.error("Voice", "Failed to fetch fresh rooms", e);
    }
    return roomsRef.current;
  }, [sessionId, getAuthHeaders]);

  const refreshRooms = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = await getAuthHeaders();
      const [roomsRes, openingsRes] = await Promise.all([
        fetch(`/api/inspection/${sessionId}/rooms`, { headers }),
        fetch(`/api/inspection/${sessionId}/openings`, { headers }),
      ]);
      const roomsData = await roomsRes.json();
      const openingsData = openingsRes.ok ? await openingsRes.json() : [];
      const openingCountByRoom = new Map<number, number>();
      for (const o of openingsData) {
        openingCountByRoom.set(o.roomId, (openingCountByRoom.get(o.roomId) || 0) + (o.quantity || 1));
      }
      const enrichedRooms = roomsData.map((r: any) => ({
        ...r,
        openingCount: openingCountByRoom.get(r.id) || 0,
      }));
      setRooms(enrichedRooms);
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
    } catch (e) { logger.error("Voice", "Refresh rooms error", e); }
  }, [sessionId, getAuthHeaders, queryClient]);

  const handleCreateStructure = useCallback(async () => {
    if (!sessionId || !addStructureName.trim()) return;
    setCreatingStructure(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/structures`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: addStructureName.trim(), structureType: addStructureType }),
      });
      if (!res.ok) return;
      const structure = await res.json();
      setCurrentStructure(structure.name);
      await fetch(`/api/inspection/${sessionId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ currentStructure: structure.name }),
      }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/structures`] });
      setShowAddStructure(false);
      setAddStructureName("");
      setAddStructureType("dwelling");
    } catch (e) {
      logger.error("Voice", "Create structure error", e);
    } finally {
      setCreatingStructure(false);
    }
  }, [sessionId, addStructureName, addStructureType, getAuthHeaders, queryClient]);

  const handleDeleteStructure = useCallback(async (structureId: number, structureName: string) => {
    if (!sessionId || !window.confirm(`Delete structure "${structureName}"? This will fail if it has any rooms.`)) return;
    setDeletingStructureId(structureId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/structures/${structureId}`, { method: "DELETE", headers });
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || "Cannot delete: structure has rooms.");
        return;
      }
      if (!res.ok) return;
      if (currentStructure === structureName) {
        const remaining = structuresList.filter((s) => s.id !== structureId);
        setCurrentStructure(remaining[0]?.name ?? "Main Dwelling");
      }
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/hierarchy`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/structures`] });
      refreshRooms();
    } catch (e) {
      logger.error("Voice", "Delete structure error", e);
    } finally {
      setDeletingStructureId(null);
    }
  }, [sessionId, currentStructure, structuresList, getAuthHeaders, queryClient, refreshRooms]);

  const addTranscriptEntry = useCallback(async (role: "user" | "agent", text: string) => {
    if (!text.trim()) return;
    setTranscript((prev) => [...prev, { role, text, timestamp: new Date() }]);
    if (sessionId) {
      try {
        const headers = await getAuthHeaders();
        fetch(`/api/inspection/${sessionId}/transcript`, {
          method: "POST",
          headers,
          body: JSON.stringify({ speaker: role, content: text }),
        }).catch((e) => logger.error("Voice", "Transcript save error", e));
      } catch (e) { logger.error("Voice", "Transcript error", e); }
    }
  }, [sessionId, getAuthHeaders]);

  // Initial data load when session is available
  useEffect(() => {
    if (!sessionId) return;
    refreshRooms();
    refreshLineItems();
    refreshEstimate();
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/inspection/${sessionId}/photos`, { headers });
        if (res.ok) {
          const photos = await res.json();
          setRecentPhotos(photos.slice(-50).reverse().map((p: any) => ({
            id: p.id,
            thumbnail: p.signedUrl || p.thumbnail || null,
            storagePath: p.storagePath,
            caption: p.caption,
            photoType: p.photoType,
            roomId: p.roomId,
            analysis: p.analysis,
            matchesRequest: p.matchesRequest,
          })));
        }
      } catch (e) { logger.error("Voice", "Photos load error", e); }
    })();
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/inspection/${sessionId}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.session?.currentPhase) setCurrentPhase(data.session.currentPhase);
          if (data.session?.currentStructure) setCurrentStructure(data.session.currentStructure);
        }
      } catch (e) { logger.error("Voice", "Session load error", e); }
    })();
  }, [sessionId]);

  // Periodic refresh every 10 seconds while connected
  useEffect(() => {
    if (sessionId && isConnected) {
      refreshIntervalRef.current = setInterval(() => {
        refreshRooms();
        refreshEstimate();
        refreshLineItems();
      }, 10000);
    }
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [sessionId, isConnected, refreshRooms, refreshEstimate, refreshLineItems]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, agentPartialText]);

  const retryableFetch = useCallback(async (
    url: string,
    options: RequestInit,
    maxRetries = 1
  ): Promise<Response> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, options);
        if (res.ok || res.status < 500) return res;
        lastError = new Error(`Server error: ${res.status}`);
      } catch (e: any) {
        lastError = e;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw lastError || new Error("Request failed after retries");
  }, []);

  const executeToolCall = useCallback(async (event: any) => {
    const { name, arguments: argsString, call_id } = event;
    let args: any;
    try {
      args = JSON.parse(argsString);
    } catch (e) { logger.error("Voice", "Tool args parse error", e);
      args = {};
    }
    logger.info("VoiceTool", `▶ ${name}`, args);
    sendLogToServer(name, "call", args);

    let result: any;

    try {
      switch (name) {
        case "set_inspection_context": {
          const prevPhase = currentPhase;
          if (args.phase) setCurrentPhase(args.phase);
          if (args.structure) setCurrentStructure(args.structure);
          if (args.area) setCurrentArea(args.area);
          let phaseValidationData: any = null;
          if (sessionId) {
            const headers = await getAuthHeaders();
            await fetch(`/api/inspection/${sessionId}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({
                currentPhase: args.phase,
                currentStructure: args.structure,
              }),
            });

            if (args.phase && args.phase !== prevPhase) {
              try {
                const valRes = await fetch(`/api/inspection/${sessionId}/validate-phase`, { headers });
                if (valRes.ok) {
                  phaseValidationData = await valRes.json();
                  const phaseWarnings = phaseValidationData.warnings || [];
                  if (phaseWarnings.length > 0) {
                    setPhaseValidation({
                      visible: true,
                      currentPhase: prevPhase,
                      nextPhase: args.phase,
                      warnings: phaseWarnings,
                      missingItems: phaseValidationData.missingItems || [],
                      completionScore: phaseValidationData.completionScore || 0,
                    });
                  }
                }
              } catch (e) {
                logger.error("Voice", "Phase validation in tool call", e);
              }
            }
          }
          result = {
            success: true,
            context: { ...args, phaseName: args.phaseName || args.area },
            phaseValidation: phaseValidationData ? {
              completionScore: phaseValidationData.completionScore,
              warnings: phaseValidationData.warnings || [],
              missingItems: phaseValidationData.missingItems || [],
              summary: (phaseValidationData.warnings?.length || 0) > 0
                ? `Phase ${prevPhase} has ${phaseValidationData.warnings.length} warning(s): ${phaseValidationData.warnings.join("; ")}`
                : `Phase ${prevPhase} is complete — no issues found.`,
            } : undefined,
          };
          break;
        }

        case "create_structure": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const structHeaders = await getAuthHeaders();
          const structRes = await fetch(`/api/inspection/${sessionId}/structures`, {
            method: "POST",
            headers: structHeaders,
            body: JSON.stringify({
              name: args.name,
              structureType: args.structureType || "dwelling",
            }),
          });
          const structure = await structRes.json();
          if (!structRes.ok) {
            result = { success: false, error: structure.message || "Failed to create structure" };
            break;
          }
          if (args.name) setCurrentStructure(args.name);
          result = { success: true, structureId: structure.id, name: structure.name, message: `Structure "${structure.name}" created.` };
          break;
        }

        case "get_inspection_state": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const hierHeaders = await getAuthHeaders();
          const hierRes = await fetch(`/api/inspection/${sessionId}/hierarchy`, { headers: hierHeaders });
          const hierarchy = await hierRes.json();
          await refreshRooms();
          result = {
            success: true,
            ...hierarchy,
            summary: {
              structureCount: hierarchy.structures?.length || 0,
              totalRooms: hierarchy.structures?.reduce((sum: number, s: any) => sum + (s.rooms?.length || 0), 0) || 0,
              totalSubAreas: hierarchy.structures?.reduce((sum: number, s: any) =>
                sum + (s.rooms?.reduce((rsum: number, r: any) => rsum + (r.subAreas?.length || 0), 0) || 0), 0) || 0,
            },
          };
          break;
        }

        case "get_room_details": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const freshDetailRooms = await fetchFreshRooms();
          const targetRoom = args.roomId
            ? freshDetailRooms.find(r => r.id === args.roomId)
            : freshDetailRooms.find(r => r.name === args.roomName);
          if (!targetRoom) {
            result = { success: false, error: `Room "${args.roomName || args.roomId}" not found` };
            break;
          }
          const detailHeaders = await getAuthHeaders();
          const [openingsRes, annotationsRes] = await Promise.all([
            fetch(`/api/inspection/${sessionId}/rooms/${targetRoom.id}/openings`, { headers: detailHeaders }),
            fetch(`/api/inspection/${sessionId}/rooms/${targetRoom.id}/annotations`, { headers: detailHeaders }),
          ]);
          const openings = openingsRes.ok ? await openingsRes.json() : [];
          const annotations = annotationsRes.ok ? await annotationsRes.json() : [];
          result = {
            success: true,
            room: {
              id: targetRoom.id,
              name: targetRoom.name,
              status: targetRoom.status,
              structure: targetRoom.structure,
              roomType: targetRoom.roomType,
              dimensions: targetRoom.dimensions,
              damageCount: targetRoom.damageCount,
              photoCount: targetRoom.photoCount,
            },
            openings,
            annotations,
          };
          break;
        }

        case "create_room": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const dimensions = args.length && args.width
            ? { length: args.length, width: args.width, height: args.height }
            : undefined;
          const roomBody = {
            name: args.name,
            roomType: args.roomType,
            structure: args.structure,
            viewType: args.viewType || "interior",
            shapeType: args.shapeType || "rectangle",
            dimensions,
            floor: args.floor,
            facetLabel: args.facetLabel,
            pitch: args.pitch || args.roofPitch,
            phase: args.phase,
          };
          const roomRes = await resilientMutation(
            "POST",
            `/api/inspection/${sessionId}/rooms`,
            roomBody,
            { label: `Create room: ${args.name}` }
          );
          const room = await roomRes.json();
          if (roomRes.status === 202 && room.queued) {
            result = { success: true, queued: true, message: "Room will be created when connected." };
            break;
          }
          if (!roomRes.ok) {
            result = { success: false, error: room.message || "Failed to create room" };
            break;
          }
          setCurrentRoomId(room.id);
          setCurrentArea(room.name);
          if (args.structure) setCurrentStructure(args.structure);
          await refreshRooms();
          result = {
            success: true,
            roomId: room.id,
            name: room.name,
            structure: args.structure,
            viewType: args.viewType,
            _context: room._context,
            message: `Room "${room.name}" created in ${args.structure || "Main Dwelling"}.`,
          };
          break;
        }

        case "create_sub_area": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const freshSubRooms = await fetchFreshRooms();
          const parentRoom = freshSubRooms.find(r => r.name === args.parentRoomName);
          if (!parentRoom) {
            result = { success: false, error: `Parent room "${args.parentRoomName}" not found. Create it first.` };
            break;
          }
          const subDimensions = args.length && args.width
            ? { length: args.length, width: args.width, height: args.height }
            : undefined;
          const subHeaders = await getAuthHeaders();
          const subRes = await fetch(`/api/inspection/${sessionId}/rooms`, {
            method: "POST",
            headers: subHeaders,
            body: JSON.stringify({
              name: args.name,
              parentRoomId: parentRoom.id,
              attachmentType: args.attachmentType,
              structure: parentRoom.structure,
              viewType: "interior",
              dimensions: subDimensions,
            }),
          });
          const subArea = await subRes.json();
          if (!subRes.ok) {
            result = { success: false, error: subArea.message || "Failed to create sub-area" };
            break;
          }
          await refreshRooms();
          result = {
            success: true,
            roomId: subArea.id,
            name: subArea.name,
            parentRoom: args.parentRoomName,
            message: `Sub-area "${subArea.name}" created under "${args.parentRoomName}".`,
          };
          break;
        }

        case "add_opening": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const freshRooms = await fetchFreshRooms();
          const openingRoom = freshRooms.find(r => r.name === args.roomName);
          if (!openingRoom) {
            result = { success: false, error: `Room "${args.roomName}" not found. Create a room first before adding openings.` };
            break;
          }
          // Resolve width/height from new or legacy params
          const openWidthFt = args.widthFt || args.width || 0;
          const openHeightFt = args.heightFt || args.height || 0;
          const openQuantity = args.quantity || 1;
          const openHeaders = await getAuthHeaders();
          const openRes = await fetch(`/api/inspection/${sessionId}/rooms/${openingRoom.id}/openings`, {
            method: "POST",
            headers: openHeaders,
            body: JSON.stringify({
              openingType: args.openingType,
              wallIndex: args.wallIndex ?? null,
              wallDirection: args.wallDirection || null,
              widthFt: openWidthFt,
              heightFt: openHeightFt,
              quantity: openQuantity,
              label: args.label || `${args.openingType}${args.wallDirection ? ` on ${args.wallDirection} wall` : ''}`,
              opensInto: args.opensInto || null,
              goesToFloor: args.openingType === "overhead_door",
              goesToCeiling: false,
              notes: args.notes || null,
            }),
          });
          const opening = await openRes.json();
          if (!openRes.ok) {
            result = { success: false, error: opening.message || "Failed to add opening" };
            break;
          }
          // Calculate running deductions for confirmation
          const allOpeningsRes = await fetch(`/api/inspection/${sessionId}/rooms/${openingRoom.id}/openings`, { headers: openHeaders });
          const allOpenings = allOpeningsRes.ok ? await allOpeningsRes.json() : [];
          const totalDeductionSF = allOpenings.reduce(
            (sum: number, o: any) => sum + ((o.widthFt || o.width || 0) * (o.heightFt || o.height || 0) * (o.quantity || 1)), 0
          );
          const typeLabel = args.openingType.replace(/_/g, " ");
          const opensLabel = args.opensInto === "E" ? "exterior" : args.opensInto ? `into ${args.opensInto}` : "";
          const qtyLabel = openQuantity > 1 ? ` ×${openQuantity}` : "";
          await refreshRooms();
          result = {
            success: true,
            openingId: opening.id,
            message: `Added ${typeLabel}${qtyLabel} (${openWidthFt}' × ${openHeightFt}')${opensLabel ? ` opening ${opensLabel}` : ""} to "${args.roomName}". Total wall deductions for this room: ${totalDeductionSF.toFixed(0)} SF.`,
          };
          break;
        }

        case "set_room_adjacency": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const adjRooms = await fetchFreshRooms();
          const adjRoomA = adjRooms.find(r => r.name === args.roomNameA);
          const adjRoomB = adjRooms.find(r => r.name === args.roomNameB);
          if (!adjRoomA) { result = { error: `Room "${args.roomNameA}" not found. Create it first with create_room.` }; break; }
          if (!adjRoomB) { result = { error: `Room "${args.roomNameB}" not found. Create it first with create_room. I'll remember to link these rooms once "${args.roomNameB}" is created.` }; break; }
          const adjHeaders = await getAuthHeaders();
          const adjRes = await fetch(`/api/sessions/${sessionId}/adjacencies`, {
            method: "POST",
            headers: adjHeaders,
            body: JSON.stringify({
              roomIdA: adjRoomA.id,
              roomIdB: adjRoomB.id,
              wallDirectionA: args.wallDirectionA || null,
              wallDirectionB: args.wallDirectionB || null,
              sharedWallLengthFt: args.sharedWallLengthFt || null,
            }),
          });
          if (!adjRes.ok) {
            const adjErr = await adjRes.json();
            result = { success: true, message: adjErr.error || `${args.roomNameA} and ${args.roomNameB} are already linked.` };
            break;
          }
          const adjacency = await adjRes.json();
          result = {
            success: true,
            adjacencyId: adjacency.id,
            message: `Linked ${args.roomNameA} ↔ ${args.roomNameB}${args.wallDirectionA ? ` (${args.wallDirectionA} wall)` : ""}`,
          };
          break;
        }

        case "update_room_dimensions": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const dimRooms = await fetchFreshRooms();
          const dimRoom = dimRooms.find(r => r.name === args.roomName);
          if (!dimRoom) { result = { error: `Room "${args.roomName}" not found. Create it first with create_room.` }; break; }
          const dimHeaders = await getAuthHeaders();
          const dimBody: Record<string, any> = {};
          if (args.length !== undefined) dimBody.length = args.length;
          if (args.width !== undefined) dimBody.width = args.width;
          if (args.height !== undefined) dimBody.height = args.height;
          if (args.ceilingType !== undefined) dimBody.ceilingType = args.ceilingType;
          const dimRes = await fetch(`/api/rooms/${dimRoom.id}/dimensions`, {
            method: "PATCH",
            headers: dimHeaders,
            body: JSON.stringify(dimBody),
          });
          if (!dimRes.ok) {
            result = { success: false, error: "Failed to update dimensions" };
            break;
          }
          const updatedRoom = await dimRes.json();
          const newDims = updatedRoom.dimensions || dimBody;
          await refreshRooms();
          result = {
            success: true,
            dimensions: newDims,
            message: `Updated ${args.roomName}: ${newDims.length || '?'}'×${newDims.width || '?'}'×${newDims.height || 8}'${newDims.dimVars ? ` (${newDims.dimVars.W} SF walls, ${newDims.dimVars.F} SF floor)` : ""}`,
          };
          break;
        }

        case "add_sketch_annotation": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const freshAnnotRooms = await fetchFreshRooms();
          const annotRoom = freshAnnotRooms.find(r => r.name === args.roomName);
          if (!annotRoom) {
            result = { success: false, error: `Room "${args.roomName}" not found` };
            break;
          }
          const annotHeaders = await getAuthHeaders();
          const annotRes = await fetch(`/api/inspection/${sessionId}/rooms/${annotRoom.id}/annotations`, {
            method: "POST",
            headers: annotHeaders,
            body: JSON.stringify({
              annotationType: args.annotationType,
              label: args.label,
              value: args.value,
              location: args.location,
            }),
          });
          const annotation = await annotRes.json();
          if (!annotRes.ok) {
            result = { success: false, error: annotation.message || "Failed to add annotation" };
            break;
          }
          result = {
            success: true,
            annotationId: annotation.id,
            message: `Annotation "${args.label}: ${args.value}" added to "${args.roomName}".`,
          };
          break;
        }

        case "complete_room": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const freshCompleteRooms = await fetchFreshRooms();
          const roomToComplete = freshCompleteRooms.find((r) => r.name === args.roomName);
          if (roomToComplete) {
            const completeHeaders = await getAuthHeaders();
            await fetch(`/api/inspection/${sessionId}/rooms/${roomToComplete.id}/complete`, { method: "POST", headers: completeHeaders });
            await refreshRooms();
          }
          result = { success: true, roomName: args.roomName };
          break;
        }

        case "add_damage": {
          if (!sessionId || !currentRoomId) { result = { success: false, error: "No room selected" }; break; }
          const measurements: any = {};
          if (args.extent) measurements.extent = args.extent;
          if (args.hitCount) measurements.hitCount = args.hitCount;
          const damageBody = {
            roomId: currentRoomId,
            description: args.description,
            damageType: args.damageType,
            severity: args.severity,
            location: args.location,
            measurements: Object.keys(measurements).length > 0 ? measurements : undefined,
          };
          const damageRes = await resilientMutation(
            "POST",
            `/api/inspection/${sessionId}/damages`,
            damageBody,
            { label: `Record damage: ${args.description?.substring?.(0, 40) ?? "damage"}` }
          );
          const json = await damageRes.json();
          if (damageRes.status === 202 && json.queued) {
            result = { success: true, queued: true, message: "Damage will be recorded when connected." };
            break;
          }
          const damage = json.damage ?? json;
          await refreshRooms();

          const autoScope = json.autoScope;
          if (autoScope && autoScope.itemsCreated > 0) {
            await refreshLineItems();
            setAutoScopeNotification({
              visible: true,
              count: autoScope.itemsCreated,
              items: autoScope.items || [],
              warnings: autoScope.warnings || [],
            });
            setTimeout(() => setAutoScopeNotification((prev) => ({ ...prev, visible: false })), 8000);
          }

          result = {
            success: true,
            damageId: damage.id,
            autoScope: autoScope ? {
              itemsCreated: autoScope.itemsCreated,
              summary: autoScope.items?.map((i: any) =>
                `${i.code}: ${i.description} — ${i.quantity} ${i.unit} @ $${Number(i.unitPrice ?? 0).toFixed(2)} = $${Number(i.totalPrice ?? 0).toFixed(2)} [${i.source}]`
              ).join("\n") || "No items matched",
              warnings: autoScope.warnings,
            } : undefined,
          };
          break;
        }

        case "add_line_item": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const { category, action, description, catalogCode, quantity, unit, unitPrice, depreciationType, wasteFactor } = args;

          let finalUnitPrice = unitPrice || 0;
          let finalUnit = unit || "EA";
          let finalWasteFactor = wasteFactor || 0;
          let isCodeUpgradeItem = false;

          // If catalogCode provided, look it up and use catalog pricing
          if (catalogCode) {
            try {
              const catalogHeaders = await getAuthHeaders();
              const catalogRes = await fetch(`/api/pricing/catalog/search?q=${encodeURIComponent(catalogCode)}`, { headers: catalogHeaders });
              if (catalogRes.ok) {
                const catalogItems = await catalogRes.json();
                const matched = catalogItems.find((item: any) => item.code === catalogCode);
                if (matched) {
                  // Auto-detect code upgrade items from catalog
                  if (matched.isCodeUpgrade) {
                    isCodeUpgradeItem = true;
                  }
                  const priceRes = await fetch(`/api/pricing/scope`, {
                    method: "POST",
                    headers: catalogHeaders,
                    body: JSON.stringify({
                      items: [{ code: catalogCode, quantity: quantity || 1 }],
                      regionId: "US_NATIONAL",
                      taxRate: 0.08,
                    }),
                  });
                  if (priceRes.ok) {
                    const priceData = await priceRes.json();
                    if (priceData.items && priceData.items.length > 0) {
                      const priced = priceData.items[0];
                      finalUnitPrice = priced.unitPriceBreakdown.unitPrice;
                      finalUnit = matched.unit || "EA";
                      finalWasteFactor = matched.defaultWasteFactor || 0;
                    }
                  }
                }
              }
            } catch (e) {
              logger.warn("Voice", "Catalog lookup failed, falling back to provided price", e);
            }
          }

          // Code upgrade items default to "Paid When Incurred"
          const effectiveDepType = isCodeUpgradeItem
            ? "Paid When Incurred"
            : (depreciationType || "Recoverable");

          const qty = quantity || 1;
          const totalPrice = qty * finalUnitPrice * (1 + (finalWasteFactor || 0) / 100);

          const lineBody = {
            roomId: currentRoomId,
            category: category || "General",
            action: action || null,
            description,
            xactCode: catalogCode || null,
            quantity: qty,
            unit: finalUnit,
            unitPrice: finalUnitPrice,
            totalPrice,
            depreciationType: effectiveDepType,
            wasteFactor: finalWasteFactor,
          };
          const lineRes = await resilientMutation(
            "POST",
            `/api/inspection/${sessionId}/line-items`,
            lineBody,
            { label: `Add line item: ${description?.substring?.(0, 40) ?? "line item"}` }
          );
          const lineItem = await lineRes.json();
          if (lineRes.status === 202 && lineItem.queued) {
            result = { success: true, queued: true, message: "Line item will be added when connected." };
            break;
          }
          await refreshLineItems();
          result = {
            success: true,
            lineItemId: lineItem.id,
            unitPrice: finalUnitPrice,
            totalPrice,
            description,
          };
          break;
        }

        case "generate_scope": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const { damageId, roomId } = args;
          if (!damageId || !roomId) {
            result = { success: false, error: "damageId and roomId are required" };
            break;
          }
          const scopeHeaders = await getAuthHeaders();
          const scopeRes = await fetch(`/api/inspection/${sessionId}/scope/assemble`, {
            method: "POST",
            headers: scopeHeaders,
            body: JSON.stringify({ roomId, damageId }),
          });
          const scopeData = await scopeRes.json();
          if (!scopeRes.ok) {
            result = { success: false, error: scopeData.message || "Scope assembly failed" };
            break;
          }
          await refreshRooms();
          await refreshLineItems();
          result = {
            success: true,
            created: scopeData.created,
            companions: scopeData.companions,
            manualNeeded: scopeData.manualNeeded || [],
            warnings: scopeData.warnings || [],
            items: scopeData.items || [],
            message: `Generated ${scopeData.created} scope items, ${scopeData.companions} companions.`,
          };
          break;
        }

        case "validate_scope": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const sid = args.sessionId ?? sessionId;
          const valHeaders = await getAuthHeaders();
          const valRes = await fetch(`/api/inspection/${sid}/scope/validate`, { headers: valHeaders });
          const validation = await valRes.json();
          if (!valRes.ok) {
            result = { success: false, error: validation.message || "Validation failed" };
            break;
          }
          result = {
            success: true,
            ...validation,
            message: validation.valid
              ? `Scope validation passed (score: ${validation.score})`
              : `Scope has ${validation.errors?.length || 0} errors, ${validation.warnings?.length || 0} warnings.`,
          };
          break;
        }

        case "apply_peril_template": {
          if (!sessionId || !args.roomId) { result = { success: false, error: "sessionId and roomId required" }; break; }
          const tplHeaders = await getAuthHeaders();
          const tplRes = await fetch(`/api/inspection/${sessionId}/scope/apply-template`, {
            method: "POST",
            headers: tplHeaders,
            body: JSON.stringify({
              roomId: args.roomId,
              templateName: args.templateName,
              includeAutoOnly: args.includeAutoOnly !== false,
            }),
          });
          const tplData = await tplRes.json();
          if (!tplRes.ok) {
            result = { success: false, error: tplData.error || "Template application failed" };
            break;
          }
          await refreshLineItems();
          result = {
            success: true,
            templateName: tplData.templateName,
            appliedCount: tplData.appliedCount,
            appliedItems: tplData.appliedItems,
            suggestedItems: tplData.suggestedItems,
            message: `Applied ${tplData.appliedCount} items from "${tplData.templateName}".`,
          };
          break;
        }

        case "trigger_photo_capture": {
          // Store the pending call_id — DO NOT send tool result yet
          // The agent will wait for the photo capture before continuing
          pendingPhotoCallRef.current = {
            call_id,
            label: args.label,
            photoType: args.photoType,
          };
          setCameraMode({
            active: true,
            label: args.label,
            photoType: args.photoType,
            overlay: args.overlay || "none",
          });
          // IMPORTANT: Return early — skip the dcRef.current.send() below
          // The tool result will be sent from handleCameraCapture instead
          return;
        }

        case "log_moisture_reading": {
          if (!sessionId || !currentRoomId) { result = { success: false, error: "No room selected" }; break; }
          const moistureHeaders = await getAuthHeaders();
          await fetch(`/api/inspection/${sessionId}/moisture`, {
            method: "POST",
            headers: moistureHeaders,
            body: JSON.stringify({
              roomId: currentRoomId,
              location: args.location,
              reading: args.reading,
              materialType: args.materialType,
              dryStandard: args.dryStandard,
            }),
          });
          const status = args.reading > 17 ? "wet" : args.reading > 14 ? "caution" : "dry";
          result = { success: true, reading: args.reading, status };
          break;
        }

        case "get_progress": {
          if (!sessionId) { result = { success: false }; break; }
          const progressHeaders = await getAuthHeaders();
          const progressRes = await fetch(`/api/inspection/${sessionId}`, { headers: progressHeaders });
          const progress = await progressRes.json();
          result = {
            totalRooms: progress.rooms.length,
            completedRooms: progress.rooms.filter((r: any) => r.status === "complete").length,
            currentPhase: progress.session.currentPhase,
            totalPhotos: progress.photoCount,
            totalLineItems: progress.lineItemCount,
          };
          break;
        }

        case "get_estimate_summary": {
          if (!sessionId) { result = { success: false }; break; }
          const estHeaders = await getAuthHeaders();
          const estRes = await fetch(`/api/inspection/${sessionId}/estimate-summary`, { headers: estHeaders });
          result = await estRes.json();
          break;
        }

        case "get_completeness": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const compHeaders = await getAuthHeaders();
          const compRes = await retryableFetch(
            `/api/inspection/${sessionId}/completeness`,
            { headers: compHeaders }
          );
          if (!compRes.ok) {
            result = { success: false, error: "Could not retrieve completeness" };
            break;
          }
          const completeness = await compRes.json();
          const gaps = completeness.scopeGaps || [];
          const missingPhotos = completeness.missingPhotos || [];
          const recommendations = (completeness.checklist || [])
            .filter((c: any) => !c.satisfied)
            .map((c: any) => c.item);
          let voiceSummary = `Overall completeness: ${completeness.completenessScore || 0}%.`;
          if (gaps.length > 0) {
            voiceSummary += ` Scope gaps in ${gaps.length} room(s): ${gaps.map((g: any) => g.room).join(", ")}.`;
          }
          if (missingPhotos.length > 0) {
            voiceSummary += ` Missing photos for: ${missingPhotos.map((p: any) => p.room).join(", ")}.`;
          }
          if (recommendations.length > 0) {
            voiceSummary += ` Recommendations: ${recommendations.slice(0, 3).join("; ")}.`;
          }
          result = {
            success: true,
            overallScore: completeness.completenessScore || 0,
            summary: voiceSummary,
            scopeGaps: gaps,
            missingPhotos,
            recommendations,
            perilSpecific: completeness.perilSpecificChecks || [],
          };
          break;
        }

        case "confirm_damage_suggestion": {
          if (!sessionId || !currentRoomId) {
            result = { success: false, error: "No room selected" };
            break;
          }
          if (!args.confirmed) {
            result = { success: true, action: "rejected", message: "Damage suggestion dismissed" };
            break;
          }
          const confirmHeaders = await getAuthHeaders();
          const confirmRes = await fetch(`/api/inspection/${sessionId}/damages`, {
            method: "POST",
            headers: confirmHeaders,
            body: JSON.stringify({
              roomId: currentRoomId,
              description: `Photo-detected ${args.damageType}${args.location ? ` at ${args.location}` : ""}`,
              damageType: args.damageType,
              severity: args.severity || "moderate",
              location: args.location || undefined,
            }),
          });
          const confirmData = await confirmRes.json();
          await refreshRooms();
          const autoScope = confirmData.autoScope || null;
          result = {
            success: true,
            action: "confirmed",
            damageId: confirmData.damage?.id || confirmData.id,
            autoScope: autoScope ? {
              itemsCreated: autoScope.itemsCreated,
              summary: autoScope.items?.map((i: any) =>
                `${i.code}: ${i.description} — ${i.quantity} ${i.unit} @ $${Number(i.unitPrice ?? 0).toFixed(2)}`
              ).join("\n") || "No items matched",
              warnings: autoScope.warnings,
            } : undefined,
          };
          if (autoScope?.itemsCreated > 0) {
            await refreshLineItems();
            await refreshEstimate();
          }
          break;
        }

        case "get_scope_gaps": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const gapHeaders = await getAuthHeaders();
          const gapUrl = args.roomId
            ? `/api/inspection/${sessionId}/completeness?roomId=${args.roomId}`
            : `/api/inspection/${sessionId}/completeness`;
          const gapRes = await fetch(gapUrl, { headers: gapHeaders });
          if (!gapRes.ok) {
            result = { success: false, error: "Could not retrieve scope gaps" };
            break;
          }
          const gapData = await gapRes.json();
          const gaps = gapData.scopeGaps || [];
          let gapSummary = gaps.length === 0
            ? "No scope gaps found — all documented damages have corresponding line items."
            : `Found ${gaps.length} scope gap(s): ` +
              gaps.map((g: any) => `${g.room}: ${g.issue}`).join("; ");
          result = {
            success: true,
            gapCount: gaps.length,
            summary: gapSummary,
            gaps,
            companionOmissions: gapData.companionOmissions || [],
          };
          break;
        }

        case "request_phase_validation": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const valHeaders = await getAuthHeaders();
          const valRes = await retryableFetch(
            `/api/inspection/${sessionId}/validate-phase`,
            { headers: valHeaders }
          );
          if (!valRes.ok) {
            result = { success: false, error: "Could not validate phase" };
            break;
          }
          const validation = await valRes.json();
          let valSummary = `Phase ${validation.currentPhase} completion: ${validation.completionScore}%.`;
          if (validation.warnings?.length > 0) {
            valSummary += ` Warnings: ${validation.warnings.join("; ")}`;
          }
          if (validation.missingItems?.length > 0) {
            valSummary += ` Missing: ${validation.missingItems.join("; ")}`;
          }
          if (!validation.warnings?.length) {
            valSummary += " All clear — ready to advance.";
          }
          result = {
            success: true,
            currentPhase: validation.currentPhase,
            nextPhase: validation.nextPhase,
            completionScore: validation.completionScore,
            warnings: validation.warnings || [],
            missingItems: validation.missingItems || [],
            summary: valSummary,
            canProceed: validation.canProceed,
          };
          break;
        }

        case "apply_smart_macro": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const macroHeaders = await getAuthHeaders();
          const macroRes = await fetch(`/api/inspection/${sessionId}/smart-macro`, {
            method: "POST",
            headers: macroHeaders,
            body: JSON.stringify({
              macroType: args.macro_type,
              severity: args.severity || "average",
              wasteFactor: args.waste_factor,
              roomId: currentRoomId,
            }),
          });
          const macroData = await macroRes.json();
          if (!macroRes.ok) {
            result = { success: false, error: macroData.message || "Failed to apply smart macro" };
            break;
          }
          await refreshLineItems();
          result = {
            success: true,
            macroType: args.macro_type,
            itemCount: macroData.itemCount,
            message: macroData.message,
          };
          break;
        }

        case "check_related_items": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const relatedHeaders = await getAuthHeaders();
          const relatedRes = await fetch(`/api/inspection/${sessionId}/check-related-items`, {
            method: "POST",
            headers: relatedHeaders,
            body: JSON.stringify({
              primaryCategory: args.primary_category,
              actionTaken: args.action_taken,
            }),
          });
          const relatedData = await relatedRes.json();
          if (!relatedRes.ok) {
            result = { success: false, error: relatedData.message || "Failed to check related items" };
            break;
          }
          result = {
            success: true,
            suggestions: relatedData.suggestions,
            message: relatedData.message,
          };
          break;
        }

        case "log_test_square": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const tsRoom = args.room_id ? rooms.find(r => r.name === args.room_id || String(r.id) === String(args.room_id)) : null;
          const tsHeaders = await getAuthHeaders();
          const tsRes = await fetch(`/api/inspection/${sessionId}/test-squares`, {
            method: "POST",
            headers: tsHeaders,
            body: JSON.stringify({
              roomId: tsRoom?.id || currentRoomId,
              hailHits: args.hail_hits,
              windCreases: args.wind_creases || 0,
              pitch: args.pitch,
              result: args.result,
              notes: args.notes,
            }),
          });
          const tsData = await tsRes.json();
          if (!tsRes.ok) {
            result = { success: false, error: tsData.message || "Failed to log test square" };
            break;
          }
          result = {
            success: true,
            testSquareId: tsData.id,
            hailHits: args.hail_hits,
            pitch: args.pitch,
            result: tsData.result,
            analysis: tsData._analysis,
            message: `Test square logged: ${args.hail_hits} hail hits at ${args.pitch} pitch. ${tsData._analysis?.recommendation || ""}`,
          };
          break;
        }

        case "skip_step": {
          if (!args.passwordConfirmed) {
            result = { success: false, error: "Voice password not confirmed. Ask the adjuster to say the voice password before skipping." };
            break;
          }
          const skipDescription = args.stepDescription || "Unknown step";
          const skipReason = args.reason || "Adjuster request";
          addTranscriptEntry("agent", `Step skipped: ${skipDescription} (${skipReason})`);
          result = {
            success: true,
            skipped: skipDescription,
            reason: skipReason,
            message: `Skipped "${skipDescription}". Proceed to next step.`,
            nextAction: "Call get_inspection_state to see current progress, then advance to the next phase or area in the flow. Prompt the adjuster for what comes next.",
          };
          break;
        }

        case "complete_inspection": {
          if (!sessionId) { result = { success: false }; break; }
          localStorage.removeItem(STORAGE_KEY);
          result = { success: true, message: "Navigating to review page. The claim remains open until you explicitly mark it complete." };
          setTimeout(() => setLocation(`/inspection/${claimId}/review`), 2000);
          break;
        }

        default:
          result = { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error: any) {
      result = { success: false, error: error.message };
    }

    logger.info("VoiceTool", `◀ ${name}`, result);
    sendLogToServer(name, "result", result);

    if (dcRef.current && dcRef.current.readyState === "open") {
      dcRef.current.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id,
          output: JSON.stringify(result),
        },
      }));
      dcRef.current.send(JSON.stringify({ type: "response.create" }));
    }
  }, [sessionId, currentRoomId, fetchFreshRooms, refreshRooms, refreshLineItems, refreshEstimate, setLocation, getAuthHeaders, addTranscriptEntry, sendLogToServer]);

  const handleRealtimeEvent = useCallback((event: any) => {
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        setVoiceState("listening");
        break;

      case "input_audio_buffer.speech_stopped":
        setVoiceState("processing");
        break;

      case "response.audio.delta":
        setVoiceState("speaking");
        break;

      case "response.audio.done":
        setVoiceState("idle");
        break;

      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          addTranscriptEntry("user", event.transcript);

          // Voice-triggered photo cancel: if a photo capture is pending and the
          // user says "skip", "cancel", or the voice password, auto-cancel the
          // camera so the agent can resume the conversation.
          if (pendingPhotoCallRef.current) {
            const lower = event.transcript.toLowerCase();
            const isSkipCommand = /\b(skip|cancel|next|one two three|1\s*2\s*3)\b/.test(lower);
            if (isSkipCommand) {
              const videoStream = videoRef.current?.srcObject as MediaStream | null;
              if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
              setCameraMode({ active: false, label: "", photoType: "", overlay: "none" });

              const pendingCall = pendingPhotoCallRef.current;
              if (pendingCall && dcRef.current && dcRef.current.readyState === "open") {
                dcRef.current.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: pendingCall.call_id,
                    output: JSON.stringify({
                      success: false,
                      skipped: true,
                      message: "Photo capture skipped by adjuster via voice command. The adjuster wants to move on. Proceed to the next step.",
                    }),
                  },
                }));
                dcRef.current.send(JSON.stringify({ type: "response.create" }));
              }
              pendingPhotoCallRef.current = null;
              addTranscriptEntry("agent", "Photo capture skipped.");
            }
          }
        }
        break;

      case "response.audio_transcript.delta":
        if (event.delta) {
          setAgentPartialText((prev) => prev + event.delta);
        }
        break;

      case "response.audio_transcript.done":
        if (event.transcript) {
          addTranscriptEntry("agent", event.transcript);
        }
        setAgentPartialText("");
        break;

      case "response.function_call_arguments.done":
        executeToolCall(event);
        break;

      case "response.done":
        break;

      case "error":
        logger.error("Voice", "Realtime error", event.error);
        setVoiceState("error");
        if (errorRecoveryTimeoutRef.current) clearTimeout(errorRecoveryTimeoutRef.current);
        errorRecoveryTimeoutRef.current = setTimeout(() => {
          setVoiceState((prev) => prev === "error" ? "idle" : prev);
          errorRecoveryTimeoutRef.current = null;
        }, 5000);
        break;
    }
  }, [addTranscriptEntry, executeToolCall]);

  const connectVoice = useCallback(async () => {
    if (!sessionId || isConnectingRef.current) return;
    isConnectingRef.current = true;
    setIsConnecting(true);
    setVoiceState("processing");

    try {
      const authHeaders = await getAuthHeaders();
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ claimId, sessionId }),
      });
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        throw new Error(tokenData.message || "Failed to create session");
      }

      const previousTranscript: string | null = tokenData.transcriptSummary || null;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      pc.addTrack(stream.getTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        setIsConnected(true);
        setVoiceState("idle");
        isConnectingRef.current = false;
        setIsConnecting(false);

        if (!hasGreetedRef.current) {
          hasGreetedRef.current = true;
          if (previousTranscript) {
            dc.send(JSON.stringify({
              type: "response.create",
              response: {
                instructions: `You are RESUMING an inspection that was previously interrupted. Here is the conversation transcript from the previous session:\n\n---\n${previousTranscript}\n---\n\nExecute these steps in order: 1) Silently call get_inspection_state to understand current progress. 2) Based on the transcript and inspection state, determine exactly where the adjuster left off. 3) Greet the adjuster briefly, acknowledge this is a resumption, tell them where you're picking back up (e.g., "Welcome back. We left off inspecting the master bedroom. Let's continue from there."). Keep it to 1-2 sentences. 4) Continue the inspection from that point — do NOT restart from the beginning or re-do completed steps.`,
              },
            }));
          } else {
            dc.send(JSON.stringify({
              type: "response.create",
              response: {
                instructions: "Do NOT introduce yourself or make small talk. Execute these steps in order: 1) Silently call get_inspection_state. 2) If no structures exist, silently call create_structure for 'Main Dwelling'. 3) Only AFTER the tools complete, greet the adjuster with a brief welcome and state where the inspection will begin. Keep the greeting to one or two sentences. 4) Then call trigger_photo_capture for the property verification photo.",
              },
            }));
          }
        }
      };

      dc.onclose = () => {
        setIsConnected(false);
        setVoiceState("disconnected");
        hasGreetedRef.current = false;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (!pcRef.current || pcRef.current.connectionState === "closed") {
            connectVoice();
          }
        }, 3000);
      };

      dc.onmessage = (event) => {
        try {
          const serverEvent = JSON.parse(event.data);
          handleRealtimeEvent(serverEvent);
        } catch (e) { logger.error("Voice", "Realtime event parse error", e); }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tokenData.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      const sdpAnswer = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
    } catch (error: any) {
      logger.error("Voice", "Voice connection error", error);
      setVoiceState("error");
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  }, [sessionId, claimId, handleRealtimeEvent, getAuthHeaders]);

  const disconnectVoice = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dcRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (errorRecoveryTimeoutRef.current) {
      clearTimeout(errorRecoveryTimeoutRef.current);
      errorRecoveryTimeoutRef.current = null;
    }
    isConnectingRef.current = false;
    hasGreetedRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    setVoiceState("disconnected");
  }, []);

  useEffect(() => {
    return () => { disconnectVoice(); };
  }, [disconnectVoice]);

  const handleCameraCapture = async () => {
    if (!canvasRef.current || !videoRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const jpegQuality = settings.photoQuality === "high" ? 0.92 : settings.photoQuality === "low" ? 0.6 : 0.8;
    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

    // Stop the camera stream
    const videoStream = videoRef.current.srcObject as MediaStream | null;
    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
    }

    // Show a "processing" state while we save + analyze
    setCameraMode((prev) => ({ ...prev, label: "Analyzing photo..." }));

    let photoResult: any = { success: false, message: "Photo capture failed" };

    if (sessionId) {
      try {
        // Step 1: Save photo to backend (uploads to Supabase)
        const sanitizedTag = cameraMode.label
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "_")
          .substring(0, 40);
        const photoHeaders = await getAuthHeaders();
        const saveRes = await fetch(`/api/inspection/${sessionId}/photos`, {
          method: "POST",
          headers: photoHeaders,
          body: JSON.stringify({
            roomId: currentRoomId,
            imageBase64: dataUrl,
            autoTag: sanitizedTag,
            caption: cameraMode.label,
            photoType: cameraMode.photoType,
          }),
        });
        const savedPhoto = await saveRes.json();

        if (!saveRes.ok || !savedPhoto.photoId) {
          throw new Error(savedPhoto.message || "Photo upload failed");
        }

        let analysis: any = null;
        if (settings.autoAnalyzePhotos) {
          try {
            const analyzeHeaders = await getAuthHeaders();
            const analyzeRes = await fetch(
              `/api/inspection/${sessionId}/photos/${savedPhoto.photoId}/analyze`,
              {
                method: "POST",
                headers: analyzeHeaders,
                body: JSON.stringify({
                  imageBase64: dataUrl,
                  expectedLabel: cameraMode.label,
                  expectedPhotoType: cameraMode.photoType,
                }),
              }
            );
            analysis = await analyzeRes.json();
          } catch (e) {
            logger.error("Voice", "Photo analysis failed", e);
          }
        }

        // Step 3: Store in local state WITH thumbnail + analysis for gallery display
        const damageSuggestions = analysis?.damageSuggestions || [];
        setRecentPhotos((prev) => [
          {
            id: savedPhoto.photoId,
            storagePath: savedPhoto.storagePath,
            thumbnail: dataUrl,
            caption: cameraMode.label,
            photoType: cameraMode.photoType,
            roomId: currentRoomId,
            analysis,
            matchesRequest: analysis?.matchesExpected ?? true,
            damageSuggestions,
          },
          ...prev,
        ].slice(0, 50));

        if (damageSuggestions.length > 0) {
          setPhotoDamageSuggestions(damageSuggestions);
        }

        // Step 4: Build the tool result to send back to the voice agent
        photoResult = {
          success: true,
          photoId: savedPhoto.photoId,
          message: "Photo captured and saved.",
          analysis: analysis
            ? {
                description: analysis.description,
                damageVisible: analysis.damageVisible,
                damageSuggestions: analysis.damageSuggestions || [],
                matchesExpected: analysis.matchesExpected,
                matchExplanation: analysis.matchExplanation,
                qualityScore: analysis.qualityScore,
              }
            : undefined,
        };

        // If photo doesn't match what was requested, tell the agent
        if (analysis && !analysis.matchesExpected) {
          photoResult.warning = `Photo may not match requested capture "${cameraMode.label}". ${analysis.matchExplanation}`;
        }

        // If AI detected damage, include suggestions for the agent to confirm
        if (analysis?.damageSuggestions?.length > 0) {
          photoResult.damageSuggestions = analysis.damageSuggestions;
        }
      } catch (e: any) {
        logger.error("Voice", "Camera capture error", e);
        photoResult = { success: false, message: e.message };
      }
    }

    // Step 5: NOW send the deferred tool result to the voice agent
    const pendingCall = pendingPhotoCallRef.current;
    if (pendingCall && dcRef.current && dcRef.current.readyState === "open") {
      dcRef.current.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: pendingCall.call_id,
          output: JSON.stringify(photoResult),
        },
      }));
      dcRef.current.send(JSON.stringify({ type: "response.create" }));
    }
    pendingPhotoCallRef.current = null;

    // Step 6: Close camera overlay
    setCameraMode({ active: false, label: "", photoType: "", overlay: "none" });
  };

  useEffect(() => {
    if (cameraMode.active && videoRef.current) {
      navigator.mediaDevices
        .getUserMedia({ video: {
          facingMode: "environment",
          ...(settings.photoQuality === "high" ? { width: { ideal: 3840 }, height: { ideal: 2160 } }
            : settings.photoQuality === "low" ? { width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1920 }, height: { ideal: 1080 } }),
        } })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((e) => logger.error("Voice", "Unhandled error", e));
    }
  }, [cameraMode.active]);

  const togglePause = () => {
    if (isPaused) {
      setIsPaused(false);
    } else {
      setIsPaused(true);
    }
  };

  const claim = claimData as any;
  const claimNumber = claim?.claimNumber || `Claim #${claimId}`;
  const insuredName = claim?.insuredName || "";

  const leftSidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <Link href={`/briefing/${claimId}`} className="text-muted-foreground hover:text-foreground" data-testid="link-back-briefing">
            <ChevronLeft size={20} />
          </Link>
          <h1 className="font-display font-bold text-sm truncate">{claimNumber}</h1>
        </div>
        {insuredName && <p className="text-xs text-muted-foreground mb-3">{insuredName}</p>}

        <div className="space-y-0.5">
          {PHASES.map((phase) => (
            <div
              key={phase.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1 rounded text-xs transition-all",
                currentPhase === phase.id
                  ? "bg-primary/20 text-primary font-semibold"
                  : currentPhase > phase.id
                  ? "text-green-400/80"
                  : "text-muted-foreground"
              )}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold border",
                  currentPhase === phase.id
                    ? "border-primary bg-primary/30 text-primary"
                    : currentPhase > phase.id
                    ? "border-green-500 bg-green-500/20 text-green-400"
                    : "border-border"
                )}
              >
                {currentPhase > phase.id ? <CheckCircle2 size={10} /> : settings.showPhaseNumbers ? phase.id : "·"}
              </div>
              <span className="truncate">{phase.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 px-1">Rooms / Areas</p>
        {rooms.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">No rooms yet. Start the voice session to begin.</p>
        )}
        {rooms.map((room) => (
          <div
            key={room.id}
            data-testid={`room-${room.id}`}
            onClick={() => {
              setCurrentRoomId(room.id);
              setCurrentArea(room.name);
              if (isMobile) setMobileLeftOpen(false);
            }}
            className={cn(
              "p-2.5 rounded-lg border cursor-pointer transition-all",
              currentRoomId === room.id
                ? "bg-primary/20 border-primary/50"
                : room.status === "complete"
                ? "bg-green-500/10 border-green-500/20"
                : "bg-primary/5 border-primary/10 hover:bg-primary/15"
            )}
          >
            <div className="flex justify-between items-center">
              <p className="text-sm font-medium truncate">{room.name}</p>
              {room.status === "complete" && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
              {room.status === "in_progress" && <div className="h-2 w-2 rounded-full bg-accent animate-pulse shrink-0" />}
            </div>
            <div className="flex gap-3 mt-1">
              <span className="text-[10px] text-muted-foreground">{room.damageCount} damage{room.damageCount !== 1 ? "s" : ""}</span>
              <span className="text-[10px] text-muted-foreground">{room.photoCount} photo{room.photoCount !== 1 ? "s" : ""}</span>
              {room.openingCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{room.openingCount} opening{room.openingCount !== 1 ? "s" : ""}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10"
          onClick={() => setShowProgressTracker(true)}
          data-testid="button-progress-tracker"
        >
          <Activity className="h-3 w-3 mr-1" />
          Progress Tracker
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10"
          onClick={() => setShowProgressMap(true)}
        >
          <MapPin className="h-3 w-3 mr-1" />
          Progress Map
        </Button>
        <Button
          variant="outline"
          className="w-full border-border text-foreground hover:bg-primary/10 text-xs"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setLocation(`/inspection/${claimId}/review`);
          }}
          data-testid="button-finish-inspection"
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" /> Review & Finalize
        </Button>
      </div>
    </div>
  );

  const rightPanelContent = (
    <div className="flex-1 flex flex-col p-3 space-y-4 overflow-hidden">
      <div className="bg-primary/5 rounded-lg p-3 border border-border">
        <div className="flex items-center gap-1.5 mb-2">
          <DollarSign size={14} className="text-accent" />
          <span className="text-xs font-semibold text-accent uppercase tracking-wider">Running Estimate</span>
        </div>
        <div className="text-2xl font-display font-bold text-foreground">
          ${estimateSummary.totalRCV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>ACV: ${estimateSummary.totalACV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span>{estimateSummary.itemCount} items</span>
        </div>
      </div>

      {/* Auto-Scope Notification Toast (PROMPT-19) */}
      <AnimatePresence>
        {autoScopeNotification.visible && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-lg p-3 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[#22C55E]" />
              <span className="text-xs font-semibold text-[#22C55E]">
                Auto-Scope: {autoScopeNotification.count} item{autoScopeNotification.count !== 1 ? "s" : ""} generated
              </span>
              <button
                onClick={() => setAutoScopeNotification((prev) => ({ ...prev, visible: false }))}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            </div>
            {autoScopeNotification.items.slice(0, 3).map((item, i) => (
              <div key={i} className="flex justify-between text-[10px] text-muted-foreground pl-5">
                <span className="truncate flex-1 mr-2">
                  {item.description}
                  {item.source === "companion" && (
                    <span className="ml-1 text-[#9D8BBF]">(companion)</span>
                  )}
                </span>
                <span className="font-mono whitespace-nowrap">${Number(item.totalPrice || 0).toFixed(2)}</span>
              </div>
            ))}
            {autoScopeNotification.items.length > 3 && (
              <p className="text-[10px] text-muted-foreground pl-5">
                +{autoScopeNotification.items.length - 3} more item{autoScopeNotification.items.length - 3 !== 1 ? "s" : ""}
              </p>
            )}
            {autoScopeNotification.warnings.length > 0 && (
              <div className="text-[10px] text-[#F59E0B] pl-5">
                {autoScopeNotification.warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Scope Items</p>
          <button
            onClick={() => setLocation(`/inspection/${claimId}/review`)}
            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-medium transition-colors"
            data-testid="link-view-full-scope"
          >
            <FileText size={10} />
            View Full Scope
            <ChevronRight size={10} />
          </button>
        </div>
        {recentLineItems.length === 0 && (
          <p className="text-xs text-muted-foreground">No items yet</p>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          <AnimatePresence>
            {recentLineItems.map((item: any) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setLocation(`/inspection/${claimId}/review`)}
                className={cn(
                  "rounded-lg px-2.5 py-2 border cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all",
                  item.provenance === "auto_scope"
                    ? "bg-[#22C55E]/5 border-[#22C55E]/20"
                    : item.provenance === "companion"
                    ? "bg-[#9D8BBF]/5 border-[#9D8BBF]/20"
                    : "bg-primary/5 border-border"
                )}
                data-testid={`scope-item-${item.id}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
                    {item.provenance === "auto_scope" && (
                      <Zap size={10} className="text-[#22C55E] shrink-0" />
                    )}
                    {item.provenance === "companion" && (
                      <Link2 size={10} className="text-[#9D8BBF] shrink-0" />
                    )}
                    <p className="text-xs font-medium truncate">{item.description}</p>
                  </div>
                  <span className="text-xs text-accent font-mono whitespace-nowrap">
                    ${Number(item.totalPrice || 0).toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {item.category} · {item.action} · {item.quantity} {item.unit}
                  {item.provenance && item.provenance !== "voice" && (
                    <span className={cn(
                      "ml-1",
                      item.provenance === "auto_scope" ? "text-[#22C55E]" : "text-[#9D8BBF]"
                    )}>
                      · {item.provenance === "auto_scope" ? "auto-scoped" : item.provenance}
                    </span>
                  )}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <PhotoGallery
        photos={recentPhotos.map((p: any) => ({
          id: p.id,
          thumbnail: p.thumbnail,
          storagePath: p.storagePath,
          caption: p.caption,
          photoType: p.photoType,
          roomName: rooms.find((r) => r.id === p.roomId)?.name,
          matchesRequest: p.matchesRequest,
          analysis: p.analysis,
        }))}
        sessionId={sessionId || undefined}
        onDeletePhoto={sessionId ? async (photoId) => {
          try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/inspection/${sessionId}/photos/${photoId}`, {
              method: "DELETE",
              headers,
            });
            if (res.ok) {
              setRecentPhotos((prev) => prev.filter((p) => p.id !== photoId));
            }
          } catch (e) {
            logger.error("Voice", "Delete photo error", e);
          }
        } : undefined}
      />
    </div>
  );

  return (
    <div className="h-[calc(100vh-4rem)] bg-background text-foreground flex overflow-hidden relative" data-testid="active-inspection-page">
      {/* LEFT SIDEBAR - Desktop only */}
      {!isMobile && (
        <div className="w-72 bg-card border-r border-border flex flex-col z-20">
          {leftSidebarContent}
        </div>
      )}

      {/* LEFT SIDEBAR - Mobile Sheet */}
      {isMobile && (
        <Sheet open={mobileLeftOpen} onOpenChange={setMobileLeftOpen}>
          <SheetContent side="left" className="w-[280px] bg-card text-foreground border-border p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {leftSidebarContent}
          </SheetContent>
        </Sheet>
      )}

      {/* RIGHT PANEL - Mobile Sheet */}
      {isMobile && (
        <Sheet open={mobileRightOpen} onOpenChange={setMobileRightOpen}>
          <SheetContent side="right" className="w-[280px] bg-card text-foreground border-border p-0">
            <SheetTitle className="sr-only">Estimate</SheetTitle>
            {rightPanelContent}
          </SheetContent>
        </Sheet>
      )}

      {/* CENTER STAGE */}
      <div className="flex-1 relative flex flex-col">
        {/* Top Bar */}
        <div className="h-14 bg-card/80 backdrop-blur-md border-b border-border z-10 px-3 md:px-5 flex justify-between items-center">
          <div className="flex items-center gap-2 md:gap-3">
            {isMobile && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground h-8 w-8 p-0" onClick={() => setMobileLeftOpen(true)} data-testid="button-mobile-nav">
                <Menu size={18} />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-8 gap-1 px-2"
              onClick={() => setLocation("/")}
              data-testid="button-back-to-claims"
            >
              <ChevronLeft size={16} />
              <span className="text-xs hidden sm:inline">Claims</span>
            </Button>
            {isConnected && (
              <div className="flex items-center gap-1.5 bg-destructive/10 px-2 py-1 rounded-full border border-destructive/30">
                <div className="h-1.5 w-1.5 bg-destructive rounded-full animate-pulse" />
                <span className="text-[10px] font-mono text-destructive">REC {formatTime(elapsed)}</span>
              </div>
            )}
            {currentArea && (
              <div className="bg-primary/10 px-2.5 py-1 rounded-full hidden sm:block">
                <span className="text-xs">{currentStructure} &rsaquo; {currentArea}</span>
              </div>
            )}
          </div>
          <div className="flex gap-1 md:gap-2">
            {isConnected && (
              <>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground h-8 px-2" onClick={togglePause} data-testid="button-pause">
                  {isPaused ? <Play size={14} /> : <Pause size={14} />}
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground h-8 px-2 hidden sm:flex" data-testid="button-flag">
                  <Flag size={14} />
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground h-8 w-8 p-0" onClick={() => setShowProgressTracker(true)} data-testid="button-progress-tracker-topbar">
              <Activity size={isMobile ? 18 : 14} />
            </Button>
            {isMobile && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground h-8 w-8 p-0" onClick={() => setMobileRightOpen(true)} data-testid="button-mobile-estimate">
                <BarChart3 size={18} />
              </Button>
            )}
          </div>
        </div>

        {/* Mobile current area indicator */}
        {isMobile && currentArea && (
          <div className="bg-primary/5 px-3 py-1.5 border-b border-border sm:hidden">
            <span className="text-[11px] text-muted-foreground">{currentStructure} &rsaquo; {currentArea}</span>
          </div>
        )}

        {/* Resumed session banner */}
        {isResumedSession && (
          <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-3 flex items-center justify-between text-sm z-10">
            <span className="text-blue-700 dark:text-blue-300">
              Resumed previous inspection session. Voice connection will re-establish automatically.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
              onClick={() => setIsResumedSession(false)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Disconnected Banner */}
        {voiceState === "disconnected" && !isConnecting && (
          <div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between text-sm z-10">
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              <span>Voice disconnected — Reconnecting...</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive-foreground hover:bg-destructive/80"
              onClick={connectVoice}
            >
              Reconnect Now
            </Button>
          </div>
        )}

        {voiceState === "error" && (
          <div className="bg-destructive/10 border-b border-destructive/20 px-5 py-2 flex items-center gap-2 z-10">
            <AlertCircle size={14} className="text-destructive" />
            <span className="text-xs text-destructive">Voice connection error. Try reconnecting.</span>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 relative flex flex-col bg-gradient-to-b from-background via-background to-muted/30 overflow-hidden">
          {/* Transcript Log - top half */}
          <div className={cn("overflow-y-auto px-3 md:px-6 py-4 space-y-3", sketchCollapsed ? "flex-1" : "flex-1 min-h-0")} style={!sketchCollapsed && rooms.length > 0 ? { flex: "1 1 55%" } : undefined}>
            {transcript.length === 0 && !agentPartialText && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60">
                <Mic size={40} className="mb-3 opacity-50" />
                <p className="text-sm">
                  {isConnected ? "Listening... Start speaking to begin the inspection." : "Tap the microphone to start the voice inspection."}
                </p>
              </div>
            )}
            <AnimatePresence>
              {transcript.map((entry, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "max-w-xl rounded-xl px-4 py-3",
                    entry.role === "agent"
                      ? "bg-primary/15 border border-primary/20 mr-auto"
                      : "bg-primary/10 border border-primary/25 ml-auto"
                  )}
                >
                  <p className="text-[10px] uppercase tracking-wider mb-1 text-muted-foreground">
                    {entry.role === "agent" ? "Claims IQ" : "You"}
                  </p>
                  <p className="text-sm leading-relaxed text-foreground">{entry.text}</p>
                </motion.div>
              ))}
            </AnimatePresence>

            {agentPartialText && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-xl rounded-xl px-4 py-3 bg-primary/15 border border-primary/20 mr-auto"
              >
                <p className="text-[10px] uppercase tracking-wider mb-1 text-muted-foreground">Claims IQ</p>
                <p className="text-sm leading-relaxed text-foreground">{agentPartialText}<span className="animate-pulse">|</span></p>
              </motion.div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Inline Floor Plan Sketch - bottom panel */}
          {(rooms.length > 0 || isConnected) && (
            <div
              className={cn(
                "border-t border-border bg-card/60 backdrop-blur-sm transition-all",
                sketchCollapsed ? "h-9" : "min-h-0"
              )}
              style={!sketchCollapsed ? { flex: "0 0 auto", maxHeight: "40%" } : undefined}
              data-testid="sketch-inline-panel"
            >
              <div
                className="h-9 flex items-center justify-between px-3 cursor-pointer hover:bg-primary/5"
                onClick={() => setSketchCollapsed(!sketchCollapsed)}
              >
                <div className="flex items-center gap-2">
                  {sketchCollapsed ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Floor Plan</span>
                  <span className="text-[10px] text-muted-foreground/60">{rooms.length} area{rooms.length !== 1 ? "s" : ""}</span>
                </div>
                {!sketchCollapsed && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSketchExpanded(true);
                    }}
                    data-testid="button-expand-sketch"
                  >
                    <Maximize2 size={12} />
                  </Button>
                )}
              </div>
              {!sketchCollapsed && (
                <div className="overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100% - 36px)" }}>
                  <PropertySketch
                    sessionId={sessionId}
                    rooms={rooms}
                    currentRoomId={currentRoomId}
                    onRoomClick={(roomId) => {
                      setCurrentRoomId(roomId);
                      setCurrentArea(rooms.find(r => r.id === roomId)?.name || "");
                    }}
                    onEditRoom={(roomId) => {
                      setCurrentRoomId(roomId);
                      setCurrentArea(rooms.find(r => r.id === roomId)?.name || "");
                      setSketchExpanded(true);
                      setSketchEditMode(true);
                    }}
                    onAddRoom={() => setShowAddRoom(true)}
                    onStructureChange={(name) => setCurrentStructure(name)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Voice Status + Controls */}
          <div className="h-24 md:h-28 bg-card/80 backdrop-blur-xl border-t border-border flex items-center justify-between px-4 md:px-8">
            <Button
              size="lg"
              variant="outline"
              className="border-border text-foreground bg-transparent hover:bg-primary/10 h-10 w-10 md:h-12 md:w-12 rounded-full p-0"
              onClick={() =>
                setCameraMode({ active: true, label: "Manual Photo", photoType: "damage_detail", overlay: "none" })
              }
              data-testid="button-camera-manual"
            >
              <Camera size={16} className="md:hidden" />
              <Camera size={18} className="hidden md:block" />
            </Button>

            <div className="flex flex-col items-center -mt-4">
              <button
                onClick={() => {
                  if (!isConnected && !isConnecting) {
                    connectVoice();
                  } else if (isConnected) {
                    disconnectVoice();
                  }
                }}
                disabled={isConnecting}
                data-testid="button-mic"
                className={cn(
                  "h-14 w-14 md:h-16 md:w-16 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-105 active:scale-95 border-2",
                  isConnecting
                    ? "bg-accent/50 border-accent/30 cursor-wait"
                    : isConnected
                    ? voiceState === "listening"
                      ? "bg-primary border-primary/50 animate-pulse"
                      : "bg-primary border-primary/50"
                    : "bg-accent border-accent/50"
                )}
              >
                {isConnecting ? (
                  <Loader2 className="h-5 w-5 md:h-6 md:w-6 text-white animate-spin" />
                ) : isConnected ? (
                  <Mic className="h-5 w-5 md:h-6 md:w-6 text-white" />
                ) : (
                  <MicOff className="h-5 w-5 md:h-6 md:w-6 text-white" />
                )}
              </button>
              <div className="mt-2 h-6">
                {isConnected && <VoiceIndicator status={voiceState} />}
                {!isConnected && !isConnecting && (
                  <span className="text-[10px] text-muted-foreground">Tap to connect</span>
                )}
                {isConnecting && (
                  <span className="text-[10px] text-accent animate-pulse">Connecting...</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 md:gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground hidden sm:flex"
                onClick={() => {
                  localStorage.removeItem(STORAGE_KEY);
                  setLocation(`/inspection/${claimId}/review`);
                }}
              >
                <FileText className="h-4 w-4 mr-1" />
                Review
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-border text-foreground bg-transparent hover:bg-primary/10 h-10 w-10 md:h-12 md:w-12 rounded-full p-0"
                data-testid="button-skip"
              >
                <SkipForward size={16} className="md:hidden" />
                <SkipForward size={18} className="hidden md:block" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - Desktop only */}
      {!isMobile && (
        <div
          className={cn(
            "bg-card border-l border-border flex flex-col z-20 transition-all",
            rightPanelCollapsed ? "w-10" : "w-72"
          )}
        >
          <button
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="h-10 flex items-center justify-center border-b border-border text-muted-foreground hover:text-foreground"
            data-testid="button-toggle-right-panel"
          >
            <ChevronRight size={14} className={cn("transition-transform", !rightPanelCollapsed && "rotate-180")} />
          </button>

          {!rightPanelCollapsed && rightPanelContent}
        </div>
      )}

      {/* PROGRESS MAP */}
      <ProgressMap
        isOpen={showProgressMap}
        onClose={() => setShowProgressMap(false)}
        sessionId={sessionId!}
        rooms={rooms}
        currentPhase={currentPhase}
        currentRoomId={currentRoomId}
        onNavigateToRoom={(roomId) => {
          setCurrentRoomId(roomId);
          setShowProgressMap(false);
        }}
      />

      {/* PROGRESS TRACKER */}
      <InspectionProgressTracker
        sessionId={sessionId}
        currentPhase={currentPhase}
        rooms={rooms}
        isOpen={showProgressTracker}
        onClose={() => setShowProgressTracker(false)}
        onRefresh={() => {
          refreshRooms();
          refreshLineItems();
          refreshEstimate();
        }}
      />

      {/* EXPANDED SKETCH OVERLAY */}
      <AnimatePresence>
        {sketchExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col"
            data-testid="sketch-expanded-overlay"
          >
            <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-card/80">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-primary" />
                <span className="text-sm font-semibold">Floor Plan Sketch</span>
                <span className="text-xs text-muted-foreground">{rooms.length} area{rooms.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs border-slate-200"
                  onClick={() => setShowAddStructure(true)}
                  data-testid="button-add-structure"
                >
                  <Building2 size={14} />
                  Add structure
                </Button>
                <div className="flex bg-slate-100 rounded-lg p-0.5" data-testid="sketch-mode-toggle">
                  <button
                    onClick={() => setSketchEditMode(false)}
                    className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors",
                      !sketchEditMode ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                    data-testid="button-sketch-view-mode"
                  >
                    View
                  </button>
                  <button
                    onClick={() => setSketchEditMode(true)}
                    className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors",
                      sketchEditMode ? "bg-purple-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}
                    data-testid="button-sketch-edit-mode"
                  >
                    Edit
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSketchExpanded(false); setSketchEditMode(false); }}
                  data-testid="button-close-expanded-sketch"
                >
                  <X size={18} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex items-stretch">
              {sketchEditMode && sessionId ? (
                <SketchEditor
                  rooms={rooms}
                  sessionId={sessionId}
                  currentRoomId={currentRoomId}
                  structureName={currentStructure}
                  onRoomSelect={(roomId) => {
                    setCurrentRoomId(roomId);
                    setCurrentArea(rooms.find(r => r.id === roomId)?.name || "");
                  }}
                  onRoomUpdate={() => refreshRooms()}
                  onAddRoom={() => setShowAddRoom(true)}
                  onEditRoom={(roomId) => setEditingRoomId(roomId)}
                  getAuthHeaders={getAuthHeaders}
                  className="flex-1 rounded-none border-0"
                />
              ) : (
                <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
                  <div className="w-full max-w-4xl">
                    <PropertySketch
                      sessionId={sessionId}
                      rooms={rooms}
                      currentRoomId={currentRoomId}
                      onRoomClick={(roomId) => {
                        setCurrentRoomId(roomId);
                        setCurrentArea(rooms.find(r => r.id === roomId)?.name || "");
                      }}
                      onEditRoom={(roomId) => setEditingRoomId(roomId)}
                      onAddRoom={() => setShowAddRoom(true)}
                      onStructureChange={(name) => setCurrentStructure(name)}
                      expanded
                    />
                  </div>
                </div>
              )}
            </div>
            {!sketchEditMode && (
              <div className="h-14 flex items-center justify-center border-t border-border bg-card/80">
                <div className="flex gap-6 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-2 rounded-sm border border-green-500 bg-green-500/10" />
                    <span>Complete</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-2 rounded-sm border border-primary bg-primary/15" />
                    <span>In Progress</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-2 rounded-sm border border-gray-500 border-dashed bg-gray-800/80" />
                    <span>Not Started</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span>Damages</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* CAMERA OVERLAY */}
      <AnimatePresence>
        {cameraMode.active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-foreground flex flex-col"
          >
            <div className="bg-foreground/95 px-4 py-3 flex justify-between items-center border-b border-primary/25">
              <div>
                <p className="text-accent text-xs font-bold uppercase tracking-wider">{cameraMode.photoType.replace("_", " ")}</p>
                <p className="text-white text-sm font-medium">{cameraMode.label}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-white"
                onClick={() => {
                  const videoStream = videoRef.current?.srcObject as MediaStream | null;
                  if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
                  setCameraMode({ active: false, label: "", photoType: "", overlay: "none" });

                  // Send cancelled result to the voice agent so it doesn't hang
                  const pendingCall = pendingPhotoCallRef.current;
                  if (pendingCall && dcRef.current && dcRef.current.readyState === "open") {
                    dcRef.current.send(JSON.stringify({
                      type: "conversation.item.create",
                      item: {
                        type: "function_call_output",
                        call_id: pendingCall.call_id,
                        output: JSON.stringify({
                          success: false,
                          message: "Photo capture cancelled by user. Ask if they want to try again or continue.",
                        }),
                      },
                    }));
                    dcRef.current.send(JSON.stringify({ type: "response.create" }));
                  }
                  pendingPhotoCallRef.current = null;
                }}
                data-testid="button-camera-close"
              >
                Close
              </Button>
            </div>
            <div className="flex-1 relative">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {cameraMode.overlay === "test_square_grid" && (
                <div className="absolute top-1/4 left-1/4 w-1/2 h-1/2 border-2 border-accent/60">
                  <div className="w-full h-px bg-accent/40 absolute top-1/3" />
                  <div className="w-full h-px bg-accent/40 absolute top-2/3" />
                  <div className="h-full w-px bg-accent/40 absolute left-1/3" />
                  <div className="h-full w-px bg-accent/40 absolute left-2/3" />
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="bg-foreground/95 p-4 border-t border-primary/25">
              {cameraMode.label === "Analyzing photo..." ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 text-accent animate-spin" />
                  <p className="text-sm text-white/70">Analyzing photo with AI...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={handleCameraCapture}
                    className="h-16 w-16 rounded-full bg-white border-4 border-primary/40 hover:scale-105 active:scale-95 transition-transform"
                    data-testid="button-camera-capture"
                  />
                  <p className="text-[10px] text-white/70">Tap to capture</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase Validation Overlay (PROMPT-19) */}
      <AnimatePresence>
        {phaseValidation?.visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setPhaseValidation(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-xl border border-border shadow-xl max-w-md w-full p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#F59E0B]/10 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-[#F59E0B]" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-foreground">
                    Phase {phaseValidation.currentPhase} → {phaseValidation.nextPhase}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {phaseValidation.completionScore}% complete — {phaseValidation.warnings.length} item{phaseValidation.warnings.length !== 1 ? "s" : ""} to review
                  </p>
                </div>
              </div>

              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {phaseValidation.warnings.map((warning, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 bg-[#F59E0B]/5 rounded-lg border border-[#F59E0B]/20">
                    <AlertTriangle size={12} className="text-[#F59E0B] shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground">{warning}</p>
                  </div>
                ))}
              </div>

              {phaseValidation.missingItems.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Missing Items</p>
                  <ul className="space-y-1">
                    {phaseValidation.missingItems.map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setPhaseValidation(null)}
                >
                  Stay & Fix
                </Button>
                <Button
                  size="sm"
                  className="flex-1 text-xs bg-[#F59E0B] hover:bg-[#F59E0B]/90 text-white"
                  onClick={() => setPhaseValidation(null)}
                >
                  Proceed Anyway
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo Damage Suggestions Overlay (PROMPT-19) */}
      <AnimatePresence>
        {photoDamageSuggestions.length > 0 && !cameraMode.active && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-x-0 bottom-0 z-40 bg-card border-t border-border shadow-lg p-4 space-y-3 max-h-[40vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera size={14} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">AI-Detected Damage</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {photoDamageSuggestions.length} suggestion{photoDamageSuggestions.length !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() => setPhotoDamageSuggestions([])}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {photoDamageSuggestions.map((suggestion: any, i: number) => (
              <div
                key={i}
                className="bg-muted/30 rounded-lg p-3 border border-border"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {suggestion.damageType?.replace(/_/g, " ")}
                      </span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full",
                        suggestion.severity === "severe" ? "bg-red-500/10 text-red-500" :
                        suggestion.severity === "moderate" ? "bg-[#F59E0B]/10 text-[#F59E0B]" :
                        "bg-[#22C55E]/10 text-[#22C55E]"
                      )}>
                        {suggestion.severity}
                      </span>
                      {suggestion.confidence && (
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(suggestion.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{suggestion.notes || suggestion.description}</p>
                  </div>
                </div>
                {suggestion.autoCreated && (
                  <p className="text-[10px] text-[#22C55E] mt-1">✓ Auto-created as damage observation</p>
                )}
              </div>
            ))}

            <p className="text-[10px] text-muted-foreground italic">
              The voice agent will ask you to confirm or dismiss these suggestions.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {editingRoomId && sessionId && (
        <RoomEditorPanel
          room={(() => {
            const r = rooms.find(rm => rm.id === editingRoomId);
            return r ? { ...r, openings: [] } : null;
          })()}
          sessionId={sessionId}
          onClose={() => setEditingRoomId(null)}
          onSave={() => { refreshRooms(); setEditingRoomId(null); }}
          onDelete={() => {
            setRooms(prev => prev.filter(r => r.id !== editingRoomId));
          }}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {showAddRoom && sessionId && (
        <AddRoomPanel
          sessionId={sessionId}
          structureName={currentStructure}
          onClose={() => setShowAddRoom(false)}
          onCreated={() => {}}
          onStructureCreated={(name) => setCurrentStructure(name)}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {showAddStructure && sessionId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowAddStructure(false)} data-testid="add-structure-overlay">
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
            data-testid="add-structure-panel"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Add structure</h3>
              <button onClick={() => setShowAddStructure(false)} className="p-1 rounded hover:bg-slate-100">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Name</label>
              <input
                type="text"
                value={addStructureName}
                onChange={(e) => setAddStructureName(e.target.value)}
                placeholder="e.g., Detached Garage, Shed"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                data-testid="input-add-structure-name"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Type</label>
              <select
                value={addStructureType}
                onChange={(e) => setAddStructureType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                data-testid="select-add-structure-type"
              >
                <option value="dwelling">Main / Dwelling</option>
                <option value="garage">Garage</option>
                <option value="shed">Shed</option>
                <option value="fence">Fence</option>
                <option value="carport">Carport</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={handleCreateStructure}
                disabled={creatingStructure || !addStructureName.trim()}
                data-testid="button-confirm-add-structure"
              >
                {creatingStructure ? "Creating…" : "Create"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddStructure(false)}>
                Cancel
              </Button>
            </div>
            {structuresList.length > 0 && (
              <div className="border-t border-slate-200 pt-3 mt-3">
                <p className="text-xs font-medium text-slate-500 mb-2">Current structures</p>
                <ul className="space-y-1.5">
                  {structuresList.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-slate-50">
                      <span className="text-sm text-slate-800">{s.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDeleteStructure(s.id, s.name)}
                        disabled={deletingStructureId === s.id}
                        data-testid={`button-delete-structure-${s.id}`}
                      >
                        {deletingStructureId === s.id ? "Deleting…" : "Delete"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
