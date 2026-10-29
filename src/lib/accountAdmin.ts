import type { AuditEvent } from "../modules/audit/types";

type Fetch = typeof fetch;

/** Vai trò lưu ở bảng profiles. */
export const ACCOUNT_ROLES = ["admin", "hr", "engineer", "employee", "pending"] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = { admin: "Admin", hr: "HR", engineer: "Kỹ sư", employee: "Nhân viên", pending: "Chờ cấp quyền" };

export type Account = { id: string; email: string; fullName: string; role: AccountRole; createdAt: string; lastSignInAt: string | null; locked: boolean };
export type NewAccount = { email: string; password: string; fullName: string; role: AccountRole };
export type AccountChange = { id: string; role?: AccountRole; fullName?: string; password?: string; locked?: boolean };

/** Thao tác trên Supabase Auth + profiles bằng khóa bí mật (chỉ ở máy chủ). */
export type AccountStore = {
  list: () => Promise<Account[]>;
  get: (id: string) => Promise<Account | null>;
  /** Trả lỗi EMAIL_TAKEN khi email đã có tài khoản. */
  create: (input: NewAccount) => Promise<{ ok: true; account: Account } | { ok: false; code: "ACCOUNT_EMAIL_TAKEN" }>;
  update: (change: AccountChange) => Promise<void>;
  appendAudit: (event: AuditEvent) => Promise<void>;
};

export type AccountEnv = { supabaseUrl?: string | undefined; supabaseKey?: string | undefined };
export type AccountDeps = {
  lookupRole: (userId: string) => Promise<string | null>;
  /** null khi máy chủ chưa có SUPABASE_SECRET_KEY. */
  store: AccountStore | null;
  fetcher?: Fetch;
  now?: () => string;
  newId?: () => string;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (status: number, code: string, message: string) => json(status, { ok: false, code, message });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;
const isRole = (value: unknown): value is AccountRole => ACCOUNT_ROLES.includes(value as AccountRole);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Bản ghi nhật ký của tài khoản: không bao giờ chứa mật khẩu. */
const auditDoc = (account: Pick<Account, "email" | "fullName" | "role" | "locked">) => ({ email: account.email, fullName: account.fullName, role: account.role, locked: account.locked });

async function resolveAdmin(request: Request, env: AccountEnv, deps: AccountDeps): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !env.supabaseUrl || !env.supabaseKey) return null;
  const response = await (deps.fetcher ?? fetch)(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: env.supabaseKey, authorization: header } });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string };
  if (!user.id) return null;
  return await deps.lookupRole(user.id) === "admin" ? user.id : null;
}

/** Kiểm tra dữ liệu tạo tài khoản; trả mã lỗi đầu tiên hoặc dữ liệu đã chuẩn hóa. */
export function validateNewAccount(body: unknown): { ok: true; value: NewAccount } | { ok: false; code: string; message: string } {
  if (!isRecord(body)) return { ok: false, code: "ACCOUNT_INVALID", message: "Thiếu thông tin tài khoản." };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL.test(email)) return { ok: false, code: "ACCOUNT_EMAIL_INVALID", message: "Email không hợp lệ." };
  if (fullName.length > 100) return { ok: false, code: "ACCOUNT_NAME_TOO_LONG", message: "Họ tên tối đa 100 ký tự." };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: "ACCOUNT_PASSWORD_SHORT", message: `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.` };
  if (!isRole(body.role)) return { ok: false, code: "ACCOUNT_ROLE_INVALID", message: "Vai trò không hợp lệ." };
  return { ok: true, value: { email, fullName, password, role: body.role } };
}

function validateChange(body: unknown): { ok: true; value: AccountChange } | { ok: false; code: string; message: string } {
  if (!isRecord(body) || typeof body.id !== "string" || !body.id) return { ok: false, code: "ACCOUNT_INVALID", message: "Thiếu tài khoản cần sửa." };
  const change: AccountChange = { id: body.id };
  if (body.role !== undefined) { if (!isRole(body.role)) return { ok: false, code: "ACCOUNT_ROLE_INVALID", message: "Vai trò không hợp lệ." }; change.role = body.role; }
  if (body.fullName !== undefined) {
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    if (fullName.length > 100) return { ok: false, code: "ACCOUNT_NAME_TOO_LONG", message: "Họ tên tối đa 100 ký tự." };
    change.fullName = fullName;
  }
  if (body.password !== undefined) {
    if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: "ACCOUNT_PASSWORD_SHORT", message: `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.` };
    change.password = body.password;
  }
  if (body.locked !== undefined) { if (typeof body.locked !== "boolean") return { ok: false, code: "ACCOUNT_INVALID", message: "Trạng thái khóa không hợp lệ." }; change.locked = body.locked; }
  return { ok: true, value: change };
}

/** Quản trị tài khoản: GET danh sách, POST thêm, PATCH sửa vai trò / họ tên / mật khẩu / khóa. Chỉ Admin. */
export async function handleAccountRequest(request: Request, env: AccountEnv, deps: AccountDeps): Promise<Response> {
  const adminId = await resolveAdmin(request, env, deps);
  if (!adminId) return fail(401, "ACCOUNT_UNAUTHORIZED", "Chỉ Admin được quản trị tài khoản.");
  const store = deps.store;
  if (!store) return fail(503, "ACCOUNT_NOT_CONFIGURED", "Máy chủ chưa cấu hình SUPABASE_SECRET_KEY.");
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const audit = (action: string, entityId: string, before: unknown, after: unknown) => store.appendAudit({ id: newId(), at: now(), actorId: adminId, role: "admin", action, entityType: "account", entityId, before, after });

  if (request.method === "GET") return json(200, { ok: true, accounts: await store.list() });
  const body = await request.json().catch(() => null) as unknown;

  if (request.method === "POST") {
    const parsed = validateNewAccount(body);
    if (!parsed.ok) return fail(400, parsed.code, parsed.message);
    const created = await store.create(parsed.value);
    if (!created.ok) return fail(409, created.code, "Email này đã có tài khoản.");
    await audit("account.create", created.account.id, null, auditDoc(created.account));
    return json(200, { ok: true, account: created.account });
  }

  if (request.method === "PATCH") {
    const parsed = validateChange(body);
    if (!parsed.ok) return fail(400, parsed.code, parsed.message);
    const change = parsed.value;
    // Tự hạ quyền hay tự khóa mình thì không ai còn mở lại được
    if (change.id === adminId && ((change.role !== undefined && change.role !== "admin") || change.locked === true)) return fail(400, "ACCOUNT_SELF_LOCKOUT", "Không thể tự đổi vai trò hoặc tự khóa tài khoản của mình.");
    const before = await store.get(change.id);
    if (!before) return fail(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản.");
    await store.update(change);
    const after: Account = { ...before, ...(change.role !== undefined ? { role: change.role } : {}), ...(change.fullName !== undefined ? { fullName: change.fullName } : {}), ...(change.locked !== undefined ? { locked: change.locked } : {}) };
    if (change.role !== undefined && change.role !== before.role) await audit("account.role", change.id, auditDoc(before), auditDoc(after));
    if (change.fullName !== undefined && change.fullName !== before.fullName) await audit("account.update", change.id, auditDoc(before), auditDoc(after));
    if (change.locked !== undefined && change.locked !== before.locked) await audit(change.locked ? "account.lock" : "account.unlock", change.id, auditDoc(before), auditDoc(after));
    if (change.password !== undefined) await audit("account.password", change.id, null, { email: before.email });
    return json(200, { ok: true, account: after });
  }

  return fail(405, "METHOD_NOT_ALLOWED", "Phương thức không hỗ trợ.");
}
