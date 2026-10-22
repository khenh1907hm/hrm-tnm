import { describe, expect, it } from "vitest";
import { cacheRepositories, withListCache } from "./cached";

type Row = { id: string; version: number; name: string };

/** Kho giả đếm số lần đọc cả bảng (mỗi lần = một vòng tới Supabase). */
function fakeRepository(initial: Row[]) {
  const rows = [...initial];
  const repository = {
    listCalls: 0,
    getCalls: 0,
    gate: null as Promise<void> | null,
    failNext: false,
    async list() {
      repository.listCalls += 1;
      if (repository.gate) await repository.gate;
      if (repository.failNext) { repository.failNext = false; throw new Error("mạng lỗi"); }
      return rows.map((row) => ({ ...row }));
    },
    async get(id: string) { repository.getCalls += 1; return rows.find((row) => row.id === id) ?? null; },
    async insert(value: Row) { rows.push(value); },
    async replace(value: Row, expectedVersion: number) {
      const index = rows.findIndex((row) => row.id === value.id && row.version === expectedVersion);
      if (index < 0) return false;
      rows[index] = value;
      return true;
    },
  };
  return repository;
}

const a: Row = { id: "a", version: 1, name: "An" };

describe("bộ nhớ tạm cho list()", () => {
  it("đọc nhiều lần trong thời hạn chỉ tốn một vòng", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    await cached.list(); await cached.list(); await cached.get("a");
    expect(repository.listCalls).toBe(1);
    expect(repository.getCalls).toBe(0);
  });

  it("nhiều lượt gọi cùng lúc dùng chung một yêu cầu", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    await Promise.all([cached.list(), cached.list(), cached.list()]);
    expect(repository.listCalls).toBe(1);
  });

  it("hết hạn thì đọc lại", async () => {
    let clock = 0;
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 1000, now: () => clock });
    await cached.list();
    clock = 1500;
    await cached.list();
    expect(repository.listCalls).toBe(2);
  });

  it("ghi xong thì lần đọc sau thấy dữ liệu mới", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    await cached.list();
    await cached.insert({ id: "b", version: 1, name: "Bình" });
    expect((await cached.list()).map((row) => row.id)).toEqual(["a", "b"]);
    expect(await cached.replace({ ...a, version: 2, name: "An mới" }, 1)).toBe(true);
    expect((await cached.get("a"))?.name).toBe("An mới");
  });

  it("không lưu kết quả của lượt đọc bắt đầu trước khi ghi", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    let release!: () => void;
    repository.gate = new Promise((resolve) => { release = resolve; });
    const slowRead = cached.list();
    repository.gate = null;
    await cached.insert({ id: "b", version: 1, name: "Bình" });
    release();
    await slowRead;
    expect((await cached.list()).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("nơi gọi sửa mảng trả về không làm hỏng bộ nhớ tạm", async () => {
    const cached = withListCache(fakeRepository([a]), { ttlMs: 30_000 });
    (await cached.list()).push({ id: "x", version: 1, name: "Giả" });
    expect((await cached.list()).map((row) => row.id)).toEqual(["a"]);
  });

  it("không tìm thấy trong bộ nhớ tạm thì hỏi lại cơ sở dữ liệu", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    await cached.list();
    await repository.insert({ id: "c", version: 1, name: "Người khác vừa thêm" });
    expect((await cached.get("c"))?.name).toBe("Người khác vừa thêm");
    expect(repository.getCalls).toBe(1);
  });

  it("lỗi mạng không bị nhớ lại, lần sau thử lại được", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    repository.failNext = true;
    await expect(cached.list()).rejects.toThrow("mạng lỗi");
    expect((await cached.list()).map((row) => row.id)).toEqual(["a"]);
  });

  it("invalidateAll xóa bộ nhớ tạm của mọi kho, bỏ qua kho không có list()", async () => {
    const employees = fakeRepository([a]);
    const settings = { get: async () => ({ version: 1 }) };
    const { repositories, invalidateAll } = cacheRepositories({ employees, settings }, 30_000);
    expect(repositories.settings).toBe(settings);
    await repositories.employees.list();
    invalidateAll();
    await repositories.employees.list();
    expect(employees.listCalls).toBe(2);
  });
});
