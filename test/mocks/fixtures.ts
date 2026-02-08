/**
 * Mock catalog item — matches the shape returned by db.select().from(scopeLineItems)
 */
export function makeCatalogItem(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    code: 'DRY-12-SF',
    description: '1/2" drywall - hung, taped, floated, ready for paint',
    unit: 'SF',
    tradeCode: 'DRY',
    defaultWasteFactor: 10,
    laborMinimum: null,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock regional price — matches the shape returned by db.select().from(regionalPriceSets)
 */
export function makeRegionalPrice(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    lineItemCode: 'DRY-12-SF',
    regionId: 'US_NATIONAL',
    materialCost: 0.52,
    laborCost: 0.92,
    equipmentCost: 0.06,
    totalUnitPrice: 1.50,
    effectiveDate: '2025-01-01',
    source: 'verisk',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Helper to build a PricedLineItem for calculateEstimateTotals tests.
 * Accepts just the fields that matter for totals calculation.
 */
export function makePricedItem(overrides: Record<string, any> = {}) {
  return {
    code: 'DRY-12-SF',
    description: '1/2" drywall',
    unit: 'SF',
    quantity: 100,
    unitPriceBreakdown: {
      materialCost: 0.572,   // 0.52 * 1.10 (10% waste)
      laborCost: 1.012,      // 0.92 * 1.10
      equipmentCost: 0.066,  // 0.06 * 1.10
      wasteFactor: 10,
      unitPrice: 1.65,       // (0.52+0.92+0.06) * 1.10
    },
    totalPrice: 165.0,       // 1.65 * 100
    tradeCode: 'DRY',
    ...overrides,
  };
}

/**
 * Mock claim object
 */
export function makeClaim(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    claimNumber: 'CLM-2025-001',
    insuredName: 'Jane Smith',
    propertyAddress: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    dateOfLoss: '2025-01-15',
    perilType: 'water',
    status: 'in_progress',
    createdAt: new Date(),
    assignedTo: 'user-1',
    ...overrides,
  };
}

/**
 * Mock inspection session
 */
export function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    claimId: 1,
    status: 'active',
    currentPhase: 1,
    currentRoomId: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock structure (L1 hierarchy)
 */
export function makeStructure(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    sessionId: 1,
    name: 'Main Dwelling',
    structureType: 'dwelling',
    outline: null,
    position: null,
    sortOrder: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock inspection room (L2/L3 hierarchy)
 */
export function makeRoom(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    sessionId: 1,
    name: 'Kitchen',
    structure: 'Main Dwelling',
    structureId: 1,
    roomType: 'interior_kitchen',
    viewType: 'interior',
    shapeType: 'rectangle',
    parentRoomId: null,
    attachmentType: null,
    status: 'completed',
    dimensions: { length: 12, width: 10, height: 8 },
    polygon: null,
    position: null,
    floor: 1,
    facetLabel: null,
    pitch: null,
    damageCount: 2,
    photoCount: 3,
    createdAt: new Date(),
    completedAt: null,
    phase: null,
    ...overrides,
  };
}

/**
 * Mock room opening (L4 deduction)
 */
export function makeRoomOpening(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    roomId: 1,
    openingType: 'door',
    wallIndex: 0,
    positionOnWall: 0.5,
    width: 3.0,
    height: 6.67,
    label: 'Entry Door',
    opensInto: 'exterior',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock sketch annotation (L5 metadata)
 */
export function makeSketchAnnotation(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    roomId: 1,
    annotationType: 'hail_count',
    label: 'Hail Hits',
    value: '8',
    location: 'Front Slope (F1)',
    position: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock line item (as stored in DB)
 */
export function makeLineItem(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    sessionId: 1,
    roomId: 1,
    description: '1/2" drywall - hung, taped, floated',
    category: 'Drywall',
    action: 'R&R',
    quantity: 100,
    unit: 'SF',
    unitPrice: 1.65,
    totalPrice: 165.0,
    xactCode: 'DRY-12-SF',
    depreciation: 16.5,
    depreciationType: 'Recoverable',
    source: 'voice_agent',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock damage observation
 */
export function makeDamage(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    roomId: 1,
    sessionId: 1,
    description: 'Water staining on ceiling drywall',
    damageType: 'water_damage',
    severity: 'moderate',
    location: 'ceiling',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock photo
 */
export function makePhoto(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    sessionId: 1,
    roomId: 1,
    caption: 'Water damage on ceiling',
    photoType: 'damage_detail',
    storagePath: '/photos/1.jpg',
    analysis: { description: 'Visible water staining on drywall ceiling' },
    autoTag: 'water_damage',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock moisture reading
 */
export function makeMoistureReading(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    roomId: 1,
    sessionId: 1,
    location: 'North wall, 2ft from floor',
    materialType: 'drywall',
    reading: 28.5,
    dryStandard: 15,
    isElevated: true,
    createdAt: new Date(),
    ...overrides,
  };
}
