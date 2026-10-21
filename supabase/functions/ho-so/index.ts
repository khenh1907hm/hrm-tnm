// Edge Function "ho-so": lưu hồ sơ nhân viên từ file do skill /ho-so của Claude tạo.
//
// Web (nút "Nhập từ Claude") đọc file rồi gọi function này với phiên đăng nhập của người dùng.
// Quy tắc (đọc file, cấp mã, so CCCD, kiểm tra nhân sự) nằm ở src/modules/claude-ho-so và được đóng gói
// vào hoSoRules.mjs bằng `npm run build:ho-so-fn` — web và máy chủ dùng chung một bộ quy tắc.
//
// Xác thực: Authorization: Bearer <JWT> của tài khoản vai trò admin hoặc hr (đọc từ bảng profiles).
// Tuỳ chọn: header x-ho-so-token (mã trong bảng ho_so_keys, chỉ lưu SHA-256) cho môi trường gọi thẳng.
//
// Body: { mode, file, overrides?: { phone?, startDate?, group? }, replace_photo?: boolean,
//         employee_id?, expected_version? }
//   mode "preview": kiểm tra, trả kế hoạch (tạo mới + mã dự kiến, hoặc cập nhật + danh sách thay đổi). Không ghi.
//   mode "create":  tạo nhân viên mới (CCCD chưa có), lưu ảnh vào hr-files/employees/<id>, ghi nhật ký.
//   mode "update":  cập nhật hồ sơ trùng CCCD (employee_id + expected_version lấy từ preview), ghi nhật ký.
//                   Ảnh cũ giữ nguyên trong kho.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as bundled from "./hoSoRules.mjs";

type Issue = { code: string; field?: string; severity: "error" | "warning" };
type Employee = Record<string, any> & { id: string; version: number; code: string; cccd: string };
type Change = { field: string; old: string | null; new: string | null };
type Plan = { kind: "new" | "existing"; code?: string; employee?: Employee; input: Record<string, any>; changes?: Change[]; errors: Issue[]; warnings: Issue[] };
type HoSoFile = { employee: Record<string, string>; photo: { mime: string; base64: string; size: number }; notes: string[] };
type Parsed = { ok: true; value: HoSoFile } | { ok: false; errors: Issue[] };
/** Kiểu cho các hàm đóng gói từ src/modules/claude-ho-so (đã có test đầy đủ ở web). */
const rules = bundled as unknown as {
  HO_SO_FIELD_LABELS: Record<string, string>;
  messagesVi: Record<string, string>;
  maskCccd: (value: string) => string;
  parseHoSoFile: (raw: string) => Parsed;
  planHoSo: (file: HoSoFile, overrides: Record<string, unknown>, all: Employee[], today: string, commanderIds: string[], replacePhoto: boolean) => Plan;
  newEmployeeRecord: (input: Record<string, any>, id: string, photo: unknown) => Employee;
  updatedEmployeeRecord: (employee: Employee, input: Record<string, any>, changes: Change[], photo: unknown) => Employee;
};
const { HO_SO_FIELD_LABELS, messagesVi, maskCccd, parseHoSoFile, planHoSo, newEmployeeRecord, updatedEmployeeRecord } = rules;
type Caller = { label: string; role: "admin" | "hr"; actorId: string; source: "web-nhap-tu-claude" | "skill-ho-so" };

const BUCKET = "hr-files";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ho-so-token",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const describe = (items: Issue[]) => items.map((item) => ({ ...item, message: messagesVi[item.code] ?? "Thông tin chưa hợp lệ." }));
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { ok: false, error: messagesVi[code] ?? code, errors: describe([{ code, severity: "error" }]), ...extra });
const auditCopy = (value: Employee | null) => (value ? { ...value, cccd: maskCccd(value.cccd) } : null);
const todayVN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request): Promise<Caller | Response> {
  const token = req.headers.get("x-ho-so-token") ?? "";
  if (token) {
    const { data: key, error } = await db.from("ho_so_keys").select("id, label, role, actor_id").eq("key_hash", await sha256(token)).eq("active", true).maybeSingle();
    if (error) return json(500, { ok: false, error: error.message });
    if (!key) return json(401, { ok: false, error: "Sai mã truy cập hoặc mã đã bị thu hồi" });
    await db.from("ho_so_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
    return { label: key.label, role: key.role, actorId: key.actor_id ?? `skill-ho-so:${key.label}`, source: "skill-ho-so" };
  }
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!jwt) return json(401, { ok: false, error: "Chưa đăng nhập" });
  const { data: auth, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !auth?.user) return json(401, { ok: false, error: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại" });
  const { data: profile, error: profErr } = await db.from("profiles").select("role, full_name").eq("id", auth.user.id).maybeSingle();
  if (profErr) return json(500, { ok: false, error: profErr.message });
  if (profile?.role !== "admin" && profile?.role !== "hr") return fail(403, "FORBIDDEN");
  return { label: profile.full_name || auth.user.email || auth.user.id, role: profile.role, actorId: auth.user.id, source: "web-nhap-tu-claude" };
}

async function loadContext() {
  const [employees, commanders] = await Promise.all([
    db.from("employees").select("doc").order("created_at", { ascending: true }),
    db.from("commanders").select("doc"),
  ]);
  if (employees.error) throw employees.error;
  if (commanders.error) throw commanders.error;
  return {
    all: (employees.data ?? []).map((row: { doc: Employee }) => row.doc),
    commanderIds: (commanders.data ?? []).map((row: { doc: Record<string, any> }) => row.doc).filter((c: Record<string, any>) => !c.archived).map((c: Record<string, any>) => String(c.id)),
  };
}

async function uploadPhoto(photo: { mime: string; base64: string; size: number }, code: string) {
  const id = crypto.randomUUID();
  const bytes = Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0));
  const ext = photo.mime === "image/png" ? "png" : photo.mime === "image/webp" ? "webp" : "jpg";
  const up = await db.storage.from(BUCKET).upload(`employees/${id}`, bytes, { contentType: photo.mime });
  if (up.error) throw up.error;
  return { id, name: `anh-3x4-${code}.${ext}`, mime: photo.mime, size: bytes.length };
}

