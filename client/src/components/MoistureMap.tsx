import React, { useMemo, useState } from "react";
import { Droplets, Wind, Thermometer, AlertTriangle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MoistureReading {
  id: number;
  location: string;
  reading: number;
  materialType?: string;
  dryStandard?: number;
}

interface MoistureMapProps {
  readings: MoistureReading[];
  roomName?: string;
  roomDimensions?: { length: number; width: number };
  showDryingCalculator?: boolean;
  onAddEquipment?: (items: Array<{ description: string; category: string; action: string; unit: string; quantity: number }>) => void;
}

const getReadingColor = (reading: number) => {
  if (reading < 14) return "#22C55E";
  if (reading <= 17) return "#F59E0B";
  return "#EF4444";
};

const getReadingStatus = (reading: number) => {
  if (reading < 14) return "Dry";
  if (reading <= 17) return "Caution";
  return "Wet";
};

const parsePosition = (location: string, index: number, total: number) => {
  const lower = location.toLowerCase();
  let x = 0.5;
  let y = 0.5;

  if (lower.includes("north")) y = 0.15;
  else if (lower.includes("south")) y = 0.85;

  if (lower.includes("east")) x = 0.85;
  else if (lower.includes("west")) x = 0.15;

  if (lower.includes("center") || lower.includes("middle")) {
    x = 0.5;
    y = 0.5;
  }

  if (lower.includes("floor")) y = 0.75;
  if (lower.includes("ceiling")) y = 0.2;

  // If no hint matched, distribute evenly
  if (x === 0.5 && y === 0.5 && !lower.includes("center") && !lower.includes("middle")) {
    const cols = Math.ceil(Math.sqrt(total));
    const row = Math.floor(index / cols);
    const col = index % cols;
    x = (col + 0.5) / cols;
    y = (row + 0.5) / Math.ceil(total / cols);
    // Clamp to keep within visible area
    x = 0.1 + x * 0.8;
    y = 0.1 + y * 0.8;
  }

  return { x, y };
};

export default function MoistureMap({
  readings,
  roomName,
  roomDimensions,
  showDryingCalculator = false,
  onAddEquipment,
}: MoistureMapProps) {
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);

  const sortedReadings = useMemo(
    () => [...readings].sort((a, b) => b.reading - a.reading),
    [readings]
  );

  const wetCount = readings.filter((r) => r.reading > 17).length;
  const cautionCount = readings.filter((r) => r.reading >= 14 && r.reading <= 17).length;
  const dryCount = readings.filter((r) => r.reading < 14).length;

  const svgWidth = 300;
  const svgHeight = 200;

  // Auto-suggest damage class based on readings
  const suggestedClass = useMemo(() => {
    if (readings.length === 0) return null;
    const wetRatio = wetCount / readings.length;
    if (wetRatio < 0.05) return 1;
    if (wetRatio < 0.4) return 2;
    if (wetRatio < 0.8) return 3;
    return 4;
  }, [readings, wetCount]);

  // Equipment calculations
  const equipmentRecommendations = useMemo(() => {
    if (!showDryingCalculator || selectedClass === null) return null;

    const areaLength = roomDimensions?.length || 12;
    const areaWidth = roomDimensions?.width || 10;
    const sqft = areaLength * areaWidth;
    const linearFt = 2 * (areaLength + areaWidth);
    const dryingClass = selectedClass;
    const waterCategory = selectedCategory || 1;

    // Air movers calculation
    const lfPerMover = dryingClass >= 3 ? 7 : 14;
    const airMovers = Math.max(1, Math.ceil(linearFt / lfPerMover));

    // Dehumidifiers
    const sfPerDehu = dryingClass <= 1 ? 1000 : 600;
    const dehumidifiers = Math.max(1, Math.ceil(sqft / sfPerDehu));

    // Air scrubbers (only for category 2-3)
    const airScrubbers = waterCategory >= 2 ? Math.max(1, Math.ceil(sqft / 500)) : 0;

    // Drying duration
    const dryingDays = dryingClass <= 2 ? 4 : 6;

    return {
      airMovers,
      dehumidifiers,
      airScrubbers,
      dryingDays,
      sqft,
    };
  }, [selectedClass, selectedCategory, roomDimensions, showDryingCalculator]);

  const handleAddEquipment = () => {
    if (!equipmentRecommendations || !onAddEquipment) return;
    const items: Array<{ description: string; category: string; action: string; unit: string; quantity: number }> = [];

    if (equipmentRecommendations.airMovers > 0) {
      items.push({
        description: `Air mover / fan (${equipmentRecommendations.airMovers} units)`,
        category: "General",
        action: "Install",
        unit: "DAY",
        quantity: equipmentRecommendations.dryingDays,
      });
    }
    if (equipmentRecommendations.dehumidifiers > 0) {
      items.push({
        description: `Dehumidifier (${equipmentRecommendations.dehumidifiers} units)`,
        category: "General",
        action: "Install",
        unit: "DAY",
        quantity: equipmentRecommendations.dryingDays,
      });
    }
    if (equipmentRecommendations.airScrubbers > 0) {
      items.push({
        description: `Air scrubber / negative air machine (${equipmentRecommendations.airScrubbers} units)`,
        category: "General",
        action: "Install",
        unit: "DAY",
        quantity: equipmentRecommendations.dryingDays,
      });
    }

    onAddEquipment(items);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets size={18} className="text-[#7763B7]" />
          <h3 className="font-display font-semibold text-[#342A4F]">
            Moisture Map{roomName ? ` — ${roomName}` : ""}
          </h3>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" /> {dryCount} Dry
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> {cautionCount} Caution
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" /> {wetCount} Wet
          </span>
        </div>
      </div>

      {/* SVG Grid */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: 250 }}>
          {/* Room outline */}
          <rect
            x="10"
            y="10"
            width={svgWidth - 20}
            height={svgHeight - 20}
            fill="none"
            stroke="#9D8BBF"
            strokeWidth="2"
            strokeDasharray="4,4"
            rx="4"
          />

          {/* Room label */}
          {roomDimensions && (
            <>
              <text x={svgWidth / 2} y={svgHeight - 2} textAnchor="middle" fontSize="9" fill="#9D8BBF">
                {roomDimensions.length}' × {roomDimensions.width}'
              </text>
            </>
          )}

          {/* Compass labels */}
          <text x={svgWidth / 2} y="8" textAnchor="middle" fontSize="8" fill="#aaa">N</text>
          <text x={svgWidth / 2} y={svgHeight - (roomDimensions ? 8 : 3)} textAnchor="middle" fontSize="8" fill="#aaa">S</text>
          <text x="5" y={svgHeight / 2} textAnchor="middle" fontSize="8" fill="#aaa">W</text>
          <text x={svgWidth - 5} y={svgHeight / 2} textAnchor="middle" fontSize="8" fill="#aaa">E</text>

          {/* Moisture readings as circles */}
          {readings.map((reading, i) => {
            const pos = parsePosition(reading.location || "", i, readings.length);
            const cx = 10 + pos.x * (svgWidth - 20);
            const cy = 10 + pos.y * (svgHeight - 20);
            const color = getReadingColor(reading.reading);

            return (
              <g key={reading.id}>
                <circle cx={cx} cy={cy} r="14" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" />
                <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="bold" fill={color}>
                  {reading.reading}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Reading List Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <th className="text-left px-3 py-2">Location</th>
              <th className="text-right px-3 py-2">Reading</th>
              <th className="text-left px-3 py-2">Material</th>
              <th className="text-right px-3 py-2">Dry Std</th>
              <th className="text-center px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedReadings.map((reading) => {
              const status = getReadingStatus(reading.reading);
              const color = getReadingColor(reading.reading);
              return (
                <tr key={reading.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-[#342A4F]">{reading.location || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color }}>
                    {reading.reading}%
                  </td>
                  <td className="px-3 py-2 text-gray-500">{reading.materialType || "—"}</td>
                  <td className="px-3 py-2 text-right text-gray-500">
                    {reading.dryStandard ? `${reading.dryStandard}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${color}20`,
                        color,
                      }}
                    >
                      {status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {readings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-sm">
                  No moisture readings recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* IICRC Classification */}
      {showDryingCalculator && readings.length > 0 && (
        <div className="space-y-4">
          {/* Water Category Selection */}
          <div>
            <h4 className="text-sm font-display font-semibold text-[#342A4F] mb-2 flex items-center gap-1.5">
              <Droplets size={14} className="text-[#7763B7]" />
              Water Category
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {[
                { cat: 1, label: "Category 1", desc: "Clean Water", example: "Supply line break" },
                { cat: 2, label: "Category 2", desc: "Gray Water", example: "Dishwasher, washing machine" },
                { cat: 3, label: "Category 3", desc: "Black Water", example: "Sewage, flooding" },
              ].map((item) => (
                <button
                  key={item.cat}
                  onClick={() => setSelectedCategory(item.cat)}
                  className={cn(
                    "p-2.5 rounded-lg border text-left transition-all",
                    selectedCategory === item.cat
                      ? "border-[#7763B7] bg-[#7763B7]/10"
                      : "border-gray-200 hover:border-gray-300"
                  )}
                >
                  <p className="text-xs font-semibold text-[#342A4F]">{item.label}</p>
                  <p className="text-[10px] text-[#7763B7] font-medium">{item.desc}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{item.example}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Damage Class */}
          <div>
            <h4 className="text-sm font-display font-semibold text-[#342A4F] mb-2 flex items-center gap-1.5">
              <Wind size={14} className="text-[#7763B7]" />
              Damage Class
              {suggestedClass && (
                <span className="text-[10px] font-normal text-[#C6A54E] ml-1">
                  (AI suggests Class {suggestedClass})
                </span>
              )}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { cls: 1, desc: "<5% affected, low porosity materials" },
                { cls: 2, desc: "5-40% affected, carpet/cushion wet" },
                { cls: 3, desc: ">40% affected, walls wet floor to ceiling" },
                { cls: 4, desc: "Specialty: hardwood, concrete, plaster" },
              ].map((item) => (
                <button
                  key={item.cls}
                  onClick={() => setSelectedClass(item.cls)}
                  className={cn(
                    "p-2.5 rounded-lg border text-left transition-all",
                    selectedClass === item.cls
                      ? "border-[#7763B7] bg-[#7763B7]/10"
                      : suggestedClass === item.cls
                      ? "border-[#C6A54E]/50 bg-[#C6A54E]/5"
                      : "border-gray-200 hover:border-gray-300"
                  )}
                >
                  <p className="text-xs font-semibold text-[#342A4F]">Class {item.cls}</p>
                  <p className="text-[10px] text-gray-500">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Equipment Recommendations */}
          {equipmentRecommendations && (
            <div className="bg-[#7763B7]/5 border border-[#7763B7]/20 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-display font-semibold text-[#342A4F] flex items-center gap-1.5">
                <Thermometer size={14} className="text-[#7763B7]" />
                Equipment Recommendation
              </h4>

              <div className="grid grid-cols-3 gap-3">
                {equipmentRecommendations.airMovers > 0 && (
                  <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
                    <Wind size={20} className="text-[#7763B7] mx-auto mb-1" />
                    <p className="text-lg font-display font-bold text-[#342A4F]">
                      {equipmentRecommendations.airMovers}
                    </p>
                    <p className="text-[10px] text-gray-500">Air Movers</p>
                  </div>
                )}
                {equipmentRecommendations.dehumidifiers > 0 && (
                  <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
                    <Droplets size={20} className="text-[#7763B7] mx-auto mb-1" />
                    <p className="text-lg font-display font-bold text-[#342A4F]">
                      {equipmentRecommendations.dehumidifiers}
                    </p>
                    <p className="text-[10px] text-gray-500">Dehumidifiers</p>
                  </div>
                )}
                {equipmentRecommendations.airScrubbers > 0 && (
                  <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
                    <AlertTriangle size={20} className="text-[#C6A54E] mx-auto mb-1" />
                    <p className="text-lg font-display font-bold text-[#342A4F]">
                      {equipmentRecommendations.airScrubbers}
                    </p>
                    <p className="text-[10px] text-gray-500">Air Scrubbers</p>
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-600">
                <p>
                  Estimated drying duration:{" "}
                  <span className="font-semibold text-[#342A4F]">{equipmentRecommendations.dryingDays} days</span>
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Based on {equipmentRecommendations.sqft} SF area, Class {selectedClass}, Category {selectedCategory || 1}
                </p>
              </div>

              {onAddEquipment && (
                <Button
                  size="sm"
                  className="w-full bg-[#7763B7] hover:bg-[#7763B7]/90 text-white"
                  onClick={handleAddEquipment}
                >
                  <Plus size={14} className="mr-1" />
                  Add Equipment to Estimate
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
