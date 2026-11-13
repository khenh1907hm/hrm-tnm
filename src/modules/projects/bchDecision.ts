/**
 * Quyết định thành lập Ban chỉ huy công trường (mẫu công ty public/templates/bch/QD_BCH.xlsx):
 * điền số / ngày quyết định, gói thầu, công trình, người chịu trách nhiệm, Giám đốc ký và bảng thành viên (thêm / bớt dòng);
 * bỏ khung "Ô NHẬP LIỆU (không in)" ở cột G–J, thay công thức bằng chữ để file mở ở đâu cũng đúng.
 */
import ExcelJS from "exceljs";

export type BchMember = { name: string; title: string; phone: string };
export type BchInput = {
  number: number;
  signedOn: string;
  packageName: string;
  worksName: string;
  /** "Chủ đầu tư" khi TNM là thầu chính, "Tổng thầu" khi TNM là thầu phụ. */
  responsibleTo: string;
  directorName: string;
  members: readonly BchMember[];
};

export const BCH_TEMPLATE = "/templates/bch/QD_BCH.xlsx";
/** Chức vụ mặc định theo vai trò trong dự án. */
export const BCH_TITLES: Record<string, string> = {
  pm: "Quản lý dự án", commander: "Chỉ huy trưởng", supervisor: "Giám sát", engineer: "Kỹ sư", leader: "Tổ trưởng", worker: "Công nhân", member: "",
};

const FIRST_ROW = 22;
const TEMPLATE_ROWS = 5;
const LAST_PRINT_ROW = 39;

export function bchNumberText(number: number, signedOn: string): string {
  return `Số: ${String(Math.max(0, Math.trunc(number))).padStart(2, "0")}/${signedOn.slice(0, 4)}/QĐ-TNM`;
}
export function bchDateText(signedOn: string): string {
  const [year, month, day] = signedOn.slice(0, 10).split("-");
  return `TP.HCM, ngày ${day} tháng ${month} năm ${year}`;
}

export async function fillBchDecision(template: ArrayBuffer | Uint8Array, input: BchInput): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template instanceof Uint8Array ? template.slice().buffer : template);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("FORM_TEMPLATE_BROKEN");

  // Thêm / bớt dòng bảng thành viên: chụp lại phần từ dòng mẫu đến hết trang in rồi dựng lại (không dùng chèn / xóa dòng
  // của thư viện vì làm hỏng ô gộp), dòng thành viên lấy định dạng dòng mẫu đầu tiên
  const count = Math.max(1, input.members.length);
  const delta = count - TEMPLATE_ROWS;
  type Snap = { height: number | undefined; cells: { value: ExcelJS.CellValue; style: Partial<ExcelJS.Style> }[] };
  const snap = (row: number): Snap => ({ height: ws.getRow(row).height, cells: [1, 2, 3, 4, 5].map((col) => ({ value: ws.getCell(row, col).value, style: JSON.parse(JSON.stringify(ws.getCell(row, col).style ?? {})) as Partial<ExcelJS.Style> })) });
  const memberRow = snap(FIRST_ROW);
  const tailStart = FIRST_ROW + TEMPLATE_ROWS;
  const tail = Array.from({ length: LAST_PRINT_ROW - tailStart + 1 }, (_, index) => snap(tailStart + index));
  const tailMerges = (ws.model.merges ?? []).filter((range) => { const row = Number(range.match(/\d+/)?.[0]); return row >= tailStart && row <= LAST_PRINT_ROW; });
  for (const range of (ws.model.merges ?? []).filter((range) => { const row = Number(range.match(/\d+/)?.[0]); return row >= FIRST_ROW; })) {
    try { ws.unMergeCells(range); } catch { /* bỏ qua */ }
  }
  const lastRow = Math.max(LAST_PRINT_ROW, LAST_PRINT_ROW + delta);
  for (let row = FIRST_ROW; row <= lastRow + 2; row += 1) {
    for (let col = 1; col <= 5; col += 1) { const cell = ws.getCell(row, col); cell.value = null; cell.style = {}; }
  }
  const put = (row: number, from: Snap) => {
    from.cells.forEach((cell, index) => { const target = ws.getCell(row, index + 1); target.style = JSON.parse(JSON.stringify(cell.style)); target.value = cell.value; });
    ws.getRow(row).height = from.height as number;
  };
  for (let index = 0; index < count; index += 1) { put(FIRST_ROW + index, memberRow); ws.mergeCells(`B${FIRST_ROW + index}:C${FIRST_ROW + index}`); }
  tail.forEach((row, index) => put(tailStart + delta + index, row));
  for (const range of tailMerges) {
    const [a, b] = range.split(":");
    const move = (address: string) => address.replace(/\d+/, (row) => String(Number(row) + delta));
    ws.mergeCells(`${move(a!)}:${move(b!)}`);
  }
  const shift = (row: number) => row + delta;

  ws.getCell("A7").value = bchNumberText(input.number, input.signedOn);
  ws.getCell("D7").value = bchDateText(input.signedOn);
  ws.getCell("B19").value = `Thành lập Ban chỉ huy công trường để điều hành và quản lý công việc thi công Gói thầu “${input.packageName.trim()}” – Công trình ${input.worksName.trim()}, gồm các thành viên có tên sau:`;
  for (let index = 0; index < count; index += 1) {
    const member = input.members[index];
    const row = FIRST_ROW + index;
    ws.getCell(`A${row}`).value = member ? index + 1 : null;
    ws.getCell(`B${row}`).value = member?.name.trim() || null;
    ws.getCell(`D${row}`).value = member?.title.trim() || null;
    ws.getCell(`E${row}`).value = member?.phone.trim() || null;
    // Bỏ danh sách chọn chức vụ (trỏ vào cột J đã xóa)
    (ws.getCell(`D${row}`) as unknown as { dataValidation?: unknown }).dataValidation = undefined;
  }
  ws.getCell(`B${shift(28)}`).value = `Ban chỉ huy công trường có trách nhiệm thay mặt Công ty trực tiếp điều hành mọi công việc tại công trình nêu tại Điều 1, thường xuyên báo cáo tình hình, chất lượng, tiến độ thi công về Công ty; chịu trách nhiệm trước ${input.responsibleTo.trim() || "Chủ đầu tư"} và Giám đốc Công ty về các quyết định của mình.`;
  ws.getCell(`D${shift(39)}`).value = input.directorName.trim() ? input.directorName.trim().toLocaleUpperCase("vi") : "..................................";

  // Bỏ khung nhập liệu không in (cột F–J): gỡ gộp ô, xóa chữ và định dạng
  for (const range of [...(ws.model.merges ?? [])]) {
    if (/^[F-J]\d+:/.test(range)) { try { ws.unMergeCells(range); } catch { /* bỏ qua */ } }
  }
  ws.eachRow({ includeEmpty: true }, (row) => {
    for (let col = 6; col <= 12; col += 1) {
      const cell = row.getCell(col);
      cell.value = null;
      cell.style = {};
    }
  });
  for (let col = 7; col <= 12; col += 1) ws.getColumn(col).width = 9;
  // Danh sách chọn của cả sheet trỏ vào cột J: bỏ hết
  const validations = (ws as unknown as { dataValidations?: { model: Record<string, unknown> } }).dataValidations;
  if (validations) validations.model = {};

  ws.pageSetup.printArea = `A1:E${shift(LAST_PRINT_ROW)}`;
  workbook.creator = "Quản trị Online TNM";
  workbook.calcProperties = { ...workbook.calcProperties, fullCalcOnLoad: true };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
