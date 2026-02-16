import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Camera,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Star,
  ZoomIn,
  Filter,
  Grid3X3,
  List,
  Pen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PhotoAnnotator from "./PhotoAnnotator";

export interface PhotoData {
  id: number;
  thumbnail?: string;
  storagePath?: string;
  caption?: string;
  photoType?: string;
  roomName?: string;
  matchesRequest?: boolean;
  analysis?: {
    description?: string;
    damageVisible?: Array<{ type: string; severity: string; notes?: string }>;
    matchesExpected?: boolean;
    matchExplanation?: string;
    matchConfidence?: number;
    qualityScore?: number;
    qualityNotes?: string;
  };
}

interface PhotoGalleryProps {
  photos: PhotoData[];
  className?: string;
  sessionId?: number;
  onDeletePhoto?: (photoId: number) => void;
}

const PHOTO_TYPE_LABELS: Record<string, string> = {
  overview: "Overview",
  address_verification: "Address",
  damage_detail: "Damage",
  test_square: "Test Square",
  moisture: "Moisture",
  pre_existing: "Pre-Existing",
  photo: "Photo",
};

const qualityStars = (score: number) => {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      size={8}
      className={cn(
        i < score ? "fill-accent text-accent" : "text-purple-300/30"
      )}
    />
  ));
};

