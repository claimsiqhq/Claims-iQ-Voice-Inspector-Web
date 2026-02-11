import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(30);

export interface ClaimEvent {
  type: "claim.created" | "claim.statusChanged" | "claim.deleted";
  claimId: number;
  userId?: string;
  meta?: Record<string, unknown>;
}

export interface InspectionEvent {
  type:
    | "inspection.started"
    | "inspection.completed"
    | "inspection.roomCreated"
    | "inspection.roomCompleted"
    | "inspection.damageAdded"
    | "inspection.lineItemAdded"
    | "inspection.lineItemUpdated"
    | "inspection.lineItemDeleted"
    | "inspection.photoUploaded";
  sessionId: number;
  claimId?: number;
  userId?: string;
  meta?: Record<string, unknown>;
}

export interface DocumentEvent {
  type: "document.uploaded" | "document.parsed" | "document.extractionConfirmed";
  documentId?: number;
  claimId: number;
  userId?: string;
  meta?: Record<string, unknown>;
}

export interface SupplementalEvent {
  type: "supplemental.created" | "supplemental.submitted" | "supplemental.approved";
  supplementalId: number;
  sessionId: number;
  userId?: string;
  meta?: Record<string, unknown>;
}

export type AppEvent = ClaimEvent | InspectionEvent | DocumentEvent | SupplementalEvent;

export function emit(event: AppEvent): void {
  bus.emit(event.type, event);
  bus.emit("*", event);
}

export function on(
  eventType: AppEvent["type"] | "*",
  handler: (event: AppEvent) => void
): void {
  bus.on(eventType, handler);
}

export function once(
  eventType: AppEvent["type"] | "*",
  handler: (event: AppEvent) => void
): void {
  bus.once(eventType, handler);
}

export function off(
  eventType: AppEvent["type"] | "*",
  handler: (event: AppEvent) => void
): void {
  bus.off(eventType, handler);
}
