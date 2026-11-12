/**
 * Xuất biểu mẫu mua hàng dự án ra Excel bằng chính file mẫu của công ty (public/templates/quy-trinh/*.xlsx):
 * mở mẫu, điền số liệu đúng ô, giữ nguyên bố cục, logo, công thức; ô ký điền tên người ký và ngày ký trên web.
 * P-COST-08 dựng mẫu mới (file .xls gốc có virus macro, không dùng lại).
 */
import ExcelJS from "exceljs";
import type { ApprovalRole, ApprovalStep } from "../purchases/approval";
import { costCodeLabel, sheetTotals, type BudgetSheet, type CostCode } from "../purchases/budget";
import type { ProjectContract } from "../purchases/contract";
import { lineD, lineE, type ExplanatoryReport } from "../purchases/explanatory";
import { cheapestByItem, quoteTotal, type MaterialQuote, type MaterialRequest } from "../purchases/materials";
import type { PurchaseOrder, PurchasePayment } from "../purchases/types";
import { PO_TERMS } from "./poTerms";
import { vndInWords } from "./vndWords";

export type FormCode = "P-COST-01" | "P-COST-03" | "P-COST-05" | "P-COST-08" | "P-CC-07" | "P-CC-08" | "P-CF-03";
export const FORM_TITLES: Record<FormCode, string> = {
  "P-COST-01": "Xác nhận dự án", "P-COST-03": "Ngân sách dự án", "P-COST-05": "Báo cáo giải thích", "P-COST-08": "Phiếu yêu cầu vật tư",
  "P-CC-07": "Đơn đặt hàng nháp", "P-CC-08": "Đơn đặt hàng", "P-CF-03": "Yêu cầu thanh toán",
};
/** Mẫu Excel của công ty nằm trong thư mục public (P-COST-08 dựng trong code). */
export const templatePath = (code: Exclude<FormCode, "P-COST-08">) => `/templates/quy-trinh/${code}.xlsx`;

export type ProjectInfo = { code: string; name: string; site?: string; plannedStart?: string | null; plannedEnd?: string | null };
export type SignStep = Pick<ApprovalStep, "role" | "result" | "signerName" | "actedAt" | "targetDate">;

type Value = ExcelJS.CellValue;
const toDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
/** Ngày theo giờ Việt Nam của một mốc thời gian (timestamptz). */
const vnDay = (iso: string | null | undefined) => iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null;
const dmy = (iso: string | null | undefined) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
/** Ngày giờ duyệt theo giờ Việt Nam: "dd/mm/yyyy HH:mm". */
export const vnDateTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const local = new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString();
  return `${dmy(local)} ${local.slice(11, 16)}`;
};

async function open(template: ArrayBuffer | Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template instanceof Uint8Array ? template.slice().buffer : template);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("FORM_TEMPLATE_BROKEN");
  return { workbook, sheet };
}
async function finish(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  workbook.creator = "Quản trị Online TNM";
  for (const sheet of workbook.worksheets) {
    // Bỏ kết quả công thức còn lưu từ số mẫu để Excel / LibreOffice tính lại theo số mới
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value;
      // (exceljs không trả về kết quả 0 trong .value nhưng vẫn ghi lại khi lưu, nên luôn gán lại)
      if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
        const { result: _result, ...rest } = value as ExcelJS.CellFormulaValue;
        cell.value = rest as ExcelJS.CellValue;
      }
    }));
    // Một số mẫu còn chân trang của công ty khác
    const footer = sheet.headerFooter;
    for (const key of ["oddFooter", "evenFooter", "firstFooter", "oddHeader", "evenHeader", "firstHeader"] as const) {
      if (footer[key]) footer[key] = footer[key]!.replace(/Takasago Vietnam Co\., ?Ltd\.?/g, "Thien Nhat Minh Co., Ltd.");
    }
  }
  // Excel / LibreOffice tính lại công thức của mẫu khi mở
  workbook.calcProperties = { ...workbook.calcProperties, fullCalcOnLoad: true };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
function put(sheet: ExcelJS.Worksheet, address: string, value: Value) {
  sheet.getCell(address).value = value === undefined ? null : value;
}
function putDate(sheet: ExcelJS.Worksheet, address: string, iso: string | null | undefined) {
  const cell = sheet.getCell(address);
  cell.value = toDate(iso);
  if (cell.value && !cell.numFmt) cell.numFmt = "dd/mm/yyyy";
}
function merge(sheet: ExcelJS.Worksheet, range: string) {
  try { sheet.mergeCells(range); } catch { /* đã gộp sẵn trong mẫu */ }
}
const signText = (step: SignStep | undefined) => {
  if (!step) return "";
  // Tên người duyệt, dòng dưới là thời gian duyệt
  if (step.result === "signed") return `${step.signerName || "Đã ký"}\n${vnDateTime(step.actedAt)}`.trim();
  if (step.result === "returned") return `${step.signerName}\n(trả về)`;
  if (step.result === "skipped") return "";
  return "";
};
const stepOf = (steps: readonly SignStep[], role: ApprovalRole) => steps.find((step) => step.role === role);
function signBox(sheet: ExcelJS.Worksheet, steps: readonly SignStep[], boxes: readonly [ApprovalRole, string, string | null][]) {
  for (const [role, nameCell, dateCell] of boxes) {
    const step = stepOf(steps, role);
    const cell = sheet.getCell(nameCell);
    cell.value = signText(step) || null;
    cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle", horizontal: "center" };
    cell.font = { ...cell.font, size: 8 };
    if (dateCell) putDate(sheet, dateCell, step?.result === "signed" ? vnDay(step.actedAt) : null);
  }
}
const box = (checked: boolean) => checked ? "☑" : "☐";

