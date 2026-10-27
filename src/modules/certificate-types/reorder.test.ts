import { describe, expect, it } from "vitest";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createMemoryRepositories } from "../../repositories/memory/createMemoryRepositories";

const admin = { id: "admin", role: "admin" as const };
const newApp = () => createHrApp({ clock: fixedClock("2026-10-27T09:00:00+07:00"), ids: sequentialIds("reorder"), repositories: createMemoryRepositories() });

describe("certificateTypes.reorder (kéo thả thứ tự)", () => {
  it("đặt thứ tự 1, 2, 3… theo danh sách và chỉ ghi loại đổi chỗ", async () => {
    const app = newApp();
    const before = await app.certificateTypes.list(admin);
    if (!before.ok) throw new Error("list failed");
    const ids = before.value.map((type) => type.id);
    const moved = [ids[3]!, ...ids.filter((id) => id !== ids[3])];
    const result = await app.certificateTypes.reorder(admin, moved);
    expect(result.ok && result.value.map((type) => type.id)).toEqual(moved);
    expect(result.ok && result.value.map((type) => type.sortOrder)).toEqual(moved.map((_, index) => index + 1));
    // Loại đứng sau vị trí cũ không đổi thứ tự nên không tăng phiên bản
    const untouched = result.ok ? result.value.find((type) => type.id === ids[4]) : undefined;
    expect(untouched?.version).toBe(before.value[4]!.version);
  });

  it("từ chối danh sách thiếu/thừa loại và người không phải Admin", async () => {
    const app = newApp();
    const listed = await app.certificateTypes.list(admin);
    if (!listed.ok) throw new Error("list failed");
    const ids = listed.value.map((type) => type.id);
    expect((await app.certificateTypes.reorder(admin, ids.slice(1))).ok).toBe(false);
    expect((await app.certificateTypes.reorder(admin, [...ids, "khong-co"])).ok).toBe(false);
    expect((await app.certificateTypes.reorder({ id: "hr", role: "hr" }, ids)).ok).toBe(false);
  });
});
