import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft, ChevronDown, ChevronRight,
  Camera, CheckCircle2, AlertTriangle, FileText,
  ImageIcon, AlertCircle, X, Download, Loader2,
  ChevronUp, MessageSquare, MapPin, Cloud, DollarSign,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import WeatherCorrelation from "@/components/WeatherCorrelation";
import MoistureMap from "@/components/MoistureMap";
import PropertySketch from "@/components/PropertySketch";
import XactimateEstimateView from "@/components/XactimateEstimateView";

export default function ReviewFinalize({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
  // Fetch session data first
  const { data: claimData, isError: claimError, refetch: refetchClaim } = useQuery({
    queryKey: [`/api/claims/${claimId}`],
    enabled: !!claimId,
  });

  const claim = claimData as any;

  const { data: sessionData, isError: sessionError, refetch: refetchSession } = useQuery({
    queryKey: [`/api/claims/${claimId}/inspection/active`],
    enabled: !!claimId,
  });

  const sessionId = (sessionData as any)?.sessionId;
  const hasCriticalError = claimError || sessionError;
  const refetchCritical = () => { refetchClaim(); refetchSession(); };

  const { data: photosData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/photos-grouped`],
    enabled: !!sessionId,
  });

  const { data: completenessData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/completeness`],
    enabled: !!sessionId,
  });

  const { data: transcriptData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/transcript`],
    enabled: !!sessionId,
  });

  const { data: briefingData } = useQuery({
    queryKey: [`/api/claims/${claimId}/briefing`],
    enabled: !!claimId,
  });

  const { data: roomsData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/rooms`],
    enabled: !!sessionId,
  });

  const { data: estimateByRoomData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/estimate-by-room`],
    enabled: !!sessionId,
  });

  const photos = photosData as any;
  const completeness = completenessData as any;
  const transcriptEntries = (transcriptData || []) as any[];
  const briefing = briefingData as any;
  const rooms = (roomsData || []) as any[];
  const estimateByRoom = estimateByRoomData as any;

  if (hasCriticalError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-4" data-testid="review-finalize-page">
        <p className="text-destructive font-medium">Failed to load claim or inspection data</p>
        <Button variant="outline" onClick={() => refetchCritical()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20" data-testid="review-finalize-page">
      {/* Header */}
      <div className="h-14 bg-white border-b border-border flex items-center justify-between px-3 md:px-5 shrink-0">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button onClick={() => setLocation(`/inspection/${claimId}`)} className="text-muted-foreground hover:text-foreground shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-foreground text-sm md:text-base truncate">Review</h1>
            <p className="text-xs text-muted-foreground truncate">{claim?.claimNumber || `Claim #${claimId}`}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="scope" className="h-full flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b bg-white px-2 md:px-5 h-11 shrink-0 gap-0 overflow-x-auto">
            <TabsTrigger value="scope" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <DollarSign size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Scope</span>
            </TabsTrigger>
            <TabsTrigger value="photos" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <Camera size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Photos</span>
            </TabsTrigger>
            <TabsTrigger value="completeness" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <CheckCircle2 size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Completeness</span>
            </TabsTrigger>
            <TabsTrigger value="notes" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <FileText size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Notes</span>
            </TabsTrigger>
            <TabsTrigger value="sketch" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <MapPin size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Sketch</span>
            </TabsTrigger>
            <TabsTrigger value="weather" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <Cloud size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Weather</span>
            </TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <FileText size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Reports</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scope" className="flex-1 overflow-y-auto mt-0 p-0">
            <div className="p-4">
              <XactimateEstimateView
                data={estimateByRoom}
                claim={claim}
                sessionId={sessionId}
              />
            </div>
          </TabsContent>

          <TabsContent value="photos" className="flex-1 overflow-y-auto mt-0 p-0">
            <PhotosTab photos={photos} completeness={completeness} sessionId={sessionId} claimId={claimId} />
          </TabsContent>

          {/* COMPLETENESS TAB */}
          <TabsContent value="completeness" className="flex-1 overflow-y-auto mt-0 p-0">
            <CompletenessTab completeness={completeness} claimId={claimId} setLocation={setLocation} />
          </TabsContent>

          {/* NOTES TAB */}
          <TabsContent value="notes" className="flex-1 overflow-y-auto mt-0 p-0">
            <NotesTab transcriptEntries={transcriptEntries} sessionId={sessionId} />
          </TabsContent>

          {/* SKETCH TAB */}
          <TabsContent value="sketch" className="flex-1 overflow-y-auto mt-0 p-0">
            <SketchTab rooms={rooms} sessionId={sessionId} estimateByRoom={estimateByRoom} claim={claim} />
          </TabsContent>

          <TabsContent value="weather" className="flex-1 overflow-y-auto mt-0 p-4">
            <WeatherCorrelation claimId={claimId} />
          </TabsContent>

          <TabsContent value="reports" className="flex-1 overflow-y-auto mt-0 p-0">
            <ReportsTab sessionId={sessionId} claim={claim} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Bottom Action Bar */}
      <div className="h-auto md:h-16 bg-white border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between px-3 md:px-5 py-2 sm:py-0 gap-2 sm:gap-0 shrink-0">
        <Button variant="outline" size="sm" className="text-xs md:text-sm" onClick={() => setLocation(`/inspection/${claimId}`)}>
          <ChevronLeft size={14} className="mr-1" /> Resume Inspection
        </Button>
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs md:text-sm" onClick={() => setLocation(`/inspection/${claimId}/scope`)}>
          View Scope <ChevronRight size={14} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── REPORTS TAB ────────────────────────────────────────

