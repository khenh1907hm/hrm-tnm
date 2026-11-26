/**
 * Nhập phiếu yêu cầu vật tư từ file Excel theo mẫu P-COST-08 (hoặc bảng tương tự):
 * tìm dòng tiêu đề có "Tên vật tư", nhận cột theo tên (STT, Tên vật tư, Thông số kỹ thuật, Nhà sản xuất, Đơn vị,
 * Số lượng, Ngày cần sử dụng, Ghi chú), đọc các dòng vật tư tới khi gặp khối ký (Lãnh đạo / Người yêu cầu).
 * Phía trên bảng: Tên dự án, Số dự án, Ngày yêu cầu, Người yêu cầu (giá trị là ô có chữ đầu tiên bên phải nhãn).
 */
import type { SheetCell } from "../../lib/xlsReader";
import type { MaterialItem } from "./materials";

export type ImportedMaterial = {
  projectName: string; projectCode: string; requestedOn: string | null; requester: string;
  items: Omit<MaterialItem, "id">[];
  warnings: string[];
};

const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[:*]/g, " ").replace(/\s+/g, " ").trim();
const text = (value: SheetCell | undefined) => (value === null || value === undefined ? "" : typeof value === "number" ? String(value) : value.replace(/\s+/g, " ").trim());

type Column = "stt" | "name" | "spec" | "maker" | "unit" | "quantity" | "neededOn" | "note";
const HEADERS: readonly [Column, RegExp][] = [
  ["stt", /^(stt|tt|no\.?)$/],
  ["name", /ten (vat tu|hang|thiet bi)|vat tu|description|item/],
  ["spec", /thong so|quy cach|spec/],
  ["maker", /nha san xuat|hang sx|nsx|xuat xu|maker|brand/],
  ["unit", /^(don vi( tinh)?|dvt|unit)$/],
  ["quantity", /so luong|^sl$|qty|quantity/],
  ["neededOn", /ngay can|can su dung|ngay su dung|required date/],
  ["note", /ghi chu|note|remark/],
];

/** Số sê-ri ngày của Excel (1900) hoặc chuỗi dd/mm/yyyy, yyyy-mm-dd → ISO. */
export function toIsoDate(value: SheetCell | undefined): string | null {
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  const raw = text(value);
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw);
  if (match) {
    const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
    const iso = `${year}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const toNumber = (value: SheetCell | undefined): number => {
  if (typeof value === "number") return value;
  const raw = text(value).replace(/\s/g, "");
  if (!raw) return 0;
  // 1.234,5 (kiểu Việt) hoặc 1,234.5
  const normalized = /,\d{1,3}$/.test(raw) && !/\.\d{1,3}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

/** Giá trị bên phải một nhãn (cùng dòng): ô có chữ đầu tiên sau nhãn, hoặc phần sau dấu ":" trong chính ô nhãn. */
function labelValue(grid: readonly SheetCell[][], until: number, label: RegExp): SheetCell | null {
  for (let r = 0; r < until; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const folded = fold(row[c]);
      if (!folded || !label.test(folded)) continue;
      const inline = text(row[c]).split(":").slice(1).join(":").trim();
      if (inline) return inline;
      for (let k = c + 1; k < row.length; k += 1) {
        const value = row[k];
        if (value === null || value === undefined || text(value) === "") continue;
        // Gặp nhãn khác (vd "Ngày yêu cầu:") thì ô này trống
        if (typeof value === "string" && /(ngay yeu cau|nguoi yeu cau|ten du an|so du an)/.test(fold(value))) break;
        return value;
      }
    }
  }
  return null;
}

export function parseMaterialGrid(grid: readonly SheetCell[][]): ImportedMaterial {
  const warnings: string[] = [];
  const headerAt = grid.findIndex((row) => (row ?? []).some((cell) => /ten vat tu|ten hang|vat tu/.test(fold(cell))) && (row ?? []).some((cell) => /so luong|^sl$|qty/.test(fold(cell))));
  if (headerAt < 0) throw new Error("MR_IMPORT_NO_HEADER");
  const columns = new Map<Column, number>();
  (grid[headerAt] ?? []).forEach((cell, index) => {
    const folded = fold(cell);
    if (!folded) return;
    const found = HEADERS.find(([key, pattern]) => !columns.has(key) && pattern.test(folded));
    if (found) columns.set(found[0], index);
  });
  if (!columns.has("name") || !columns.has("quantity")) throw new Error("MR_IMPORT_NO_HEADER");
  const at = (row: readonly SheetCell[], key: Column) => { const index = columns.get(key); return index === undefined ? null : row[index] ?? null; };
  const items: Omit<MaterialItem, "id">[] = [];
  for (let r = headerAt + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const joined = fold(row.map((cell) => text(cell)).join(" "));
    if (/lanh dao|nguoi yeu cau|p\.? ky thuat|phong vat tu/.test(joined)) break;
    // Tên vật tư có thể nằm ở ô gộp (cột tên hoặc cột kế bên)
    const nameIndex = columns.get("name")!;
    const name = text(row[nameIndex]) || (columns.get("spec") !== nameIndex + 1 ? text(row[nameIndex + 1]) : "");
    const quantity = toNumber(at(row, "quantity"));
    if (!name && !quantity) continue;
    if (!name) { warnings.push(`Dòng ${r + 1}: có số lượng nhưng thiếu tên vật tư, đã bỏ qua.`); continue; }
    if (!(quantity > 0)) warnings.push(`Dòng ${r + 1} (${name}): số lượng chưa đúng, cần nhập lại.`);
    items.push({
      name, spec: text(at(row, "spec")), maker: text(at(row, "maker")), unit: text(at(row, "unit")),
      quantity: quantity > 0 ? quantity : 0, neededOn: toIsoDate(at(row, "neededOn")), note: text(at(row, "note")), budgetCode: null,
    });
  }
  if (!items.length) warnings.push("Không có dòng vật tư nào trong file.");
  if (items.some((item) => !item.unit)) warnings.push("Có dòng chưa ghi đơn vị: điền trước khi gửi ký.");
  return {
    projectName: text(labelValue(grid, headerAt, /^ten du an/) ?? ""), projectCode: text(labelValue(grid, headerAt, /^so du an|^ma du an/) ?? ""),
    requestedOn: toIsoDate(labelValue(grid, headerAt, /^ngay yeu cau/) ?? null), requester: text(labelValue(grid, headerAt, /^nguoi yeu cau/) ?? ""),
    items, warnings,
  };
}