/* ───────────────────────── P-COST-03 Ngân sách ───────────────────────── */
export type BudgetFormInput = { sheet: BudgetSheet; project: ProjectInfo; codes: readonly CostCode[]; steps: readonly SignStep[] };

export async function fillBudgetSheet(template: ArrayBuffer | Uint8Array, input: BudgetFormInput): Promise<Uint8Array> {
  const { workbook, sheet: ws } = await open(template);
  const { sheet, project } = input;
  // Tìm dòng của từng mã trong mẫu (cột B bên trái, cột K bên phải), xóa số mẫu
  const rows = new Map<string, { row: number; right: boolean }>();
  for (let row = 19; row <= 62; row += 1) {
    for (const [col, right] of [[2, false], [11, true]] as const) {
      const code = String(ws.getCell(row, col).value ?? "").trim();
      if (!/^[1-4]\d{2}$/.test(code)) continue;
      rows.set(code, { row, right });
      for (const target of right ? [13, 14, 15, 17] : [4, 5, 6, 8]) ws.getCell(row, target).value = null;
    }
  }
  const extra: string[] = [];
  for (const line of sheet.lines) {
    const place = rows.get(line.code);
    if (!place) { extra.push(`${costCodeLabel(line.code, input.codes)}: ngân sách ${line.budget.toLocaleString("vi-VN")}`); continue; }
    const [nett, budget, supplier, contingency] = place.right ? [13, 14, 15, 17] : [4, 5, 6, 8];
    ws.getCell(place.row, nett).value = line.nett || null;
    ws.getCell(place.row, budget).value = line.budget || null;
    ws.getCell(place.row, supplier).value = line.supplier || null;
    ws.getCell(place.row, contingency).value = line.contingency || (place.right && line.remark ? line.remark : null);
  }
  put(ws, "B6", `${box(sheet.confirmation === "confirmed")} XÁC NHẬN   /   ${box(sheet.confirmation === "tentative")} XN TẠM`);
  put(ws, "D8", project.code);
  put(ws, "G8", sheet.number);
  put(ws, "D9", project.name);
  putDate(ws, "D10", project.plannedStart);
  putDate(ws, "F10", project.plannedEnd);
  put(ws, "L10", sheet.contractValue);
  put(ws, "D13", sheet.quoteNo);
  put(ws, "G13", sheet.exchangeRate);
  put(ws, "H13", Number(sheet.createdAt.slice(0, 4)) || null);
  put(ws, "D14", sheet.offerPrice);
  putDate(ws, "Q2", vnDay(sheet.approvedAt ?? sheet.submittedAt ?? sheet.createdAt));
  put(ws, "Q3", Math.max(0, sheet.revision - 1));
  signBox(ws, input.steps, [["leader", "M3", null], ["technical", "N3", null], ["pic", "O3", null]]);
  for (const [role, cell] of [["leader", "M7"], ["technical", "N7"], ["pic", "O7"]] as const) {
    const step = stepOf(input.steps, role);
    put(ws, cell, `Ngày: ${step?.result === "signed" ? dmy(vnDay(step.actedAt)) : ""}`);
  }
  const totals = sheetTotals(sheet);
  if (extra.length || sheet.note) put(ws, "B63", [sheet.note, extra.length ? `Mã khác: ${extra.join("; ")}` : ""].filter(Boolean).join(" · "));
  ws.getCell("B64").value = `Xuất từ Quản trị Online TNM. Tổng ngân sách ${totals.total.toLocaleString("vi-VN")} đ, lợi nhuận B ${totals.profitB.toLocaleString("vi-VN")} đ.`;
  ws.getCell("B64").font = { italic: true, size: 8, color: { argb: "FF64748B" } };
  return finish(workbook);
}

/* ───────────────────────── P-CC-07 / P-CC-08 Đơn đặt hàng ───────────────────────── */
export type OrderFormInput = {
  order: PurchaseOrder;
  project: ProjectInfo;
  steps: readonly SignStep[];
  /** Số ngân sách đang dùng (S…-01). */
  budgetNumber: string;
  quoteRef?: string;
  quoteDate?: string | null;
  /** Đơn lập từ bảng so sánh báo giá (tích ô "Bảng so sánh"). */
  hasComparison?: boolean;
};

