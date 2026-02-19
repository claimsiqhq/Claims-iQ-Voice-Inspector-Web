/**
 * xactdocMetadata.ts
 * Complete metadata structure for XACTDOC.XML generation
 * Ensures ESX files include all fields required for Xactimate import validation
 */

/**
 * Complete metadata structure for XACTDOC generation
 */
export interface XactdocMetadata {
  transactionId: string;
  claimNumber: string;
  policyNumber: string;
  carrierName: string;
  estimateType: "ESTIMATE" | "SUPPLEMENT";

  peril: {
    type: string;
    severity: string;
    affectedAreas: string[];
    dateOfLoss: string;
    dateDiscovered?: string;
    dateReported?: string;
  };

  lossLocation: {
    propertyAddress: string;
    city: string;
    state: string;
    zip: string;
    county?: string;
    latitude?: number;
    longitude?: number;
    propertyType: string;
    yearBuilt?: number;
    squareFootage?: number;
  };

  lossDetails: {
    causeOfLoss: string;
    catastrophicIndicator: boolean;
    estimatedOccupancyImpact?: string;
    salvageOpportunity: boolean;
  };

  coverage: {
    coverageALimit: number;
    coverageBLimit: number;
    coverageCLimit: number;
    coverageDLimit: number;
    coverageELimit: number;
    coverageFLimit: number;
    deductibleType: string;
    deductibleAmount: number;
    coinsurancePercentage: number;
  };

  roofInfo?: {
    roofType: string;
    roofAge: number;
    roofMaterial: string;
    roofSlope: string;
    squareFootage: number;
    condition: string;
  };

  adjusterInfo: {
    name: string;
    company: string;
    licenseNumber?: string;
    phoneNumber?: string;
    email?: string;
    licenseState?: string;
  };

  inspectorInfo: {
    name: string;
    company: string;
    inspectionDate: string;
    phoneNumber?: string;
    email?: string;
  };

  insuredInfo: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    homePhone?: string;
    cellPhone?: string;
    email?: string;
  };

  priceListId: string;
  laborEfficiency: number;
  depreciationType: string;

  summary: {
    totalRCV: number;
    totalACV: number;
    totalDepreciation: number;
    totalMaterial: number;
    totalLabor: number;
    totalEquipment: number;
    lineItemCount: number;
  };

  supplemental?: {
    originalEstimateDate?: string;
    supplementalReason: string;
    supplementalNumber: number;
    previousRCV?: number;
    addedRCV?: number;
  };
}

interface LineItemForSummary {
  rcvTotal: number;
  acvTotal: number;
  material: number;
  laborTotal: number;
  equipment?: number;
  depreciationAmount?: number;
}

/**
 * Build complete XactdocMetadata from claim, session, and briefing data
 */
