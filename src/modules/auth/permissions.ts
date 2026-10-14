export type Role = "admin" | "hr";
export type Actor = { id: string; role: Role };
export const PERMISSIONS = {
  employeeRead: ["admin", "hr"], employeeWrite: ["admin"], employeeArchive: ["admin"], employeeReveal: ["admin", "hr"],
  certificateRead: ["admin", "hr"], certificateWrite: ["admin"], certificateTypeRead: ["admin", "hr"], certificateTypeWrite: ["admin"], signatureRead: ["admin", "hr"], signatureWrite: ["admin"],
  settingsRead: ["admin", "hr"], settingsWrite: ["admin"], commanderRead: ["admin", "hr"], commanderWrite: ["admin"], export: ["admin", "hr"], reminderRun: ["admin"], auditRead: ["admin"], ocr: ["admin", "hr"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;
export function can(actor: Actor, permission: Permission): boolean { return PERMISSIONS[permission].some((role) => role === actor.role); }

export const FACADE_USE_CASE_PERMISSIONS = {
  employees: { validate: "employeeWrite", create: "employeeWrite", update: "employeeWrite", archive: "employeeArchive", restore: "employeeArchive", get: "employeeRead", list: "employeeRead", search: "employeeRead", revealCccd: "employeeReveal" },
  certificates: { add: "certificateWrite", renew: "certificateWrite", update: "certificateWrite", updateAttachments: "certificateWrite", archive: "certificateWrite", restore: "certificateWrite", listByEmployee: "certificateRead", listExpiring: "certificateRead" },
  certificateTypes: { list: "certificateTypeRead", create: "certificateTypeWrite", update: "certificateTypeWrite", archive: "certificateTypeWrite" },
  signatures: { add: "signatureWrite", setDefault: "signatureWrite", remove: "signatureWrite", list: "signatureRead" },
  settings: { get: "settingsRead", update: "settingsWrite" },
  commanders: { list: "commanderRead", create: "commanderWrite", update: "commanderWrite", archive: "commanderWrite" },
  exports: { checkReadiness: "export", buildWorkerProfile: "export" },
  reminders: { computeDue: "reminderRun", run: "reminderRun" },
  ocr: { parseIdText: "ocr", mergeParsed: null },
  audit: { list: "auditRead" },
} as const satisfies Record<string, Record<string, Permission | null>>;

export const FACADE_PERMISSION_MATRIX = Object.fromEntries(
  Object.entries(FACADE_USE_CASE_PERMISSIONS).map(([group, useCases]) => [group, Object.fromEntries(
    Object.entries(useCases).map(([useCase, permission]) => [useCase, {
      admin: permission === null || can({ id: "matrix", role: "admin" }, permission),
      hr: permission === null || can({ id: "matrix", role: "hr" }, permission),
    }]),
  )]),
) as Record<string, Record<string, Record<Role, boolean>>>;