export function paymentTermsText(order: Pick<PurchaseOrder, "advanceRequired" | "advancePct" | "prepayRequired">): string {
  if (order.advanceRequired) return `Tạm ứng ${order.advancePct ?? 0}% sau khi NCC ký xác nhận PO; phần còn lại thanh toán sau khi giao hàng, nghiệm thu và có hóa đơn GTGT.`;
  if (order.prepayRequired) return "Thanh toán trước khi giao hàng (theo đề nghị thanh toán được duyệt).";
  return "Thanh toán sau khi nhận hàng, có biên bản giao nhận hai bên ký và hóa đơn GTGT.";
}
const itemsSummary = (order: PurchaseOrder) => order.items.map((item) => `${item.name}${item.spec ? ` (${item.spec})` : ""}: ${item.quantity.toLocaleString("vi-VN")} ${item.unit}`).join("; ").slice(0, 400);

function addItemsSheet(workbook: ExcelJS.Workbook, order: PurchaseOrder, title: string) {
  const ws = workbook.addWorksheet("Chi tiết hàng", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 6 }, { width: 38 }, { width: 28 }, { width: 9 }, { width: 11 }, { width: 16 }, { width: 18 }];
  ws.addRow([`${title} · ${order.poNo || order.code} · DANH MỤC HÀNG HÓA`]).font = { bold: true, size: 13 };
  ws.addRow([`Nhà cung cấp: ${order.supplier || "—"}    Mã ngân sách: ${order.budgetCode ?? "—"}`]);
  ws.addRow([]);
  const head = ws.addRow(["STT", "Tên hàng", "Quy cách / thông số", "ĐVT", "Số lượng", "Đơn giá (VNĐ)", "Thành tiền (VNĐ)"]);
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }; });
  const first = ws.rowCount + 1;
  order.items.forEach((item, index) => {
    const row = ws.addRow([index + 1, item.name, item.spec, item.unit, item.quantity, item.unitPrice, null]);
    row.getCell(7).value = { formula: `ROUND(E${row.number}*F${row.number},0)` };
  });
  const total = ws.addRow(["", "Cộng (chưa gồm VAT)", "", "", "", "", null]);
  total.getCell(7).value = { formula: `SUM(G${first}:G${Math.max(first, ws.rowCount - 1)})` };
  total.font = { bold: true };
  for (let row = first - 1; row <= ws.rowCount; row += 1) {
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 7) return;
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      if (col >= 5) cell.numFmt = "#,##0";
      cell.alignment = { vertical: "middle", wrapText: col === 2 || col === 3 };
    });
  }
}

function fillOrderHeader(ws: ExcelJS.Worksheet, input: OrderFormInput, issueIso: string | null, poNo: string) {
  const { order, project } = input;
  put(ws, "C10", order.supplier || null);
  putDate(ws, "S10", issueIso);
  put(ws, "S12", poNo);
  put(ws, "S14", project.code);
  put(ws, "S16", project.name);
  put(ws, "C18", order.supplierContact || null);
  put(ws, "S18", order.budgetCode ?? "");
  put(ws, "G22", order.title);
  put(ws, "B24", itemsSummary(order));
  put(ws, "B29", input.quoteRef ?? "");
  putDate(ws, "P29", input.quoteDate ?? null);
  put(ws, "B35", vndInWords(order.totalEstimate));
  put(ws, "U35", order.totalEstimate);
}

/** P-CC-07 đơn đặt hàng nháp: ngày mục tiêu và ô ký 6 bộ phận, phần xác nhận đặt hàng A–E. */
export async function fillPurchaseDraft(template: ArrayBuffer | Uint8Array, input: OrderFormInput): Promise<Uint8Array> {
  const { workbook, sheet: ws } = await open(template);
  const { order } = input;
  fillOrderHeader(ws, input, vnDay(order.submittedAt ?? order.createdAt), order.code);
  put(ws, "F12", null);
  // Hàng 3: ngày mục tiêu; hàng 5: người ký; hàng 8: ngày ký (HC, Lãnh đạo, Kế toán, Vật tư, Kỹ thuật, Phụ trách)
  const columns: [ApprovalRole, string][] = [["admin_office", "J"], ["leader", "M"], ["accounting", "P"], ["material", "S"], ["technical", "V"], ["pic", "Y"]];
  for (const [role, col] of columns) putDate(ws, `${col}3`, stepOf(input.steps, role)?.targetDate ?? null);
  signBox(ws, input.steps, columns.map(([role, col]) => [role, `${col}5`, `${col}8`] as [ApprovalRole, string, string]));
  putDate(ws, "J37", order.expectedDelivery ?? order.neededBy);
  put(ws, "J39", order.deliveryAddress || null);
  const terms = splitLines([paymentTermsText(order), order.note].filter(Boolean).join(" · "), 80, 2);
  put(ws, "J41", terms[0] ?? null);
  put(ws, "J42", terms[1] ?? null);
  put(ws, "H44", "X");
  put(ws, "J54", input.budgetNumber || null);
  put(ws, "J55", order.budgetA ?? null);
  put(ws, "J56", order.budgetB ?? null);
  if (input.hasComparison) put(ws, "J65", "X");
  addItemsSheet(workbook, order, "ĐƠN ĐẶT HÀNG (NHÁP)");
  return finish(workbook);
}