function ReportsTab({ sessionId, claim }: { sessionId: number | null; claim: any }) {
  const pdfMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/export/pdf`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const esxMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/export/esx`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_export.esx`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const photoReportPdfMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/export/photo-report/pdf`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_photo_report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const photoReportDocxMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/export/photo-report/docx`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_photo_report.docx`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <div className="p-3 md:p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="flex items-center justify-center gap-2 h-14"
          onClick={() => pdfMutation.mutate()}
          disabled={pdfMutation.isPending || !sessionId}
          data-testid="button-export-pdf"
        >
          {pdfMutation.isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Generating PDF...</>
          ) : (
            <><Download size={16} /> PDF Report</>
          )}
        </Button>
        <Button
          variant="outline"
          className="flex items-center justify-center gap-2 h-14"
          onClick={() => esxMutation.mutate()}
          disabled={esxMutation.isPending || !sessionId}
          data-testid="button-export-esx"
        >
          {esxMutation.isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Generating ESX...</>
          ) : (
            <><Download size={16} /> ESX Export</>
          )}
        </Button>
        <Button
          variant="outline"
          className="flex items-center justify-center gap-2 h-14"
          onClick={() => photoReportPdfMutation.mutate()}
          disabled={photoReportPdfMutation.isPending || !sessionId}
          data-testid="button-export-photo-pdf"
        >
          {photoReportPdfMutation.isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Generating...</>
          ) : (
            <><Download size={16} /> Photo Report PDF</>
          )}
        </Button>
        <Button
          variant="outline"
          className="flex items-center justify-center gap-2 h-14"
          onClick={() => photoReportDocxMutation.mutate()}
          disabled={photoReportDocxMutation.isPending || !sessionId}
          data-testid="button-export-photo-docx"
        >
          {photoReportDocxMutation.isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Generating...</>
          ) : (
            <><Download size={16} /> Photo Report DOCX</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── PHOTOS TAB ──────────────────────────────────────────

function PhotosTab({ photos, completeness, sessionId, claimId }: any) {
  const [filter, setFilter] = useState("all");
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);

  const groups = photos?.groups || [];
  const missingPhotos = completeness?.missingPhotos || [];

  const photoTypes = ["all", "overview", "damage_detail", "test_square", "moisture", "pre_existing"];

  const filteredGroups = groups.map((group: any) => ({
    ...group,
    photos: filter === "all" ? group.photos : group.photos.filter((p: any) => p.photoType === filter),
  })).filter((group: any) => group.photos.length > 0);

  return (
    <div className="p-3 md:p-5 space-y-4">
      {/* Missing Photo Alerts */}
      {missingPhotos.length > 0 && (
        <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg p-3 space-y-1">
          {missingPhotos.map((mp: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <AlertTriangle size={14} className="text-[#F59E0B] shrink-0" />
              <span className="text-[#342A4F]">Missing: <strong>{mp.room}</strong> {mp.issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {photoTypes.map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              filter === type
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {type === "all" ? "All" : type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Photo Grid by Room */}
      {filteredGroups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Camera size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No photos{filter !== "all" ? " matching this filter" : " captured yet"}.</p>
        </div>
      )}

      {filteredGroups.map((group: any) => (
        <div key={group.roomName}>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-display font-semibold text-sm text-foreground">{group.roomName}</h3>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
              {group.photos.length}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {group.photos.map((photo: any) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                className={cn(
                  "aspect-square bg-muted rounded-lg border overflow-hidden relative group hover:ring-2 hover:ring-primary transition-all",
                  photo.analysis?.damageVisible?.length > 0
                    ? "border-[#F59E0B]/40"
                    : "border-border"
                )}
              >
                {photo.signedUrl ? (
                  <img
                    src={photo.signedUrl}
                    alt={photo.caption || photo.autoTag || "Inspection photo"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <ImageIcon size={24} className="text-muted-foreground/30" />
                  </div>
                )}
                {/* Photo Type Badge */}
                {photo.photoType && (
                  <span className="absolute top-1 right-1 text-[8px] bg-black/60 text-white px-1 py-0.5 rounded">
                    {photo.photoType.replace(/_/g, " ")}
                  </span>
                )}
                {/* AI Damage Detection Badge (PROMPT-19) */}
                {photo.analysis?.damageVisible?.length > 0 && (
                  <span className="absolute top-1 left-1 text-[8px] bg-[#F59E0B]/90 text-white px-1 py-0.5 rounded flex items-center gap-0.5">
                    <AlertTriangle size={7} />
                    {photo.analysis.damageVisible.length} damage{photo.analysis.damageVisible.length !== 1 ? "s" : ""}
                  </span>
                )}
                {/* Quality Score Indicator (PROMPT-19) */}
                {photo.analysis?.qualityScore && (
                  <span className={cn(
                    "absolute bottom-6 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white",
                    photo.analysis.qualityScore >= 4 ? "bg-[#22C55E]" :
                    photo.analysis.qualityScore >= 3 ? "bg-[#F59E0B]" :
                    "bg-red-500"
                  )}>
                    {photo.analysis.qualityScore}
                  </span>
                )}
                {/* Auto Tag Overlay */}
                {photo.autoTag && (
                  <span className="absolute bottom-0 left-0 right-0 text-[9px] bg-black/60 text-white px-1.5 py-0.5 truncate">
                    {photo.autoTag}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Photo Detail Overlay */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
            onClick={() => setSelectedPhoto(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl max-w-lg w-full p-5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start">
                <h3 className="font-display font-semibold text-foreground">{selectedPhoto.autoTag || "Photo"}</h3>
                <button onClick={() => setSelectedPhoto(null)}>
                  <X size={18} className="text-muted-foreground" />
                </button>
              </div>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                {selectedPhoto.signedUrl ? (
                  <img
                    src={selectedPhoto.signedUrl}
                    alt={selectedPhoto.caption || selectedPhoto.autoTag || "Photo"}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon size={48} className="text-muted-foreground/20" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5 text-sm">
                {selectedPhoto.caption && <p><strong>Caption:</strong> {selectedPhoto.caption}</p>}
                {selectedPhoto.photoType && <p><strong>Type:</strong> {selectedPhoto.photoType.replace(/_/g, " ")}</p>}
                {selectedPhoto.analysis?.description && <p><strong>AI Analysis:</strong> {selectedPhoto.analysis.description}</p>}
                {selectedPhoto.createdAt && <p className="text-xs text-muted-foreground">Taken: {new Date(selectedPhoto.createdAt).toLocaleString()}</p>}
              </div>

              {/* Photo Analysis Detail (PROMPT-19) */}
              {selectedPhoto?.analysis && (
                <div className="space-y-3 mt-3">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">AI Analysis</p>
                    <p className="text-sm text-foreground">{selectedPhoto.analysis.description}</p>
                    {selectedPhoto.analysis.qualityScore && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-muted-foreground">Quality:</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <span
                              key={n}
                              className={cn(
                                "w-2 h-2 rounded-full",
                                n <= selectedPhoto.analysis.qualityScore ? "bg-[#22C55E]" : "bg-border"
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedPhoto.analysis.damageVisible?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Detected Damage</p>
                      <div className="space-y-1.5">
                        {selectedPhoto.analysis.damageVisible.map((damage: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 p-2 bg-[#F59E0B]/5 rounded border border-[#F59E0B]/20">
                            <AlertTriangle size={12} className="text-[#F59E0B] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground">{damage.type}</p>
                              <p className="text-[10px] text-muted-foreground">{damage.severity} — {damage.notes}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedPhoto.analysis.matchesExpected === false && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
                      <p className="text-xs text-red-500 font-medium">Photo may not match request</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{selectedPhoto.analysis.matchExplanation}</p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── COMPLETENESS TAB ────────────────────────────────────

function CompletenessTab({ completeness, claimId, setLocation }: any) {
  const score = completeness?.completenessScore || 0;
  const checklist = completeness?.checklist || [];
  const scopeGaps = completeness?.scopeGaps || [];
  const missingPhotos = completeness?.missingPhotos || [];
  const summary = completeness?.summary || {};

  const satisfiedCount = checklist.filter((c: any) => c.satisfied).length;

  const scoreColor = score >= 80 ? "#22C55E" : score >= 50 ? "#C6A54E" : "#EF4444";

  // SVG circle progress
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  // Sort checklist: unsatisfied first
  const sortedChecklist = [...checklist].sort((a: any, b: any) => {
    if (a.satisfied === b.satisfied) return 0;
    return a.satisfied ? 1 : -1;
  });

  return (
    <div className="p-5 space-y-6">
      {/* Score Circle */}
      <div className="flex flex-col items-center">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="8" />
          <circle
            cx="80" cy="80" r={radius}
            fill="none" stroke={scoreColor} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 80 80)"
            style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
          />
          <text x="80" y="75" textAnchor="middle" className="font-display" fontSize="32" fontWeight="700" fill={scoreColor}>
            {score}%
          </text>
          <text x="80" y="95" textAnchor="middle" fontSize="11" fill="#9CA3AF">
            Complete
          </text>
        </svg>
        <p className="text-sm text-muted-foreground mt-2">
          {satisfiedCount} of {checklist.length} items complete
        </p>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        {sortedChecklist.map((item: any, i: number) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border",
              item.satisfied
                ? "border-border bg-card"
                : "border-l-4 border-l-destructive border-t border-r border-b border-border bg-destructive/5"
            )}
          >
            {item.satisfied ? (
              <CheckCircle2 size={18} className="text-[#22C55E] shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-sm text-foreground">{item.item}</p>
              {item.evidence && (
                <p className="text-xs text-muted-foreground mt-0.5">{item.evidence}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Scope Gaps */}
      {scopeGaps.length > 0 && (
        <div>
          <h3 className="font-display font-semibold text-sm text-foreground flex items-center gap-2 mb-2 border-l-4 border-l-[#C6A54E] pl-3">
            <AlertTriangle size={14} className="text-[#C6A54E]" />
            AI-Detected Scope Gaps
          </h3>
          <div className="space-y-2">
            {scopeGaps.map((gap: any, i: number) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-card">
                <p className="text-sm font-medium text-foreground">{gap.room}</p>
                <p className="text-xs text-muted-foreground">{gap.issue}</p>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setLocation(`/inspection/${claimId}`)}>
                    Add Line Item
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Photos */}
      {missingPhotos.length > 0 && (
        <div>
          <h3 className="font-display font-semibold text-sm text-foreground flex items-center gap-2 mb-2 border-l-4 border-l-[#C6A54E] pl-3">
            <Camera size={14} className="text-[#C6A54E]" />
            Missing Photos
          </h3>
          <div className="space-y-2">
            {missingPhotos.map((mp: any, i: number) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-card">
                <p className="text-sm font-medium text-foreground">{mp.room}</p>
                <p className="text-xs text-muted-foreground">{mp.issue}</p>
                <Button size="sm" variant="outline" className="text-xs h-7 mt-2" onClick={() => setLocation(`/inspection/${claimId}`)}>
                  Return to Capture
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-display font-bold text-foreground">{summary.totalRooms || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Rooms</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-display font-bold text-foreground">{summary.totalPhotos || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Photos</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-display font-bold text-foreground">{summary.totalLineItems || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Line Items</p>
        </div>
      </div>
    </div>
  );
}

// ─── NOTES TAB ───────────────────────────────────────────

function NotesTab({ transcriptEntries, sessionId }: any) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    apiRequest("GET", `/api/inspection/${sessionId}`)
      .then((data: any) => {
        if (data?.session?.adjusterNotes) setNotes(data.session.adjusterNotes);
      })
      .catch((e: unknown) => logger.error("Notes", "Failed to load adjuster notes", e));
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [sessionId]);

  const saveNotes = useCallback((value: string) => {
    if (!sessionId) return;
    setSaving(true);
    apiRequest("PATCH", `/api/inspection/${sessionId}`, { adjusterNotes: value })
      .then(() => setSaving(false))
      .catch((e: unknown) => { logger.error("Notes", "Failed to save adjuster notes", e); setSaving(false); });
  }, [sessionId]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveNotes(value), 800);
  };
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  return (
    <div className="p-5 space-y-4">
      {/* Adjuster Notes */}
      <div>
        <h3 className="font-display font-semibold text-sm text-foreground mb-2">Adjuster Notes</h3>
        <textarea
          data-testid="input-adjuster-notes"
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          rows={6}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary focus:border-primary"
          placeholder="Add any final observations, special circumstances, or notes for the reviewer..."
        />
        <p className="text-[10px] text-muted-foreground mt-1">{saving ? "Saving..." : "Notes are auto-saved and included in the export."}</p>
      </div>

      {/* Voice Transcript */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setTranscriptOpen(!transcriptOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-primary" />
            <span className="text-sm font-medium text-foreground">View Full Transcript</span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
              {transcriptEntries.length} entries
            </span>
          </div>
          {transcriptOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        <AnimatePresence>
          {transcriptOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="max-h-96 overflow-y-auto p-3 space-y-2 bg-muted/20">
                {transcriptEntries.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No transcript entries yet.</p>
                )}
                {transcriptEntries.map((entry: any, i: number) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2",
                      entry.speaker === "agent"
                        ? "bg-[#EDEAFF] border border-[#7763B7]/20 mr-auto"
                        : "bg-white border border-border ml-auto"
                    )}
                  >
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                      {entry.speaker === "agent" ? "Claims IQ" : "Adjuster"}
                    </p>
                    <p className="text-sm text-foreground">{entry.content}</p>
                    {entry.timestamp && (
                      <p className="text-[9px] text-muted-foreground mt-1">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── SKETCH TAB ─────────────────────────────────────────

function SketchTab({ rooms, sessionId, estimateByRoom, claim }: { rooms: any[]; sessionId: number | null; estimateByRoom: any; claim: any }) {
  return (
    <div className="p-3 md:p-5 space-y-4" data-testid="sketch-tab">
      <PropertySketch
        sessionId={sessionId}
        rooms={rooms.map((r: any) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          damageCount: r.damageCount || 0,
          photoCount: r.photoCount || 0,
          roomType: r.roomType,
          dimensions: r.dimensions,
          structure: r.structure,
          viewType: r.viewType,
          shapeType: r.shapeType,
          parentRoomId: r.parentRoomId,
          attachmentType: r.attachmentType,
          facetLabel: r.facetLabel,
          pitch: r.pitch,
          floor: r.floor,
        }))}
        currentRoomId={null}
        expanded
      />

      <XactimateEstimateView
        data={estimateByRoom}
        claimNumber={claim?.claimNumber}
        insuredName={claim?.insuredName}
      />
    </div>
  );
}
