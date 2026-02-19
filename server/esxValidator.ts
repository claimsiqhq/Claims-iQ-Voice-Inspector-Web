/**
 * esxValidator.ts
 * Pre-export validation of ESX data to ensure Xactimate compliance
 */

export interface ValidationError {
  type: "error" | "warning";
  field: string;
  itemId?: number;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  summary: string;
}

/**
 * Validates ESX data before packaging into ZIP for export
 */
export function validateESXData(params: {
  lineItems: any[];
  metadata: any;
  claim: any;
}): ValidationResult {
  const { lineItems, metadata, claim } = params;
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!metadata?.transactionId) {
    errors.push({
      type: "error",
      field: "XACTDOC.transactionId",
      message: "Transaction ID is required",
    });
  }

  if (!metadata?.claimNumber) {
    errors.push({
      type: "error",
      field: "XACTDOC.claimNumber",
      message: "Claim number is required",
    });
  }

  if (!metadata?.lossLocation?.propertyAddress) {
    errors.push({
      type: "error",
      field: "XACTDOC.lossLocation.propertyAddress",
      message: "Property address is required",
    });
  }

  if (!metadata?.peril?.dateOfLoss) {
    errors.push({
      type: "error",
      field: "XACTDOC.peril.dateOfLoss",
      message: "Date of loss is required",
    });
  }

  if (!metadata?.priceListId || metadata.priceListId === "USNATNL") {
    warnings.push({
      type: "warning",
      field: "XACTDOC.priceListId",
      message: "Price list is USNATNL (national); regional list recommended",
    });
  }

  if (metadata?.coverage?.deductibleAmount != null && metadata.coverage.deductibleAmount < 0) {
    errors.push({
      type: "error",
      field: "XACTDOC.coverage.deductibleAmount",
      message: "Deductible cannot be negative",
    });
  }

  if (
    (claim?.perilType === "wind" || claim?.perilType === "hail") &&
    !metadata?.roofInfo
  ) {
    warnings.push({
      type: "warning",
      field: "XACTDOC.roofInfo",
      message: "Roof information is missing for wind/hail claim",
    });
  }

  for (const item of lineItems) {
    const itemId = item.id;

    if (!item.description || String(item.description).trim() === "") {
      errors.push({
        type: "error",
        field: "GENERIC_ROUGHDRAFT.ITEM.description",
        itemId,
        message: `Item ${itemId}: Description is required`,
      });
    }

    if (item.quantity < 0) {
      errors.push({
        type: "error",
        field: "GENERIC_ROUGHDRAFT.ITEM.quantity",
        itemId,
        message: `Item ${itemId}: Quantity cannot be negative`,
      });
    }

    if (item.rcvTotal < 0) {
      errors.push({
        type: "error",
        field: "GENERIC_ROUGHDRAFT.ITEM.rcvTotal",
        itemId,
        message: `Item ${itemId}: RCV total cannot be negative`,
      });
    }

    if (item.acvTotal < 0) {
      errors.push({
        type: "error",
        field: "GENERIC_ROUGHDRAFT.ITEM.acvTotal",
        itemId,
        message: `Item ${itemId}: ACV total cannot be negative`,
      });
    }

    if (item.acvTotal > item.rcvTotal) {
      errors.push({
        type: "error",
        field: "GENERIC_ROUGHDRAFT.ITEM.acvTotal",
        itemId,
        message: `Item ${itemId}: ACV (${item.acvTotal}) exceeds RCV (${item.rcvTotal})`,
      });
    }

    if (item.rcvTotal > 0) {
      const materialPct = (item.material / item.rcvTotal) * 100;
      const laborPct = (item.laborTotal / item.rcvTotal) * 100;
      const equipmentPct = ((item.equipment ?? 0) / item.rcvTotal) * 100;
      const total = materialPct + laborPct + equipmentPct;

      if (Math.abs(total - 100) > 1) {
        warnings.push({
          type: "warning",
          field: "GENERIC_ROUGHDRAFT.ITEM.mle",
          itemId,
          message: `Item ${itemId}: M/L/E percentages sum to ${total.toFixed(2)}% (expected ~100%)`,
        });
      }
    }

    if (item.depreciationPercentage != null) {
      if (item.depreciationPercentage < 0 || item.depreciationPercentage > 100) {
        errors.push({
          type: "error",
          field: "GENERIC_ROUGHDRAFT.ITEM.depreciationPercentage",
          itemId,
          message: `Item ${itemId}: Depreciation percentage ${item.depreciationPercentage}% is invalid (must be 0-100)`,
        });
      }
    }

    if (!item.tradeCode && item.category !== "GEN") {
      warnings.push({
        type: "warning",
        field: "GENERIC_ROUGHDRAFT.ITEM.tradeCode",
        itemId,
        message: `Item ${itemId}: Trade code is missing`,
      });
    }
  }

  const calculatedRCV = lineItems.reduce((sum, i) => sum + i.rcvTotal, 0);
  const calculatedACV = lineItems.reduce((sum, i) => sum + i.acvTotal, 0);
  const calculatedDepreciation = lineItems.reduce(
    (sum, i) => sum + (i.depreciationAmount ?? 0),
    0
  );

  if (metadata?.summary && Math.abs(calculatedRCV - metadata.summary.totalRCV) > 0.01) {
    errors.push({
      type: "error",
      field: "XACTDOC.summary.totalRCV",
      message: `Summary total RCV ${metadata.summary.totalRCV} does not match calculated ${calculatedRCV}`,
    });
  }

  if (metadata?.summary && Math.abs(calculatedACV - metadata.summary.totalACV) > 0.01) {
    errors.push({
      type: "error",
      field: "XACTDOC.summary.totalACV",
      message: `Summary total ACV ${metadata.summary.totalACV} does not match calculated ${calculatedACV}`,
    });
  }

  if (
    metadata?.summary &&
    Math.abs(calculatedDepreciation - metadata.summary.totalDepreciation) > 0.01
  ) {
    errors.push({
      type: "error",
      field: "XACTDOC.summary.totalDepreciation",
      message: `Summary total depreciation ${metadata.summary.totalDepreciation} does not match calculated ${calculatedDepreciation}`,
    });
  }

  if (!metadata?.adjusterInfo?.name) {
    warnings.push({
      type: "warning",
      field: "XACTDOC.adjusterInfo.name",
      message: "Adjuster name is missing",
    });
  }

  const isValid = errors.length === 0;
  const summary = `Validation ${isValid ? "passed" : "failed"}: ${errors.length} errors, ${warnings.length} warnings`;

  return {
    isValid,
    errors,
    warnings,
    summary,
  };
}

export function validateMLEPercentages(
  material: number,
  labor: number,
  equipment: number
): boolean {
  const total = material + labor + equipment;
  return Math.abs(total - 100) <= 1;
}

export function validateACVvsRCV(rcv: number, acv: number): boolean {
  return acv <= rcv + 0.01;
}

export function validateDepreciationPercentage(percentage: number): boolean {
  return percentage >= 0 && percentage <= 100;
}
