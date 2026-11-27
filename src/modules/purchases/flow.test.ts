import { describe, expect, it } from "vitest";
import { actualTotal, allowedActions, draftIssue, estimateTotal, lineTotal, paymentSummary, stepStates } from "./flow";

const requester = { userId: "u1", isAdmin: false, isApprover: false, isPayer: false, seesAll: false };
const boss = { userId: "boss", isAdmin: false, isApprover: true, isPayer: false, seesAll: true };
const accountant = { userId: "kt", isAdmin: false, isApprover: false, isPayer: true, seesAll: true };
const order = (status: Parameters<typeof allowedActions>[0]["status"]) => ({ status, requesterId: "u1" });

describe("purchase flow", () => {
  it("PUR_01 line, estimate and actual totals", () => {
    expect(lineTotal({ quantity: 2.5, unitPrice: 10_001 })).toBe(25_003);
    expect(estimateTotal([{ quantity: 2, unitPrice: 100_000 }, { quantity: 1, unitPrice: 50_000 }])).toBe(250_000);
    expect(actualTotal([{ acceptedQty: 1, unitPrice: 100_000 }, { acceptedQty: 0, unitPrice: 50_000 }])).toBe(100_000);
  });

  it("PUR_02 a draft needs a title, a project for project orders, valid items, and at least one item to submit", () => {
    const base = { kind: "office", projectId: null, title: "Mua máy in", items: [{ name: "Máy in", quantity: 1, unitPrice: 3_000_000 }] };
    expect(draftIssue(base, true)).toBeNull();
    expect(draftIssue({ ...base, title: " " }, false)).toBe("PO_TITLE_REQUIRED");
    expect(draftIssue({ ...base, kind: "project" }, false)).toBe("PO_PROJECT_REQUIRED");
    expect(draftIssue({ ...base, items: [{ name: "x", quantity: 0, unitPrice: 1 }] }, false)).toBe("PO_ITEM_INVALID");
    expect(draftIssue({ ...base, items: [] }, false)).toBeNull();
    expect(draftIssue({ ...base, items: [] }, true)).toBe("PO_NO_ITEMS");
  });

  it("PUR_03 step states follow the order status; payment steps are optional", () => {
    const fresh = stepStates({ status: "draft" }, []);
    expect(fresh.draft).toBe("current");
    expect(fresh.approved).toBe("todo");
    const tracking = stepStates({ status: "ordered" }, [{ kind: "advance", status: "paid" }, { kind: "prepayment", status: "requested" }]);
    expect([tracking.approved, tracking.advance, tracking.ordered, tracking.prepayment, tracking.received]).toEqual(["done", "done", "current", "current", "todo"]);
    const noAdvance = stepStates({ status: "ordered" }, []);
    expect(noAdvance.advance).toBe("skipped");
    const done = stepStates({ status: "completed" }, [{ kind: "final", status: "paid" }]);
    expect([done.completed, done.final, done.prepayment]).toEqual(["done", "done", "skipped"]);
  });

  it("PUR_04 only the requester edits and submits; only the boss approves; only the payer pays", () => {
    expect([...allowedActions(order("draft"), requester)]).toEqual(expect.arrayContaining(["edit", "submit", "cancel"]));
    expect(allowedActions(order("draft"), boss).has("edit")).toBe(false);
    expect(allowedActions(order("submitted"), requester).has("approve")).toBe(false);
    expect(allowedActions(order("submitted"), boss).has("approve")).toBe(true);
    expect(allowedActions(order("approved"), requester)).toEqual(new Set(["order", "track", "requestAdvance", "requestPrepayment", "cancel"]));
    expect(allowedActions(order("ordered"), requester).has("cancel")).toBe(false);
    expect(allowedActions(order("ordered"), boss).has("cancel")).toBe(true);
    // Thanh toán còn lại / sau nhận hàng chỉ sau khi nhận hàng
    expect(allowedActions(order("ordered"), requester).has("requestFinal")).toBe(false);
    expect(allowedActions(order("received"), requester).has("requestFinal")).toBe(true);
    expect(allowedActions({ ...order("received"), usesChain: true }, requester).has("requestFinal")).toBe(false);
    expect(allowedActions({ ...order("received"), usesChain: true, docsCollectedAt: "x" }, requester).has("requestFinal")).toBe(true);
    expect(allowedActions({ ...order("received"), prepayRequired: true }, requester).has("requestPrepayment")).toBe(false);
    // Thanh toán trước khi nhận hàng: chưa chi thì chưa nhận hàng
    expect(allowedActions({ ...order("ordered"), prepayRequired: true }, requester).has("receive")).toBe(false);
    expect(allowedActions({ ...order("ordered"), prepayRequired: true }, requester, [{ kind: "prepayment", status: "paid" }]).has("receive")).toBe(true);
    expect(allowedActions(order("received"), requester, [{ status: "approved" }]).has("complete")).toBe(false);
    expect(allowedActions(order("received"), requester, [{ status: "paid" }]).has("complete")).toBe(false);
    const ready = { ...order("received"), stockedAt: "2026-11-20T03:00:00Z", docsCollectedAt: "2026-11-21T03:00:00Z" };
    expect(allowedActions(ready, requester, [{ status: "paid" }]).has("complete")).toBe(true);
    expect(allowedActions(order("ordered"), accountant, [{ status: "approved" }]).has("pay")).toBe(true);
    expect(allowedActions(order("ordered"), boss, [{ status: "approved" }]).has("pay")).toBe(false);
    expect(allowedActions(order("ordered"), boss, [{ status: "requested" }]).has("decidePayment")).toBe(true);
    expect(allowedActions(order("ordered"), { ...requester, userId: "other", isProjectLead: true }).has("receive")).toBe(true);
    expect(allowedActions(order("completed"), boss).size).toBe(0);
  });

  it("PUR_06 Nhập kho: chỉ phòng ban được giao (hoặc Admin) nhập kho, thu chứng từ; nhập kho rồi thì không sửa nhận hàng", () => {
    const received = order("received");
    expect(allowedActions(received, requester).has("stockIn")).toBe(false);
    expect(allowedActions(received, { ...requester, stages: new Set(["stocked"] as const) }).has("stockIn")).toBe(true);
    expect(allowedActions(received, { ...boss, isAdmin: true }).has("stockIn")).toBe(true);
    expect(allowedActions(received, requester).has("receive")).toBe(true);
    const stocked = { ...received, stockedAt: "2026-11-20T03:00:00Z", docsCollectedAt: null };
    expect(allowedActions(stocked, requester).has("receive")).toBe(false);
    expect(allowedActions(stocked, { ...requester, stages: new Set(["stocked"] as const) }).has("stockIn")).toBe(false);
    expect(allowedActions(stocked, requester).has("collectDocs")).toBe(false);
    expect(allowedActions(stocked, { ...requester, stages: new Set(["final"] as const) }).has("collectDocs")).toBe(true);
    expect(allowedActions({ ...order("ordered") }, { ...requester, userId: "kho", stages: new Set(["received"] as const) }).has("receive")).toBe(true);
  });

  it("PUR_08 PO do người lập nắm: người lập phát hành PO và ghi nhận NCC ký; người khác (không phụ trách) thì không", () => {
    const approved = { ...order("approved"), usesChain: true, poIssuedAt: null, supplierAcceptedAt: null };
    expect(allowedActions(approved, requester).has("issuePo")).toBe(true);
    expect(allowedActions(approved, { ...requester, userId: "other" }).has("issuePo")).toBe(false);
    expect(allowedActions(approved, { ...requester, userId: "pm", isProjectLead: true }).has("issuePo")).toBe(true);
    expect(allowedActions({ ...approved, poIssuedAt: "2026-11-20T03:00:00Z" }, requester).has("supplierAccept")).toBe(true);
  });

  it("PUR_07 giai đoạn: nhận hàng xong thì Nhập kho là bước hiện tại, rồi tới Thu thập chứng từ; hủy thì Thất bại", async () => {
    const { stepStates, mergeStageDepartments, STAGE_DEPARTMENT_DEFAULTS } = await import("./flow");
    const got = stepStates({ status: "received" }, []);
    expect([got.received, got.stocked, got.final, got.completed]).toEqual(["done", "current", "todo", "todo"]);
    const stocked = stepStates({ status: "received", stockedAt: "x" }, [{ kind: "final", status: "approved" }]);
    expect([stocked.stocked, stocked.final, stocked.final_pay]).toEqual(["done", "current", "current"]);
    const advance = stepStates({ status: "ordered", advanceRequired: true }, [{ kind: "advance", status: "approved" }]);
    expect([advance.advance, advance.advance_pay]).toEqual(["done", "current"]);
    expect(stepStates({ status: "ordered", advanceRequired: false }, []).advance_pay).toBe("skipped");
    expect(stepStates({ status: "cancelled" }, []).failed).toBe("current");
    expect(stepStates({ status: "completed" }, []).failed).toBe("skipped");
    expect(mergeStageDepartments({ stocked: "material", final: "bogus" })).toEqual({ ...STAGE_DEPARTMENT_DEFAULTS, stocked: "material" });
  });

  it("PUR_05 payment summary: paid per kind, pending, remaining against the actual (or estimated) total", () => {
    const payments = [
      { kind: "advance" as const, amount: 1_000_000, status: "paid" as const },
      { kind: "prepayment" as const, amount: 500_000, status: "approved" as const },
      { kind: "final" as const, amount: 9, status: "rejected" as const },
    ];
    expect(paymentSummary({ totalEstimate: 3_000_000, totalActual: null }, payments)).toEqual({ advance: 1_000_000, prepayment: 0, final: 0, paid: 1_000_000, pending: 500_000, remaining: 2_000_000 });
    expect(paymentSummary({ totalEstimate: 3_000_000, totalActual: 2_500_000 }, payments).remaining).toBe(1_500_000);
  });
});

describe("purchase progress", () => {
  it("PUR_03 progress percent rises with the status and the hint tells each role what to do next", async () => {
    const { progressOf, nextHint } = await import("./flow");
    const order = ["draft", "submitted", "approved", "ordered", "received", "completed"] as const;
    const percents = order.map((status) => progressOf(status).percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    expect(progressOf("completed")).toEqual({ percent: 100, label: "Hoàn tất" });
    expect(nextHint({ status: "submitted", requesterId: "u1" }, { userId: "boss", isApprover: true, isPayer: false, seesAll: true }, [])).toMatch(/Duyệt đơn/);
    expect(nextHint({ status: "ordered", requesterId: "u1" }, { userId: "kt", isApprover: false, isPayer: true, seesAll: true }, [{ status: "approved" }])).toMatch(/Thực hiện chi/);
    expect(nextHint({ status: "draft", requesterId: "u1" }, { userId: "u1", isApprover: false, isPayer: false, seesAll: false }, [])).toMatch(/Lập đơn/);
  });
});
