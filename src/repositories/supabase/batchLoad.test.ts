import { describe, expect, it } from "vitest";
import { createSupabaseRepositories } from "./createSupabaseRepositories";
import { createFakeSupabase } from "./fakeSupabase";

const certificateRow = (index: number) => {
  const id = `c-${String((index * 7919) % 2500).padStart(4, "0")}`; // id không theo thứ tự tạo
  return { id, version: 1, created_at: index, employee_id: "e1", type: "atld", state: "current", expiry_date: "2027-01-01", doc: { id, version: 1, employeeId: "e1", type: "atld", state: "current", expiryDate: "2027-01-01" } };
};

describe("tải cả bảng theo lô (giới hạn số dòng mỗi lần của Supabase)", () => {
  it("10. bảng 2.500 dòng nạp đủ 2.500, không trùng, giữ thứ tự tạo", async () => {
    const rows = Array.from({ length: 2500 }, (_, index) => certificateRow(index));
    const { client } = createFakeSupabase({ certificates: rows }, { maxRows: 1000 });
    const listed = await createSupabaseRepositories(client).certificates.list();
    expect(listed).toHaveLength(2500);
    expect(new Set(listed.map((item) => item.id)).size).toBe(2500);
    expect(listed.map((item) => item.id)).toEqual(rows.map((row) => row.id));
  });

  it("máy chủ cấu hình trần thấp hơn 1.000 dòng vẫn nạp đủ (dựa vào tổng số dòng)", async () => {
    const rows = Array.from({ length: 1234 }, (_, index) => certificateRow(index));
    const { client } = createFakeSupabase({ certificates: rows }, { maxRows: 300 });
    expect(await createSupabaseRepositories(client).certificates.list()).toHaveLength(1234);
  });

  it("reminder_log cũng tải theo lô", async () => {
    const entries = Array.from({ length: 1500 }, (_, index) => ({ identity: `k-${index}`, certificate_id: `c-${index}`, sent_on: "2026-10-01", created_at: index }));
    const { client } = createFakeSupabase({ reminder_log: entries }, { maxRows: 1000 });
    expect(await createSupabaseRepositories(client).reminders.list()).toHaveLength(1500);
  });

  it("audit: phân trang ở máy chủ (range + count), mới nhất trước", async () => {
    const events = Array.from({ length: 45 }, (_, index) => {
      const at = `2026-10-${String(1 + Math.floor(index / 2)).padStart(2, "0")}T0${index % 2}:00:00Z`;
      return { id: `ev-${String(index).padStart(2, "0")}`, at, actor_id: "u", action: "x", entity_type: "employee", entity_id: "e1", doc: { id: `ev-${String(index).padStart(2, "0")}`, at } };
    });
    const { client } = createFakeSupabase({ audit_events: events }, { maxRows: 1000 });
    const audit = createSupabaseRepositories(client).audit;
    const page = await audit.listPage({ page: 2, pageSize: 20 });
    expect(page).toMatchObject({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
    expect(page.items.map((item) => item.id)).toEqual(events.slice(5, 25).reverse().map((item) => item.id));
    const beyond = await audit.listPage({ page: 99, pageSize: 500 });
    expect(beyond).toMatchObject({ page: 1, pageSize: 100, totalPages: 1 });
    expect(beyond.items).toHaveLength(45);
  });
});