export default function PhotoGallery({ photos, className, sessionId, onDeletePhoto }: PhotoGalleryProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterType, setFilterType] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const photoTypes = useMemo(() => {
    const types = new Set(photos.map((p) => p.photoType || "photo"));
    return ["all", ...Array.from(types)];
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    if (filterType === "all") return photos;
    return photos.filter((p) => (p.photoType || "photo") === filterType);
  }, [photos, filterType]);

  React.useEffect(() => {
    if (viewerIndex !== null && viewerIndex >= filteredPhotos.length) {
      setViewerIndex(filteredPhotos.length > 0 ? filteredPhotos.length - 1 : null);
    }
  }, [filteredPhotos.length, viewerIndex]);

  const openViewer = (index: number) => setViewerIndex(index);
  const closeViewer = () => setViewerIndex(null);

  const navigateViewer = (dir: -1 | 1) => {
    if (viewerIndex === null) return;
    const next = viewerIndex + dir;
    if (next >= 0 && next < filteredPhotos.length) setViewerIndex(next);
  };

  if (photos.length === 0) {
    return (
      <div className={cn("bg-primary/5 rounded-lg border border-primary/15 p-4", className)}>
        <div className="flex items-center gap-1.5 mb-3">
          <Camera size={14} className="text-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-purple-300/50">Photos</span>
        </div>
        <div className="h-20 flex items-center justify-center">
          <p className="text-xs text-purple-300/30">Photos will appear here as they're captured</p>
        </div>
      </div>
    );
  }

  const currentPhoto = viewerIndex !== null ? filteredPhotos[viewerIndex] : null;

  return (
    <>
      <div className={cn("bg-primary/5 rounded-lg border border-primary/15 overflow-hidden", className)} data-testid="photo-gallery">
        <div className="px-3 py-2 border-b border-primary/15 flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            <Camera size={12} className="text-accent" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-purple-300/50">
              Photos ({filteredPhotos.length}{filterType !== "all" ? ` / ${photos.length}` : ""})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "h-6 w-6 flex items-center justify-center rounded hover:bg-primary/15 transition-colors",
                showFilters ? "text-accent" : "text-purple-300/50"
              )}
              data-testid="button-photo-filter"
            >
              <Filter size={11} />
            </button>
            <button
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              className="h-6 w-6 flex items-center justify-center rounded text-purple-300/50 hover:bg-primary/15 hover:text-purple-300/70 transition-colors"
              data-testid="button-photo-view-mode"
            >
              {viewMode === "grid" ? <List size={11} /> : <Grid3X3 size={11} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-primary/15"
            >
              <div className="px-3 py-2 flex flex-wrap gap-1">
                {photoTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors",
                      filterType === type
                        ? "bg-accent/20 text-accent border border-accent/30"
                        : "bg-primary/5 text-purple-300/50 border border-primary/15 hover:bg-primary/10"
                    )}
                  >
                    {PHOTO_TYPE_LABELS[type] || type}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-1 p-1">
            {filteredPhotos.map((photo, i) => (
              <motion.button
                key={photo.id || i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative aspect-square rounded overflow-hidden group"
                onClick={() => openViewer(i)}
                data-testid={`photo-grid-item-${photo.id}`}
              >
                {photo.thumbnail ? (
                  <img
                    src={photo.thumbnail}
                    alt={photo.caption || "Inspection photo"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-primary/5 flex items-center justify-center">
                    <Camera size={16} className="text-purple-300/30" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                </div>
                {photo.analysis && (
                  <div className={cn(
                    "absolute top-0.5 right-0.5 h-4 w-4 rounded-full flex items-center justify-center",
                    photo.matchesRequest ? "bg-green-500/90" : "bg-amber-500/90"
                  )}>
                    {photo.matchesRequest
                      ? <CheckCircle2 size={9} className="text-white" />
                      : <AlertTriangle size={9} className="text-white" />}
                  </div>
                )}
                {photo.analysis?.damageVisible && photo.analysis.damageVisible.length > 0 && (
                  <div className="absolute bottom-0.5 left-0.5 bg-red-500/90 px-1 py-0.5 rounded text-[7px] text-white font-bold">
                    {photo.analysis.damageVisible.length} DMG
                  </div>
                )}
                <div className="absolute bottom-0.5 right-0.5 bg-black/70 px-1 py-0.5 rounded text-[7px] text-white/80">
                  {PHOTO_TYPE_LABELS[photo.photoType || "photo"] || photo.photoType}
                </div>
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {filteredPhotos.map((photo, i) => (
              <motion.div
                key={photo.id || i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-b border-primary/10 last:border-b-0 cursor-pointer hover:bg-primary/5 transition-colors"
                onClick={() => openViewer(i)}
                data-testid={`photo-list-item-${photo.id}`}
              >
                <div className="flex gap-2 p-2">
                  <div className="relative w-16 h-16 flex-shrink-0 rounded overflow-hidden">
                    {photo.thumbnail ? (
                      <img src={photo.thumbnail} alt={photo.caption || ""} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-primary/5 flex items-center justify-center">
                        <Camera size={12} className="text-purple-300/30" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">{photo.caption || "Photo"}</p>
                    <p className="text-[9px] text-purple-300/50 mt-0.5">
                      {PHOTO_TYPE_LABELS[photo.photoType || "photo"] || photo.photoType}
                      {photo.roomName && ` · ${photo.roomName}`}
                    </p>
                    {photo.analysis?.description && (
                      <p className="text-[9px] text-purple-300/40 mt-1 line-clamp-2">{photo.analysis.description}</p>
                    )}
                    {photo.analysis?.damageVisible && photo.analysis.damageVisible.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {photo.analysis.damageVisible.map((d, j) => (
                          <span key={j} className="px-1 py-0.5 bg-red-500/20 text-red-300 rounded text-[8px]">
                            {d.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {photo.analysis && (
                      <div className={cn(
                        "px-1.5 py-0.5 rounded-full text-[8px] font-bold",
                        photo.matchesRequest ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"
                      )}>
                        {photo.matchesRequest ? "✓" : "⚠"}
                      </div>
                    )}
                    {photo.analysis?.qualityScore && (
                      <div className="flex">{qualityStars(photo.analysis.qualityScore)}</div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* FULL-SCREEN PHOTO VIEWER */}
      <AnimatePresence>
        {viewerIndex !== null && currentPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-gray-900/90 backdrop-blur-sm flex flex-col"
            onClick={(e) => { if (e.target === e.currentTarget) closeViewer(); }}
            data-testid="photo-viewer-modal"
          >
            <div className="h-12 flex items-center justify-between px-4 border-b border-white/10 bg-gray-800/60">
              <span className="text-xs text-gray-300">
                {viewerIndex + 1} / {filteredPhotos.length}
              </span>
              <p className="text-sm font-medium text-gray-100 truncate max-w-[50%]">
                {currentPhoto.caption || "Photo"}
              </p>
              <div className="flex items-center gap-1">
                {currentPhoto && !annotatingPhoto && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-300 hover:text-white hover:bg-white/10 h-8 px-2"
                    onClick={() => setAnnotatingPhoto(currentPhoto)}
                    title="Annotate photo"
                  >
                    <Pen size={14} className="mr-1" />
                    Annotate
                  </Button>
                )}
                {onDeletePhoto && currentPhoto && (
                  confirmDelete ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/15 h-8 px-2 text-xs"
                        onClick={() => {
                          onDeletePhoto(currentPhoto.id);
                          setConfirmDelete(false);
                          if (filteredPhotos.length <= 1) {
                            closeViewer();
                          } else if (viewerIndex >= filteredPhotos.length - 1) {
                            setViewerIndex(viewerIndex - 1);
                          }
                        }}
                        data-testid="button-confirm-delete-photo"
                      >
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-gray-400 hover:text-gray-200 hover:bg-white/10 h-8 px-2 text-xs"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-gray-300 hover:text-red-400 hover:bg-red-500/10 h-8 w-8 p-0"
                      onClick={() => setConfirmDelete(true)}
                      title="Delete photo"
                      data-testid="button-delete-photo"
                    >
                      <Trash2 size={14} />
                    </Button>
                  )
                )}
                <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white hover:bg-white/10 h-8 w-8 p-0" onClick={() => { closeViewer(); setConfirmDelete(false); }} data-testid="button-close-viewer">
                  <X size={18} />
                </Button>
              </div>
            </div>

            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
              {viewerIndex > 0 && (
                <button
                  onClick={() => navigateViewer(-1)}
                  className="absolute left-2 z-10 h-10 w-10 rounded-full bg-black/40 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-colors"
                  data-testid="button-viewer-prev"
                >
                  <ChevronLeft size={20} />
                </button>
              )}

              {currentPhoto.thumbnail ? (
                <img
                  src={currentPhoto.thumbnail}
                  alt={currentPhoto.caption || ""}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="h-64 w-64 bg-gray-800/50 rounded-xl flex items-center justify-center">
                  <Camera size={48} className="text-gray-500" />
                </div>
              )}

              {viewerIndex < filteredPhotos.length - 1 && (
                <button
                  onClick={() => navigateViewer(1)}
                  className="absolute right-2 z-10 h-10 w-10 rounded-full bg-black/40 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-colors"
                  data-testid="button-viewer-next"
                >
                  <ChevronRight size={20} />
                </button>
              )}
            </div>

            <div className="bg-gray-800/70 backdrop-blur-md border-t border-white/10 max-h-[40%] overflow-y-auto">
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] text-gray-200 font-medium">
                      {PHOTO_TYPE_LABELS[currentPhoto.photoType || "photo"] || currentPhoto.photoType}
                    </span>
                    {currentPhoto.roomName && (
                      <span className="text-[10px] text-gray-400">{currentPhoto.roomName}</span>
                    )}
                  </div>
                  {currentPhoto.analysis && (
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
                      currentPhoto.matchesRequest
                        ? "bg-green-500/20 text-green-300 border border-green-500/30"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    )}>
                      {currentPhoto.matchesRequest
                        ? <><CheckCircle2 size={10} /> Match</>
                        : <><AlertTriangle size={10} /> Mismatch</>}
                    </div>
                  )}
                </div>

                {currentPhoto.analysis?.description && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">AI Analysis</p>
                    <p className="text-xs text-gray-200 leading-relaxed">{currentPhoto.analysis.description}</p>
                  </div>
                )}

                {currentPhoto.analysis?.damageVisible && currentPhoto.analysis.damageVisible.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Damage Detected</p>
                    <div className="space-y-1">
                      {currentPhoto.analysis.damageVisible.map((d, j) => (
                        <div key={j} className="flex items-start gap-2 bg-red-500/10 rounded px-2 py-1.5 border border-red-500/20">
                          <Shield size={10} className="text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <span className="text-[11px] font-medium text-red-300">{d.type}</span>
                            <span className="text-[10px] text-gray-400 ml-1.5">Severity: {d.severity}</span>
                            {d.notes && <p className="text-[9px] text-gray-500 mt-0.5">{d.notes}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {currentPhoto.analysis && !currentPhoto.matchesRequest && currentPhoto.analysis.matchExplanation && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-amber-300/60 mb-1">Mismatch Details</p>
                    <p className="text-[11px] text-amber-200/80">{currentPhoto.analysis.matchExplanation}</p>
                  </div>
                )}

                {currentPhoto.analysis?.qualityScore != null && (
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-purple-300/40">Quality:</p>
                    <div className="flex">{qualityStars(currentPhoto.analysis.qualityScore)}</div>
                    {currentPhoto.analysis.qualityNotes && (
                      <p className="text-[9px] text-gray-400 ml-1">{currentPhoto.analysis.qualityNotes}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo Annotator Modal */}
      <AnimatePresence>
        {annotatingPhoto && (
          <PhotoAnnotator
            imageUrl={annotatingPhoto.thumbnail || ""}
            imageBase64={annotatingPhoto.storagePath || ""}
            photoCaption={annotatingPhoto.caption || "Photo"}
            onSaveAnnotations={async (annotatedBase64, shapes) => {
              try {
                const res = await fetch(
                  `/api/inspection/${sessionId}/photos/${annotatingPhoto.id}/annotations`,
                  {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      shapes,
                      annotatedImageBase64: annotatedBase64,
                    }),
                  }
                );
                if (res.ok) {
                  setAnnotatingPhoto(null);
                }
              } catch (e) {
                logger.error("PhotoGallery", "Error saving annotations", e);
              }
            }}
            onCancel={() => setAnnotatingPhoto(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