/** P-CC-08 PO chính thức gửi NCC ký, kèm danh mục hàng và điều khoản PO. */
export async function fillPurchaseOrder(template: ArrayBuffer | Uint8Array, input: OrderFormInput): Promise<Uint8Array> {
  const { workbook, sheet: ws } = await open(template);
  const { order } = input;
  fillOrderHeader(ws, input, vnDay(order.poIssuedAt ?? order.approvedAt ?? order.createdAt), order.poNo || order.code);
  for (const address of ["F12", "F14", "F16"]) put(ws, address, null);
  putDate(ws, "J39", order.expectedDelivery ?? order.neededBy);
  put(ws, "J41", order.deliveryAddress || null);
  const termLines = splitLines([paymentTermsText(order), order.note].filter(Boolean).join(" · "), 80, 2);
  put(ws, "J43", termLines[0] ?? null);
  put(ws, "J44", termLines[1] ?? null);
  put(ws, "H46", "X");
  for (const address of ["P56", "P58"]) put(ws, address, "X");
  addItemsSheet(workbook, order, "ĐƠN ĐẶT HÀNG");
  const terms = workbook.addWorksheet("Điều khoản PO", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  terms.columns = [{ width: 4 }, { width: 110 }];
  terms.addRow(["", "ĐIỀU KHOẢN & ĐIỀU KIỆN"]).font = { bold: true, size: 13 };
  terms.addRow(["", `Kèm theo Đơn đặt hàng ${order.poNo || order.code}`]).font = { italic: true };
  PO_TERMS.forEach((section, index) => {
    terms.addRow([]);
    terms.addRow([`${index + 1}.`, section.title]).font = { bold: true };
    section.lines.forEach((line, sub) => {
      const row = terms.addRow([`${index + 1}.${sub + 1}`, line]);
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      row.height = Math.max(15, Math.ceil(line.length / 120) * 15);
    });
  });
  terms.addRow([]);
  terms.addRow(["", "Bên Bán (ký, ghi rõ họ tên, đóng dấu)                                              Bên Mua: Công ty TNHH Thiên Nhật Minh"]).font = { bold: true };
  return finish(workbook);
}

/* ───────────────────────── P-CF-03 Yêu cầu thanh toán ───────────────────────── */
export type PaymentFormInput = {
  payment: PurchasePayment;
  order: PurchaseOrder;
  project: ProjectInfo;
  steps: readonly SignStep[];
  budgetNumber: string;
  /** Các khoản đã chi trước của PO (lịch sử thanh toán). */
  history: readonly PurchasePayment[];
};

export async function fillPaymentRequest(template: ArrayBuffer | Uint8Array, input: PaymentFormInput): Promise<Uint8Array> {
  const { workbook, sheet: ws } = await open(template);
  const { payment, order, project } = input;
  const poAmount = order.totalActual ?? order.totalEstimate;
  const paidBefore = input.history.reduce((sum, item) => sum + item.amount, 0);
  put(ws, "E9", [project.code, input.budgetNumber].filter(Boolean).join(" / "));
  put(ws, "K9", project.name);
  put(ws, "V9", payment.rfpNo || "RFP-");
  putDate(ws, "D10", vnDay(payment.requestedAt));
  putDate(ws, "O10", vnDay(payment.paidAt));
  const line = (row: number, item: PurchasePayment, paid: number) => {
    put(ws, `B${row}`, item.payee || order.supplier);
    put(ws, `F${row}`, order.budgetCode ?? "");
    put(ws, `G${row}`, order.poNo || order.code);
    put(ws, `I${row}`, poAmount);
    put(ws, `I${row + 1}`, paid);
    put(ws, `L${row}`, item.invoiceNo || (item.kind === "advance" ? "tạm ứng" : ""));
    putDate(ws, `L${row + 1}`, item.invoiceDate);
    put(ws, `Q${row}`, item.amount);
    put(ws, `Q${row + 1}`, item.vatAmount);
    put(ws, `R${row}`, item.amount);
    put(ws, `U${row}`, item.vatAmount);
  };
  line(16, payment, paidBefore);
  let running = 0;
  input.history.slice(0, 4).forEach((item, index) => { running += item.amount; line(32 + index * 2, item, running); });
  put(ws, "R40", { formula: "SUM(R32:T39)" });
  put(ws, "U40", { formula: "SUM(U32:X39)" });
  put(ws, "R42", { formula: "R40+U40" });
  signBox(ws, input.steps, [["leader", "L4", "L6"], ["material", "Q4", "Q6"], ["technical", "R4", "R6"], ["pic", "U4", "U6"]]);
  const accountant = ws.getCell("J4");
  accountant.value = payment.paidAt ? `Đã chi\n${payment.paidMethod || ""}`.trim() : null;
  accountant.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  accountant.font = { size: 8 };
  putDate(ws, "J6", vnDay(payment.paidAt));
  if (input.history.length > 4) put(ws, "B45", `Còn ${input.history.length - 4} khoản đã chi trước đó không đủ chỗ in, tổng đã chi trước: ${paidBefore.toLocaleString("vi-VN")} đ.`);
  return finish(workbook);
}

/* ───────────────────────── P-COST-05 Báo cáo giải thích ───────────────────────── */
export type ExplanatoryFormInput = { report: ExplanatoryReport; project: ProjectInfo; steps: readonly SignStep[] };

export async function fillExplanatory(template: ArrayBuffer | Uint8Array, input: ExplanatoryFormInput): Promise<Uint8Array> {
  const { workbook, sheet: ws } = await open(template);
  const { report, project } = input;
  merge(ws, "S2:U2");
  putDate(ws, "S2", vnDay(report.submittedAt ?? report.createdAt));
  ws.getCell("S2").alignment = { horizontal: "center" };
  put(ws, "S4", report.createdByName || null);
  put(ws, "B11", report.kind === "budget_change" ? "X" : null);
  put(ws, "B12", report.kind === "warranty" ? "X" : null);
  put(ws, "B13", report.kind === "other" ? "X" : null);
  put(ws, "F15", `${project.code}   (số báo cáo ${report.number})`);
  put(ws, "F17", project.name);
  putDate(ws, "K19", report.warrantyDoneOn);
  const sample = ws.getRow(24);
  for (let row = 24; row <= 38; row += 1) {
    for (const range of ["B:E", "F:I", "J:M", "N:Q", "R:U"]) {
      const [from, to] = range.split(":");
      merge(ws, `${from}${row}:${to}${row}`);
    }
    for (const col of row === 38 ? ["B", "F", "J", "N", "R"] : ["A", "B", "F", "J", "N", "R"]) {
      const cell = ws.getCell(`${col}${row}`);
      cell.value = null;
      cell.numFmt = sample.getCell(col).numFmt || "#,##0";
      if (col !== "A") cell.alignment = { horizontal: "right" };
    }
  }
  report.lines.slice(0, 14).forEach((line, index) => {
    const row = 24 + index;
    put(ws, `A${row}`, Number(line.code));
    put(ws, `B${row}`, line.budgetA);
    put(ws, `F${row}`, line.orderedB);
    put(ws, `J${row}`, line.neededC);
    put(ws, `N${row}`, { formula: `F${row}+J${row}`, result: lineD(line) });
    put(ws, `R${row}`, { formula: `N${row}-B${row}`, result: lineE(line) });
  });
  for (const col of ["B", "F", "J", "N", "R"]) put(ws, `${col}38`, { formula: `SUM(${col}24:${col}37)` });
  merge(ws, "A42:U46");
  const text = ws.getCell("A42");
  text.value = report.explanation;
  text.alignment = { wrapText: true, vertical: "top" };
  const attachments: [keyof ExplanatoryReport["attachments"], number][] = [["customerRequest", 49], ["overQuote", 51], ["incident", 53], ["drawing", 55]];
  for (const [key, row] of attachments) { put(ws, `I${row}`, report.attachments[key] ? "X" : null); put(ws, `K${row}`, report.attachments[key] ? null : "X"); }
  signBox(ws, input.steps, [["leader", "L7", null], ["accounting", "N7", null], ["material", "P7", null], ["technical", "R7", null], ["pic", "T7", null]]);
  return finish(workbook);
}

/* ───────────────────────── P-COST-01 Xác nhận dự án ───────────────────────── */
export type ContractFormInput = { contract: ProjectContract; project: ProjectInfo; steps: readonly SignStep[] };

/** Chia đoạn văn thành các dòng ngắn cho các ô một dòng của mẫu. */
function splitLines(text: string, width: number, count: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [""];
  for (const word of words) {
    const last = out[out.length - 1]!;
    if ((last + " " + word).trim().length > width && out.length < count) out.push(word);
    else out[out.length - 1] = `${last} ${word}`.trim();
  }
  return out;
}

export async function fillContract(template: ArrayBuffer | Uint8Array, input: ContractFormInput): Promise<Uint8Array> {
  const { workbook, sheet: ws } = await open(template);
  const { contract, project } = input;
  const attach = contract.attachments;
  put(ws, "Q2", `${box(contract.confirmation === "confirmed")} Xác Nhận  /  ${box(contract.confirmation === "tentative")} Xác Nhận Tạm   (lần ${contract.revision})`);
  putDate(ws, "F12", contract.issuedOn);
  put(ws, "E14", project.code);
  put(ws, "K14", project.name);
  const description = splitLines(contract.description, 110, 2);
  put(ws, "F16", description[0] ?? "");
  put(ws, "F17", description[1] ?? null);
  put(ws, "E19", contract.quoteNo || null);
  putDate(ws, "Q19", contract.quoteDate);
  put(ws, "I21", contract.quoteValue);
  put(ws, "L24", contract.confirmedValue);
  merge(ws, "G29:L29");
  merge(ws, "P29:S29");
  put(ws, "G29", contract.customerDocNo || null);
  ws.getCell("G29").alignment = { wrapText: false, vertical: "bottom" };
  putDate(ws, "P29", contract.customerDocDate);
  const terms = splitLines(contract.paymentTerms, 95, 3);
  ["G31", "G32", "G33"].forEach((address, index) => put(ws, address, terms[index] ?? null));
  put(ws, "E35", contract.customerName || null);
  put(ws, "Q35", contract.ownerName || null);
  putDate(ws, "G37", contract.startOn);
  putDate(ws, "P37", contract.endOn);
  const mark = (address: string, label: string, checked: boolean, active: boolean) => put(ws, address, `${active ? `${box(checked)} ` : ""}${label}`);
  const confirmed = contract.confirmation === "confirmed";
  mark("G40", "Báo giá có ký xác nhận hoặc PO/Hợp Đồng", attach.signedQuoteOrPo, confirmed);
  mark("G41", "Báo giá TNM gửi có ký đóng dấu", attach.stampedQuote, confirmed);
  mark("G42", "Tiến độ tổng", attach.masterSchedule, confirmed);
  mark("G43", "Bản vẽ", attach.drawings, confirmed);
  mark("G45", "Báo giá TNM gửi có ký đóng dấu", attach.stampedQuote, !confirmed);
  mark("G46", "Thông tin hướng dẫn từ khách hàng", attach.customerInstruction, !confirmed);
  mark("G48", "Tiến độ tổng", attach.masterSchedule, !confirmed);
  mark("G49", "Bản vẽ", attach.drawings, !confirmed);
  if (contract.note) put(ws, "E50", contract.note);
  // Ô ký: HC, Kế toán (KT), Lãnh đạo, VT-Kho, P. Kỹ thuật, Phụ trách; ngày ký ở hàng 10
  const boxes: [ApprovalRole, string][] = [["admin_office", "L"], ["accounting", "N"], ["leader", "P"], ["material", "R"], ["technical", "T"], ["pic", "V"]];
  for (const [, col] of boxes) merge(ws, `${col}6:${String.fromCharCode(col.charCodeAt(0) + 1)}9`);
  signBox(ws, input.steps, boxes.map(([role, col]) => [role, `${col}6`, `${col}10`] as [ApprovalRole, string, string]));
  for (const [, col] of boxes) { const date = ws.getCell(`${col}10`); date.numFmt = "dd/mm/yy"; date.font = { ...date.font, size: 8 }; date.alignment = { horizontal: "center" }; }
  return finish(workbook);
}

/* ───────────────────────── P-COST-08 Phiếu yêu cầu vật tư (dựng mẫu mới) ───────────────────────── */
export type MaterialFormInput = { request: MaterialRequest; project: ProjectInfo; steps: readonly SignStep[]; quotes?: readonly MaterialQuote[]; codes?: readonly CostCode[] };

const thin: Partial<ExcelJS.Borders> = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };

