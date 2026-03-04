import { type Claim } from "@shared/schema";
import { logger } from "./logger";

export type PriorityLevel = "critical" | "high" | "normal" | "low";

export interface UrgencyScore {
  score: number;
  priority: PriorityLevel;
  slaDeadline: Date;
  factors: string[];
}

const PERIL_URGENCY: Record<string, number> = {
  water: 90,
  fire: 85,
  flood: 80,
  tornado: 75,
  hurricane: 75,
  collapse: 70,
  vandalism: 50,
  hail: 40,
  wind: 40,
  lightning: 35,
  theft: 30,
  other: 20,
};

const SLA_HOURS: Record<PriorityLevel, number> = {
  critical: 24,
  high: 48,
  normal: 72,
  low: 120,
};

function priorityFromScore(score: number): PriorityLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "normal";
  return "low";
}

function daysSinceLoss(dateOfLoss: string | null | undefined): number | null {
  if (!dateOfLoss) return null;
  const parsed = new Date(dateOfLoss);
  if (isNaN(parsed.getTime())) return null;
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24)));
}

export function computeUrgency(claim: Partial<Claim>): UrgencyScore {
  let score = 0;
  const factors: string[] = [];

  const perilKey = (claim.perilType || "other").toLowerCase();
  const perilScore = PERIL_URGENCY[perilKey] ?? PERIL_URGENCY.other;
  score += perilScore * 0.5;
  factors.push(`peril:${perilKey}(${perilScore})`);

  const elapsed = daysSinceLoss(claim.dateOfLoss);
  if (elapsed !== null) {
    if (elapsed <= 1) {
      score += 30;
      factors.push("loss<24h(+30)");
    } else if (elapsed <= 3) {
      score += 20;
      factors.push("loss<3d(+20)");
    } else if (elapsed <= 7) {
      score += 10;
      factors.push("loss<7d(+10)");
    } else if (elapsed > 14) {
      score += 5;
      factors.push("loss>14d(+5_aging)");
    }
  }

  if (perilKey === "water" || perilKey === "flood") {
    score += 10;
    factors.push("mitigation_urgency(+10)");
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  const priority = priorityFromScore(score);
  const slaHours = SLA_HOURS[priority];
  const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);

  return { score, priority, slaDeadline, factors };
}

export function computeSlaDeadline(priority: PriorityLevel): Date {
  const hours = SLA_HOURS[priority];
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function applySlaToClaimData<T extends Record<string, any>>(
  claimData: T,
): Promise<T> {
  try {
    const urgency = computeUrgency(claimData as Partial<Claim>);
    if (!claimData.priority || claimData.priority === "normal") {
      claimData.priority = urgency.priority;
    }
    if (!claimData.slaDeadline) {
      claimData.slaDeadline = urgency.slaDeadline;
    }
    logger.info(`SLA computed: score=${urgency.score} priority=${urgency.priority} factors=[${urgency.factors.join(",")}]`);
  } catch (err) {
    logger.warn("SLA computation failed, using defaults", err);
  }
  return claimData;
}

export function recalculateUrgency(claim: Claim): UrgencyScore {
  return computeUrgency(claim);
}

export async function generateSlaNotifications(userId: string): Promise<void> {
  const { storage } = await import("./storage");

  try {
    const allClaims = await storage.getClaimsForUser(userId);
    const activeClaims = allClaims.filter(
      (c) => !["completed", "closed", "cancelled"].includes(c.status.toLowerCase())
    );

    const existingNotifications = await storage.getNotifications(userId);
    const existingKeys = new Set(
      existingNotifications.map((n) => `${n.claimId}:${n.type}`)
    );

    const thresholds = [
      { hours: 1, type: "sla_critical", title: "SLA Critical" },
      { hours: 8, type: "sla_warning", title: "SLA Warning" },
      { hours: 24, type: "sla_approaching", title: "SLA Approaching" },
    ];

    for (const claim of activeClaims) {
      if (!claim.slaDeadline) continue;

      const hoursRemaining =
        (new Date(claim.slaDeadline).getTime() - Date.now()) / 3600000;

      if (hoursRemaining <= 0 || hoursRemaining > 24) continue;

      for (const threshold of thresholds) {
        if (hoursRemaining < threshold.hours) {
          const key = `${claim.id}:${threshold.type}`;
          if (!existingKeys.has(key)) {
            await storage.createNotification({
              userId,
              type: threshold.type,
              title: threshold.title,
              message: `Claim ${claim.claimNumber} – ${claim.insuredName || "Unknown"} has less than ${threshold.hours}h remaining on SLA deadline.`,
              claimId: claim.id,
              read: false,
            });
            existingKeys.add(key);
          }
          break;
        }
      }
    }
  } catch (err) {
    logger.warn("Failed to generate SLA notifications", err);
  }
}
