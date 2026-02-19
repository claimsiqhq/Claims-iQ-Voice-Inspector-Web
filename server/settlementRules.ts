// ── Settlement Rules Engine ──

/**
 * SettlementRules defines carrier-specific and claim-specific rules for settlement calculation.
 *
 * This replaces hardcoded values throughout the codebase with a rules-based approach:
 * - O&P threshold: varies by carrier (2 vs 3 trades)
 * - O&P taxation: always false per Xactimate; included for explicit carrier override
 * - Labor taxation: varies by state/jurisdiction
 * - Depreciation basis: determines what portion of RCV gets deprecated
 * - Tax rate: read from claim/policy, not hardcoded fallback
 * - Labor efficiency: optional multiplier for labor cost adjustments
 */
export interface SettlementRules {
  opThreshold: number;
  taxOnOP: boolean;
  taxOnLabor: boolean;
  depreciationBasis: "rcv_full" | "rcv_before_op" | "materials_only";
  defaultTaxRate: number;
  laborEfficiency: number;
  overheadPercentage: number;
  profitPercentage: number;
  opExcludedTrades: string[];
  applyRoofDepreciationSchedule: boolean;
  carrierCode: string;
  description: string;
}

/**
 * Factory function: resolves settlement rules from claim + policy data.
 */
export async function resolveSettlementRules(
  claimId: string,
  carrierCode: string | null,
  overrides?: Partial<SettlementRules>
): Promise<SettlementRules> {
  let rules = getDefaultSettlementRules();

  if (carrierCode) {
    const carrierRules = await loadCarrierSettlementRules(carrierCode);
    if (carrierRules) {
      rules = { ...rules, ...carrierRules };
    }
  }

  try {
    const claim = await loadClaimTaxInfo(claimId);
    if (claim?.taxRate != null) {
      rules.defaultTaxRate = claim.taxRate;
    }
  } catch {
    // Claim not found; continue with current rate
  }

  if (overrides) {
    rules = { ...rules, ...overrides };
  }

  return rules;
}

export function getDefaultSettlementRules(): SettlementRules {
  return {
    opThreshold: 3,
    taxOnOP: false,
    taxOnLabor: true,
    depreciationBasis: "rcv_full",
    defaultTaxRate: 8,
    laborEfficiency: 100,
    overheadPercentage: 10,
    profitPercentage: 10,
    opExcludedTrades: [],
    applyRoofDepreciationSchedule: false,
    carrierCode: "DEFAULT",
    description: "Xactimate-standard defaults (Replacement Cost Value basis)",
  };
}

const CARRIER_RULES: Map<string, Partial<SettlementRules>> = new Map([
  [
    "CARRIER_STATE_FARM",
    {
      opThreshold: 3,
      taxOnOP: false,
      taxOnLabor: false,
      depreciationBasis: "rcv_before_op",
      overheadPercentage: 12,
      profitPercentage: 8,
      opExcludedTrades: ["MIT"],
      applyRoofDepreciationSchedule: true,
      description: "State Farm (FL-specific): non-taxable labor, roof depreciation",
    },
  ],
  [
    "CARRIER_ALLSTATE",
    {
      opThreshold: 2,
      taxOnOP: false,
      taxOnLabor: true,
      depreciationBasis: "rcv_before_op",
      overheadPercentage: 10,
      profitPercentage: 10,
      opExcludedTrades: ["MIT", "DEM"],
      applyRoofDepreciationSchedule: false,
      description: "Allstate: 2-trade O&P threshold, non-taxable O&P",
    },
  ],
  [
    "CARRIER_HOMEOWNERS_STANDARD",
    {
      opThreshold: 3,
      taxOnOP: false,
      taxOnLabor: true,
      depreciationBasis: "rcv_full",
      overheadPercentage: 15,
      profitPercentage: 15,
      opExcludedTrades: [],
      applyRoofDepreciationSchedule: false,
      description: "Standard homeowners (high O&P rates)",
    },
  ],
]);

async function loadCarrierSettlementRules(
  carrierCode: string
): Promise<Partial<SettlementRules> | null> {
  const cached = CARRIER_RULES.get(carrierCode.toUpperCase());
  return cached ?? null;
}

async function loadClaimTaxInfo(_claimId: string): Promise<{ taxRate?: number } | null> {
  // Future: read from claim.taxRate or policy.taxRate in database
  return null;
}

export function validateSettlementRules(rules: SettlementRules): void {
  const errors: string[] = [];

  if (rules.opThreshold < 1) {
    errors.push("opThreshold must be >= 1");
  }
  if (rules.defaultTaxRate < 0 || rules.defaultTaxRate > 100) {
    errors.push("defaultTaxRate must be between 0 and 100");
  }
  if (rules.laborEfficiency <= 0 || rules.laborEfficiency > 200) {
    errors.push("laborEfficiency must be between 0.1 and 200");
  }
  if (!["rcv_full", "rcv_before_op", "materials_only"].includes(rules.depreciationBasis)) {
    errors.push(
      `depreciationBasis must be one of: rcv_full, rcv_before_op, materials_only`
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid SettlementRules:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}

/**
 * Calculates the taxable base for a line item.
 * Xactimate-compliant: O&P is NEVER included in taxable base (unless rules.taxOnOP = true).
 */
export function calculateTaxableBase(
  totalPrice: number,
  laborPortion: number,
  opAmount: number,
  rules: SettlementRules
): number {
  let taxableBase = totalPrice;

  if (!rules.taxOnLabor) {
    taxableBase -= laborPortion;
  }

  if (rules.taxOnOP) {
    taxableBase += opAmount;
  }

  return Math.max(0, taxableBase);
}

/**
 * Determines the depreciation basis for a line item.
 */
export function calculateDepreciationBasis(
  rcv: number,
  taxAmount: number,
  opAmount: number,
  materialCost: number | null,
  rules: SettlementRules
): number {
  switch (rules.depreciationBasis) {
    case "rcv_full":
      return rcv;
    case "rcv_before_op":
      return rcv - opAmount;
    case "materials_only":
      return materialCost ?? rcv;
    default:
      return rcv;
  }
}

/**
 * Resolves the tax rate for a line item.
 */
export function resolveTaxRateWithRules(
  category: string,
  rules: SettlementRules,
  taxRules?: Array<{
    category: string;
    taxRate: number;
    costType: "all" | "materials_only" | "labor_only";
  }>
): number {
  if (!taxRules || taxRules.length === 0) {
    return rules.defaultTaxRate / 100;
  }

  const catLower = (category || "").toLowerCase();

  for (const rule of taxRules) {
    const ruleCat = (rule.category || "").toLowerCase();
    if (ruleCat && (catLower.includes(ruleCat) || ruleCat.includes(catLower))) {
      return rule.taxRate / 100;
    }
  }

  return rules.defaultTaxRate / 100;
}

/**
 * Checks whether a trade qualifies for O&P.
 */
export function tradeQualifiesForOP(
  tradesInvolved: string[],
  tradeCode: string,
  rules: SettlementRules
): boolean {
  if (tradesInvolved.length < rules.opThreshold) {
    return false;
  }
  if (rules.opExcludedTrades.includes(tradeCode.toUpperCase())) {
    return false;
  }
  return true;
}