export async function buildMaterialRequest(input: MaterialFormInput): Promise<Uint8Array> {
  const { request, project } = input;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("P-COST-08", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } });
  ws.headerFooter.oddHeader = "&R&8P-COST-08";
  ws.headerFooter.oddFooter = "&L&8Rev. 00&R&8Thien Nhat Minh Co., Ltd";
  ws.columns = [{ width: 5 }, { width: 26 }, { width: 2 }, { width: 24 }, { width: 14 }, { width: 8 }, { width: 10 }, { width: 13 }, { width: 18 }];
  ws.getCell("C1").value = "THIEN NHAT MINH Co. Ltd";
  ws.getCell("C1").font = { bold: true, size: 13, color: { argb: "FF1E3A8A" } };
  ["Office : 75 Nguyen Cuu Dam, Tan Son Nhi Ward, Tan Phu Dist., HCMC", "Tel.: (84-8) 38126 990    Website: www.thiennhatminh.com", "Tax code: 0303590774"].forEach((text, index) => {
    ws.getCell(`C${index + 2}`).value = text;
    ws.getCell(`C${index + 2}`).font = { size: 9 };
  });
  ws.mergeCells("A6:I6");
  ws.getCell("A6").value = "PHIẾU YÊU CẦU VẬT TƯ";
  ws.getCell("A6").font = { bold: true, size: 16 };
  ws.getCell("A6").alignment = { horizontal: "center" };
  const field = (row: number, label: string, value: string, labelRight: string, valueRight: string) => {
    ws.mergeCells(`A${row}:D${row}`);
    ws.getCell(`A${row}`).value = { richText: [{ text: `${label}: `, font: { bold: true } }, { text: value }] };
    ws.mergeCells(`F${row}:G${row}`);
    ws.getCell(`F${row}`).value = labelRight; ws.getCell(`F${row}`).font = { bold: true };
    ws.mergeCells(`H${row}:I${row}`); ws.getCell(`H${row}`).value = valueRight;
    for (const col of ["A", "H"]) ws.getCell(`${col}${row}`).border = { bottom: { style: "hair" } };
  };
  field(8, "Tên dự án", project.name, "Ngày yêu cầu:", dmy(request.requestedOn));
  field(9, "Số dự án", project.code, "Người yêu cầu:", request.requesterName);
  field(10, "Số phiếu", request.number, "Nơi giao:", project.site ?? "");
  const head = ws.getRow(12);
  ["STT", "Tên vật tư", "", "Thông số kỹ thuật", "Nhà sản xuất", "Đơn vị", "Số lượng", "Ngày cần sử dụng", "Ghi chú / mã NS"].forEach((text, index) => { head.getCell(index + 1).value = text || null; });
  ws.mergeCells("B12:C12");
  head.font = { bold: true };
  head.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  head.height = 30;
  const rows = Math.max(15, request.items.length);
  for (let index = 0; index < rows; index += 1) {
    const rowNo = 13 + index;
    const item = request.items[index];
    const row = ws.getRow(rowNo);
    ws.mergeCells(`B${rowNo}:C${rowNo}`);
    if (item) {
      row.values = [index + 1, item.name, null, item.spec, item.maker, item.unit, item.quantity, toDate(item.neededOn), [item.note, item.budgetCode ? `Mã ${item.budgetCode}` : ""].filter(Boolean).join(" · ")];
    }
    row.getCell(8).numFmt = "dd/mm/yyyy";
    row.getCell(7).numFmt = "#,##0.###";
    for (let col = 1; col <= 9; col += 1) {
      row.getCell(col).border = thin;
      row.getCell(col).alignment = { vertical: "middle", wrapText: col === 2 || col === 4 || col === 9, ...(col === 1 || col === 6 ? { horizontal: "center" as const } : {}) };
    }
  }
  let row = 13 + rows + 1;
  if (request.note) { ws.mergeCells(`A${row}:I${row}`); ws.getCell(`A${row}`).value = `Ghi chú: ${request.note}`; ws.getCell(`A${row}`).alignment = { wrapText: true }; row += 2; }
  // Ô ký: Lãnh đạo, P. Kỹ thuật, Phòng Vật tư - Kho, Người yêu cầu
  const signs: [string, string, SignStep | undefined | "requester"][] = [
    ["A", "Lãnh Đạo", stepOf(input.steps, "leader")], ["D", "P. Kỹ Thuật", stepOf(input.steps, "technical")],
    ["F", "Phòng Vật Tư, Kho", stepOf(input.steps, "material")], ["I", "Người Yêu Cầu", "requester"],
  ];
  for (const [col, label, step] of signs) {
    const end = col === "A" ? "B" : col === "D" ? "E" : col === "F" ? "H" : "I";
    ws.mergeCells(`${col}${row}:${end}${row}`);
    ws.mergeCells(`${col}${row + 1}:${end}${row + 3}`);
    ws.getCell(`${col}${row}`).value = label;
    ws.getCell(`${col}${row}`).font = { bold: true };
    ws.getCell(`${col}${row}`).alignment = { horizontal: "center" };
    const sign = ws.getCell(`${col}${row + 1}`);
    sign.value = step === "requester" ? `${request.requesterName}\n${dmy(request.requestedOn)}` : step?.result === "signed" ? `${step.signerName}\n${vnDateTime(step.actedAt)}` : null;
    sign.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sign.font = { size: 9 };
  }
  if (input.quotes?.length) addComparisonSheet(workbook, request, project, input.quotes);
  return finish(workbook);
}

