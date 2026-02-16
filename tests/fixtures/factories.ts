/**
 * Factory functions for creating test data.
 * Each factory returns a valid object with sensible defaults.
 * Override any field by passing partial data.
 */

let idCounter = 1;
function nextId() {
  return idCounter++;
}

export function resetIdCounter() {
  idCounter = 1;
}

export function buildClaim(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    claimNumber: `CLM-${String(id).padStart(5, "0")}`,
    insuredName: "John Doe",
    propertyAddress: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    dateOfLoss: "2025-03-15",
    perilType: "hail",
    status: "active",
    assignedTo: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildSession(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    claimId: overrides.claimId ?? 1,
    status: "active",
    currentPhase: 1,
    currentStructure: "main",
    currentRoomId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    roomCount: 0,
    damageCount: 0,
    photoCount: 0,
    lineItemCount: 0,
    ...overrides,
  };
}

export function buildRoom(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    name: `Room ${id}`,
    roomType: "bedroom",
    structure: "main",
    dimensions: null,
    phase: 3,
    isComplete: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildDamage(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    roomId: overrides.roomId ?? 1,
    description: "Water staining on ceiling",
    damageType: "water_stain",
    severity: "moderate",
    location: "ceiling center",
    sourcePhotoId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildLineItem(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    roomId: overrides.roomId ?? 1,
    damageId: overrides.damageId ?? null,
    category: "Drywall",
    action: "Remove & Replace",
    description: "Drywall - Remove & Replace 1/2\"",
    xactCode: "DRY-RR12",
    quantity: 48,
    unit: "SF",
    unitPrice: 3.25,
    totalPrice: 156.0,
    depreciationType: "normal",
    wasteFactor: 10,
    provenance: "voice",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildPhoto(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    roomId: overrides.roomId ?? 1,
    damageId: null,
    storagePath: `photos/session-1/photo-${id}.jpg`,
    photoType: "damage_evidence",
    label: "Ceiling water damage",
    analysis: null,
    autoTag: null,
    annotations: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildEstimateSummary(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? nextId(),
    sessionId: overrides.sessionId ?? 1,
    totalRCV: 5250.0,
    totalACV: 4462.5,
    totalDepreciation: 787.5,
    totalOverhead: 525.0,
    totalProfit: 525.0,
    deductible: 1000.0,
    netClaimRCV: 4250.0,
    netClaimACV: 3462.5,
    lineItemCount: 12,
    roomCount: 4,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
