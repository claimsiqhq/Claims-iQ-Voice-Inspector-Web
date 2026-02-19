/**
 * Water Damage Classification Protocol (IICRC-compliant)
 *
 * 7-step questioning flow for voice agent water damage assessment.
 * Integrates with CompanionEngine and water-aware depreciation.
 */

import type { WaterClassification } from "./companionEngine";
import { storage } from "./storage";
import { logger } from "./logger";

export interface WaterProtocolResponses {
  waterSource: string;
  standingWaterStart?: Date;
  standingWaterEnd?: Date;
  affectedArea?: number;
  visibleContamination: boolean;
  affectedMaterials?: string;
  notes?: string;
}

export interface WaterProtocolQuestion {
  step: number;
  question: string;
  examples?: string[];
  field: keyof WaterProtocolResponses;
  format: "text" | "datetime" | "number" | "boolean";
}

export interface WaterClassificationResult {
  classification: WaterClassification;
  companionsTriggered: string[];
}

const SOURCE_MAP: Record<string, "clean" | "gray" | "black"> = {
  "supply line": "clean",
  supply: "clean",
  rain: "clean",
  sprinkler: "clean",
  "washing machine": "gray",
  dishwasher: "gray",
  "dish washer": "gray",
  sink: "gray",
  sewer: "black",
  toilet: "black",
  flood: "black",
};

export function getWaterProtocolQuestions(): WaterProtocolQuestion[] {
  return [
    {
      step: 1,
      question: "What was the source of the water damage?",
      examples: ["supply line break", "washing machine overflow", "sewer backup", "rain/flood"],
      field: "waterSource",
      format: "text",
    },
    {
      step: 2,
      question: "When did the water first appear?",
      field: "standingWaterStart",
      format: "datetime",
    },
    {
      step: 3,
      question: "When was the water completely removed?",
      field: "standingWaterEnd",
      format: "datetime",
    },
    {
      step: 4,
      question: "What is the approximate affected area in square feet?",
      field: "affectedArea",
      format: "number",
    },
    {
      step: 5,
      question: "Do you see visible contamination (discoloration, odor, growth)?",
      field: "visibleContamination",
      format: "boolean",
    },
    {
      step: 6,
      question: "What materials are affected? (drywall, carpet, wood, concrete)",
      field: "affectedMaterials",
      format: "text",
    },
    {
      step: 7,
      question: "Any additional notes about the water damage?",
      field: "notes",
      format: "text",
    },
  ];
}

function inferSource(source: string): "clean" | "gray" | "black" {
  const lower = source.toLowerCase().trim();
  for (const [key, value] of Object.entries(SOURCE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return "gray";
}

function assessContaminationLevel(
  category: 1 | 2 | 3,
  standingDays: number,
  visibleContamination: boolean
): "low" | "medium" | "high" {
  if (category === 3) return "high";
  if (category === 2 && (standingDays > 24 || visibleContamination)) return "high";
  if (category === 2 && standingDays > 12) return "medium";
  return "low";
}

function isDryingPossible(
  category: 1 | 2 | 3,
  standingDays: number,
  affectedArea: number
): boolean {
  if (category === 3) return false;
  if (category === 2 && standingDays > 2) return false;
  if (affectedArea > 1000 && standingDays > 24) return false;
  return true;
}

function determineWaterClass(
  affectedArea: number,
  standingDays: number,
  dryingPossible: boolean
): 1 | 2 | 3 | 4 {
  if (!dryingPossible) return 4;
  if (affectedArea > 300) return 3;
  if (affectedArea > 24) return 2;
  return 1;
}

/**
 * Process water damage protocol responses and produce classification.
 */
export function processWaterDamageResponses(
  responses: WaterProtocolResponses
): WaterClassification {
  const source = inferSource(responses.waterSource);
  const categoryMap = { clean: 1, gray: 2, black: 3 } as const;
  const category = categoryMap[source];

  const start = responses.standingWaterStart
    ? new Date(responses.standingWaterStart)
    : new Date();
  const end = responses.standingWaterEnd ? new Date(responses.standingWaterEnd) : new Date();
  const standingDays = Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  );

  const affectedArea = responses.affectedArea ?? 0;
  const contaminationLevel = assessContaminationLevel(
    category,
    standingDays,
    responses.visibleContamination
  );
  const dryingPossible = isDryingPossible(category, standingDays, affectedArea);
  const waterClass = determineWaterClass(affectedArea, standingDays, dryingPossible);

  return {
    category,
    waterClass,
    source,
    contaminationLevel,
    dryingPossible,
    classifiedAt: new Date(),
    notes: responses.notes,
  };
}

/**
 * Store water classification on session and return result.
 */
export async function handleWaterDamageProtocol(
  sessionId: number,
  responses: WaterProtocolResponses
): Promise<WaterClassificationResult> {
  const classification = processWaterDamageResponses(responses);

  await storage.updateSession(sessionId, {
    waterClassification: classification as unknown as Record<string, unknown>,
  });

  const companionsTriggered: string[] = [];
  if (classification.category === 3) {
    companionsTriggered.push("cat3-001", "cat3-002");
  }

  logger.info("Water damage protocol processed", {
    sessionId,
    category: classification.category,
    waterClass: classification.waterClass,
    source: classification.source,
  });

  return { classification, companionsTriggered };
}
