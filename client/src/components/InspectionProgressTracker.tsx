import React, { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  Camera,
  FileText,
  Droplets,
  Home,
  Shield,
  ChevronDown,
  ChevronUp,
  X,
  Activity,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";

interface ProgressTrackerProps {
  sessionId: number | null;
  currentPhase: number;
  rooms: Array<{
    id: number;
    name: string;
    status: string;
    damageCount: number;
    photoCount: number;
    structure?: string;
  }>;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

interface ChecklistItem {
  item: string;
  satisfied: boolean;
  evidence?: string;
}

interface CompletenessData {
  completenessScore: number;
  checklist: ChecklistItem[];
  scopeGaps: Array<{ room: string; issue: string }>;
  missingPhotos: Array<{ room: string; issue: string }>;
  summary: {
    totalRooms: number;
    completedRooms: number;
    totalDamages: number;
    totalLineItems: number;
    totalPhotos: number;
    totalMoistureReadings: number;
  };
}

const PHASES = [
  { id: 1, name: "Pre-Inspection", icon: FileText },
  { id: 2, name: "Setup", icon: Home },
  { id: 3, name: "Exterior", icon: Shield },
  { id: 4, name: "Interior", icon: Home },
  { id: 5, name: "Moisture", icon: Droplets },
  { id: 6, name: "Evidence", icon: Camera },
  { id: 7, name: "Estimate", icon: Target },
  { id: 8, name: "Finalize", icon: CheckCircle2 },
];

export default function InspectionProgressTracker({
  sessionId,
  currentPhase,
  rooms,
  isOpen,
  onClose,
  onRefresh,
}: ProgressTrackerProps) {
  const [completenessData, setCompletenessData] = useState<CompletenessData | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("phases");
  const [loading, setLoading] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {}
    return headers;
  }, []);

  const fetchCompleteness = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/completeness`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCompletenessData(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [sessionId, getAuthHeaders]);

  useEffect(() => {
    if (isOpen && sessionId) {
      fetchCompleteness();
    }
  }, [isOpen, sessionId, fetchCompleteness]);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const completedRooms = rooms.filter((r) => r.status === "complete").length;
  const totalRooms = rooms.length;
  const roomProgress = totalRooms > 0 ? Math.round((completedRooms / totalRooms) * 100) : 0;

  const overallScore = completenessData?.completenessScore ?? 0;
  const checklist = completenessData?.checklist ?? [];
  const scopeGaps = completenessData?.scopeGaps ?? [];
  const missingPhotos = completenessData?.missingPhotos ?? [];
  const summary = completenessData?.summary;

  const satisfiedChecklist = checklist.filter((c) => c.satisfied).length;
  const totalChecklist = checklist.length;

  const alertCount = scopeGaps.length + missingPhotos.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white z-50 shadow-2xl flex flex-col overflow-hidden"
            data-testid="progress-tracker-panel"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-gradient-to-r from-primary/5 to-accent/5">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Activity size={18} className="text-primary" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-foreground" data-testid="text-tracker-title">Inspection Progress</h2>
                  <p className="text-xs text-muted-foreground">Phase {currentPhase} of {PHASES.length}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors"
                data-testid="button-close-tracker"
              >
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>

            {/* Overall Score Ring */}
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-5">
                <div className="relative h-20 w-20 shrink-0">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      className="stroke-muted"
                      strokeWidth="3"
                    />
                    <motion.path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      className={overallScore >= 80 ? "stroke-success" : overallScore >= 50 ? "stroke-accent" : "stroke-primary"}
                      strokeWidth="3"
                      strokeLinecap="round"
                      initial={{ strokeDasharray: "0, 100" }}
                      animate={{ strokeDasharray: `${overallScore}, 100` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-display font-bold text-foreground" data-testid="text-overall-score">{overallScore}%</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Checklist</span>
                    <span className="font-semibold text-foreground" data-testid="text-checklist-count">{satisfiedChecklist}/{totalChecklist}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-success"
                      initial={{ width: 0 }}
                      animate={{ width: totalChecklist > 0 ? `${(satisfiedChecklist / totalChecklist) * 100}%` : "0%" }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Rooms</span>
                    <span className="font-semibold text-foreground" data-testid="text-room-count">{completedRooms}/{totalRooms}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${roomProgress}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              {summary && (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {[
                    { label: "Damages", value: summary.totalDamages, icon: AlertTriangle },
                    { label: "Photos", value: summary.totalPhotos, icon: Camera },
                    { label: "Items", value: summary.totalLineItems, icon: FileText },
                    { label: "Moisture", value: summary.totalMoistureReadings, icon: Droplets },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="bg-muted/50 rounded-lg px-2 py-2 text-center" data-testid={`stat-${label.toLowerCase()}`}>
                      <Icon size={14} className="mx-auto text-muted-foreground mb-0.5" />
                      <p className="text-lg font-display font-bold text-foreground">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Phase Progress Section */}
              <div className="border-b border-border">
                <button
                  onClick={() => toggleSection("phases")}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  data-testid="button-toggle-phases"
                >
                  <span className="text-sm font-display font-semibold text-foreground">Inspection Phases</span>
                  {expandedSection === "phases" ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </button>
                <AnimatePresence>
                  {expandedSection === "phases" && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-4">
                        <div className="relative">
                          {PHASES.map((phase, index) => {
                            const isCompleted = currentPhase > phase.id;
                            const isCurrent = currentPhase === phase.id;
                            const Icon = phase.icon;
                            return (
                              <div key={phase.id} className="flex items-start gap-3 relative" data-testid={`phase-step-${phase.id}`}>
                                {/* Vertical connector line */}
                                {index < PHASES.length - 1 && (
                                  <div
                                    className={cn(
                                      "absolute left-[15px] top-[32px] w-0.5 h-[calc(100%-8px)]",
                                      isCompleted ? "bg-success" : "bg-muted"
                                    )}
                                  />
                                )}
                                {/* Step circle */}
                                <div
                                  className={cn(
                                    "h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10 border-2 transition-all",
                                    isCompleted
                                      ? "bg-success border-success text-white"
                                      : isCurrent
                                      ? "bg-primary border-primary text-white shadow-md shadow-primary/30"
                                      : "bg-white border-muted text-muted-foreground"
                                  )}
                                >
                                  {isCompleted ? (
                                    <CheckCircle2 size={14} />
                                  ) : (
                                    <Icon size={14} />
                                  )}
                                </div>
                                {/* Label */}
                                <div className={cn("pb-5 pt-1", isCurrent && "pb-6")}>
                                  <p
                                    className={cn(
                                      "text-sm font-medium",
                                      isCompleted ? "text-success" : isCurrent ? "text-primary font-semibold" : "text-muted-foreground"
                                    )}
                                  >
                                    {phase.name}
                                  </p>
                                  {isCurrent && (
                                    <motion.p
                                      initial={{ opacity: 0, y: -4 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="text-[11px] text-primary/70 mt-0.5"
                                    >
                                      In progress...
                                    </motion.p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Checklist Section */}
              <div className="border-b border-border">
                <button
                  onClick={() => toggleSection("checklist")}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  data-testid="button-toggle-checklist"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-display font-semibold text-foreground">Completeness Checklist</span>
                    {totalChecklist > 0 && (
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                        satisfiedChecklist === totalChecklist
                          ? "bg-success/10 text-success"
                          : "bg-accent/10 text-accent"
                      )}>
                        {satisfiedChecklist}/{totalChecklist}
                      </span>
                    )}
                  </div>
                  {expandedSection === "checklist" ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </button>
                <AnimatePresence>
                  {expandedSection === "checklist" && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-4 space-y-2">
                        {loading && checklist.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">Loading checklist...</p>
                        ) : checklist.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">Start the inspection to see checklist items.</p>
                        ) : (
                          checklist.map((item, i) => (
                            <div
                              key={i}
                              className={cn(
                                "flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors",
                                item.satisfied
                                  ? "bg-success/5 border-success/20"
                                  : "bg-muted/30 border-border"
                              )}
                              data-testid={`checklist-item-${i}`}
                            >
                              {item.satisfied ? (
                                <CheckCircle2 size={16} className="text-success mt-0.5 shrink-0" />
                              ) : (
                                <Circle size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                              )}
                              <div>
                                <p className={cn("text-sm", item.satisfied ? "text-foreground" : "text-muted-foreground")}>
                                  {item.item}
                                </p>
                                {item.evidence && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{item.evidence}</p>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Alerts Section */}
              {alertCount > 0 && (
                <div className="border-b border-border">
                  <button
                    onClick={() => toggleSection("alerts")}
                    className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                    data-testid="button-toggle-alerts"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-display font-semibold text-foreground">Alerts</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">
                        {alertCount}
                      </span>
                    </div>
                    {expandedSection === "alerts" ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                  </button>
                  <AnimatePresence>
                    {expandedSection === "alerts" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 space-y-2">
                          {scopeGaps.map((gap, i) => (
                            <div key={`gap-${i}`} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-warning/5 border border-warning/20" data-testid={`alert-scope-gap-${i}`}>
                              <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                              <div>
                                <p className="text-sm font-medium text-foreground">{gap.room}</p>
                                <p className="text-[11px] text-muted-foreground">{gap.issue}</p>
                              </div>
                            </div>
                          ))}
                          {missingPhotos.map((mp, i) => (
                            <div key={`photo-${i}`} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-destructive/5 border border-destructive/20" data-testid={`alert-missing-photo-${i}`}>
                              <Camera size={14} className="text-destructive mt-0.5 shrink-0" />
                              <div>
                                <p className="text-sm font-medium text-foreground">{mp.room}</p>
                                <p className="text-[11px] text-muted-foreground">{mp.issue}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Room Status Section */}
              <div>
                <button
                  onClick={() => toggleSection("rooms")}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  data-testid="button-toggle-rooms"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-display font-semibold text-foreground">Room Status</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      {completedRooms}/{totalRooms}
                    </span>
                  </div>
                  {expandedSection === "rooms" ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </button>
                <AnimatePresence>
                  {expandedSection === "rooms" && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-4 space-y-1.5">
                        {rooms.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No rooms created yet.</p>
                        ) : (
                          rooms.map((room) => (
                            <div
                              key={room.id}
                              className={cn(
                                "flex items-center gap-3 p-2.5 rounded-lg border transition-colors",
                                room.status === "complete"
                                  ? "bg-success/5 border-success/20"
                                  : room.status === "in_progress"
                                  ? "bg-primary/5 border-primary/20"
                                  : "bg-white border-border"
                              )}
                              data-testid={`room-status-${room.id}`}
                            >
                              {room.status === "complete" ? (
                                <CheckCircle2 size={16} className="text-success shrink-0" />
                              ) : room.status === "in_progress" ? (
                                <div className="h-4 w-4 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
                                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                </div>
                              ) : (
                                <Circle size={16} className="text-muted-foreground shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{room.name}</p>
                                <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                                  <span>{room.damageCount} damage{room.damageCount !== 1 ? "s" : ""}</span>
                                  <span>{room.photoCount} photo{room.photoCount !== 1 ? "s" : ""}</span>
                                </div>
                              </div>
                              {room.structure && (
                                <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
                                  {room.structure}
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-muted/30">
              <button
                onClick={() => {
                  fetchCompleteness();
                  onRefresh?.();
                }}
                disabled={loading}
                className="w-full text-xs text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50"
                data-testid="button-refresh-progress"
              >
                {loading ? "Refreshing..." : "Refresh Progress"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
