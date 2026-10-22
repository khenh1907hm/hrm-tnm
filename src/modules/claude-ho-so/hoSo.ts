/**
 * Nhập hồ sơ từ Claude (skill /ho-so): đọc file hồ sơ skill xuất ra, quyết định tạo mới hay cập nhật,
 * và kiểm tra bằng đúng quy tắc nhân sự của hệ thống.
 *
 * Module thuần (không gọi mạng/kho dữ liệu) để dùng chung cho web (xem trước) và Edge Function `ho-so`
 * (ghi thật, được đóng gói từ chính file này bằng `npm run build:ho-so-fn`).
 */
import { failure, issue, success, type Issue, type Result } from "../../lib/result";
import { normalizeName } from "../../lib/vietnam/name";
import { normalizePhone } from "../../lib/vietnam/phone";
import { validateEmployee } from "../employees/rules";
import { PHOTO_MIMES } from "../employees/photo";
import type { FileRef } from "../certificates/types";
import { POSITIONS, type Employee, type EmployeeInput } from "../employees/types";

export const HO_SO_FORMAT = "tnm-ho-so";
export const HO_SO_VERSION = 1;
/** Ảnh thẻ skill tạo ra ~60 KB; giới hạn 2 MB để file hồ sơ luôn nhẹ. */
export const HO_SO_MAX_PHOTO = 2 * 1024 * 1024;
const MAX_CODE_NUMBER = 99_999;

export type HoSoEmployee = {
  name: string; cccd: string; dob: string; gender: string; home: string; address: string;
  currentAddress: string; phone: string; position: string; startDate: string;
};
export type HoSoPhoto = { mime: (typeof PHOTO_MIMES)[number]; name: string; base64: string; size: number };
export type HoSoFile = { createdAt: string; employee: HoSoEmployee; photo: HoSoPhoto; notes: string[] };
/** Thông tin người nhập bổ sung trên web trước khi lưu (file không có hoặc cần sửa). */
export type HoSoOverrides = { phone?: string; startDate?: string; group?: number | null };

export type HoSoChangeField = "name" | "dob" | "gender" | "home" | "address" | "currentAddress" | "phone" | "position" | "photo";
export type HoSoChange = { field: HoSoChangeField; old: string | null; new: string | null };
export type HoSoPlan =
  | { kind: "new"; code: string; input: EmployeeInput; errors: Issue[]; warnings: Issue[] }
  | { kind: "existing"; employee: Employee; input: EmployeeInput; changes: HoSoChange[]; errors: Issue[]; warnings: Issue[] };

export const HO_SO_FIELD_LABELS: Record<HoSoChangeField, string> = {
  name: "Họ và tên", dob: "Ngày sinh", gender: "Giới tính", home: "Nguyên quán", address: "Địa chỉ thường trú",
  currentAddress: "Địa chỉ hiện tại", phone: "Điện thoại", position: "Chức danh", photo: "Ảnh 3×4",
};

