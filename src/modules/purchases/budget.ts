/**
 * Ngân sách dự án theo mã chi phí (biểu mẫu P-COST-03) và kiểm tra ngân sách khi đặt hàng (P-CC-07).
 * Đặc tả: docs/dac-ta-mua-hang-du-an.md mục 3.2, 3.5, quy tắc PRC-01, PRC-02, PRC-03.
 */
import type { BudgetCategory } from "../projects/types";

export type CostGroup = 100 | 200 | 300 | 400;
export const COST_GROUPS: readonly CostGroup[] = [100, 200, 300, 400];
export const COST_GROUP_LABELS: Record<CostGroup, string> = {
  100: "#100 Thiết bị, vật tư",
  200: "#200 Lắp đặt (nhân công)",
  300: "#300 Thi công kèm vật tư (thầu phụ)",
  400: "#400 Chi phí chung",
};
/** 4 khoản ngân sách cũ của dự án được tự tính từ các nhóm mã. */
export const CATEGORY_OF_GROUP: Record<CostGroup, BudgetCategory> = { 100: "material", 200: "labor", 300: "subcontract", 400: "other" };

export type CostCode = { code: string; group: CostGroup; name: string };

const codes = (group: CostGroup, list: string): CostCode[] => list.split("|").map((entry) => {
  const [code, ...name] = entry.trim().split(" ");
  return { code: code!, group, name: name.join(" ") };
});

/** Danh mục mã chi phí lấy đúng từ mẫu P-COST-03 của công ty. */
export const DEFAULT_COST_CODES: readonly CostCode[] = [
  ...codes(100, "111 BOILER, FLUE & TANK|112 HEAT EXCHANGER|113 KITCHEN EQUIPMENT|121 CHILLER|123 AIR COMPRESSOR & DRYER|132 COOLING TOWER|141 PUMP|151 HEATER|161 FAN|163 AIR FILTER|164 FAN COIL UNIT|165 AIR HANDLING UNIT|166 PACKAGED UNIT/HUMIDIFIER - DEHUMIDIFIER|167 DUCT, DUCT ACCESSORIES|168 GRILLES|169 VAV - CAV - SILENCER|171 MECHANICAL PIPING MATERIALS|172 ELECTRICAL PIPING|173 MV PANEL/ MV EQUIPMENT|174 TRANSFORMERS|175 SWITCH BOARD/PANEL|176 CABLE LADDER/ TRUNKING|177 CABLE|178 LIGHTING & SOCKET OUTLET|179 GENERATOR/UPS/BATTERY|181 ELV EQUIPMENT|182 AUTOMATIC CONTROL EQUIP./PANEL|183 AUTOMATIC FIELD DEVICES|184 LIGHTNING EQUIPMENT|185 SOLAR MODULE|186 SOLAR INVERTER/ EQUIPMENT|192 FIRE PROTECTION M-EQUIPMENT|193 FIRE PROTECTION E-EQUIPMENT|194 SANITARY EQUIPMENT|195 MISCELLANEOUS MATERIAL|196 CLEAN ROOM EQUIPMENT"),
  ...codes(200, "211 PIPING INSTALLATION|221 DUCTING INSTALLATION|231 ELECTRICAL WORK WITHOUT MATERIAL|241 BUILDING INSTALLATION|251 HOISTING & ASSEMBLY|252 BOOM LIFT/SCISSOR LIFT"),
  ...codes(300, "311 DUCT WORK|321 INSULATION|331 PAINTING WORK|341 ELECTRICAL WORK WITH MATERIAL|342 CONTROL WIRING|351 PIPING WORK WITH MATERIAL|352 BUILDING WORK|353 CR PANEL|354 WATER TREATMENT|355 FIRE FIGHTING WORK|361 MISC. WORK W/MATERIAL|362 MAINTENANCE, T&C WORK|363 A/C WORK|364 SANITARY WORK|399 NOT YET DECIDE AMOUNT"),
  ...codes(400, "411 TEMPORARY FACILITY|415 ELECTRICAL & WATER FEE|416 TRANSPORTATION|417 RENTAL FEE|418 IMPORTATION FEE|421 CONSULTANT FEE|454 FEE FOR SITE OFFICE|455 INSURANCE|478 SAFETY EQUIPMENT FEE|479 OFFICE MANAGEMENT|480 STATIONERY, TELEPHONE, INTERNET FEE|483 ENTERTAINMENT FEE|490 MISC EXPENSES"),
];

/** Nhóm của một mã: chữ số đầu × 100 (111 → #100, 231 → #200…). */
export function groupOf(code: string): CostGroup | null {
  const head = Number(code.trim().charAt(0));
  return head >= 1 && head <= 4 ? (head * 100) as CostGroup : null;
}
export const costCodeLabel = (code: string, catalog: readonly CostCode[] = DEFAULT_COST_CODES) => {
  const found = catalog.find((item) => item.code === code);
  return found ? `${found.code} ${found.name}` : code;
};

export type BudgetSheetStatus = "draft" | "submitted" | "approved" | "rejected" | "superseded";
export const BUDGET_SHEET_STATUS_LABELS: Record<BudgetSheetStatus, string> = {
  draft: "Nháp", submitted: "Đang ký duyệt", approved: "Đã duyệt", rejected: "Bị trả về", superseded: "Đã thay bằng lần lập mới",
};
export type Confirmation = "confirmed" | "tentative";
export const CONFIRMATION_LABELS: Record<Confirmation, string> = { confirmed: "Xác nhận", tentative: "Xác nhận tạm" };