/** Bảng so sánh báo giá: mỗi nhà cung cấp hai cột (đơn giá, thành tiền), tô xanh giá thấp nhất từng dòng. */
function addComparisonSheet(workbook: ExcelJS.Workbook, request: MaterialRequest, project: ProjectInfo, quotes: readonly MaterialQuote[]) {
  const ws = workbook.addWorksheet("Bảng so sánh", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const cheapest = cheapestByItem(quotes, request.items);
  ws.columns = [{ width: 5 }, { width: 30 }, { width: 8 }, { width: 10 }, ...quotes.flatMap(() => [{ width: 14 }, { width: 16 }])];
  ws.addRow([`BẢNG SO SÁNH BÁO GIÁ · ${request.number}`]).font = { bold: true, size: 13 };
  ws.addRow([`Dự án: ${project.code} · ${project.name}`]);
  ws.addRow([]);
  const head1 = ws.addRow(["STT", "Vật tư", "ĐVT", "SL", ...quotes.flatMap((quote) => [`${quote.supplier}${quote.selected ? " (đã chọn)" : ""}`, ""])]);
  quotes.forEach((_, index) => ws.mergeCells(head1.number, 5 + index * 2, head1.number, 6 + index * 2));
  const head2 = ws.addRow(["", "", "", "", ...quotes.flatMap(() => ["Đơn giá", "Thành tiền"])]);
  for (const head of [head1, head2]) { head.font = { bold: true }; head.alignment = { horizontal: "center", wrapText: true }; }
  request.items.forEach((item, index) => {
    const row = ws.addRow([index + 1, `${item.name}${item.spec ? ` (${item.spec})` : ""}`, item.unit, item.quantity, ...quotes.flatMap((quote): (number | string | null)[] => {
      const price = quote.prices[item.id] ?? 0;
      return price > 0 ? [price, Math.round(price * item.quantity)] : ["—", null];
    })]);
    quotes.forEach((quote, qIndex) => {
      if (cheapest[item.id] === quote.id) for (const col of [5 + qIndex * 2, 6 + qIndex * 2]) row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
    });
  });
  const total = ws.addRow(["", "Tổng (chưa VAT)", "", "", ...quotes.flatMap((quote) => ["", quoteTotal(quote, request.items)])]);
  total.font = { bold: true };
  ws.addRow(["", "Thời gian giao (ngày)", "", "", ...quotes.flatMap((quote) => [quote.deliveryDays ?? "—", ""])]);
  ws.addRow(["", "Điều kiện thanh toán", "", "", ...quotes.flatMap((quote) => [quote.paymentTerms || "—", ""])]);
  ws.addRow(["", "Số / ngày báo giá", "", "", ...quotes.flatMap((quote) => [[quote.quoteRef, dmy(quote.quoteDate)].filter(Boolean).join(" · ") || "—", ""])]);
  for (let row = head1.number; row <= ws.rowCount; row += 1) {
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 4 + quotes.length * 2) return;
      cell.border = thin;
      if (col >= 4 && typeof cell.value === "number") cell.numFmt = "#,##0";
      cell.alignment = { ...cell.alignment, vertical: "middle", wrapText: true };
    });
  }
}

