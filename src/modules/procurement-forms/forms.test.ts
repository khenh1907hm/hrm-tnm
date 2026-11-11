import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEFAULT_COST_CODES, type BudgetSheet } from "../purchases/budget";
import { noContractAttachments, type ProjectContract } from "../purchases/contract";
import { noAttachments, type ExplanatoryReport } from "../purchases/explanatory";
import type { MaterialQuote, MaterialRequest } from "../purchases/materials";
import type { PurchaseOrder, PurchasePayment } from "../purchases/types";
import { buildMaterialRequest, fillBudgetSheet, fillContract, fillExplanatory, fillPaymentRequest, fillPurchaseDraft, fillPurchaseOrder, paymentTermsText, type SignStep } from "./forms";
import { numberInWords, vndInWords } from "./vndWords";

const template = (code: string) => readFileSync(join(process.cwd(), "public", "templates", "quy-trinh", `${code}.xlsx`));
const project = { code: "Pr25001-01", name: "Murata Đà Nẵng – cấp điện 9 cụm máy", site: "KCN Hòa Khánh, Đà Nẵng", plannedStart: "2025-01-01", plannedEnd: "2025-04-30" };
const signed = (role: SignStep["role"], name: string): SignStep => ({ role, result: "signed", signerName: name, actedAt: "2026-11-12T02:00:00Z", targetDate: "2026-11-13" });
const pending = (role: SignStep["role"]): SignStep => ({ role, result: "pending", signerName: "", actedAt: null, targetDate: "2026-11-14" });
async function reopen(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  // Bản xuất để xem bằng mắt khi chạy với FORMS_OUT=<thư mục>
  if (process.env.FORMS_OUT) writeFileSync(join(process.env.FORMS_OUT, `${workbook.worksheets[0]!.name}.xlsx`), bytes);
  return workbook;
}
const cell = (workbook: ExcelJS.Workbook, address: string, sheet = 0) => {
  const value = workbook.worksheets[sheet]!.getCell(address).value;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value && typeof value === "object" && "formula" in value ? `=${value.formula}` : value;
};

const order: PurchaseOrder = {
  id: "o1", code: "DH-2611-0001", kind: "project", projectId: "p1", title: "Tủ điện tổng MSB", requesterId: "u1", requesterName: "Kỹ sư A", department: "", neededBy: "2026-11-20",
  deliveryAddress: "Công trường Murata", supplier: "Công ty TNHH ABC", supplierContact: "Ông Nguyễn Văn A · 0909 000 000", expectedDelivery: "2026-11-25", note: "Giao giờ hành chính", status: "approved",
  totalEstimate: 40_000_000, totalActual: null, decisionNote: "", submittedAt: "2026-11-11T03:00:00Z", approvedAt: "2026-11-12T03:00:00Z", orderedAt: null, receivedAt: null, completedAt: null, createdAt: "2026-11-11T02:00:00Z",
  items: [{ id: "i1", name: "Tủ MSB 400A", spec: "IP54", unit: "bộ", quantity: 2, unitPrice: 20_000_000, receivedQty: 0, acceptedQty: 0, inspectionNote: "" }],
  budgetCode: "175", budgetA: 100_000_000, budgetB: 50_000_000, usesChain: true, advanceRequired: true, advancePct: 30, prepayRequired: false,
  poNo: "PO-Pr25001-01-001", poIssuedAt: "2026-11-12T04:00:00Z", supplierAcceptedAt: null, supplierAcceptNote: "", receiptRecordNo: "",
};
const payment = (id: string, amount: number, extra: Partial<PurchasePayment> = {}): PurchasePayment => ({
  id, orderId: "o1", kind: "final", amount, payee: "Công ty TNHH ABC", note: "", status: "requested", requestedAt: "2026-11-15T02:00:00Z", approvedAt: null, paidAt: null, paidMethod: "",
  decisionNote: "", rfpNo: "RFP-2611-0002", invoiceNo: "0001234", invoiceDate: "2026-11-14", vatAmount: amount / 10, usesChain: true, ...extra,
});