const text = (value: unknown): string => (typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ") : "");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Số byte thật của chuỗi base64 (không cần giải mã cả ảnh). */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Kiểm tra chữ ký tệp (magic bytes) khớp định dạng khai báo. */
export function photoSignatureMatches(base64: string, mime: string): boolean {
  let head: string;
  try { head = atob(base64.slice(0, 16)); } catch { return false; }
  const bytes = Array.from(head, (char) => char.charCodeAt(0));
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP";
}

/** HOSO-01: đọc và kiểm tra file hồ sơ. Sai định dạng, phiên bản hay ảnh thì từ chối cả file. */
export function parseHoSoFile(raw: string): Result<HoSoFile> {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return failure([issue("HOSO_FILE_INVALID", "file")]); }
  if (!isRecord(data) || data.format !== HO_SO_FORMAT || !isRecord(data.employee)) return failure([issue("HOSO_FILE_INVALID", "file")]);
  if (data.version !== HO_SO_VERSION) return failure([issue("HOSO_FILE_VERSION", "file")]);
  const photo = data.photo;
  const base64 = isRecord(photo) && typeof photo.base64 === "string" ? photo.base64.replace(/\s+/g, "") : "";
  const mime = isRecord(photo) ? photo.mime : undefined;
  const mimeOk = PHOTO_MIMES.some((item) => item === mime);
  const size = base64ByteLength(base64);
  if (!mimeOk || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || size > HO_SO_MAX_PHOTO || !photoSignatureMatches(base64, String(mime)))
    return failure([issue("HOSO_PHOTO_INVALID", "photo")]);
  const e = data.employee;
  const employee: HoSoEmployee = {
    name: text(e.name), cccd: text(e.cccd).replace(/\D/g, ""), dob: text(e.dob), gender: text(e.gender), home: text(e.home),
    address: text(e.address), currentAddress: text(e.currentAddress), phone: text(e.phone), position: text(e.position), startDate: text(e.startDate),
  };
  const notes = Array.isArray(data.notes) ? data.notes.filter((note): note is string => typeof note === "string").map(text).filter(Boolean) : [];
  return success({
    createdAt: text(data.createdAt), employee, notes,
    photo: { mime: mime as HoSoPhoto["mime"], name: text((photo as Record<string, unknown>).name) || "anh-3x4", base64, size },
  });
}

