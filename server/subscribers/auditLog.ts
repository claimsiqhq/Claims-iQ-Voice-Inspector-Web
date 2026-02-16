import { on, type AppEvent } from "../events";
import { logger } from "../logger";

export function registerAuditLogSubscriber(): void {
  on("*", (event: AppEvent) => {
    logger.child({ subsystem: "audit" }).info(
      {
        event: event.type,
        ...("claimId" in event && { claimId: event.claimId }),
        ...("sessionId" in event && { sessionId: event.sessionId }),
        ...("documentId" in event && { documentId: event.documentId }),
        ...("supplementalId" in event && { supplementalId: event.supplementalId }),
        userId: event.userId || "system",
        meta: event.meta || {},
      },
      "audit_event"
    );
  });
}