export type BudgetLine = { code: string; nett: number; budget: number; supplier: string; contingency: number; remark: string };
export type BudgetSheet = {
  id: string;
  projectId: string;
  revision: number;
  /** Số ngân sách: số dự án + "-" + số lần lập (vd DA-2026-001-01). */
  number: string;
  status: BudgetSheetStatus;
  confirmation: Confirmation;
  exchangeRate: number;
  quoteNo: string;
  /** Giá báo khách (offer, VNĐ). */
  offerPrice: number;
  /** Giá trị hợp đồng (VNĐ), dùng tính lợi nhuận. */
  contractValue: number;
  note: string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  lines: BudgetLine[];
};
export type BudgetSheetHeader = Pick<BudgetSheet, "confirmation" | "exchangeRate" | "quoteNo" | "offerPrice" | "contractValue" | "note">;

export const budgetNumber = (projectCode: string, revision: number) => `${projectCode}-${String(revision).padStart(2, "0")}`;

const pct = (part: number, whole: number) => whole ? part / whole : null;

/** PRC-20: tổng theo nhóm và lợi nhuận theo đúng công thức trong mẫu P-COST-03. */
export function sheetTotals(sheet: Pick<BudgetSheet, "lines" | "offerPrice" | "contractValue">) {
  const byGroup = Object.fromEntries(COST_GROUPS.map((group) => [group, { nett: 0, budget: 0, contingency: 0 }])) as Record<CostGroup, { nett: number; budget: number; contingency: number }>;
  for (const line of sheet.lines) {
    const group = groupOf(line.code);
    if (!group) continue;
    byGroup[group].nett += line.nett;
    byGroup[group].budget += line.budget;
    byGroup[group].contingency += line.contingency;
  }
  const nett = COST_GROUPS.reduce((sum, group) => sum + byGroup[group].nett, 0);
  const direct = byGroup[100].budget + byGroup[200].budget + byGroup[300].budget;
  const total = direct + byGroup[400].budget;
  const contract = sheet.contractValue;
  return {
    byGroup, nett, direct, total,
    /** Lợi nhuận báo giá = giá báo khách − tổng giá gốc. */
    quoteProfit: sheet.offerPrice - nett, quoteProfitPct: pct(sheet.offerPrice - nett, sheet.offerPrice),
    /** Lợi nhuận = giá trị HĐ − tổng giá gốc; A = HĐ − chi phí trực tiếp (#100~#300); B = HĐ − tổng chi phí (#100~#400). */
    profit: contract - nett, profitPct: pct(contract - nett, contract),
    profitA: contract - direct, profitAPct: pct(contract - direct, contract),
    profitB: contract - total, profitBPct: pct(contract - total, contract),
  };
}

/** Ngân sách đã duyệt theo 4 khoản cũ (đồng bộ vào project_budgets khi lần lập được duyệt). */
export function categoryAmounts(lines: readonly BudgetLine[]): Record<BudgetCategory, number> {
  const out: Record<BudgetCategory, number> = { labor: 0, subcontract: 0, material: 0, other: 0 };
  for (const line of lines) { const group = groupOf(line.code); if (group) out[CATEGORY_OF_GROUP[group]] += line.budget; }
  return out;
}

/** PRC-21: kiểm tra lần lập trước khi lưu / gửi ký. Trả về mã lỗi đầu tiên hoặc null. */
export function sheetIssue(sheet: Pick<BudgetSheet, "lines" | "exchangeRate" | "offerPrice" | "contractValue">, submitting: boolean, catalog: readonly CostCode[] = DEFAULT_COST_CODES): string | null {
  const seen = new Set<string>();
  for (const line of sheet.lines) {
    if (!catalog.some((item) => item.code === line.code)) return "BUDGET_UNKNOWN_CODE";
    if (seen.has(line.code)) return "BUDGET_DUPLICATE_CODE";
    seen.add(line.code);
    if ([line.nett, line.budget, line.contingency].some((value) => !Number.isFinite(value) || value < 0 || !Number.isInteger(value))) return "BUDGET_BAD_AMOUNT";
  }
  if ([sheet.offerPrice, sheet.contractValue].some((value) => !Number.isFinite(value) || value < 0)) return "BUDGET_BAD_AMOUNT";
  if (!(sheet.exchangeRate > 0)) return "BUDGET_BAD_RATE";
  if (submitting && !sheet.lines.some((line) => line.budget > 0)) return "BUDGET_EMPTY";
  return null;
}

/** Ngân sách đang dùng của dự án: lần lập mới nhất đã duyệt. */
export const activeSheet = (sheets: readonly BudgetSheet[]) => sheets.filter((sheet) => sheet.status === "approved").sort((a, b) => b.revision - a.revision)[0] ?? null;

export type BudgetCheck = { code: string; sheetNumber: string; a: number; b: number; c: number; d: number; e: number; over: boolean };

/**
 * PRC-02: phần "Xác nhận đặt hàng" của P-CC-07. A = ngân sách của mã, B = đã đặt (đơn đã duyệt, chưa hủy),
 * C = đơn lần này, D = B + C, E = A − D (âm là vượt ngân sách, PRC-03 chặn gửi duyệt).
 */
export function budgetCheck(code: string, sheetNumber: string, a: number, b: number, c: number): BudgetCheck {
  const d = b + c;
  return { code, sheetNumber, a, b, c, d, e: a - d, over: a - d < 0 };
}
