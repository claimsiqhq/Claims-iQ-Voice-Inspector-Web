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
  WifiOff,
  FileText,
  MapPin,
  Menu,
  BarChart3,
  Activity,
  Maximize2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import VoiceIndicator from "@/components/VoiceIndicator";
import ProgressMap from "@/components/ProgressMap";
import InspectionProgressTracker from "@/components/InspectionProgressTracker";
import PropertySketch from "@/components/PropertySketch";
import PhotoGallery from "@/components/PhotoGallery";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabaseClient";

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

  const [sessionId, setSessionId] = useState<number | null>(null);
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

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [agentPartialText, setAgentPartialText] = useState("");
  const [recentLineItems, setRecentLineItems] = useState<any[]>([]);
  const [estimateSummary, setEstimateSummary] = useState({ totalRCV: 0, totalACV: 0, itemCount: 0 });
  const [recentPhotos, setRecentPhotos] = useState<any[]>([]);

  const [cameraMode, setCameraMode] = useState<CameraMode>({ active: false, label: "", photoType: "", overlay: "none" });
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showProgressMap, setShowProgressMap] = useState(false);
  const [showProgressTracker, setShowProgressTracker] = useState(false);
  const [sketchCollapsed, setSketchCollapsed] = useState(false);
  const [sketchExpanded, setSketchExpanded] = useState(false);
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
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const { data: claimData } = useQuery({
    queryKey: [`/api/claims/${claimId}`],
    enabled: !!claimId,
  });

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/claims/${claimId}/inspection/start`);
      return res.json();
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
    },
  });

  useEffect(() => {
    startSessionMutation.mutate();
  }, [claimId]);

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

  const getAuthHeaders = useCallback(async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {}
    return headers;
  }, []);

  const refreshEstimate = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/estimate-summary`, { headers });
      const data = await res.json();
      setEstimateSummary(data);
    } catch {}
  }, [sessionId, getAuthHeaders]);

  const refreshLineItems = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/line-items`, { headers });
      const items = await res.json();
      setRecentLineItems(items.slice(-5).reverse());
      refreshEstimate();
    } catch {}
  }, [sessionId, refreshEstimate, getAuthHeaders]);

  const refreshRooms = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/rooms`, { headers });
      const data = await res.json();
      setRooms(data);
    } catch {}
  }, [sessionId, getAuthHeaders]);

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
        }).catch(() => {});
      } catch {}
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
            storagePath: p.storagePath,
            caption: p.caption,
            photoType: p.photoType,
            roomId: p.roomId,
            analysis: p.analysis,
            matchesRequest: p.matchesRequest,
          })));
        }
      } catch {}
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
      } catch {}
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

  const executeToolCall = useCallback(async (event: any) => {
    const { name, arguments: argsString, call_id } = event;
    let args: any;
    try {
      args = JSON.parse(argsString);
    } catch {
      args = {};
    }

    let result: any;

    try {
      switch (name) {
        case "set_inspection_context": {
          if (args.phase) setCurrentPhase(args.phase);
          if (args.structure) setCurrentStructure(args.structure);
          if (args.area) setCurrentArea(args.area);
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
          }
          result = { success: true, context: args };
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
          const targetRoom = args.roomId
            ? rooms.find(r => r.id === args.roomId)
            : rooms.find(r => r.name === args.roomName);
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
          const roomHeaders = await getAuthHeaders();
          const roomRes = await fetch(`/api/inspection/${sessionId}/rooms`, {
            method: "POST",
            headers: roomHeaders,
            body: JSON.stringify({
              name: args.name,
              roomType: args.roomType,
              structure: args.structure,
              viewType: args.viewType || "interior",
              shapeType: args.shapeType || "rectangle",
              dimensions,
              floor: args.floor,
              facetLabel: args.facetLabel,
              pitch: args.pitch,
              phase: args.phase,
            }),
          });
          const room = await roomRes.json();
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
          const parentRoom = rooms.find(r => r.name === args.parentRoomName);
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
          const openingRoom = rooms.find(r => r.name === args.roomName);
          if (!openingRoom) {
            result = { success: false, error: `Room "${args.roomName}" not found` };
            break;
          }
          const openHeaders = await getAuthHeaders();
          const openRes = await fetch(`/api/inspection/${sessionId}/rooms/${openingRoom.id}/openings`, {
            method: "POST",
            headers: openHeaders,
            body: JSON.stringify({
              openingType: args.openingType,
              wallIndex: args.wallIndex ?? 0,
              width: args.width,
              height: args.height,
              label: args.label || `${args.openingType} on wall ${args.wallIndex || 0}`,
              opensInto: args.opensInto,
            }),
          });
          const opening = await openRes.json();
          if (!openRes.ok) {
            result = { success: false, error: opening.message || "Failed to add opening" };
            break;
          }
          result = {
            success: true,
            openingId: opening.id,
            message: `${args.openingType} (${args.width}'x${args.height}') added to "${args.roomName}" wall ${args.wallIndex || 0}.`,
          };
          break;
        }

        case "add_sketch_annotation": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const annotRoom = rooms.find(r => r.name === args.roomName);
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
          const roomToComplete = rooms.find((r) => r.name === args.roomName);
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
          const damageHeaders = await getAuthHeaders();
          const damageRes = await fetch(`/api/inspection/${sessionId}/damages`, {
            method: "POST",
            headers: damageHeaders,
            body: JSON.stringify({
              roomId: currentRoomId,
              description: args.description,
              damageType: args.damageType,
              severity: args.severity,
              location: args.location,
              measurements: Object.keys(measurements).length > 0 ? measurements : undefined,
            }),
          });
          const damage = await damageRes.json();
          await refreshRooms();
          result = { success: true, damageId: damage.id };
          break;
        }

        case "add_line_item": {
          if (!sessionId) { result = { success: false, error: "No session" }; break; }
          const { category, action, description, catalogCode, quantity, unit, unitPrice, depreciationType, wasteFactor } = args;

          let finalUnitPrice = unitPrice || 0;
          let finalUnit = unit || "EA";
          let finalWasteFactor = wasteFactor || 0;

          // If catalogCode provided, look it up and use catalog pricing
          if (catalogCode) {
            try {
              const catalogHeaders = await getAuthHeaders();
              const catalogRes = await fetch(`/api/pricing/catalog/search?q=${encodeURIComponent(catalogCode)}`, { headers: catalogHeaders });
              if (catalogRes.ok) {
                const catalogItems = await catalogRes.json();
                const matched = catalogItems.find((item: any) => item.code === catalogCode);
                if (matched) {
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
              console.warn("Catalog lookup failed, falling back to provided price:", e);
            }
          }

          const qty = quantity || 1;
          const totalPrice = qty * finalUnitPrice * (1 + (finalWasteFactor || 0) / 100);

          const lineHeaders = await getAuthHeaders();
          const lineRes = await fetch(`/api/inspection/${sessionId}/line-items`, {
            method: "POST",
            headers: lineHeaders,
            body: JSON.stringify({
              roomId: currentRoomId,
              category: category || "General",
              action: action || null,
              description,
              xactCode: catalogCode || null,
              quantity: qty,
              unit: finalUnit,
              unitPrice: finalUnitPrice,
              totalPrice,
              depreciationType: depreciationType || "Recoverable",
              wasteFactor: finalWasteFactor,
            }),
          });
          const lineItem = await lineRes.json();
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

        case "skip_step": {
          if (!args.passwordConfirmed) {
            result = { success: false, error: "Voice password not confirmed. Ask the adjuster to say the voice password before skipping." };
            break;
          }
          const skipDescription = args.stepDescription || "Unknown step";
          const skipReason = args.reason || "Adjuster request";
          addTranscriptEntry("agent", `Step skipped: ${skipDescription} (${skipReason})`);
          result = { success: true, skipped: skipDescription, reason: skipReason, message: `Skipped "${skipDescription}". Proceed to next step.` };
          break;
        }

        case "complete_inspection": {
          if (!sessionId) { result = { success: false }; break; }
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
  }, [sessionId, currentRoomId, rooms, refreshRooms, refreshLineItems, refreshEstimate, setLocation, getAuthHeaders]);

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
        console.error("Realtime error:", event.error);
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
          dc.send(JSON.stringify({
            type: "response.create",
            response: {
              instructions: "Begin the inspection now. Follow your system instructions for the mandatory first step.",
            },
          }));
        }
      };

      dc.onclose = () => {
        setIsConnected(false);
        setVoiceState("disconnected");
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
        } catch {}
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
      console.error("Voice connection error:", error);
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

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

        // Step 2: Send to GPT-4o Vision for analysis
        let analysis: any = null;
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
          console.error("Photo analysis failed:", e);
        }

        // Step 3: Store in local state WITH thumbnail + analysis for gallery display
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
          },
          ...prev,
        ].slice(0, 50));

        // Step 4: Build the tool result to send back to the voice agent
        photoResult = {
          success: true,
          photoId: savedPhoto.photoId,
          message: "Photo captured and saved.",
          analysis: analysis ? {
            description: analysis.description,
            damageVisible: analysis.damageVisible,
            matchesExpected: analysis.matchesExpected,
            matchExplanation: analysis.matchExplanation,
            qualityScore: analysis.qualityScore,
          } : undefined,
        };

        // If photo doesn't match what was requested, tell the agent
        if (analysis && !analysis.matchesExpected) {
          photoResult.warning = `Photo may not match requested capture "${cameraMode.label}". ${analysis.matchExplanation}`;
        }
      } catch (e: any) {
        console.error("Camera capture error:", e);
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
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(console.error);
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
                {currentPhase > phase.id ? <CheckCircle2 size={10} /> : phase.id}
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
          onClick={() => setLocation(`/inspection/${claimId}/review`)}
          data-testid="button-finish-inspection"
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" /> Review & Finalize
        </Button>
      </div>
    </div>
  );

  const rightPanelContent = (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
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

      <PropertySketch
        sessionId={sessionId}
        rooms={rooms}
        currentRoomId={currentRoomId}
        onRoomClick={(roomId) => {
          setCurrentRoomId(roomId);
          setCurrentArea(rooms.find(r => r.id === roomId)?.name || "");
        }}
      />

      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Recent Line Items</p>
        {recentLineItems.length === 0 && (
          <p className="text-xs text-muted-foreground">No items yet</p>
        )}
        <AnimatePresence>
          {recentLineItems.map((item: any) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-primary/5 rounded-lg px-2.5 py-2 mb-1.5 border border-border"
            >
              <div className="flex justify-between items-start">
                <p className="text-xs font-medium truncate flex-1 mr-2">{item.description}</p>
                <span className="text-xs text-accent font-mono whitespace-nowrap">
                  ${(item.totalPrice || 0).toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {item.category} &middot; {item.action} &middot; {item.quantity} {item.unit}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
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
                onClick={() => setLocation(`/inspection/${claimId}/review`)}
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
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setSketchExpanded(false)}
                data-testid="button-close-expanded-sketch"
              >
                <X size={18} />
              </Button>
            </div>
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
                  expanded
                />
              </div>
            </div>
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
    </div>
  );
}
