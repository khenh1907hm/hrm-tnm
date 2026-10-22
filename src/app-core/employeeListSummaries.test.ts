import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };

/** Đếm số lần đọc cả bảng: mỗi lần là một lượt tải từ Supabase ở chế độ thật. */
function countListCalls<T extends object>(repositories: T) {
  const counts: Record<string, number> = {};
  for (const [name, repository] of Object.entries(repositories)) {
    const original = (repository as { list?: () => Promise<unknown> }).list;
    if (typeof original !== "function") continue;
    (repository as { list: () => Promise<unknown> }).list = function (this: unknown) {
      counts[name] = (counts[name] ?? 0) + 1;
      return original.call(repository);
    };
  }
  return counts;
}

async function setup() {
  const clock = fixedClock("2026-10-12T09:00:00+07:00");
  const repositories = await createDemoRepositories(clock, sequentialIds("seed-summary"));
  const app = createHrApp({ clock, ids: sequentialIds("summary"), repositories });
  return { app, counts: countListCalls(repositories) };
}

describe("danh sách nhân sự trả kèm tóm tắt chứng chỉ", () => {
  it("tóm tắt của từng người trên trang khớp với checklist tính riêng", async () => {
    const { app } = await setup();
    const listed = await app.employees.list(admin, { pageSize: 100 });
    if (!listed.ok) throw new Error("list");
    expect(Object.keys(listed.value.certificateSummaries).sort()).toEqual(listed.value.items.map((item) => item.id).sort());
    for (const employee of listed.value.items) {
      const checklist = await app.certificates.checklist(admin, employee.id);
      expect(checklist.ok && checklist.value.summary).toEqual(listed.value.certificateSummaries[employee.id]);
    }
  });

  it("chỉ có tóm tắt cho người trên trang hiện tại", async () => {
    const { app } = await setup();
    const listed = await app.employees.list(admin, { pageSize: 5, page: 2 });
    expect(listed.ok && Object.keys(listed.value.certificateSummaries)).toEqual(listed.ok ? listed.value.items.map((item) => item.id) : []);
  });

  it("mỗi lần lọc chỉ đọc mỗi bảng một lần, dù trang có bao nhiêu người", async () => {
    const { app, counts } = await setup();
    await app.employees.list(admin, { pageSize: 20, query: "nguyen" });
    expect(counts).toEqual({ employees: 1, certificateTypes: 1, certificates: 1 });
  });
});
