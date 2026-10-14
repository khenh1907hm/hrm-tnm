import type { Role } from "../auth/permissions";
export type AuditEvent = { id: string; at: string; actorId: string; role: Role; action: string; entityType: string; entityId: string; before: unknown; after: unknown };
