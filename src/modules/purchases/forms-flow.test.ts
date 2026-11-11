import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { createMemoryProjectStore } from "../../repositories/projects/memoryProjectStore";
import { createMemoryPurchaseStore } from "../../repositories/purchases/memoryPurchaseStore";
import { CHAINS } from "./approval";
import { contractIssue, missingAttachments, noContractAttachments, type ContractDraft } from "./contract";
import { budgetIncrements, explanatoryIssue, explanatoryTotals, noAttachments } from "./explanatory";
import { cheapestByItem, materialIssue, needsSecondQuote, ordersFromQuote, quoteTotal, type MaterialQuote, type MaterialRequest } from "./materials";

const clock = fixedClock("2026-11-12T09:00:00+07:00");
function setup() {
  let seq = 0;
  const projects = createMemoryProjectStore({ clock });
  const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects });
  const signAll = async (docType: Parameters<typeof store.listSteps>[0], docId: string) => {
    for (const step of await store.listSteps(docType, docId)) if (step.result === "pending") await store.sign(step.id, true, "");
  };
  const approvedBudget = async (budget: number) => {
    const sheet = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheet, { confirmation: "confirmed", exchangeRate: 25_000, quoteNo: "", offerPrice: 0, contractValue: 1_000_000_000, note: "" }, [{ code: "175", nett: budget, budget, supplier: "", contingency: 0, remark: "" }]);
    await store.submitBudgetSheet(sheet);
    await signAll("budget", sheet);
  };
  return { store, signAll, approvedBudget };
}

describe("báo cáo giải thích P-COST-05", () => {
  it("PRC_40 A–E theo mẫu và điều kiện gửi ký", async () => {
    const lines = [{ code: "175", budgetA: 12_000_000, orderedB: 8_000_000, neededC: 8_000_000 }, { code: "177", budgetA: 10_000_000, orderedB: 2_000_000, neededC: 1_000_000 }];
    expect(explanatoryTotals(lines)).toEqual({ a: 22_000_000, b: 10_000_000, c: 9_000_000, d: 19_000_000, e: -3_000_000 });
    expect(budgetIncrements(lines)).toEqual([{ code: "175", amount: 4_000_000 }]);
    const base = { kind: "budget_change" as const, warrantyDoneOn: null, explanation: "Khách đổi thiết bị, cần tăng tủ điện", lines };
    expect(explanatoryIssue(base, true)).toBeNull();
    expect(explanatoryIssue({ ...base, lines: [] }, true)).toBe("EXP_NO_LINES");
    expect(explanatoryIssue({ ...base, explanation: "ngắn" }, true)).toBe("EXP_EXPLANATION_REQUIRED");
    expect(explanatoryIssue({ ...base, kind: "warranty" }, true)).toBe("EXP_WARRANTY_DATE_REQUIRED");
    expect(explanatoryIssue({ ...base, lines: [...lines, lines[0]!] }, false)).toBe("BUDGET_DUPLICATE_CODE");
    expect(explanatoryIssue({ ...base, lines: [{ ...lines[0]!, neededC: -1 }] }, false)).toBe("BUDGET_BAD_AMOUNT");
    const { store } = setup();
    const id = await store.saveExplanatory({ projectId: "proj-1", ...base, attachments: noAttachments(), orderId: null });
    await expect(store.submitExplanatory(id)).rejects.toThrow("PO_NO_BUDGET");
  });

  it("PRC_41 Lãnh đạo duyệt thì mã được cộng E và đơn vượt ngân sách gửi được", async () => {
    const { store, signAll, approvedBudget } = setup();
    await approvedBudget(12_000_000);
    const order = await store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode: "175", advanceRequired: false, advancePct: null, prepayRequired: false, title: "Tủ", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice: 16_000_000 }] });
    await expect(store.submit(order.id)).rejects.toThrow("PO_OVER_BUDGET");
    const id = await store.saveExplanatory({ projectId: "proj-1", kind: "budget_change", warrantyDoneOn: null, explanation: "Khách đổi tủ 400A lên 630A", attachments: noAttachments(), orderId: order.id, lines: [{ code: "175", budgetA: 12_000_000, orderedB: 0, neededC: 16_000_000 }] });
    expect((await store.listExplanatory("proj-1"))[0]).toMatchObject({ number: "GT-DA-01", status: "draft" });
    await store.submitExplanatory(id);
    expect((await store.listSteps("explanatory", id)).map((step) => step.role)).toEqual(CHAINS.explanatory);
    const [first] = await store.listSteps("explanatory", id);
    await store.sign(first!.id, false, "Thiếu báo giá");
    expect((await store.listExplanatory("proj-1"))[0]!.status).toBe("rejected");
    expect((await store.checkBudget("proj-1", "175", null))!.a).toBe(12_000_000);
    await store.submitExplanatory(id);
    await signAll("explanatory", id);
    expect((await store.listExplanatory("proj-1"))[0]!.status).toBe("approved");
    expect((await store.checkBudget("proj-1", "175", null))!.a).toBe(16_000_000);
    await store.submit(order.id);
    expect((await store.getOrder(order.id))!.status).toBe("submitted");
  });
});

