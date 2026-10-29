export type Role = "admin" | "hr";
export type Actor = { id: string; role: Role };
export const PERMISSIONS = {
  // HR xử lý toàn bộ nghiệp vụ nhân sự và hành chính; chỉ Nhật ký thay đổi (và quản trị tài khoản ở API riêng) dành cho Admin
  employeeRead: ["admin", "hr"], employeeWrite: ["admin", "hr"], employeeArchive: ["admin", "hr"], employeeReveal: ["admin", "hr"],
  certificateRead: ["admin", "hr"], certificateWrite: ["admin", "hr"], certificateTypeRead: ["admin", "hr"], certificateTypeWrite: ["admin", "hr"], signatureRead: ["admin", "hr"], signatureWrite: ["admin", "hr"],
  settingsRead: ["admin", "hr"], settingsWrite: ["admin", "hr"], commanderRead: ["admin", "hr"], commanderWrite: ["admin", "hr"], export: ["admin", "hr"], reminderRun: ["admin", "hr"], auditRead: ["admin"], ocr: ["admin", "hr"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;
export function can(actor: Actor, permission: Permission): boolean { return PERMISSIONS[permission].some((role) => role === actor.role); }

export const FACADE_USE_CASE_PERMISSIONS = {
  employees: { validate: "employeeWrite", create: "employeeWrite", importMany: "employeeWrite", update: "employeeWrite", archive: "employeeArchive", restore: "employeeArchive", get: "employeeRead", list: "employeeRead", search: "employeeRead", revealCccd: "employeeReveal", updateExtra: "employeeWrite" },
  certificates: { add: "certificateWrite", renew: "certificateWrite", update: "certificateWrite", updateAttachments: "certificateWrite", archive: "certificateWrite", restore: "certificateWrite", listByEmployee: "certificateRead", listExpiring: "certificateRead" },
  certificateTypes: { list: "certificateTypeRead", create: "certificateTypeWrite", update: "certificateTypeWrite", reorder: "certificateTypeWrite", archive: "certificateTypeWrite" },
  signatures: { add: "signatureWrite", update: "signatureWrite", setDefault: "signatureWrite", remove: "signatureWrite", list: "signatureRead" },
  settings: { get: "settingsRead", update: "settingsWrite" },
  commanders: { list: "commanderRead", create: "commanderWrite", update: "commanderWrite", archive: "commanderWrite" },
  exports: { checkReadiness: "export", buildWorkerProfile: "export", employeeRoster: "export" },
  reminders: { computeDue: "reminderRun", run: "reminderRun", sendTest: "reminderRun" },
  ocr: { parseIdText: "ocr", mergeParsed: null },
  audit: { list: "auditRead", listPage: "auditRead", page: "auditRead" },
} as const satisfies Record<string, Record<string, Permission | null>>;

export const FACADE_PERMISSION_MATRIX = Object.fromEntries(
  Object.entries(FACADE_USE_CASE_PERMISSIONS).map(([group, useCases]) => [group, Object.fromEntries(
    Object.entries(useCases).map(([useCase, permission]) => [useCase, {
      admin: permission === null || can({ id: "matrix", role: "admin" }, permission),
      hr: permission === null || can({ id: "matrix", role: "hr" }, permission),
    }]),
  )]),
) as Record<string, Record<string, Record<Role, boolean>>>;