describe("procurement forms (Excel theo mẫu công ty)", () => {
  it("PRC_70 đọc số tiền thành chữ cho dòng bằng chữ trên PO", () => {
    expect(numberInWords(40_000_000)).toBe("bốn mươi triệu");
    expect(numberInWords(15_500_000)).toBe("mười lăm triệu năm trăm nghìn");
    expect(numberInWords(1_100_000_000)).toBe("một tỷ một trăm triệu");
    expect(numberInWords(1_000_005_000)).toBe("một tỷ không trăm linh năm nghìn");
    expect(numberInWords(21_000)).toBe("hai mươi mốt nghìn");
    expect(numberInWords(105)).toBe("một trăm linh năm");
    expect(numberInWords(0)).toBe("không");
    expect(vndInWords(40_000_000)).toBe("Bốn mươi triệu đồng chẵn");
  });

  it("PRC_71 P-COST-03: điền mã vào đúng dòng của mẫu, xóa số mẫu, giữ công thức", async () => {
    const sheet: BudgetSheet = {
      id: "s1", projectId: "p1", revision: 2, number: "Pr25001-01-02", status: "approved", confirmation: "confirmed", exchangeRate: 25_500, quoteNo: "TNM Q-0201-2025", offerPrice: 1_200_000_000,
      contractValue: 1_100_000_000, note: "", createdAt: "2026-11-10T02:00:00Z", submittedAt: "2026-11-10T03:00:00Z", approvedAt: "2026-11-11T03:00:00Z",
      lines: [{ code: "175", nett: 80_000_000, budget: 100_000_000, supplier: "ABC", contingency: 5_000_000, remark: "" }, { code: "251", nett: 0, budget: 30_000_000, supplier: "Cẩu XYZ", contingency: 0, remark: "" }],
    };
    const book = await reopen(await fillBudgetSheet(template("P-COST-03"), { sheet, project, codes: DEFAULT_COST_CODES, steps: [signed("pic", "PM Trần B"), signed("technical", "KT Lê C"), signed("leader", "Nguyễn Gia Luân")] }));
    expect(cell(book, "G8")).toBe("Pr25001-01-02");
    expect(cell(book, "L10")).toBe(1_100_000_000);
    expect([cell(book, "B40"), cell(book, "D40"), cell(book, "E40"), cell(book, "F40"), cell(book, "H40")]).toEqual([175, 80_000_000, 100_000_000, "ABC", 5_000_000]);
    expect([cell(book, "K21"), cell(book, "N21"), cell(book, "O21"), cell(book, "Q21")]).toEqual([251, 30_000_000, "Cẩu XYZ", null]);
    expect(cell(book, "H31")).toBeNull();
    expect(cell(book, "N57")).toMatch(/^=SUBTOTAL/);
    expect(String(cell(book, "M3"))).toContain("Nguyễn Gia Luân");
    expect(cell(book, "B6")).toBe("☑ XÁC NHẬN   /   ☐ XN TẠM");
  });

  it("PRC_72 P-CC-07: ngày mục tiêu, người ký 6 bộ phận, A–E và bằng chữ; kèm sheet danh mục hàng", async () => {
    const steps = [signed("pic", "PM Trần B"), signed("technical", "KT Lê C"), pending("material"), pending("accounting"), pending("leader"), pending("admin_office")];
    const book = await reopen(await fillPurchaseDraft(template("P-CC-07"), { order, project, steps, budgetNumber: "Pr25001-01-02", quoteRef: "BG-ABC-11", quoteDate: "2026-11-05", hasComparison: true }));
    expect([cell(book, "C10"), cell(book, "S12"), cell(book, "S14"), cell(book, "S18")]).toEqual(["Công ty TNHH ABC", "DH-2611-0001", "Pr25001-01", "175"]);
    expect([cell(book, "Y3"), cell(book, "J3")]).toEqual(["2026-11-13", "2026-11-14"]);
    expect(String(cell(book, "Y5"))).toContain("PM Trần B");
    expect(cell(book, "Y8")).toBe("2026-11-12");
    expect(cell(book, "J5")).toBeNull();
    expect(cell(book, "B35")).toBe("Bốn mươi triệu đồng chẵn");
    expect([cell(book, "U35"), cell(book, "J54"), cell(book, "J55"), cell(book, "J56"), cell(book, "J65")]).toEqual([40_000_000, "Pr25001-01-02", 100_000_000, 50_000_000, "X"]);
    expect(cell(book, "J59")).toBe("=J55-J58");
    expect(String(cell(book, "J41"))).toMatch(/^Tạm ứng 30%/);
    expect(cell(book, "J57")).toBe("=U35");
    expect(book.worksheets[1]!.name).toBe("Chi tiết hàng");
  });

  it("PRC_73 P-CC-08: số PO, ngày phát hành, điều khoản PO kèm theo", async () => {
    const book = await reopen(await fillPurchaseOrder(template("P-CC-08"), { order, project, steps: [], budgetNumber: "Pr25001-01-02" }));
    expect([cell(book, "S12"), cell(book, "S10"), cell(book, "F12"), cell(book, "H46")]).toEqual(["PO-Pr25001-01-001", "2026-11-12", null, "X"]);
    expect(`${cell(book, "J43")} ${cell(book, "J44")}`).toContain(paymentTermsText(order).slice(0, 40));
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["P-CC-08", "Chi tiết hàng", "Điều khoản PO"]);
    expect(book.worksheets[0]!.getImages().length).toBe(1);
  });

  it("PRC_74 P-CF-03: dòng thanh toán theo PO + hóa đơn, lịch sử các khoản đã chi", async () => {
    const history = [payment("pa", 12_000_000, { kind: "advance", invoiceNo: "tạm ứng", invoiceDate: null, vatAmount: 0, status: "paid", paidAt: "2026-11-13T02:00:00Z", rfpNo: "RFP-2611-0001" })];
    const book = await reopen(await fillPaymentRequest(template("P-CF-03"), { payment: payment("pb", 28_000_000), order, project, steps: [signed("pic", "PM Trần B")], budgetNumber: "Pr25001-01-02", history }));
    expect([cell(book, "V9"), cell(book, "G16"), cell(book, "I16"), cell(book, "I17"), cell(book, "L16"), cell(book, "Q16"), cell(book, "U16")]).toEqual(["RFP-2611-0002", "PO-Pr25001-01-001", 40_000_000, 12_000_000, "0001234", 28_000_000, 2_800_000]);
    expect([cell(book, "L32"), cell(book, "R32"), cell(book, "R40")]).toEqual(["tạm ứng", 12_000_000, "=SUM(R32:T39)"]);
    expect(String(cell(book, "U4"))).toContain("PM Trần B");
  });

  it("PRC_75 P-COST-05: loại báo cáo, bảng A–E có công thức, diễn giải, hồ sơ kèm", async () => {
    const report: ExplanatoryReport = {
      id: "r1", projectId: "p1", number: "GT-Pr25001-01-01", kind: "budget_change", warrantyDoneOn: null, explanation: "Khách đổi tủ 400A lên 630A theo email 10/11.", attachments: { ...noAttachments(), customerRequest: true },
      status: "submitted", orderId: null, createdByName: "PM Trần B", createdAt: "2026-11-12T02:00:00Z", submittedAt: "2026-11-12T03:00:00Z", approvedAt: null,
      lines: [{ code: "175", budgetA: 12_000_000, orderedB: 8_000_000, neededC: 8_000_000 }],
    };
    const book = await reopen(await fillExplanatory(template("P-COST-05"), { report, project, steps: [signed("pic", "PM Trần B")] }));
    expect([cell(book, "B11"), cell(book, "B12"), cell(book, "A24"), cell(book, "B24"), cell(book, "N24"), cell(book, "R24"), cell(book, "R38")]).toEqual(["X", null, 175, 12_000_000, "=F24+J24", "=N24-B24", "=SUM(R24:R37)"]);
    expect([cell(book, "I49"), cell(book, "K49"), cell(book, "I51"), cell(book, "K51")]).toEqual(["X", null, null, "X"]);
    expect(cell(book, "A42")).toBe(report.explanation);
    expect(cell(book, "A25")).toBeNull();
  });

  it("PRC_76 P-COST-01: xác nhận / xác nhận tạm, giá trị, điều khoản thanh toán, hồ sơ theo trường hợp", async () => {
    const contract: ProjectContract = {
      id: "c1", projectId: "p1", revision: 1, status: "approved", confirmation: "confirmed", issuedOn: "2024-12-23", description: "Power supply for 9 machine clusters VR2, VR3, W, I, E",
      quoteNo: "TNM Q-0201-2025 Rev-00", quoteDate: "2024-11-23", quoteValue: 1_100_000_000, confirmedValue: 1_100_000_000, customerDocNo: "PO 4500123", customerDocDate: "2024-12-20",
      paymentTerms: "Tạm ứng 15%, thanh toán theo tiến độ dự án theo tháng đến 95% sau 45 ngày ký nghiệm thu khối lượng, 5% còn lại nhận sau 2 tháng sau khi phát hành bảo lãnh bảo hành",
      customerName: "Taikisha Vietnam Engineering", ownerName: "Murata Đà Nẵng", startOn: "2025-01-01", endOn: "2025-04-30", attachments: { ...noContractAttachments(), signedQuoteOrPo: true, drawings: true },
      note: "", createdAt: "2024-12-23T02:00:00Z", submittedAt: "2024-12-23T03:00:00Z", approvedAt: "2024-12-24T03:00:00Z",
    };
    const book = await reopen(await fillContract(template("P-COST-01"), { contract, project, steps: [signed("leader", "Nguyễn Gia Luân")] }));
    expect([cell(book, "E14"), cell(book, "L24"), cell(book, "G29"), cell(book, "E35"), cell(book, "Q35"), cell(book, "P37")]).toEqual(["Pr25001-01", 1_100_000_000, "PO 4500123", "Taikisha Vietnam Engineering", "Murata Đà Nẵng", "2025-04-30"]);
    expect(String(cell(book, "Q2"))).toMatch(/^☑ Xác Nhận/);
    expect([cell(book, "G40"), cell(book, "G41"), cell(book, "G45")]).toEqual(["☑ Báo giá có ký xác nhận hoặc PO/Hợp Đồng", "☐ Báo giá TNM gửi có ký đóng dấu", "Báo giá TNM gửi có ký đóng dấu"]);
    expect(String(cell(book, "G31")).length).toBeLessThanOrEqual(95);
    expect(String(cell(book, "P6"))).toContain("Nguyễn Gia Luân");
  });

  it("PRC_77 P-COST-08: phiếu mới (không dùng file .xls có virus) kèm bảng so sánh báo giá", async () => {
    const request: MaterialRequest = {
      id: "m1", projectId: "p1", number: "YCVT-Pr25001-01-001", requesterName: "CHT Phạm D", requestedOn: "2026-11-12", status: "approved", note: "Cần gấp cho tầng 2", createdAt: "2026-11-12T02:00:00Z",
      submittedAt: "2026-11-12T02:30:00Z", approvedAt: "2026-11-12T05:00:00Z", orderIds: [],
      items: [{ id: "a", name: "Cáp CVV 4x2.5", spec: "0.6/1kV", maker: "Cadivi", unit: "m", quantity: 500, neededOn: "2026-11-18", note: "", budgetCode: "177" }, { id: "b", name: "Máng cáp 200x100", spec: "", maker: "", unit: "m", quantity: 60, neededOn: null, note: "", budgetCode: "176" }],
    };
    const quote = (id: string, supplier: string, a: number, b: number): MaterialQuote => ({ id, requestId: "m1", supplier, supplierContact: "", quoteRef: `BG-${id}`, quoteDate: "2026-11-13", deliveryDays: 3, paymentTerms: "30 ngày", note: "", prices: { a, b }, selected: false, createdAt: "2026-11-13T02:00:00Z" });
    const book = await reopen(await buildMaterialRequest({ request, project, steps: [signed("material", "VT Hoàng E")], quotes: [quote("q1", "NCC 1", 20_000, 150_000), quote("q2", "NCC 2", 21_000, 140_000)] }));
    expect(JSON.stringify(cell(book, "A8"))).toContain(project.name);
    expect([cell(book, "A6"), cell(book, "H8"), cell(book, "B13"), cell(book, "G13"), cell(book, "I13")]).toEqual(["PHIẾU YÊU CẦU VẬT TƯ", "12/11/2026", "Cáp CVV 4x2.5", 500, "Mã 177"]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["P-COST-08", "Bảng so sánh"]);
    expect([cell(book, "F6", 1), cell(book, "F8", 1)]).toEqual([10_000_000, 19_000_000]);
  });
});

