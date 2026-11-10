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
    expect(allowedActions(order("ordered"), requester).has("requestFinal")).toBe(true);
    expect(allowedActions(order("received"), requester, [{ status: "approved" }]).has("complete")).toBe(false);
    expect(allowedActions(order("received"), requester, [{ status: "paid" }]).has("complete")).toBe(true);
    expect(allowedActions(order("ordered"), accountant, [{ status: "approved" }]).has("pay")).toBe(true);
    expect(allowedActions(order("ordered"), boss, [{ status: "approved" }]).has("pay")).toBe(false);
    expect(allowedActions(order("ordered"), boss, [{ status: "requested" }]).has("decidePayment")).toBe(true);
    expect(allowedActions(order("ordered"), { ...requester, userId: "other", isProjectLead: true }).has("receive")).toBe(true);
    expect(allowedActions(order("completed"), boss).size).toBe(0);
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
