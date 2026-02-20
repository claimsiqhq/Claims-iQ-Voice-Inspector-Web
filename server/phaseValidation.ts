/**
 * phaseValidation.ts
 *
 * Validates inspection completeness at phase transitions.
 * Returns warnings (not hard blocks) so adjusters can override.
 */

import type { IStorage } from "./storage";

export interface PhaseValidationResult {
  canProceed: boolean;
  warnings: string[];
  missingItems: string[];
  completionScore: number;
}

export interface PhaseValidationOptions {
  requirePhotoVerification?: boolean;
}

/**
 * Validate readiness to transition FROM the given phase TO the next.
 */
export async function validatePhaseTransition(
  storage: IStorage,
  sessionId: number,
  currentPhase: number,
  perilType?: string,
  options: PhaseValidationOptions = {}
): Promise<PhaseValidationResult> {
  const requirePhotoVerification = options.requirePhotoVerification !== false;
  switch (currentPhase) {
    case 1:
      return validatePhase1(storage, sessionId, requirePhotoVerification);
    case 2:
      return validatePhase2();
    case 3:
      return validatePhase3(storage, sessionId);
    case 4:
      return validatePhase4(storage, sessionId);
    case 5:
      return validatePhase5(storage, sessionId, perilType);
    case 6:
      return validatePhase6(storage, sessionId);
    case 7:
      return validatePhase7(storage, sessionId);
    default:
      return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
  }
}