/** HOSO-02: mã mới = TNM + (số lớn nhất trong mọi mã TNM, kể cả hồ sơ đã ẩn) + 1, tối thiểu 3 chữ số. */
export function nextEmployeeCode(codes: readonly string[]): string | null {
  const max = codes.reduce((top, code) => {
    const match = /^TNM(\d+)$/i.exec(code.trim());
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return max + 1 > MAX_CODE_NUMBER ? null : `TNM${String(max + 1).padStart(3, "0")}`;
}

/** Phần kiểm tra kiểu của employeeInputSchema mà dữ liệu từ file có thể vi phạm (giới tính, chức danh). */
const shapeIssues = (input: EmployeeInput): Issue[] => [
  ...(input.gender === "Nam" || input.gender === "Nữ" ? [] : [issue("EMP_INPUT_INVALID", "gender")]),
  ...(POSITIONS.some((position) => position === input.position) ? [] : [issue("EMP_POSITION_INVALID", "position")]),
];

/** Hồ sơ mới từ file + phần bổ sung trên web. Ngày nhận việc mặc định là hôm nay. */
export function buildNewEmployeeInput(file: HoSoFile, overrides: HoSoOverrides, code: string, today: string): EmployeeInput {
  const e = file.employee;
  return {
    code, name: e.name, dob: e.dob, gender: e.gender as EmployeeInput["gender"], cccd: e.cccd,
    phone: text(overrides.phone) || e.phone, home: e.home, address: e.address,
    ...(e.currentAddress ? { currentAddress: e.currentAddress } : {}),
    position: e.position as EmployeeInput["position"], group: overrides.group ?? null,
    startDate: text(overrides.startDate) || e.startDate || today,
    emergencyContactId: null, status: "active", endDate: null,
  };
}

const same = (value: string) => value;
const comparable: Record<Exclude<HoSoChangeField, "photo">, (value: string) => string> = {
  name: normalizeName, dob: same, gender: same, home: same, address: same, currentAddress: same, phone: normalizePhone, position: same,
};

/**
 * HOSO-03: CCCD đã có → chỉ đổi các trường file có giá trị và khác giá trị đang lưu.
 * Không đổi mã, ngày nhận việc, tình trạng, nhóm, người liên hệ. Ảnh luôn được thay (trừ khi bỏ chọn).
 */
export function diffHoSo(employee: Employee, file: HoSoFile, overrides: HoSoOverrides, replacePhoto = true): HoSoChange[] {
  const incoming = { ...file.employee, phone: text(overrides.phone) || file.employee.phone };
  const changes: HoSoChange[] = [];
  for (const field of Object.keys(comparable) as Exclude<HoSoChangeField, "photo">[]) {
    const next = incoming[field];
    if (!next) continue;
    const current = (employee[field] ?? "") as string;
    if (comparable[field](current) !== comparable[field](next)) changes.push({ field, old: current || null, new: next });
  }
  if (replacePhoto) changes.push({ field: "photo", old: employee.photo ? "Có ảnh" : null, new: "Ảnh mới" });
  return changes;
}

/** Dữ liệu sau khi áp các thay đổi lên hồ sơ cũ (để kiểm tra lại toàn bộ quy tắc). */
export function applyHoSoChanges(employee: Employee, changes: readonly HoSoChange[]): EmployeeInput {
  const input: EmployeeInput = {
    code: employee.code, name: employee.name, dob: employee.dob, gender: employee.gender, cccd: employee.cccd, phone: employee.phone,
    home: employee.home, address: employee.address, ...(employee.currentAddress ? { currentAddress: employee.currentAddress } : {}),
    position: employee.position, group: employee.group, startDate: employee.startDate, emergencyContactId: employee.emergencyContactId,
    status: employee.status, endDate: employee.endDate,
  };
  for (const change of changes) if (change.field !== "photo") Object.assign(input, { [change.field]: change.new ?? "" });
  return input;
}

/**
 * Lập kế hoạch cho một file: tạo mới (kèm mã dự kiến) hoặc cập nhật hồ sơ trùng CCCD (kèm danh sách thay đổi).
 * HOSO-04: mọi trường hợp đều qua validateEmployee như nhập tay, không cho ghi đè lệch CCCD.
 * `all` là toàn bộ nhân sự kể cả đã ẩn; `commanderIds` là chỉ huy trưởng còn hiệu lực.
 */
export function planHoSo(file: HoSoFile, overrides: HoSoOverrides, all: readonly Employee[], today: string, commanderIds: string[], replacePhoto = true): HoSoPlan {
  const match = all.find((employee) => employee.cccd === file.employee.cccd);
  if (match) {
    const changes = diffHoSo(match, file, overrides, replacePhoto);
    const input = applyHoSoChanges(match, changes);
    const others = all.filter((employee) => employee.id !== match.id);
    // Chỉ kiểm tra lại khi đổi thông tin; chỉ thay ảnh thì không chặn vì dữ liệu cũ
    if (!changes.some((change) => change.field !== "photo")) return { kind: "existing", employee: match, input, changes, errors: [], warnings: [] };
    const shape = shapeIssues(input);
    if (shape.length) return { kind: "existing", employee: match, input, changes, errors: shape, warnings: [] };
    const validation = validateEmployee({ ...input, mismatchOverrideReason: "" }, today, others, match.id, commanderIds);
    return { kind: "existing", employee: match, input: validation.value, changes, errors: validation.errors, warnings: validation.warnings };
  }
  const code = nextEmployeeCode(all.map((employee) => employee.code));
  const input = buildNewEmployeeInput(file, overrides, code ?? "", today);
  if (!code) return { kind: "new", code: "", input, errors: [issue("HOSO_CODE_EXHAUSTED", "code")], warnings: [] };
  const shape = shapeIssues(input);
  if (shape.length) return { kind: "new", code, input, errors: shape, warnings: [] };
  const validation = validateEmployee({ ...input, mismatchOverrideReason: "" }, today, [...all], undefined, commanderIds);
  return { kind: "new", code, input: validation.value, errors: validation.errors, warnings: validation.warnings };
}

/** Bản ghi nhân sự mới đúng dạng web lưu (xem createEmployeeUseCases.create). */
export function newEmployeeRecord(input: EmployeeInput, id: string, photo: FileRef | null): Employee {
  const { mismatchOverrideReason: _ignored, ...rest } = input;
  void _ignored;
  return { ...rest, photo, id, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null };
}

/** Bản ghi sau cập nhật: giữ mọi trường cũ, áp thay đổi, tăng phiên bản. */
export function updatedEmployeeRecord(employee: Employee, input: EmployeeInput, changes: readonly HoSoChange[], photo: FileRef | null): Employee {
  const next: Employee = { ...employee, version: employee.version + 1 };
  for (const change of changes) if (change.field !== "photo") Object.assign(next, { [change.field]: input[change.field] });
  if (photo) next.photo = photo;
  return next;
}
