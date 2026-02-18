import { on, type AppEvent } from "../events";
import pinoLogger from "../logger";

export function registerAuditLogSubscriber(): void {
  const auditLogger = pinoLogger.child({ subsystem: "audit" });

  on("*", (event: AppEvent) => {
    auditLogger.info(
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
