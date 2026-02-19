/**
 * PROMPT-30 Part B: RoomProvenanceIndicator component
 * Displays a visual warning when room dimensions are defaulted
 */

import React from "react";
import type { DimensionProvenance } from "@/lib/types/roomPolygon";

interface RoomProvenanceIndicatorProps {
  provenance?: DimensionProvenance;
  compact?: boolean;
}

const RoomProvenanceIndicator: React.FC<RoomProvenanceIndicatorProps> = ({
  provenance,
  compact = false,
}) => {
  if (!provenance) return null;

  const hasDefaults = Object.values(provenance).some((v) => v === "defaulted");
  if (!hasDefaults) return null;

  const defaultedDims = Object.entries(provenance)
    .filter(([, v]) => v === "defaulted")
    .map(([k]) => k);
  const tooltipText = `Default dimensions: ${defaultedDims.join(", ")}. Provide actual measurements to update.`;

  if (compact) {
    return (
      <span title={tooltipText} style={{ cursor: "help", fontSize: "16px" }}>
        ⚠️
      </span>
    );
  }

  return (
    <div
      style={{
        padding: "8px 12px",
        backgroundColor: "#fff3cd",
        border: "1px solid #ffc107",
        borderRadius: "4px",
        marginBottom: "12px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <span style={{ fontSize: "18px" }}>⚠️</span>
      <div>
        <strong style={{ color: "#856404" }}>Default dimensions applied</strong>
        <div style={{ fontSize: "12px", color: "#856404" }}>
          {defaultedDims.join(", ")} using defaults. Provide actual measurements to update.
        </div>
      </div>
    </div>
  );
};

export default RoomProvenanceIndicator;
