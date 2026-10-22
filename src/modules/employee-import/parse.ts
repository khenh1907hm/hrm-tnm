import { normalizeText } from "../../lib/text";
import { isValidISODate } from "../../lib/dates";
import { decodeCccd, type Gender } from "../../lib/vietnam/cccd";
import { POSITIONS, type EmployeeInput, type EmploymentStatus, type Position } from "../employees/types";

/** Giá trị ô sau khi đã gỡ lớp vỏ của ExcelJS (công thức, chữ định dạng, liên kết). */
export type PlainCell = string | number | boolean | Date | null;

export const IMPORT_FIELDS = ["code", "name", "dob", "gender", "cccd", "phone", "home", "address", "currentAddress", "position", "group", "startDate", "companyStartDate", "status", "endDate"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  code: "Mã NV", name: "Họ và tên", dob: "Ngày sinh", gender: "Giới tính", cccd: "Số CCCD", phone: "Số điện thoại",
  home: "Nguyên quán", address: "Địa chỉ thường trú", currentAddress: "Nơi ở hiện tại", position: "Chức danh",
  group: "Nhóm ATLĐ", startDate: "Ngày làm nghề", companyStartDate: "Ngày vào TNM", status: "Tình trạng", endDate: "Ngày nghỉ việc",
};

/** Cột bắt buộc phải có trong file. Giới tính không bắt buộc vì suy được từ số CCCD. */
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ["code", "name", "dob", "cccd", "phone", "position", "startDate"];

/** Các cách đặt tên cột thường gặp (đã bỏ dấu, chữ thường). So khớp nguyên cụm. */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  code: ["ma nv", "ma nhan vien", "msnv", "ma so nhan vien", "ma"],
  name: ["ho va ten", "ho ten", "ten nhan vien", "ten"],
  dob: ["ngay sinh", "ngay thang nam sinh", "sinh ngay"],
  gender: ["gioi tinh", "gt", "phai"],
  cccd: ["so cccd", "cccd", "can cuoc", "can cuoc cong dan", "so can cuoc", "cccd/cmnd", "cmnd/cccd", "so cmnd/cccd"],
  phone: ["so dien thoai", "dien thoai", "sdt", "so dt", "dt", "di dong"],
  home: ["nguyen quan", "que quan", "que"],
  address: ["dia chi thuong tru", "thuong tru", "noi thuong tru", "ho khau thuong tru", "dia chi"],
  currentAddress: ["noi o hien tai", "dia chi hien tai", "cho o hien tai", "tam tru"],
  position: ["chuc danh", "chuc vu", "vi tri"],
  group: ["nhom atld", "nhom an toan", "nhom huan luyen", "nhom an toan lao dong"],
  startDate: ["ngay lam nghe", "ngay vao nghe", "ngay bat dau lam nghe", "ngay nhan viec", "ngay vao lam", "ngay vao", "ngay bat dau lam viec", "ngay bat dau"],
  companyStartDate: ["ngay vao tnm", "ngay bat dau lam viec tai tnm", "ngay vao cong ty", "ngay vao lam tai tnm"],
  status: ["tinh trang", "trang thai", "tinh trang lam viec"],
  endDate: ["ngay nghi viec", "ngay nghi"],
};

export type ColumnMap = Partial<Record<ImportField, number>>;
export type ParsedRow = {
  /** Số dòng trong Excel (bắt đầu từ 1), để người dùng tìm lại. */
  rowNumber: number;
  /** Nội dung gốc từng ô (dạng chữ), dùng cho file báo lỗi. */
  cells: string[];
  /** null khi có ô không đọc được. */
  input: EmployeeInput | null;
  errors: string[];
  notes: string[];
};
export type ParsedSheet = { headerRow: number; headers: string[]; columns: ColumnMap; missing: ImportField[]; rows: ParsedRow[] };

/** Gỡ giá trị thật từ ô ExcelJS: công thức lấy kết quả, chữ định dạng nối lại, liên kết lấy chữ. */
export function plainCell(value: unknown): PlainCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) return plainCell(record.result);
    if (Array.isArray(record.richText)) return record.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("");
    if ("text" in record) return plainCell(record.text);
    if ("error" in record) return null;
  }
  return String(value);
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoOf = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