async function audit(caller: Caller, action: string, entityId: string, before: Employee | null, after: Employee) {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  return await db.from("audit_events").insert({
    id, at, actor_id: caller.actorId, action, entity_type: "employee", entity_id: entityId,
    doc: { id, at, actorId: caller.actorId, role: caller.role, action, entityType: "employee", entityId,
      before: auditCopy(before), after: auditCopy(after), source: caller.source, actorLabel: caller.label },
  });
}

function planView(plan: Plan) {
  const base = { ok: plan.errors.length === 0, kind: plan.kind, input: plan.input, errors: describe(plan.errors), warnings: describe(plan.warnings) };
  if (plan.kind === "new") return { ...base, code: plan.code };
  const e = plan.employee!;
  return {
    ...base, code: e.code,
    existing: { id: e.id, code: e.code, name: e.name, version: e.version, status: e.status, archivedAt: e.archivedAt ?? null, hasPhoto: Boolean(e.photo) },
    changes: (plan.changes ?? []).map((c) => ({ ...c, label: HO_SO_FIELD_LABELS[c.field] })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Chỉ nhận POST" });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Body phải là JSON" }); }
  const mode = body.mode ?? "preview";
  if (!["preview", "create", "update"].includes(mode)) return json(400, { ok: false, error: `mode không hợp lệ: ${mode}` });

  const parsed = parseHoSoFile(typeof body.file === "string" ? body.file : JSON.stringify(body.file ?? null));
  if (!parsed.ok) return json(422, { ok: false, error: messagesVi[parsed.errors[0]!.code], errors: describe(parsed.errors) });
  const file = parsed.value;
  const overrides = {
    ...(typeof body.overrides?.phone === "string" ? { phone: body.overrides.phone } : {}),
    ...(typeof body.overrides?.startDate === "string" ? { startDate: body.overrides.startDate } : {}),
    ...(body.overrides?.group === null || Number.isFinite(body.overrides?.group) ? { group: body.overrides.group } : {}),
  };
  const replacePhoto = body.replace_photo !== false;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { all, commanderIds } = await loadContext();
      const today = todayVN();
      const plan = planHoSo(file, overrides, all, today, commanderIds, replacePhoto);
      if (mode === "preview") return json(200, { ...planView(plan), notes: file.notes, today });
      if (plan.errors.length) return json(422, { ...planView(plan), error: describe(plan.errors)[0]!.message });

      if (mode === "create") {
        if (plan.kind !== "new") return json(409, { ...planView(plan), error: `CCCD đã có ở hồ sơ ${plan.employee!.code} – ${plan.employee!.name}. Xem lại để cập nhật.` });
        const id = crypto.randomUUID();
        const photo = await uploadPhoto(file.photo, plan.code!);
        const record = newEmployeeRecord(plan.input, id, photo);
        const ins = await db.from("employees").insert({ id, version: 1, code: record.code, cccd: record.cccd, doc: record });
        if (ins.error) {
          await db.storage.from(BUCKET).remove([`employees/${photo.id}`]);
          // Có người vừa lưu cùng lúc (trùng mã hoặc CCCD): lập lại kế hoạch với dữ liệu mới
          if (ins.error.code === "23505" && attempt < 2) continue;
          throw ins.error;
        }
        const a = await audit(caller, "employee.create", id, null, record);
        return json(200, { ok: true, mode, id, code: record.code, name: record.name, warnings: describe(plan.warnings), auditError: a.error?.message ?? null });
      }

      // update
      if (plan.kind !== "existing") return fail(409, "EMP_NOT_FOUND");
      const current = plan.employee!;
      const changes = plan.changes ?? [];
      if (current.id !== body.employee_id) return json(409, { ok: false, error: "CCCD trong file không khớp hồ sơ cần cập nhật." });
      if (current.version !== Number(body.expected_version)) return fail(409, "CONFLICT");
      if (!changes.length) return json(200, { ok: true, mode, id: current.id, code: current.code, unchanged: true });
      const photo = replacePhoto ? await uploadPhoto(file.photo, current.code) : null;
      const record = updatedEmployeeRecord(current, plan.input, changes, photo);
      const upd = await db.from("employees").update({ version: record.version, doc: record }).eq("id", current.id).eq("version", current.version).select("id");
      if (upd.error || !upd.data?.length) {
        if (photo) await db.storage.from(BUCKET).remove([`employees/${photo.id}`]);
        if (upd.error) throw upd.error;
        return fail(409, "CONFLICT");
      }
      const a = await audit(caller, "employee.update", current.id, current, record);
      return json(200, { ok: true, mode, id: current.id, code: current.code, name: record.name,
        changed: changes.map((c) => HO_SO_FIELD_LABELS[c.field]), warnings: describe(plan.warnings), auditError: a.error?.message ?? null });
    }
    return fail(409, "CONFLICT");
  } catch (err) {
    return json(500, { ok: false, error: err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err) });
  }
});