describe("nhập ngân sách từ file P-COST-03", () => {
  it("PRC_78 đọc mã, giá gốc, ngân sách, NCC, dự phòng từ file mẫu (kể cả file đã xuất từ web)", async () => {
    const { parseBudgetWorkbook } = await import("./forms");
    const sample = await parseBudgetWorkbook(template("P-COST-03"), DEFAULT_COST_CODES);
    expect(sample.lines.map((line) => [line.code, line.contingency])).toEqual([["165", 50_000_000], ["211", 0], ["221", 500_000_000], ["251", 500_000_000], ["353", 200_000_000], ["417", 100_000_000]].filter(([code]) => code !== "211"));
    const sheet: BudgetSheet = { id: "s", projectId: "p", revision: 1, number: "X-01", status: "draft", confirmation: "tentative", exchangeRate: 24_000, quoteNo: "Q-1", offerPrice: 5, contractValue: 9, note: "", createdAt: "2026-01-01T00:00:00Z", submittedAt: null, approvedAt: null,
      lines: [{ code: "175", nett: 1, budget: 2, supplier: "A", contingency: 3, remark: "" }] };
    const round = await parseBudgetWorkbook(await fillBudgetSheet(template("P-COST-03"), { sheet, project, codes: DEFAULT_COST_CODES, steps: [] }), DEFAULT_COST_CODES);
    expect(round).toEqual({ lines: [{ code: "175", nett: 1, budget: 2, supplier: "A", contingency: 3, remark: "" }], quoteNo: "Q-1", exchangeRate: 24_000, offerPrice: 5, contractValue: 9 });
    await expect(parseBudgetWorkbook(template("P-COST-05"), DEFAULT_COST_CODES)).rejects.toThrow("BUDGET_IMPORT_EMPTY");
  });
});
