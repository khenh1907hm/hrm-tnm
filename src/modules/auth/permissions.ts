export type Role = "admin" | "hr";
/** Vai trò (bộ phận) của người đang thao tác. Kỹ sư, Nhân viên chỉ vào được phần nhân sự khi Admin tick thêm quyền. */
export type ActorRole = Role | "engineer" | "employee";
/** `access` là các mục quyền của riêng người này; không có thì dùng mặc định theo vai trò. */
export type Actor = { id: string; role: ActorRole; access?: readonly AccessKey[] };
export const PERMISSIONS = {
  // HR xử lý toàn bộ nghiệp vụ nhân sự và hành chính; chỉ Nhật ký thay đổi (và quản trị tài khoản ở API riêng) dành cho Admin
  employeeRead: ["admin", "hr"], employeeWrite: ["admin", "hr"], employeeImport: ["admin", "hr"], employeeArchive: ["admin", "hr"], employeeReveal: ["admin", "hr"],
  certificateRead: ["admin", "hr"], certificateWrite: ["admin", "hr"], certificateTypeRead: ["admin", "hr"], certificateTypeWrite: ["admin", "hr"], signatureRead: ["admin", "hr"], signatureWrite: ["admin", "hr"],
  settingsRead: ["admin", "hr"], settingsWrite: ["admin", "hr"], commanderRead: ["admin", "hr"], commanderWrite: ["admin", "hr"], export: ["admin", "hr"], reminderRun: ["admin", "hr"], auditRead: ["admin"], ocr: ["admin", "hr"],
  // Nơi nhận thông báo (Telegram): chỉ Admin, khớp RLS private.is_admin() của bảng notification_targets
  notificationManage: ["admin"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

/**
 * Các mục Admin tick cho từng người. Khóa lưu ở cột profiles.permissions và được RLS đọc
 * (private.has_access): thêm hoặc đổi khóa ở đây thì phải có migration đi kèm.
 */
export const ACCESS_ITEMS = [
  { key: "employees.view", group: "Nhân sự", label: "Xem nhân sự và chứng chỉ", hint: "Danh sách, hồ sơ, chứng chỉ của từng người và cảnh báo hết hạn.", requires: [], grants: ["employeeRead", "certificateRead", "certificateTypeRead", "commanderRead"] },
  { key: "employees.edit", group: "Nhân sự", label: "Thêm, sửa hồ sơ nhân sự", hint: "Gồm xem CCCD đầy đủ và thêm người liên hệ khẩn cấp.", requires: ["employees.view"], grants: ["employeeWrite", "employeeReveal", "commanderWrite", "ocr"] },
  { key: "employees.import", group: "Nhân sự", label: "Nhập nhân sự", hint: "Nhập từ Excel và nhập từ Claude.", requires: ["employees.view"], grants: ["employeeImport"] },
  { key: "employees.export", group: "Nhân sự", label: "Xuất nhân sự", hint: "Xuất Excel, xuất hồ sơ theo mẫu, PDF và tải thư mục chứng chỉ.", requires: ["employees.view"], grants: ["export", "employeeReveal", "signatureRead"] },
  { key: "employees.archive", group: "Nhân sự", label: "Lưu trữ, khôi phục hồ sơ", hint: "Ẩn hồ sơ người đã nghỉ và mở lại khi cần.", requires: ["employees.view"], grants: ["employeeArchive"] },
  { key: "certificates.edit", group: "Chứng chỉ", label: "Thêm, sửa, gia hạn chứng chỉ", hint: "Gồm tải tệp chứng chỉ lên và ẩn chứng chỉ.", requires: ["employees.view"], grants: ["certificateWrite", "ocr"] },
  { key: "certificateTypes.manage", group: "Chứng chỉ", label: "Quản lý loại chứng chỉ", hint: "Thêm, sửa, sắp xếp các loại chứng chỉ.", requires: ["employees.view"], grants: ["certificateTypeWrite"] },
  { key: "reminders.manage", group: "Chứng chỉ", label: "Cài đặt email và gửi nhắc hạn", hint: "Đổi địa chỉ nhận và gửi email nhắc hạn chứng chỉ.", requires: ["employees.view"], grants: ["settingsRead", "settingsWrite", "reminderRun"] },
  { key: "signatures.manage", group: "Tài liệu", label: "Thư viện chữ ký", hint: "Xem, thêm, sửa, xóa chữ ký.", requires: [], grants: ["signatureRead", "signatureWrite"] },
  { key: "reports.manage", group: "Tài liệu", label: "FORM báo cáo (Excel)", hint: "Tạo, sửa mẫu báo cáo và danh sách đối tác.", requires: ["employees.view"], grants: ["signatureRead"] },
  { key: "tools", group: "Tài liệu", label: "Công cụ", hint: "Ảnh Trước / Sau và tách nền ảnh.", requires: [], grants: [] },
  { key: "projects.view", group: "Dự án", label: "Xem mọi dự án và giờ công", hint: "Không gồm số tiền: tiền chỉ Admin và PM của dự án xem được. Người trong dự án luôn xem được dự án của mình.", requires: [], grants: [] },
  { key: "projects.manage", group: "Dự án", label: "Tạo, sửa dự án", hint: "Tạo dự án mới, gán PM, sửa thông tin và ngân sách của mọi dự án.", requires: ["projects.view"], grants: [] },
  { key: "purchases.view", group: "Mua hàng", label: "Xem mọi đơn hàng", hint: "Xem đơn hàng của mọi người, cả dự án và văn phòng. Ai cũng tự lập và xem đơn của mình; duyệt đơn chỉ người phê duyệt.", requires: [], grants: [] },
  { key: "purchases.pay", group: "Mua hàng", label: "Thực hiện chi (kế toán)", hint: "Chi tạm ứng và thanh toán cho các khoản đã được sếp duyệt.", requires: ["purchases.view"], grants: [] },
] as const satisfies readonly { key: string; group: string; label: string; hint: string; requires: readonly string[]; grants: readonly Permission[] }[];
export type AccessKey = typeof ACCESS_ITEMS[number]["key"];

export const ACCESS_KEYS: readonly AccessKey[] = ACCESS_ITEMS.map((item) => item.key);
const itemOf = (key: AccessKey) => ACCESS_ITEMS.find((item) => item.key === key)!;
const requiresOf = (key: AccessKey): readonly AccessKey[] => itemOf(key).requires;
const NO_ACCESS: readonly AccessKey[] = [];
const TOOLS_ONLY: readonly AccessKey[] = ["tools"];

/** Bỏ khóa lạ, thêm các mục bắt buộc đi kèm, xếp theo thứ tự danh mục. */
export function normalizeAccess(raw: readonly unknown[]): AccessKey[] {
  const picked = new Set(raw.filter((key): key is AccessKey => ACCESS_KEYS.includes(key as AccessKey)));
  for (const key of [...picked]) for (const needed of requiresOf(key)) picked.add(needed);
  return ACCESS_KEYS.filter((key) => picked.has(key));
}

/** Tick một mục kéo theo mục nó cần; bỏ tick một mục kéo theo các mục cần nó. */
export function toggleAccess(current: readonly AccessKey[], key: AccessKey, on: boolean): AccessKey[] {
  if (on) return normalizeAccess([...current, key]);
  return normalizeAccess(current.filter((item) => item !== key && !requiresOf(item).includes(key)));
}

/** Quyền mặc định khi Admin chưa tùy chỉnh. */
export function defaultAccess(role: string): readonly AccessKey[] {
  if (role === "admin") return ACCESS_KEYS;
  // HR mặc định có mọi mục trừ Tạo, sửa dự án (chỉ Admin tạo dự án, spec quản lý dự án mục 2.2)
  if (role === "hr") return ACCESS_KEYS.filter((key) => key !== "projects.manage");
  return role === "engineer" || role === "employee" ? TOOLS_ONLY : NO_ACCESS;
}

/** Quyền thực tế: Admin luôn đủ, Chờ cấp quyền không có gì, còn lại theo mục đã tick hoặc mặc định của vai trò. */
export function effectiveAccess(role: string, stored: unknown): readonly AccessKey[] {
  if (role === "admin") return ACCESS_KEYS;
  if (role !== "hr" && role !== "engineer" && role !== "employee") return NO_ACCESS;
  return Array.isArray(stored) ? normalizeAccess(stored) : defaultAccess(role);
}

/** Có mục nào ngoài Công cụ, Dự án, Mua hàng thì mới cần dựng app nhân sự; còn lại dùng khung giới hạn kèm các trang đó. */
export const needsHrWorkspace = (access: readonly AccessKey[]) => access.some((key) => key !== "tools" && !key.startsWith("projects.") && !key.startsWith("purchases."));

/** Dựng tác nhân từ dòng profiles; null nếu chưa được cấp quyền. Dùng cho các API ở máy chủ. */
export function actorFromProfile(id: string, role: unknown, stored: unknown): Actor | null {
  if (role === "admin") return { id, role };
  if (role !== "hr" && role !== "engineer" && role !== "employee") return null;
  return { id, role, access: effectiveAccess(role, stored) };
}

export function hasAccess(actor: Actor, key: AccessKey): boolean {
  return actor.role === "admin" || (actor.access ?? defaultAccess(actor.role)).includes(key);
}

export function can(actor: Actor, permission: Permission): boolean {
  if (actor.role === "admin") return true;
  return (actor.access ?? defaultAccess(actor.role)).some((key) => (itemOf(key).grants as readonly Permission[]).includes(permission));
}

export const FACADE_USE_CASE_PERMISSIONS = {
  employees: { validate: "employeeWrite", create: "employeeWrite", importMany: "employeeImport", update: "employeeWrite", archive: "employeeArchive", restore: "employeeArchive", get: "employeeRead", list: "employeeRead", search: "employeeRead", revealCccd: "employeeReveal", updateExtra: "employeeWrite" },
  certificates: { add: "certificateWrite", renew: "certificateWrite", update: "certificateWrite", updateAttachments: "certificateWrite", archive: "certificateWrite", restore: "certificateWrite", listByEmployee: "certificateRead", listExpiring: "certificateRead" },
  certificateTypes: { list: "certificateTypeRead", create: "certificateTypeWrite", update: "certificateTypeWrite", reorder: "certificateTypeWrite", archive: "certificateTypeWrite" },
  signatures: { add: "signatureWrite", update: "signatureWrite", setDefault: "signatureWrite", remove: "signatureWrite", list: "signatureRead" },
  settings: { get: "settingsRead", update: "settingsWrite" },
  commanders: { list: "commanderRead", create: "commanderWrite", update: "commanderWrite", archive: "commanderWrite" },
  exports: { checkReadiness: "export", buildWorkerProfile: "export", employeeRoster: "export" },
  reminders: { computeDue: "reminderRun", run: "reminderRun", sendTest: "reminderRun" },
  notifications: { listTargets: "notificationManage", saveTarget: "notificationManage", removeTarget: "notificationManage", runDailyDigest: "reminderRun", sendTelegramTest: "notificationManage" },
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
