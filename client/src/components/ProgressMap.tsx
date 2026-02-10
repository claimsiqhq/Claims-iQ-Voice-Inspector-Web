import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Circle, AlertTriangle, MapPin, Camera, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import FloorPlanSketch from "@/components/FloorPlanSketch";

interface ProgressMapProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: number;
  rooms: Array<{
    id: number;
    name: string;
    status: string;
    damageCount: number;
    photoCount: number;
    structure?: string;
    phase?: number;
    roomType?: string;
    dimensions?: { length?: number; width?: number; height?: number; dimVars?: Record<string, number> };
  }>;
  currentPhase: number;
  currentRoomId?: number | null;
  onNavigateToRoom: (roomId: number) => void;
}

export default function ProgressMap({
  isOpen,
  onClose,
  sessionId,
  rooms,
  currentPhase,
  currentRoomId = null,
  onNavigateToRoom,
}: ProgressMapProps) {
  const { data: adjacencies = [] } = useQuery({
    queryKey: [`/api/sessions/${sessionId}/adjacencies`],
    enabled: !!sessionId && isOpen,
  });

  const { data: openingsData = [] } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/openings`],
    enabled: !!sessionId && isOpen,
  });

  const completedRooms = rooms.filter((r) => r.status === "complete").length;
  const totalRooms = rooms.length;
  const completenessPercent = totalRooms > 0 ? Math.round((completedRooms / totalRooms) * 100) : 0;
  const remainingRooms = totalRooms - completedRooms;

  // Group rooms by structure
  const structureGroups: Record<string, typeof rooms> = {};
  const exteriorRooms: typeof rooms = [];

  for (const room of rooms) {
    if (room.phase === 3 || room.name.toLowerCase().includes("exterior") || room.name.toLowerCase().includes("roof") || room.name.toLowerCase().includes("elevation")) {
      exteriorRooms.push(room);
    } else {
      const structure = room.structure || "Main Dwelling";
      if (!structureGroups[structure]) structureGroups[structure] = [];
      structureGroups[structure].push(room);
    }
  }

  const getBorderColor = (status: string) => {
    switch (status) {
      case "complete":
        return "border-l-[#22C55E]";
      case "in_progress":
        return "border-l-[#7763B7]";
      case "flagged":
        return "border-l-[#C6A54E]";
      default:
        return "border-l-gray-400";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "complete":
        return <CheckCircle2 size={14} className="text-[#22C55E]" />;
      case "in_progress":
        return <div className="h-2.5 w-2.5 rounded-full bg-[#7763B7] animate-pulse" />;
      case "flagged":
        return <AlertTriangle size={14} className="text-[#C6A54E]" />;
      default:
        return <Circle size={14} className="text-gray-400" />;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-30"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 left-0 bottom-0 w-[400px] bg-white z-40 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin size={18} className="text-[#7763B7]" />
                <h2 className="font-display font-bold text-lg text-[#342A4F]">Progress Map</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold bg-[#7763B7]/10 text-[#7763B7] px-2 py-1 rounded-full">
                  {completenessPercent}%
                </span>
                <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
                  <X size={18} />
                </Button>
              </div>
            </div>

            {/* Completeness Bar */}
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${completenessPercent}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="h-full bg-[#7763B7] rounded-full"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                {completenessPercent}% Complete — {remainingRooms} area{remainingRooms !== 1 ? "s" : ""} remaining
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Live Sketch */}
              {rooms.length > 0 && (
                <FloorPlanSketch
                  rooms={rooms as any}
                  adjacencies={(adjacencies as any) ?? []}
                  openings={(openingsData as any) ?? []}
                  currentRoomId={currentRoomId ?? null}
                  onRoomClick={onNavigateToRoom}
                />
              )}

              {/* Interior Structure Sections */}
              {Object.entries(structureGroups).map(([structure, structureRooms]) => (
                <div key={structure}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-display font-semibold text-[#342A4F]">{structure}</h3>
                    <span className="text-xs text-gray-400">{structureRooms.length} room{structureRooms.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {structureRooms.map((room) => (
                      <button
                        key={room.id}
                        onClick={() => onNavigateToRoom(room.id)}
                        className={cn(
                          "text-left p-3 rounded-lg border border-gray-200 border-l-4 transition-all hover:shadow-md hover:border-gray-300",
                          getBorderColor(room.status)
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-[#342A4F] truncate pr-1">{room.name}</p>
                          {getStatusIcon(room.status)}
                        </div>
                        <div className="flex gap-3 text-[10px] text-gray-500">
                          <span className="flex items-center gap-0.5">
                            <AlertCircle size={10} /> {room.damageCount}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Camera size={10} /> {room.photoCount}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Exterior Sections */}
              {exteriorRooms.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-display font-semibold text-[#342A4F]">Exterior</h3>
                    <span className="text-xs text-gray-400">{exteriorRooms.length} area{exteriorRooms.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {exteriorRooms.map((room) => (
                      <button
                        key={room.id}
                        onClick={() => onNavigateToRoom(room.id)}
                        className={cn(
                          "text-left p-3 rounded-lg border border-gray-200 border-l-4 transition-all hover:shadow-md hover:border-gray-300 flex-1 min-w-[140px]",
                          getBorderColor(room.status)
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-[#342A4F] truncate pr-1">{room.name}</p>
                          {getStatusIcon(room.status)}
                        </div>
                        <div className="flex gap-3 text-[10px] text-gray-500">
                          <span className="flex items-center gap-0.5">
                            <AlertCircle size={10} /> {room.damageCount}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Camera size={10} /> {room.photoCount}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {rooms.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <MapPin size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">No rooms documented yet.</p>
                  <p className="text-xs mt-1">Start the voice session to add rooms.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Phase {currentPhase} of 8</span>
                <span>{totalRooms} total areas</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
