import ExcelJS from "exceljs";
import { SYSTEM_FIELDS } from "./fieldValues";
import { parseRange } from "./fillWorkbook";
import { IMAGE_FIELDS } from "./profileConfig";

/** Cách ghi mã vào ô: "replace" thay cả ô bằng mã; "append" giữ chữ đang có (vd "Họ tên:") và thêm mã phía sau. */
export type PlacementMode = "replace" | "append";
export type FieldPlacement = { cell: string; field: string; mode?: PlacementMode };

/** Một trường chọn được khi gán ô: trường hồ sơ, ô ☑ chứng chỉ hoặc ảnh. */
export type CatalogField = { key: string; label: string; group: "employee" | "computed" | "contact" | "signer" | "certificate" | "image"; kind: "text" | "date" | "checkbox" | "image" };

export const CATALOG_GROUP_LABELS: Readonly<Record<CatalogField["group"], string>> = {
  employee: "Thông tin nhân sự",
  computed: "Tự tính",
  contact: "Người liên hệ khẩn cấp",
  signer: "Người ký",
  certificate: "Ô đánh dấu ☑ có chứng chỉ",
  image: "Ảnh (lấp đầy vùng ô đã chọn)",
};

/** Toàn bộ trường app tự điền được, theo phiên bản app hiện tại (dùng cho ô chọn dữ liệu và bộ quy tắc gửi AI). */
export function templateFieldCatalog(certificateTypes: readonly { key: string; name: string }[]): CatalogField[] {
  return [
    ...SYSTEM_FIELDS.map((field): CatalogField => ({ key: field.key, label: field.label, group: field.group, kind: field.kind })),
    ...certificateTypes.map((type): CatalogField => ({ key: `cert:${type.key}`, label: `☑ ${type.name}`, group: "certificate", kind: "checkbox" })),
    ...IMAGE_FIELDS.map((field): CatalogField => ({ key: field.key, label: field.label, group: "image", kind: "image" })),
  ];
}

const code = (field: string) => `{{${field}}}`;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return typeof value === "object" ? "" : String(value);
}

async function editSheet(bytes: Uint8Array, sheetName: string | undefined, edit: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const sheet = (sheetName ? workbook.getWorksheet(sheetName) : undefined) ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Tệp mẫu không có sheet nào.");
  edit(sheet);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Ô chủ của vùng gộp chứa ô này (ghi vào ô con của vùng gộp thì Excel không hiện). */
const masterOf = (sheet: ExcelJS.Worksheet, address: string) => {
  const cell = sheet.getCell(address);
  return cell.isMerged ? cell.master : cell;
};

/**
 * Ghi mã {{trường}} vào ô của file mẫu, ngay trong app (không phải tải file về sửa). Định dạng ô giữ nguyên;
 * ô thuộc vùng gộp thì ghi vào ô chủ. Mã đã có trong ô thì không ghi lặp.
 */
export function placeFieldCodes(bytes: Uint8Array, sheetName: string | undefined, placements: readonly FieldPlacement[]): Promise<Uint8Array> {
  return editSheet(bytes, sheetName, (sheet) => {
    for (const placement of placements) {
      const [start] = parseRange(placement.cell.replace(/\$/g, ""));
      const cell = masterOf(sheet, sheet.getCell(start.row, start.col).address);
      const text = cellText(cell.value);
      if (text.includes(code(placement.field))) continue;
      cell.value = placement.mode === "append" && text.trim() ? `${text.replace(/\s+$/, "")} ${code(placement.field)}` : code(placement.field);
    }
  });
}

/** Gỡ mã {{trường}} khỏi file mẫu: trong vùng `range` nếu có, không thì khỏi mọi ô. Ô chỉ còn khoảng trắng thì để trống. */
export function removeFieldCode(bytes: Uint8Array, sheetName: string | undefined, field: string, range?: string): Promise<Uint8Array> {
  return editSheet(bytes, sheetName, (sheet) => {
    const [start, end] = range ? parseRange(range.replace(/\$/g, "")) : [null, null];
    const pattern = new RegExp(`\\s*\\{\\{\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g");
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (start && end) {
        const col = Number(cell.col), line = Number(cell.row);
        if (col < start.col || col > end.col || line < start.row || line > end.row) return;
      }
      const text = cellText(cell.value);
      if (!pattern.test(text)) return;
      pattern.lastIndex = 0;
      const rest = text.replace(pattern, "");
      cell.value = rest.trim() ? rest : null;
    }));
  });
}
