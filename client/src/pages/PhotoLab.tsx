import { useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Camera,
  Upload,
  Loader2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Link2,
  Unlink,
  X,
  ZoomIn,
  StickyNote,
  ChevronDown,
  ImageOff,
  Shield,
  Wrench,
  Eye,
} from "lucide-react";

interface DamageDetection {
  damageType: string;
  description: string;
  severity: "none" | "minor" | "moderate" | "severe" | "critical";
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  repairSuggestion: string;
}

interface PhotoAnalysis {
  summary: string;
  damageDetections: DamageDetection[];
  overallSeverity: number;
  damageTypes: string[];
  suggestedRepairs: string[];
  propertyContext: string;
}

interface StandalonePhoto {
  id: number;
  userId: string;
  claimId: number | null;
  storagePath: string;
  fileName: string;
  fileSize: number | null;
  source: string | null;
  analysisStatus: string | null;
  analysis: PhotoAnalysis | null;
  annotations: DamageDetection[] | null;
  severityScore: number | null;
  damageTypes: string[] | null;
  suggestedRepairs: string[] | null;
  notes: string | null;
  createdAt: string;
  signedUrl: string | null;
}

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
}

const severityColors: Record<string, string> = {
  none: "bg-gray-100 text-gray-600 border-gray-200",
  minor: "bg-blue-50 text-blue-700 border-blue-200",
  moderate: "bg-yellow-50 text-yellow-700 border-yellow-200",
  severe: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

const severityBorderColors: Record<string, string> = {
  none: "rgba(156,163,175,0.6)",
  minor: "rgba(59,130,246,0.7)",
  moderate: "rgba(234,179,8,0.7)",
  severe: "rgba(249,115,22,0.8)",
  critical: "rgba(239,68,68,0.9)",
};

function severityLabel(score: number): string {
  if (score <= 2) return "No Significant Damage";
  if (score <= 4) return "Minor Damage";
  if (score <= 6) return "Moderate Damage";
  if (score <= 8) return "Severe Damage";
  return "Critical Damage";
}

function severityColor(score: number): string {
  if (score <= 2) return "text-green-600";
  if (score <= 4) return "text-blue-600";
  if (score <= 6) return "text-yellow-600";
  if (score <= 8) return "text-orange-600";
  return "text-red-600";
}

function AnnotatedImage({ photo, onClose }: { photo: StandalonePhoto; onClose: () => void }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const annotations = photo.annotations || [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
      data-testid="annotated-overlay"
    >
      <div className="relative max-w-5xl w-full my-auto" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 z-10 bg-white/20 text-white rounded-full p-2 hover:bg-white/30 transition-colors"
          data-testid="close-annotated"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1 min-w-0">
            <div className="relative inline-block w-full">
              {photo.signedUrl && (
                <img
                  src={photo.signedUrl}
                  alt={photo.fileName}
                  className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
                  data-testid="annotated-image"
                />
              )}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {annotations.map((det, idx) => (
                  <g key={idx}>
                    <rect
                      x={det.bbox.x * 100}
                      y={det.bbox.y * 100}
                      width={det.bbox.width * 100}
                      height={det.bbox.height * 100}
                      fill={hoveredIdx === idx ? "rgba(239,68,68,0.15)" : "transparent"}
                      stroke={severityBorderColors[det.severity] || "rgba(239,68,68,0.7)"}
                      strokeWidth={hoveredIdx === idx ? "0.6" : "0.4"}
                      rx="0.3"
                      className="pointer-events-auto cursor-pointer"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                    <text
                      x={det.bbox.x * 100 + 0.5}
                      y={det.bbox.y * 100 + 2.5}
                      fill="white"
                      fontSize="2"
                      fontWeight="bold"
                      className="pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
                    >
                      {idx + 1}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          {annotations.length > 0 && (
            <div className="lg:w-80 bg-white/10 backdrop-blur-md rounded-lg p-4 max-h-[70vh] overflow-y-auto">
              <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Damage Detections ({annotations.length})
              </h3>
              <div className="space-y-2">
                {annotations.map((det, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg transition-colors cursor-pointer ${
                      hoveredIdx === idx ? "bg-white/20" : "bg-white/5"
                    }`}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    data-testid={`detection-item-${idx}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white/60 text-xs font-bold">#{idx + 1}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${severityColors[det.severity]}`}>
                        {det.severity}
                      </span>
                      <span className="text-white/50 text-[10px] ml-auto">
                        {Math.round(det.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-white text-xs font-medium">{det.damageType}</p>
                    <p className="text-white/60 text-[11px] mt-1 leading-tight">{det.description}</p>
                    <p className="text-blue-300 text-[10px] mt-1.5 flex items-center gap-1">
                      <Wrench className="h-2.5 w-2.5" />
                      {det.repairSuggestion}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {photo.analysis && (
          <div className="mt-3 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-3">
            <p className="text-white text-sm">{photo.analysis.summary}</p>
            <p className="text-white/50 text-[10px] mt-1">{photo.analysis.propertyContext}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoCard({
  photo,
  onAnalyze,
  isAnalyzing,
  onDelete,
  onViewAnnotated,
  onAttach,
  onDetach,
}: {
  photo: StandalonePhoto;
  onAnalyze: (id: number) => void;
  isAnalyzing: boolean;
  onDelete: (id: number) => void;
  onViewAnnotated: (photo: StandalonePhoto) => void;
  onAttach: (photo: StandalonePhoto) => void;
  onDetach: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAnalysis = photo.analysisStatus === "complete" && photo.analysis;
  const analyzing = photo.analysisStatus === "analyzing" || isAnalyzing;
  const annotations = photo.annotations || [];
  const score = photo.severityScore || 0;

  return (
    <Card className="overflow-hidden" data-testid={`photo-card-${photo.id}`}>
      <div className="relative group">
        <div className="aspect-video bg-muted relative overflow-hidden">
          {photo.signedUrl ? (
            <>
              <img
                src={photo.signedUrl}
                alt={photo.fileName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {hasAnalysis && annotations.length > 0 && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {annotations.map((det, idx) => (
                    <rect
                      key={idx}
                      x={det.bbox.x * 100}
                      y={det.bbox.y * 100}
                      width={det.bbox.width * 100}
                      height={det.bbox.height * 100}
                      fill="transparent"
                      stroke={severityBorderColors[det.severity] || "rgba(239,68,68,0.7)"}
                      strokeWidth="0.4"
                      rx="0.3"
                    />
                  ))}
                </svg>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Camera className="h-10 w-10 text-muted-foreground/30" />
            </div>
          )}

          {hasAnalysis && (
            <button
              onClick={() => onViewAnnotated(photo)}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-lg p-1.5 hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
              data-testid={`view-annotated-${photo.id}`}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          )}

          {photo.claimId && (
            <div className="absolute top-2 left-2 bg-primary/90 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
              Claim #{photo.claimId}
            </div>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground truncate flex-1" data-testid={`photo-name-${photo.id}`}>
            {photo.fileName}
          </p>
          <p className="text-[10px] text-muted-foreground/60 ml-2">
            {photo.createdAt ? new Date(photo.createdAt).toLocaleDateString() : ""}
          </p>
        </div>

        {hasAnalysis && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${severityColor(score)}`}>
                <Shield className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">{score}/10</span>
              </div>
              <span className={`text-[10px] font-medium ${severityColor(score)}`}>
                {severityLabel(score)}
              </span>
            </div>

            {(photo.damageTypes as string[])?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(photo.damageTypes as string[]).map((dt, i) => (
                  <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                    {dt}
                  </span>
                ))}
              </div>
            )}

            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline w-full"
              data-testid={`toggle-details-${photo.id}`}
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Hide Details" : "View Details"}
            </button>

            {expanded && photo.analysis && (
              <div className="space-y-2 text-xs border-t pt-2">
                <p className="text-muted-foreground leading-relaxed">{photo.analysis.summary}</p>
                {photo.analysis.propertyContext && (
                  <p className="text-muted-foreground/70 text-[10px]">
                    Context: {photo.analysis.propertyContext}
                  </p>
                )}

                {annotations.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="font-medium text-foreground">
                      Damage Areas ({annotations.length})
                    </p>
                    {annotations.map((det, idx) => (
                      <div key={idx} className="bg-muted/50 rounded p-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] px-1 py-px rounded border ${severityColors[det.severity]}`}>
                            {det.severity}
                          </span>
                          <span className="font-medium text-[11px]">{det.damageType}</span>
                        </div>
                        <p className="text-muted-foreground text-[10px] leading-relaxed">{det.description}</p>
                        <p className="text-primary/80 text-[10px] mt-1 flex items-center gap-1">
                          <Wrench className="h-2.5 w-2.5" />
                          {det.repairSuggestion}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {(photo.suggestedRepairs as string[])?.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground mb-1">Suggested Repairs</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                      {(photo.suggestedRepairs as string[]).map((r, i) => (
                        <li key={i} className="text-[10px]">{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-1 border-t">
          {!hasAnalysis && !analyzing && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-[11px] gap-1 flex-1"
              onClick={() => onAnalyze(photo.id)}
              data-testid={`analyze-btn-${photo.id}`}
            >
              <Sparkles className="h-3 w-3" />
              Analyze
            </Button>
          )}

          {analyzing && (
            <Button size="sm" variant="secondary" className="h-7 text-[11px] gap-1 flex-1" disabled>
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
            </Button>
          )}

          {photo.analysisStatus === "failed" && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-[11px] gap-1 flex-1"
              onClick={() => onAnalyze(photo.id)}
              data-testid={`retry-btn-${photo.id}`}
            >
              <AlertTriangle className="h-3 w-3" />
              Retry
            </Button>
          )}

          {hasAnalysis && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 flex-1"
              onClick={() => onViewAnnotated(photo)}
              data-testid={`view-btn-${photo.id}`}
            >
              <Eye className="h-3 w-3" />
              View
            </Button>
          )}

          {photo.claimId ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-orange-600"
              onClick={() => onDetach(photo.id)}
              title="Detach from claim"
              data-testid={`detach-btn-${photo.id}`}
            >
              <Unlink className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
              onClick={() => onAttach(photo)}
              title="Attach to claim"
              data-testid={`attach-btn-${photo.id}`}
            >
              <Link2 className="h-3 w-3" />
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
            onClick={() => onDelete(photo.id)}
            title="Delete photo"
            data-testid={`delete-btn-${photo.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function PhotoLab() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<StandalonePhoto | null>(null);
  const [attachingPhoto, setAttachingPhoto] = useState<StandalonePhoto | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());

  const { data: photos = [], isLoading } = useQuery<StandalonePhoto[]>({
    queryKey: ["/api/photolab/photos"],
  });

  const { data: claimsList = [] } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return new Promise<StandalonePhoto>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const res = await apiRequest("POST", "/api/photolab/upload", {
              imageData: reader.result as string,
              fileName: file.name,
            });
            const data = await res.json();
            resolve(data);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photolab/photos"] });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (photoId: number) => {
      setAnalyzingIds((prev) => new Set(prev).add(photoId));
      const res = await apiRequest("POST", `/api/photolab/photos/${photoId}/analyze`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photolab/photos"] });
    },
    onSettled: (_data, _error, photoId) => {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (photoId: number) => {
      await apiRequest("DELETE", `/api/photolab/photos/${photoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photolab/photos"] });
    },
  });

  const attachMutation = useMutation({
    mutationFn: async ({ photoId, claimId }: { photoId: number; claimId: number }) => {
      const res = await apiRequest("PATCH", `/api/photolab/photos/${photoId}/attach`, { claimId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photolab/photos"] });
      setAttachingPhoto(null);
    },
  });

  const detachMutation = useMutation({
    mutationFn: async (photoId: number) => {
      const res = await apiRequest("PATCH", `/api/photolab/photos/${photoId}/detach`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photolab/photos"] });
    },
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      uploadMutation.mutate(file);
    });
    e.target.value = "";
  }, [uploadMutation]);

  const analyzedCount = photos.filter((p) => p.analysisStatus === "complete").length;
  const pendingCount = photos.filter((p) => p.analysisStatus === "pending" || p.analysisStatus === "failed").length;

  return (
    <Layout title="Photo Lab" showBack>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground flex items-center gap-3" data-testid="text-page-title">
              <Sparkles className="h-7 w-7 text-primary" />
              Photo Lab
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload photos for AI-powered damage analysis. Attach to claims when ready.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />

          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="gap-2"
            data-testid="button-upload"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload Photos
          </Button>

          <input
            ref={(el) => {
              if (el) el.setAttribute("capture", "environment");
            }}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = "";
            }}
            className="hidden"
            id="camera-input"
            data-testid="input-camera-capture"
          />
          <Button
            variant="outline"
            onClick={() => document.getElementById("camera-input")?.click()}
            disabled={uploadMutation.isPending}
            className="gap-2"
            data-testid="button-camera"
          >
            <Camera className="h-4 w-4" />
            Take Photo
          </Button>

          <div className="flex-1" />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span data-testid="text-total-count">{photos.length} photo{photos.length !== 1 ? "s" : ""}</span>
            {analyzedCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                {analyzedCount} analyzed
              </span>
            )}
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {pendingCount} pending
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : photos.length === 0 ? (
          <Card className="p-12 flex flex-col items-center justify-center text-center" data-testid="empty-state">
            <ImageOff className="h-14 w-14 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">No Photos Yet</h3>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
              Upload property photos or take new ones to get AI-powered damage analysis
              with annotated damage areas, severity scoring, and repair suggestions.
            </p>
            <Button
              className="mt-6 gap-2"
              onClick={() => fileInputRef.current?.click()}
              data-testid="empty-upload-btn"
            >
              <Upload className="h-4 w-4" />
              Upload Your First Photo
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="photo-grid">
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                onAnalyze={(id) => analyzeMutation.mutate(id)}
                isAnalyzing={analyzingIds.has(photo.id)}
                onDelete={(id) => deleteMutation.mutate(id)}
                onViewAnnotated={setSelectedPhoto}
                onAttach={setAttachingPhoto}
                onDetach={(id) => detachMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedPhoto && (
        <AnnotatedImage photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
      )}

      {attachingPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setAttachingPhoto(null)}
          data-testid="attach-modal"
        >
          <Card
            className="w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Attach to Claim</h3>
              <button onClick={() => setAttachingPhoto(null)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Select a claim to attach "{attachingPhoto.fileName}" to:
            </p>
            {claimsList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No claims available</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {claimsList.map((claim) => (
                  <button
                    key={claim.id}
                    onClick={() => attachMutation.mutate({ photoId: attachingPhoto.id, claimId: claim.id })}
                    className="w-full text-left px-3 py-2.5 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors"
                    data-testid={`claim-option-${claim.id}`}
                  >
                    <p className="text-sm font-medium">Claim #{claim.claimNumber}</p>
                    {claim.insuredName && (
                      <p className="text-xs text-muted-foreground">{claim.insuredName}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Layout>
  );
}
