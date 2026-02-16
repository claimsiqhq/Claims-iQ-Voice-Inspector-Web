type CategoryEntry = {
  keywords: Array<{ match: string; life: number }>;
  default: number;
};

export const LIFE_EXPECTANCY_TABLE: Record<string, CategoryEntry> = {
  roofing: {
    keywords: [
      { match: "3-tab composition shingles", life: 20 },
      { match: "laminated/architectural shingles", life: 30 },
      { match: "metal roofing", life: 50 },
      { match: "tile roofing", life: 50 },
      { match: "flat/modified bitumen", life: 20 },
      { match: "wood shake/shingle", life: 30 },
      { match: "roofing felt", life: 30 },
      { match: "ice & water barrier", life: 30 },
      { match: "ridge vent", life: 25 },
      { match: "drip edge", life: 25 },
      { match: "flashing", life: 25 },
    ],
    default: 25,
  },
  siding: {
    keywords: [
      { match: "vinyl siding", life: 40 },
      { match: "aluminum siding", life: 40 },
      { match: "wood siding", life: 30 },
      { match: "fiber cement/hardie", life: 50 },
      { match: "stucco", life: 50 },
      { match: "brick", life: 100 },
    ],
    default: 35,
  },
  "soffit/fascia": {
    keywords: [
      { match: "aluminum", life: 30 },
      { match: "vinyl", life: 30 },
      { match: "wood", life: 20 },
    ],
    default: 25,
  },
  gutters: {
    keywords: [
      { match: "aluminum", life: 20 },
      { match: "copper", life: 50 },
      { match: "vinyl", life: 15 },
      { match: "steel", life: 20 },
    ],
    default: 20,
  },
  windows: {
    keywords: [
      { match: "vinyl window", life: 30 },
      { match: "wood window", life: 30 },
      { match: "aluminum window", life: 25 },
    ],
    default: 30,
  },
  doors: {
    keywords: [
      { match: "exterior door", life: 30 },
      { match: "interior door", life: 50 },
      { match: "garage door", life: 25 },
      { match: "storm door", life: 20 },
    ],
    default: 30,
  },
  drywall: {
    keywords: [],
    default: 70,
  },
  painting: {
    keywords: [
      { match: "interior", life: 7 },
      { match: "exterior", life: 7 },
    ],
    default: 7,
  },
  flooring: {
    keywords: [
      { match: "carpet", life: 10 },
      { match: "hardwood", life: 50 },
      { match: "laminate", life: 15 },
      { match: "tile", life: 50 },
      { match: "vinyl/lvp", life: 20 },
    ],
    default: 20,
  },
  plumbing: {
    keywords: [],
    default: 40,
  },
  electrical: {
    keywords: [],
    default: 40,
  },
  hvac: {
    keywords: [],
    default: 15,
  },
  fencing: {
    keywords: [
      { match: "wood fence", life: 15 },
      { match: "vinyl fence", life: 30 },
      { match: "chain link", life: 20 },
      { match: "wrought iron", life: 50 },
    ],
    default: 20,
  },
  cabinetry: {
    keywords: [],
    default: 50,
  },
  debris: {
    keywords: [],
    default: 0,
  },
  general: {
    keywords: [],
    default: 0,
  },
};

export function lookupLifeExpectancy(category: string, description: string): number {
  const catLower = category.toLowerCase().trim();
  const descLower = description.toLowerCase().trim();

  const entry = LIFE_EXPECTANCY_TABLE[catLower];
  if (!entry) return 0;

  for (const kw of entry.keywords) {
    if (descLower.includes(kw.match)) {
      return kw.life;
    }
  }

  return entry.default;
}

export function calculateDepreciation(params: {
  totalPrice: number;
  age?: number | null;
  lifeExpectancy?: number | null;
  category?: string;
  description?: string;
  depreciationType?: string;
}): {
  lifeExpectancy: number;
  depreciationPercentage: number;
  depreciationAmount: number;
} {
  if (params.depreciationType === "Paid When Incurred") {
    return { lifeExpectancy: 0, depreciationPercentage: 0, depreciationAmount: 0 };
  }

  const lifeExpectancy =
    params.lifeExpectancy != null
      ? params.lifeExpectancy
      : lookupLifeExpectancy(params.category || "", params.description || "");

  if (!params.age) {
    return { lifeExpectancy, depreciationPercentage: 0, depreciationAmount: 0 };
  }

  if (lifeExpectancy === 0) {
    return { lifeExpectancy: 0, depreciationPercentage: 0, depreciationAmount: 0 };
  }

  const depreciationPercentage = Math.round(Math.min(100, (params.age / lifeExpectancy) * 100) * 100) / 100;
  const depreciationAmount = Math.round(params.totalPrice * depreciationPercentage / 100 * 100) / 100;

  return { lifeExpectancy, depreciationPercentage, depreciationAmount };
}