async function validatePhase1(
  storage: IStorage,
  sessionId: number,
  requirePhotoVerification: boolean
): Promise<PhaseValidationResult> {
  if (!requirePhotoVerification) {
    return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
  }

  const warnings: string[] = [];
  const missingItems: string[] = [];
  const photos = await storage.getPhotos(sessionId);
  const verificationPhotos = photos.filter((p) => p.photoType === "address_verification");

  if (verificationPhotos.length === 0) {
    warnings.push("No property verification photo captured");
    missingItems.push("Property verification photo (front of building with address visible)");
  }

  const score = verificationPhotos.length > 0 ? 100 : 20;
  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase2(): Promise<PhaseValidationResult> {
  return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
}

async function validatePhase3(storage: IStorage, sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];
  const rooms = await storage.getRooms(sessionId);
  const exteriorRooms = rooms.filter(
    (r) => r.roomType?.startsWith("exterior_") || r.phase === 3
  );

  if (exteriorRooms.length === 0) {
    warnings.push("No exterior rooms/areas documented");
    missingItems.push("At least one exterior area (roof, elevation, etc.)");
  }

  const roofRooms = exteriorRooms.filter((r) => r.roomType?.includes("roof"));
  if (roofRooms.length === 0 && exteriorRooms.length > 0) {
    warnings.push("No roof slopes documented — verify roof was inspected");
    missingItems.push("Roof slope documentation");
  }

  const photos = await storage.getPhotos(sessionId);
  const damages = await storage.getDamagesForSession(sessionId);
  const scopeItems = await storage.getScopeItems(sessionId);
  const lineItems = await storage.getLineItems(sessionId);

  for (const room of exteriorRooms) {
    const roomPhotos = photos.filter((p) => p.roomId === room.id);
    if (roomPhotos.length === 0) {
      warnings.push(`${room.name} has no photos`);
      missingItems.push(`Photo for ${room.name}`);
    }

    const roomDamages = damages.filter((d) => d.roomId === room.id);
    const roomScopeItems = scopeItems.filter((s) => s.roomId === room.id);
    const roomLineItems = lineItems.filter((l) => l.roomId === room.id);
    if (roomDamages.length > 0 && roomScopeItems.length === 0 && roomLineItems.length === 0) {
      warnings.push(`${room.name}: ${roomDamages.length} damage(s) documented but no scope items — scope gap`);
    }
  }

  const completedRooms = exteriorRooms.filter((r) => r.status === "complete").length;
  const score =
    exteriorRooms.length > 0 ? Math.round((completedRooms / exteriorRooms.length) * 100) : 0;

  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase4(storage: IStorage, sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];
  const rooms = await storage.getRooms(sessionId);
  const interiorRooms = rooms.filter(
    (r) => r.roomType?.startsWith("interior_") || r.phase === 4
  );

  if (interiorRooms.length === 0) {
    warnings.push("No interior rooms documented");
    missingItems.push("At least one interior room");
  }

  const damages = await storage.getDamagesForSession(sessionId);
  const scopeItems = await storage.getScopeItems(sessionId);
  const lineItems = await storage.getLineItems(sessionId);

  for (const room of interiorRooms) {
    const roomDamages = damages.filter((d) => d.roomId === room.id);
    const roomScopeItems = scopeItems.filter((s) => s.roomId === room.id);
    const roomLineItems = lineItems.filter((l) => l.roomId === room.id);
    const hasItems = roomScopeItems.length > 0 || roomLineItems.length > 0;

    if (roomDamages.length > 0 && !hasItems) {
      warnings.push(`${room.name}: damages documented but no scope items`);
    }

    if (hasItems) {
      const allItems = [...roomScopeItems, ...roomLineItems];
      const hasDrywall = allItems.some(
        (i) => (i as any).tradeCode === "DRY" || (i as any).category === "DRY" || (i as any).category === "Drywall"
      );
      const hasPainting = allItems.some(
        (i) => (i as any).tradeCode === "PNT" || (i as any).category === "PNT" || (i as any).category === "Painting"
      );
      if (hasDrywall && !hasPainting) {
        warnings.push(`${room.name}: Drywall scope without painting — add paint finish?`);
      }
    }
  }

  const completedRooms = interiorRooms.filter((r) => r.status === "complete").length;
  const score =
    interiorRooms.length > 0 ? Math.round((completedRooms / interiorRooms.length) * 100) : 0;

  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase5(
  storage: IStorage,
  sessionId: number,
  perilType?: string
): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  if (perilType?.toLowerCase() !== "water") {
    return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
  }

  const readings = await storage.getMoistureReadingsForSession(sessionId);

  if (readings.length === 0) {
    warnings.push("Water claim but no moisture readings documented");
    missingItems.push("Moisture readings at affected areas");
  }

  const elevatedReadings = readings.filter((r) => {
    const dry = r.dryStandard || 15;
    return r.reading > dry;
  });

  if (elevatedReadings.length > 0) {
    const scopeItems = await storage.getScopeItems(sessionId);
    const lineItems = await storage.getLineItems(sessionId);
    const allItems = [...scopeItems, ...lineItems];
    const hasMitigation = allItems.some(
      (i) => (i as any).tradeCode === "MIT" || (i as any).category === "MIT" || (i as any).category === "Mitigation"
    );

    if (!hasMitigation) {
      warnings.push(
        `${elevatedReadings.length} elevated moisture reading(s) but no mitigation items in scope`
      );
      missingItems.push("Mitigation/extraction line items for wet areas");
    }
  }

  const score = readings.length >= 3 ? 100 : Math.round((readings.length / 3) * 100);
  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase6(storage: IStorage, sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];
  const photos = await storage.getPhotos(sessionId);
  const damages = await storage.getDamagesForSession(sessionId);

  if (photos.length < 5) {
    warnings.push(`Only ${photos.length} photos — most inspections need 10+`);
    missingItems.push("Additional evidence photos");
  }

  const overviews = photos.filter((p) => p.photoType === "overview");
  if (overviews.length === 0) {
    warnings.push("No overview photos captured");
    missingItems.push("Overview photo of property/rooms");
  }

  const damagePhotos = photos.filter((p) => p.damageId !== null);
  if (damages.length > 0 && damagePhotos.length === 0) {
    warnings.push(`${damages.length} damage(s) documented but no damage detail photos`);
    missingItems.push("Damage detail photos linked to observations");
  }

  const score = Math.min(100, Math.round((photos.length / 10) * 100));
  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase7(storage: IStorage, sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];
  const scopeItems = await storage.getScopeItems(sessionId);
  const lineItems = await storage.getLineItems(sessionId);
  const items = [...scopeItems, ...lineItems];
  const rooms = await storage.getRooms(sessionId);

  if (items.length === 0) {
    warnings.push("No line items in estimate — cannot finalize empty estimate");
    missingItems.push("At least one estimate line item");
  }

  const unpricedItems = items.filter((i) => {
    const price = (i as any).unitPrice ?? (i as any).totalPrice;
    return !price || Number(price) === 0;
  });
  if (unpricedItems.length > 0) {
    warnings.push(`${unpricedItems.length} item(s) have $0 unit price — verify pricing`);
  }

  for (const room of rooms) {
    if ((room.damageCount || 0) > 0) {
      const roomScopeItems = scopeItems.filter((s) => s.roomId === room.id);
      const roomLineItems = lineItems.filter((l) => l.roomId === room.id);
      if (roomScopeItems.length === 0 && roomLineItems.length === 0) {
        warnings.push(`${room.name}: ${room.damageCount} damage(s) but 0 line items`);
      }
    }
  }

  const pricedCount = items.filter((i) => {
    const price = (i as any).unitPrice ?? (i as any).totalPrice;
    return price && Number(price) > 0;
  }).length;
  const score = items.length > 0 ? Math.min(100, Math.round((pricedCount / Math.max(items.length, 1)) * 100)) : 0;

  return { canProceed: true, warnings, missingItems, completionScore: score };
}