export function buildXactdocMetadata(params: {
  claim: any;
  session: any;
  briefing?: any;
  lineItemsXML: LineItemForSummary[];
  isSupplemental?: boolean;
  supplementalReason?: string;
  adjusterData?: any;
}): XactdocMetadata {
  const {
    claim,
    session,
    briefing,
    lineItemsXML,
    isSupplemental,
    supplementalReason,
    adjusterData,
  } = params;

  const summary = {
    totalRCV: lineItemsXML.reduce((sum, i) => sum + i.rcvTotal, 0),
    totalACV: lineItemsXML.reduce((sum, i) => sum + i.acvTotal, 0),
    totalDepreciation: lineItemsXML.reduce((sum, i) => sum + (i.depreciationAmount ?? 0), 0),
    totalMaterial: lineItemsXML.reduce((sum, i) => sum + i.material, 0),
    totalLabor: lineItemsXML.reduce((sum, i) => sum + i.laborTotal, 0),
    totalEquipment: lineItemsXML.reduce((sum, i) => sum + (i.equipment ?? 0), 0),
    lineItemCount: lineItemsXML.length,
  };

  const transactionId = `CLAIMSIQ-${claim?.claimNumber ?? "EST"}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    transactionId,
    claimNumber: claim?.claimNumber ?? "",
    policyNumber: briefing?.coverageSnapshot?.policyNumber ?? claim?.policyNumber ?? "",
    carrierName: claim?.carrierName ?? "Claims IQ",
    estimateType: isSupplemental ? "SUPPLEMENT" : "ESTIMATE",

    peril: {
      type: (claim?.perilType ?? "water") as string,
      severity: claim?.perilSeverity ?? "moderate",
      affectedAreas: claim?.affectedRooms ?? [],
      dateOfLoss: claim?.dateOfLoss ?? new Date().toISOString().split("T")[0],
      dateDiscovered: claim?.dateDiscovered,
      dateReported: claim?.dateReported,
    },

    lossLocation: {
      propertyAddress: claim?.propertyAddress ?? "",
      city: claim?.city ?? "",
      state: claim?.state ?? "",
      zip: claim?.zip ?? "",
      county: claim?.county,
      latitude: claim?.latitude,
      longitude: claim?.longitude,
      propertyType: claim?.propertyType ?? "residential",
      yearBuilt: claim?.yearBuilt,
      squareFootage: claim?.squareFootage,
    },

    lossDetails: {
      causeOfLoss: claim?.causeOfLoss ?? `${claim?.perilType ?? "water"} damage to property`,
      catastrophicIndicator: claim?.isCatastrophic ?? false,
      estimatedOccupancyImpact: claim?.occupancyImpact,
      salvageOpportunity: claim?.hasSalvage ?? false,
    },

    coverage: {
      coverageALimit: briefing?.coverageSnapshot?.coverageALimit ?? 0,
      coverageBLimit: briefing?.coverageSnapshot?.coverageBLimit ?? 0,
      coverageCLimit: briefing?.coverageSnapshot?.coverageCLimit ?? 0,
      coverageDLimit: briefing?.coverageSnapshot?.coverageDLimit ?? 0,
      coverageELimit: briefing?.coverageSnapshot?.coverageELimit ?? 0,
      coverageFLimit: briefing?.coverageSnapshot?.coverageFLimit ?? 0,
      deductibleType: briefing?.coverageSnapshot?.deductibleType ?? "standard",
      deductibleAmount: Number(briefing?.coverageSnapshot?.deductible ?? 0) || 0,
      coinsurancePercentage: briefing?.coverageSnapshot?.coinsurance ?? 80,
    },

    roofInfo: claim?.roofInfo
      ? {
          roofType: claim.roofInfo.roofType ?? "",
          roofAge: claim.roofInfo.roofAge ?? 0,
          roofMaterial: claim.roofInfo.roofMaterial ?? "",
          roofSlope: claim.roofInfo.roofSlope ?? "6:12",
          squareFootage: claim.roofInfo.squareFootage ?? 0,
          condition: claim.roofInfo.condition ?? "unknown",
        }
      : undefined,

    adjusterInfo: {
      name: adjusterData?.name ?? claim?.adjusterName ?? "Claims IQ Adjuster",
      company: adjusterData?.company ?? claim?.adjustingCompany ?? "Claims IQ",
      licenseNumber: adjusterData?.licenseNumber,
      phoneNumber: adjusterData?.phoneNumber,
      email: adjusterData?.email,
      licenseState: adjusterData?.licenseState,
    },

    inspectorInfo: {
      name: session?.inspectorName ?? "Voice Inspector",
      company: "Claims IQ",
      inspectionDate: new Date().toISOString().split("T")[0],
      phoneNumber: session?.inspectorPhone,
      email: session?.inspectorEmail,
    },

    insuredInfo: {
      name: claim?.insuredName ?? "",
      address: claim?.propertyAddress ?? "",
      city: claim?.city ?? "",
      state: claim?.state ?? "",
      zip: claim?.zip ?? "",
      homePhone: claim?.homePhone,
      cellPhone: claim?.cellPhone,
      email: claim?.email,
    },

    priceListId: claim?.regionalPriceListId ?? briefing?.priceListId ?? "USNATNL",
    laborEfficiency: 100,
    depreciationType:
      claim?.perilType === "water"
        ? "Recoverable"
        : (claim?.depreciationType ?? "Standard"),

    summary,

    supplemental: isSupplemental
      ? {
          supplementalReason: supplementalReason ?? "Additional items discovered",
          supplementalNumber: 1,
          previousRCV: claim?.previousRCV,
          addedRCV: summary.totalRCV,
        }
      : undefined,
  };
}