describe("yêu cầu vật tư P-COST-08 và hỏi giá", () => {
  const request: MaterialRequest = {
    id: "m1", projectId: "proj-1", number: "YCVT-DA-001", requesterName: "", requestedOn: "2026-11-12", status: "approved", note: "", createdAt: "", submittedAt: null, approvedAt: null, orderIds: [],
    items: [
      { id: "a", name: "Cáp", spec: "4x2.5", maker: "Cadivi", unit: "m", quantity: 500, neededOn: "2026-11-20", note: "", budgetCode: "177" },
      { id: "b", name: "Máng cáp", spec: "", maker: "", unit: "m", quantity: 60, neededOn: "2026-11-18", note: "", budgetCode: "176" },
      { id: "c", name: "Ốc", spec: "", maker: "", unit: "bộ", quantity: 10, neededOn: null, note: "", budgetCode: "176" },
    ],
  };
  const quote = (id: string, prices: Record<string, number>): MaterialQuote => ({ id, requestId: "m1", supplier: `NCC ${id}`, supplierContact: "", quoteRef: "", quoteDate: null, deliveryDays: null, paymentTerms: "", note: "", prices, selected: false, createdAt: "" });

  it("PRC_50 kiểm tra dòng vật tư và chuỗi ký", async () => {
    expect(materialIssue({ items: request.items }, true)).toBeNull();
    expect(materialIssue({ items: [] }, true)).toBe("MR_NO_ITEMS");
    expect(materialIssue({ items: [{ ...request.items[0]!, name: "x" }] }, false)).toBe("MR_ITEM_NAME_REQUIRED");
    expect(materialIssue({ items: [{ ...request.items[0]!, quantity: 0 }] }, false)).toBe("MR_BAD_QUANTITY");
    expect(materialIssue({ items: [{ ...request.items[0]!, unit: " " }] }, true)).toBe("MR_UNIT_REQUIRED");
    expect(materialIssue({ items: [{ ...request.items[0]!, budgetCode: "999" }] }, false)).toBe("BUDGET_UNKNOWN_CODE");
    expect(CHAINS.material).toEqual(["material", "technical", "leader"]);
  });

  it("PRC_52 bảng so sánh: giá thấp nhất từng dòng, cảnh báo một báo giá từ 50 triệu", () => {
    const q1 = quote("1", { a: 20_000, b: 150_000 });
    const q2 = quote("2", { a: 21_000, b: 140_000, c: 5_000 });
    expect(quoteTotal(q1, request.items)).toBe(19_000_000);
    expect(cheapestByItem([q1, q2], request.items)).toEqual({ a: "1", b: "2", c: "2" });
    expect(needsSecondQuote([quote("3", { a: 100_000 })], request.items)).toBe(true);
    expect(needsSecondQuote([q1], request.items)).toBe(false);
    expect(needsSecondQuote([quote("3", { a: 100_000 }), q1], request.items)).toBe(false);
  });

  it("PRC_53 chọn báo giá → đơn nháp theo từng mã ngân sách", async () => {
    const drafts = ordersFromQuote(request, quote("2", { a: 21_000, b: 140_000, c: 5_000 }), "Công trường");
    expect(Array.isArray(drafts) && drafts.map((draft) => [draft.budgetCode, draft.items.length, draft.supplier, draft.neededBy])).toEqual([["176", 2, "NCC 2", "2026-11-18"], ["177", 1, "NCC 2", "2026-11-20"]]);
    expect(ordersFromQuote(request, quote("x", {}))).toEqual({ error: "MR_QUOTE_EMPTY" });
    expect(ordersFromQuote({ ...request, items: [{ ...request.items[0]!, budgetCode: null }] }, quote("1", { a: 1 }))).toEqual({ error: "MR_ITEM_CODE_REQUIRED" });

    const { store, signAll } = setup();
    const id = await store.saveMaterialRequest({ projectId: "proj-1", requestedOn: "2026-11-12", note: "", items: request.items.map((item) => ({ ...item, id: `tmp-${item.id}` })) });
    const saved = (await store.listMaterialRequests("proj-1"))[0]!;
    expect(saved.items.every((item) => !item.id.startsWith("tmp-"))).toBe(true);
    await expect(store.saveQuote({ requestId: id, supplier: "NCC A", supplierContact: "", quoteRef: "", quoteDate: null, deliveryDays: null, paymentTerms: "", note: "", prices: {} })).rejects.toThrow("MR_NOT_APPROVED");
    await store.submitMaterialRequest(id);
    await signAll("material", id);
    expect((await store.listMaterialRequests("proj-1"))[0]!.status).toBe("approved");
    const prices = Object.fromEntries(saved.items.map((item) => [item.id, 1_000]));
    const qid = await store.saveQuote({ requestId: id, supplier: "NCC A", supplierContact: "", quoteRef: "BG-1", quoteDate: null, deliveryDays: 3, paymentTerms: "", note: "", prices });
    const orders = await store.ordersFromQuote(id, qid);
    expect(orders).toHaveLength(2);
    expect((await store.getOrder(orders[0]!))).toMatchObject({ status: "draft", budgetCode: "176", supplier: "NCC A" });
    expect((await store.listMaterialRequests("proj-1"))[0]).toMatchObject({ status: "ordered", orderIds: orders });
    await expect(store.deleteQuote(qid)).rejects.toThrow("MR_QUOTE_USED");
    await expect(store.ordersFromQuote(id, qid)).rejects.toThrow("MR_QUOTE_USED");
  });
});

