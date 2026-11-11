import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { createMemoryProjectStore } from "../projects/memoryProjectStore";
import { createMemoryPurchaseStore } from "./memoryPurchaseStore";

describe("memory purchase store", () => {
  it("PUR_05 full flow: draft → submit → approve → advance paid → order → receive → final paid → complete writes a project material expense", async () => {
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const projects = createMemoryProjectStore({ clock, newId: () => `p${++seq}` });
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects });
    // Ngân sách theo mã đã duyệt (mã 177 Cable 10 triệu) thì đơn dự án mới gửi được
    const sheetId = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheetId, { confirmation: "confirmed", exchangeRate: 25_000, quoteNo: "", offerPrice: 0, contractValue: 0, note: "" }, [{ code: "177", nett: 8_000_000, budget: 10_000_000, supplier: "", contingency: 0, remark: "" }]);
    await store.submitBudgetSheet(sheetId);
    for (const step of await store.listSteps("budget", sheetId)) if (step.result === "pending") await store.sign(step.id, true, "");
    const draft = await store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode: "177", title: "Ống đồng đợt 2", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Ống đồng", spec: "D12", unit: "m", quantity: 100, unitPrice: 50_000 }] });
    expect(draft).toMatchObject({ code: "DH-2611-0001", status: "draft", totalEstimate: 5_000_000 });
    await expect(store.decide(draft.id, true, "")).rejects.toThrow("PO_BAD_STATUS");
    await store.submit(draft.id);
    await expect(store.decide(draft.id, true, "OK")).rejects.toThrow("PO_USE_CHAIN");
    const chain = await store.listSteps("purchase", draft.id);
    await expect(store.sign(chain[0]!.id, false, "x")).rejects.toThrow("PO_REASON_REQUIRED");
    for (const step of chain.filter((item) => item.role !== "admin_office")) await store.sign(step.id, true, step.role === "leader" ? "OK" : "");
    expect((await store.getOrder(draft.id))!.status).toBe("approved");
    await store.requestPayment(draft.id, "advance", 2_000_000, "Anh A", "");
    const [advance] = await store.listPayments(draft.id);
    await expect(store.pay(advance!.id, "Chuyển khoản", "")).rejects.toThrow("PO_PAYMENT_NOT_APPROVED");
    await store.decidePayment(advance!.id, true, "");
    await store.pay(advance!.id, "Chuyển khoản", "");
    await expect(store.markOrdered(draft.id, "", "", null, "")).rejects.toThrow("PO_SUPPLIER_REQUIRED");
    await store.markOrdered(draft.id, "Vật tư Hòa Phát", "0901", "2026-11-20", "");
    const order = (await store.getOrder(draft.id))!;
    await store.receive(draft.id, [{ id: order.items[0]!.id, receivedQty: 100, acceptedQty: 95, note: "5 m móp" }], "Nhận đủ");
    expect((await store.getOrder(draft.id))!.totalActual).toBe(4_750_000);
    await store.requestPayment(draft.id, "final", 2_750_000, "Vật tư Hòa Phát", "");
    await expect(store.complete(draft.id, "")).rejects.toThrow("PO_PAYMENTS_PENDING");
    const final = (await store.listPayments(draft.id)).find((payment) => payment.kind === "final")!;
    await store.decidePayment(final.id, true, "");
    await store.pay(final.id, "Chuyển khoản", "");
    await store.complete(draft.id, "");
    expect((await store.getOrder(draft.id))!.status).toBe("completed");
    expect((await projects.listExpenses("proj-1"))?.map((expense) => [expense.category, expense.amount, expense.status])).toEqual([["material", 4_750_000, "approved"]]);
    expect((await store.listEvents(draft.id)).map((event) => event.action)).toEqual(["submit", "sign:pic", "sign:technical", "sign:material", "sign:accounting", "approve", "payment_request:advance", "payment_approve:advance", "paid:advance", "order", "receive", "payment_request:final", "payment_approve:final", "paid:final", "complete"]);
    await expect(store.cancel(draft.id, "Hủy thử")).rejects.toThrow("PO_BAD_STATUS");
  });
});
