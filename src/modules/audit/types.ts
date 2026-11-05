import type { ActorRole } from "../auth/permissions";
export type AuditEvent = { id: string; at: string; actorId: string; role: ActorRole; action: string; entityType: string; entityId: string; before: unknown; after: unknown };