describe("xác nhận dự án P-COST-01", () => {
  const draft: ContractDraft = {
    confirmation: "confirmed", issuedOn: "2026-11-12", description: "Cấp điện", quoteNo: "Q-1", quoteDate: null, quoteValue: 1_000, confirmedValue: 1_000, customerDocNo: "PO 1", customerDocDate: null,
    paymentTerms: "", customerName: "Taikisha", ownerName: "", startOn: "2026-11-01", endOn: "2026-12-01", attachments: noContractAttachments(), note: "",
  };
  it("PRC_60 điều kiện gửi ký, các lần sửa và chuỗi ký 6 bộ phận", async () => {
    expect(contractIssue(draft, true)).toBeNull();
    expect(contractIssue({ ...draft, confirmedValue: 0 }, true)).toBe("CONTRACT_VALUE_REQUIRED");
    expect(contractIssue({ ...draft, customerName: "" }, true)).toBe("CONTRACT_CUSTOMER_REQUIRED");
    expect(contractIssue({ ...draft, customerDocNo: "" }, true)).toBe("CONTRACT_CUSTOMER_DOC_REQUIRED");
    expect(contractIssue({ ...draft, customerDocNo: "", confirmation: "tentative" }, true)).toBeNull();
    expect(contractIssue({ ...draft, endOn: "2026-10-01" }, false)).toBe("CONTRACT_BAD_DATES");
    expect(missingAttachments({ confirmation: "tentative", attachments: { ...noContractAttachments(), stampedQuote: true } })).toEqual(["customerInstruction", "masterSchedule", "drawings"]);

    const { store, signAll } = setup();
    const first = await store.newContract("proj-1");
    await expect(store.newContract("proj-1")).rejects.toThrow("CONTRACT_OPEN_EXISTS");
    await store.saveContract(first, draft);
    await store.submitContract(first);
    expect((await store.listSteps("contract", first)).map((step) => step.role)).toEqual(CHAINS.contract);
    await signAll("contract", first);
    const second = await store.newContract("proj-1");
    await store.saveContract(second, { ...draft, confirmedValue: 1_200 });
    await store.submitContract(second);
    await signAll("contract", second);
    expect((await store.listContracts("proj-1")).map((item) => [item.revision, item.status, item.confirmedValue])).toEqual([[2, "approved", 1_200], [1, "superseded", 1_000]]);
  });
});
