import { vi } from 'vitest';
import type { IStorage } from '../../server/storage';

/**
 * Creates a fully-mocked IStorage where every method is a vi.fn().
 * Override individual methods in your tests as needed.
 */
export function createMockStorage(overrides: Partial<IStorage> = {}): IStorage {
  const mock: IStorage = {
    // User
    getUser: vi.fn().mockResolvedValue(undefined),
    getUserByUsername: vi.fn().mockResolvedValue(undefined),
    getUserBySupabaseId: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue({ id: 'user-1', username: 'test' }),
    syncSupabaseUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateUserLastLogin: vi.fn().mockResolvedValue(undefined),
    getAllUsers: vi.fn().mockResolvedValue([]),

    // Claims
    createClaim: vi.fn().mockResolvedValue({ id: 1 }),
    getClaimsForUser: vi.fn().mockResolvedValue([]),
    getClaims: vi.fn().mockResolvedValue([]),
    getClaim: vi.fn().mockResolvedValue(undefined),
    deleteClaim: vi.fn().mockResolvedValue(true),
    deleteAllClaims: vi.fn().mockResolvedValue(0),
    updateClaimStatus: vi.fn().mockResolvedValue(undefined),
    updateClaimFields: vi.fn().mockResolvedValue(undefined),

    // Documents
    getAllDocuments: vi.fn().mockResolvedValue([]),
    getDocumentById: vi.fn().mockResolvedValue(undefined),
    createDocument: vi.fn().mockResolvedValue({ id: 1 }),
    getDocuments: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn().mockResolvedValue(undefined),
    updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
    updateDocumentStoragePath: vi.fn().mockResolvedValue(undefined),
    updateDocumentError: vi.fn().mockResolvedValue(undefined),

    // Extractions
    createExtraction: vi.fn().mockResolvedValue({ id: 1 }),
    getExtractions: vi.fn().mockResolvedValue([]),
    getExtraction: vi.fn().mockResolvedValue(undefined),
    updateExtraction: vi.fn().mockResolvedValue(undefined),
    confirmExtraction: vi.fn().mockResolvedValue(undefined),

    // Briefings
    createBriefing: vi.fn().mockResolvedValue({ id: 1 }),
    getBriefing: vi.fn().mockResolvedValue(undefined),

    // Sessions
    createInspectionSession: vi.fn().mockResolvedValue({ id: 1 }),
    getInspectionSession: vi.fn().mockResolvedValue(undefined),
    getInspectionSessionsForClaim: vi.fn().mockResolvedValue([]),
    getActiveSessionForClaim: vi.fn().mockResolvedValue(undefined),
    getLatestSessionForClaim: vi.fn().mockResolvedValue(undefined),
    updateSessionPhase: vi.fn().mockResolvedValue(undefined),
    updateSessionRoom: vi.fn().mockResolvedValue(undefined),
    updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    completeSession: vi.fn().mockResolvedValue(undefined),

    // Structures (L1 hierarchy)
    createStructure: vi.fn().mockResolvedValue({ id: 1 }),
    getStructures: vi.fn().mockResolvedValue([]),
    getStructure: vi.fn().mockResolvedValue(undefined),
    getStructureByName: vi.fn().mockResolvedValue(undefined),
    updateStructure: vi.fn().mockResolvedValue(undefined),

    // Rooms (L2/L3 hierarchy)
    createRoom: vi.fn().mockResolvedValue({ id: 1 }),
    getRooms: vi.fn().mockResolvedValue([]),
    getRoomsForStructure: vi.fn().mockResolvedValue([]),
    getChildRooms: vi.fn().mockResolvedValue([]),
    getRoom: vi.fn().mockResolvedValue(undefined),
    getRoomByName: vi.fn().mockResolvedValue(undefined),
    updateRoomStatus: vi.fn().mockResolvedValue(undefined),
    updateRoomGeometry: vi.fn().mockResolvedValue(undefined),
    completeRoom: vi.fn().mockResolvedValue(undefined),
    incrementRoomDamageCount: vi.fn().mockResolvedValue(undefined),
    incrementRoomPhotoCount: vi.fn().mockResolvedValue(undefined),

    // Room Openings (L4 deductions)
    createRoomOpening: vi.fn().mockResolvedValue({ id: 1 }),
    getRoomOpenings: vi.fn().mockResolvedValue([]),
    deleteRoomOpening: vi.fn().mockResolvedValue(undefined),

    // Sketch Annotations (L5 metadata)
    createSketchAnnotation: vi.fn().mockResolvedValue({ id: 1 }),
    getSketchAnnotations: vi.fn().mockResolvedValue([]),
    getSketchAnnotationsForSession: vi.fn().mockResolvedValue([]),
    deleteSketchAnnotation: vi.fn().mockResolvedValue(undefined),

    // Sketch Templates
    getSketchTemplates: vi.fn().mockResolvedValue([]),
    getSketchTemplate: vi.fn().mockResolvedValue(undefined),

    // Hierarchical inspection state
    getInspectionHierarchy: vi.fn().mockResolvedValue({ structures: [] }),

    // Damages
    createDamage: vi.fn().mockResolvedValue({ id: 1 }),
    getDamages: vi.fn().mockResolvedValue([]),
    getDamagesForSession: vi.fn().mockResolvedValue([]),

    // Line Items
    createLineItem: vi.fn().mockResolvedValue({ id: 1 }),
    getLineItems: vi.fn().mockResolvedValue([]),
    getLineItemsForRoom: vi.fn().mockResolvedValue([]),
    getEstimateSummary: vi.fn().mockResolvedValue({ totalRCV: 0, totalDepreciation: 0, totalACV: 0, itemCount: 0 }),
    updateLineItem: vi.fn().mockResolvedValue(undefined),
    deleteLineItem: vi.fn().mockResolvedValue(undefined),

    // Photos
    createPhoto: vi.fn().mockResolvedValue({ id: 1 }),
    getPhotos: vi.fn().mockResolvedValue([]),
    getPhotosForRoom: vi.fn().mockResolvedValue([]),
    updatePhoto: vi.fn().mockResolvedValue(undefined),

    // Moisture
    createMoistureReading: vi.fn().mockResolvedValue({ id: 1 }),
    getMoistureReadings: vi.fn().mockResolvedValue([]),
    getMoistureReadingsForSession: vi.fn().mockResolvedValue([]),

    // Transcripts
    addTranscript: vi.fn().mockResolvedValue({ id: 1 }),
    getTranscript: vi.fn().mockResolvedValue([]),

    // Pricing catalog
    getScopeLineItems: vi.fn().mockResolvedValue([]),
    getScopeLineItemByCode: vi.fn().mockResolvedValue(undefined),
    getScopeLineItemsByTrade: vi.fn().mockResolvedValue([]),
    getRegionalPrice: vi.fn().mockResolvedValue(undefined),
    getRegionalPricesForRegion: vi.fn().mockResolvedValue([]),

    // Supplementals
    createSupplementalClaim: vi.fn().mockResolvedValue({ id: 1 }),
    getSupplementalsForSession: vi.fn().mockResolvedValue([]),
    getSupplemental: vi.fn().mockResolvedValue(undefined),
    updateSupplemental: vi.fn().mockResolvedValue(undefined),
    submitSupplemental: vi.fn().mockResolvedValue(undefined),
    approveSupplemental: vi.fn().mockResolvedValue(undefined),

    // User settings & profile
    updateUserProfile: vi.fn().mockResolvedValue(undefined),
    getUserSettings: vi.fn().mockResolvedValue(null),
    upsertUserSettings: vi.fn().mockResolvedValue({ id: 1, userId: 'user-1', settings: {} }),

    // Apply overrides
    ...overrides,
  };

  return mock;
}
