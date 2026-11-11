import { describe, expect, it } from "vitest";
import type { Account } from "../../lib/accountAdmin";
import { pageAccounts } from "./AccountsView";

const account = (index: number, extra: Partial<Account> = {}): Account => ({ id: `u${index}`, email: `nv${index}@nhanvien.tnm.com.vn`, fullName: `Nguyễn Văn ${index}`, role: "employee", createdAt: "", lastSignInAt: null, locked: false, permissions: null, employeeId: null, employeeLabel: null, ...extra });

describe("accounts paging", () => {
  it("ACC_07 filters by text, role and link status, then pages and clamps the page", () => {
    const list = [...Array.from({ length: 45 }, (_, index) => account(index)), account(99, { role: "hr", email: "hr@tnm.vn", fullName: "Trần Thị Lan", employeeId: "e1", employeeLabel: "TNM001 · Trần Thị Lan" })];
    const first = pageAccounts(list, { query: "", role: "*", page: 1, pageSize: 20 });
    expect([first.total, first.pages, first.items.length]).toEqual([46, 3, 20]);
    expect(pageAccounts(list, { query: "", role: "*", page: 9, pageSize: 20 })).toMatchObject({ page: 3, items: expect.any(Array) });
    expect(pageAccounts(list, { query: "", role: "*", page: 3, pageSize: 20 }).items).toHaveLength(6);
    expect(pageAccounts(list, { query: "tran lan", role: "*", page: 1, pageSize: 20 }).items.map((item) => item.id)).toEqual(["u99"]);
    expect(pageAccounts(list, { query: "tnm001", role: "*", page: 1, pageSize: 20 }).total).toBe(1);
    expect(pageAccounts(list, { query: "", role: "hr", page: 1, pageSize: 20 }).total).toBe(1);
    expect(pageAccounts(list, { query: "", role: "linked", page: 1, pageSize: 20 }).total).toBe(1);
    expect(pageAccounts(list, { query: "", role: "unlinked", page: 1, pageSize: 50 }).total).toBe(45);
    expect(pageAccounts([], { query: "", role: "*", page: 1, pageSize: 20 })).toEqual({ items: [], total: 0, pages: 1, page: 1 });
  });
});