export function cellText(value: PlainCell): string {
  if (value === null) return "";
  if (value instanceof Date) return isoOf(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  return String(value).trim();
}

const isBlank = (value: PlainCell) => cellText(value) === "";

/** Đọc ngày: ô ngày của Excel, số ngày kiểu Excel, hoặc chữ dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd. */
export function parseDateCell(value: PlainCell): { value: string } | { error: string } {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { error: "ngày không hợp lệ" };
    return { value: isoOf(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) };
  }
  if (typeof value === "number") {
    if (value >= 1900 && value <= 2100 && Number.isInteger(value)) return { error: `chỉ có năm ${value}, cần đủ ngày/tháng/năm` };
    if (value < 1 || value > 80000) return { error: "ngày không hợp lệ" };
    const date = new Date(Math.round((value - 25569) * 86400000));
    return { value: isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) };
  }
  const text = cellText(value);
  if (/^\d{4}$/.test(text)) return { error: `chỉ có năm ${text}, cần đủ ngày/tháng/năm` };
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  let iso = match ? isoOf(Number(match[1]), Number(match[2]), Number(match[3])) : null;
  if (!iso) {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (match) iso = isoOf(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  if (!iso || !isValidISODate(iso)) return { error: `“${text}” không phải ngày dd/mm/yyyy` };
  return { value: iso };
}

/**
 * CCCD bị Excel lưu thành số thì mất các số 0 đầu (mã tỉnh 001–096 luôn bắt đầu bằng 0,
 * Hà Nội "001" mất hai số). Bù lại cho đủ 12 số; số 9 chữ số giữ nguyên để báo là CMND cũ.
 */
function cccdCell(value: PlainCell): string {
  if (typeof value === "number") {
    const text = String(Math.round(value));
    return text.length === 10 || text.length === 11 ? text.padStart(12, "0") : text;
  }
  return cellText(value).replace(/[\s.\-']/g, "");
}

/** Điện thoại lưu thành số (hoặc gõ thiếu số 0) còn 9 số: thêm 0 đầu. */
function phoneCell(value: PlainCell): string {
  const text = typeof value === "number" ? String(Math.round(value)) : cellText(value).replace(/[\s.\-()']/g, "");
  return /^[35789]\d{8}$/.test(text) ? `0${text}` : text;
}

function genderCell(value: PlainCell): Gender | null | "invalid" {
  const text = normalizeText(cellText(value));
  if (!text) return null;
  if (["nam", "m", "male", "trai"].includes(text)) return "Nam";
  if (["nu", "f", "female", "gai"].includes(text)) return "Nữ";
  return "invalid";
}

function positionCell(value: PlainCell): Position | null {
  const text = normalizeText(cellText(value));
  return POSITIONS.find((position) => normalizeText(position) === text) ?? null;
}

function statusCell(value: PlainCell): EmploymentStatus | null {
  const text = normalizeText(cellText(value));
  if (!text || ["dang lam", "dang lam viec", "con lam", "active", "chinh thuc"].includes(text)) return "active";
  if (["tam nghi", "nghi phep", "nghi thai san", "on leave"].includes(text)) return "on_leave";
  if (["nghi viec", "da nghi", "da nghi viec", "thoi viec", "resigned"].includes(text)) return "resigned";
  return null;
}

/** Tìm dòng tiêu đề trong 15 dòng đầu: dòng khớp được nhiều cột nhất (ít nhất 3). */
export function detectColumns(rows: readonly (readonly PlainCell[])[]): { headerRow: number; columns: ColumnMap } | null {
  let best: { headerRow: number; columns: ColumnMap } | null = null;
  let bestScore = 2;
  for (const [index, row] of rows.slice(0, 15).entries()) {
    const columns: ColumnMap = {};
    row.forEach((cell, column) => {
      const header = normalizeText(cellText(cell)).replace(/[:*()]/g, " ").replace(/\s+/g, " ").trim();
      if (!header) return;
      const field = IMPORT_FIELDS.find((candidate) => columns[candidate] === undefined && HEADER_ALIASES[candidate].includes(header));
      if (field) columns[field] = column;
    });
    const score = Object.keys(columns).length;
    if (score > bestScore) { best = { headerRow: index, columns }; bestScore = score; }
  }
  return best;
}

/** Chuyển một dòng Excel thành hồ sơ nhân sự. Ô nào không đọc được thì ghi lỗi, không tự đoán. */
export function parseRow(row: readonly PlainCell[], columns: ColumnMap, rowNumber: number): ParsedRow {
  const get = (field: ImportField): PlainCell => (columns[field] === undefined ? null : row[columns[field]!] ?? null);
  const errors: string[] = [];
  const notes: string[] = [];
  const label = (field: ImportField) => IMPORT_FIELD_LABELS[field];

  const date = (field: ImportField, required: boolean): string | null => {
    const value = get(field);
    if (isBlank(value)) { if (required) errors.push(`${label(field)}: còn trống`); return null; }
    const parsed = parseDateCell(value);
    if ("error" in parsed) { errors.push(`${label(field)}: ${parsed.error}`); return null; }
    return parsed.value;
  };

  const code = cellText(get("code")).replace(/\s+/g, "").toUpperCase();
  const name = cellText(get("name")).replace(/\s+/g, " ");
  if (!code) errors.push(`${label("code")}: còn trống`);
  if (!name) errors.push(`${label("name")}: còn trống`);
  const dob = date("dob", true);
  const startDate = date("startDate", true);
  const companyStartDate = date("companyStartDate", false);
  const endDate = date("endDate", false);
  const cccd = cccdCell(get("cccd"));
  if (!cccd) errors.push(`${label("cccd")}: còn trống`);
  const phone = phoneCell(get("phone"));

  let gender = genderCell(get("gender"));
  if (gender === "invalid") { errors.push(`${label("gender")}: “${cellText(get("gender"))}” phải là Nam hoặc Nữ`); gender = null; }
  else if (gender === null) {
    const decoded = decodeCccd(cccd);
    if (decoded) { gender = decoded.gender; notes.push(`Giới tính lấy theo số CCCD: ${decoded.gender}`); }
    else errors.push(`${label("gender")}: còn trống và không suy được từ số CCCD`);
  }

  const position = positionCell(get("position"));
  if (!position) errors.push(`${label("position")}: “${cellText(get("position"))}” không thuộc danh sách (${POSITIONS.join(", ")})`);

  let group: number | null = null;
  const groupText = cellText(get("group"));
  if (groupText) {
    const parsed = Number(groupText.replace(/^nhom\s*/i, ""));
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 6) group = parsed;
    else errors.push(`${label("group")}: “${groupText}” phải là số từ 1 đến 6`);
  }

  const status = statusCell(get("status"));
  if (!status) errors.push(`${label("status")}: “${cellText(get("status"))}” không rõ (dùng: Đang làm, Tạm nghỉ, Nghỉ việc)`);
  if (status === "resigned" && !endDate && !errors.some((item) => item.startsWith(label("endDate")))) errors.push(`${label("endDate")}: người đã nghỉ việc cần có ngày nghỉ`);

  const cells = row.map(cellText);
  if (errors.length || !dob || !startDate || !gender || !position || !status) return { rowNumber, cells, input: null, errors, notes };
  const currentAddress = cellText(get("currentAddress"));
  const input: EmployeeInput = {
    code, name, dob, gender, cccd, phone,
    home: cellText(get("home")), address: cellText(get("address")),
    ...(currentAddress ? { currentAddress } : {}),
    position, group, startDate, companyStartDate, emergencyContactId: null, status, endDate: status === "resigned" ? endDate : null,
  };
  return { rowNumber, cells, input, errors, notes };
}

/** Đọc cả trang tính: tìm tiêu đề, bỏ dòng trống, chuyển từng dòng. */
export function parseSheet(rows: readonly (readonly PlainCell[])[]): ParsedSheet | null {
  const detected = detectColumns(rows);
  if (!detected) return null;
  const { headerRow, columns } = detected;
  const headers = (rows[headerRow] ?? []).map(cellText);
  const missing = REQUIRED_IMPORT_FIELDS.filter((field) => columns[field] === undefined);
  const parsed: ParsedRow[] = [];
  rows.forEach((row, index) => {
    if (index <= headerRow || row.every(isBlank)) return;
    parsed.push(parseRow(row, columns, index + 1));
  });
  return { headerRow: headerRow + 1, headers, columns, missing, rows: parsed };
}