/* ───────────────────────── Nhập ngân sách từ file P-COST-03 cũ ───────────────────────── */
const numberOf = (value: ExcelJS.CellValue): number => {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value && typeof value.result === "number") return value.result;
  if (typeof value === "string") { const parsed = Number(value.replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
  return 0;
};
const textOf = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  if (value instanceof Date) return "";
  return String(value);
};

export type ImportedBudget = { lines: { code: string; nett: number; budget: number; supplier: string; contingency: number; remark: string }[]; quoteNo: string; exchangeRate: number; offerPrice: number; contractValue: number };

/**
 * PRC-78: đọc file ngân sách Excel cũ theo mẫu P-COST-03 (mã ở cột B / K; giá gốc, ngân sách, NCC, dự phòng ở D E F H / M N O Q).
 * Mã không có trong danh mục thì bỏ qua; số làm tròn về số nguyên không âm.
 */
export async function parseBudgetWorkbook(bytes: ArrayBuffer | Uint8Array, catalog: readonly CostCode[]): Promise<ImportedBudget> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes instanceof Uint8Array ? bytes.slice().buffer : bytes);
  const known = new Set(catalog.map((item) => item.code));
  const amount = (value: ExcelJS.CellValue) => Math.max(0, Math.round(numberOf(value)));
  let best: ImportedBudget | null = null;
  for (const ws of workbook.worksheets) {
    const lines = new Map<string, ImportedBudget["lines"][number]>();
    ws.eachRow((row) => {
      for (const [col, cols] of [[2, [4, 5, 6, 8]], [11, [13, 14, 15, 17]]] as const) {
        const code = textOf(row.getCell(col).value).trim();
        if (!known.has(code) || lines.has(code)) continue;
        const [nett, budget, supplier, contingency] = cols.map((index) => row.getCell(index).value);
        const line = { code, nett: amount(nett!), budget: amount(budget!), supplier: textOf(supplier!).trim().slice(0, 200), contingency: typeof contingency === "string" ? 0 : amount(contingency!), remark: typeof contingency === "string" ? contingency.slice(0, 200) : "" };
        if (line.nett || line.budget || line.contingency || line.supplier) lines.set(code, line);
      }
    });
    const result: ImportedBudget = {
      lines: [...lines.values()].sort((a, b) => a.code.localeCompare(b.code)),
      quoteNo: textOf(ws.getCell("D13").value).trim().slice(0, 200),
      exchangeRate: amount(ws.getCell("G13").value) || 25_000,
      offerPrice: amount(ws.getCell("D14").value),
      contractValue: amount(ws.getCell("L10").value),
    };
    if (!best || result.lines.length > best.lines.length) best = result;
  }
  if (!best || !best.lines.length) throw new Error("BUDGET_IMPORT_EMPTY");
  return best;
}
