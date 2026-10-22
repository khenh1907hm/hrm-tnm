import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheRepositories, withListCache } from "./cached";

type Row = { id: string; version: number; name: string };

/** Kho giả: đếm số lần đọc cả bảng, cho phép giữ lời gọi lại (gate), làm lỗi lần đọc/ghi kế tiếp. */
function fakeRepository(initial: Row[]) {
  const rows = [...initial];
  const repository = {
    listCalls: 0,
    gate: null as Promise<void> | null,
    failList: 0,
    failWrite: false,
    /** Chạy ngay khi lời gọi list() bắt đầu (dùng để giả lập ghi xen giữa lúc đang tải). */
    onList: null as (() => Promise<unknown> | undefined) | null,
    async list() {
      repository.listCalls += 1;
      const snapshot = rows.map((row) => ({ ...row }));
      await repository.onList?.();
      if (repository.gate) await repository.gate;
      if (repository.failList > 0) { repository.failList -= 1; throw new Error("mạng lỗi"); }
      return snapshot;
    },
    async get(id: string) { return rows.find((row) => row.id === id) ?? null; },
    async insert(value: Row) {
      if (repository.failWrite) throw new Error("ghi lỗi");
      rows.push(value);
    },
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
const b: Row = { id: "b", version: 1, name: "Bình" };
const ids = (rows: Row[]) => rows.map((row) => row.id);
const gate = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };

afterEach(() => { vi.useRealTimers(); });

describe("vòng đời bộ nhớ tạm (stale-while-revalidate)", () => {
  it("1–3. lần đầu gọi nền đúng 1 lần; lần hai trong 30 giây không gọi; 5 lần đồng thời chỉ 1 lời gọi", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    await Promise.all(Array.from({ length: 5 }, () => cached.list()));
    expect(repository.listCalls).toBe(1);
    await cached.list();
    expect(repository.listCalls).toBe(1);
  });

  it("4. quá 30 giây: trả dữ liệu cũ ngay, tải ngầm 1 lần, sau đó có dữ liệu mới và revision tăng", async () => {
    let clock = 0;
    const repository = fakeRepository([a]);
    const { repositories, status } = cacheRepositories({ employees: repository }, { ttlMs: 30_000, now: () => clock });
    await repositories.employees.list();
    const revision = status().revision;
    await repository.insert(b);
    clock = 31_000;
    const slow = gate();
    repository.gate = slow.promise;
    // Trả ngay dữ liệu cũ dù lời gọi nền còn đang chờ
    expect(ids(await repositories.employees.list())).toEqual(["a"]);
    expect(ids(await repositories.employees.list())).toEqual(["a"]);
    expect(repository.listCalls).toBe(2);
    slow.release();
    repository.gate = null;
    await vi.waitFor(async () => expect(ids(await repositories.employees.list())).toEqual(["a", "b"]));
    expect(repository.listCalls).toBe(2);
    expect(status().revision).toBe(revision + 1);
  });

  it("revision không tăng khi tải ngầm về dữ liệu y hệt", async () => {
    let clock = 0;
    const repository = fakeRepository([a]);
    const { repositories, status } = cacheRepositories({ employees: repository }, { ttlMs: 30_000, now: () => clock });
    await repositories.employees.list();
    const revision = status().revision;
    clock = 31_000;
    await repositories.employees.list();
    await vi.waitFor(() => expect(repository.listCalls).toBe(2));
    await Promise.resolve();
    expect(status().revision).toBe(revision);
  });

  it("5. tải ngầm lỗi: dữ liệu cũ còn nguyên, stale = true, tự thử lại sau 30 giây", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const repository = fakeRepository([a]);
    const { repositories, status } = cacheRepositories({ employees: repository }, { ttlMs: 30_000, now: () => clock, retryMs: 30_000 });
    await repositories.employees.list();
    clock = 31_000;
    repository.failList = 1;
    expect(ids(await repositories.employees.list())).toEqual(["a"]);
    await vi.waitFor(() => expect(status().stale).toBe(true));
    expect(ids(await repositories.employees.list())).toEqual(["a"]);
    const callsBeforeRetry = repository.listCalls;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(repository.listCalls).toBe(callsBeforeRetry + 1);
    expect(status().stale).toBe(false);
  });

  it("6 + 20. ghi thành công thì lần đọc kế thấy dữ liệu mới; ghi lỗi hoặc replace trả false thì không đánh dấu", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    await cached.list();
    repository.failWrite = true;
    await expect(cached.insert(b)).rejects.toThrow("ghi lỗi");
    expect(await cached.replace({ ...a, version: 9 }, 7)).toBe(false);
    await cached.list();
    expect(repository.listCalls).toBe(1);
    repository.failWrite = false;
    await cached.insert(b);
    expect(ids(await cached.list())).toEqual(["a", "b"]);
    expect(repository.listCalls).toBe(2);
  });

  it("16. sau khi ghi thành công, lần đọc kế tiếp KHÔNG BAO GIỜ trả dữ liệu cũ, kể cả khi bảng đã quá hạn", async () => {
    let clock = 0;
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000, now: () => clock });
    await cached.list();
    clock = 40_000;
    await cached.insert(b);
    const slow = gate();
    repository.gate = slow.promise;
    let settled: Row[] | null = null;
    const read = cached.list().then((rows) => { settled = rows; return rows; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBeNull();
    slow.release();
    expect(ids(await read)).toEqual(["a", "b"]);
    // get() cũng không lấy bản cũ khi bảng đang bị đánh dấu
    await cached.replace({ ...a, version: 2, name: "An mới" }, 1);
    expect((await cached.get("a"))?.name).toBe("An mới");
  });

  it("7. race: tải ngầm bắt đầu lúc 0s, ghi lúc 1s, kết quả cũ về lúc 2s không được đè dữ liệu mới", async () => {
    let clock = 0;
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000, now: () => clock });
    await cached.list();
    clock = 31_000;
    const slow = gate();
    repository.gate = slow.promise;
    await cached.list(); // khởi động tải ngầm (snapshot chỉ có "a")
    repository.gate = null;
    clock = 32_000;
    await cached.insert(b);
    slow.release();
    expect(ids(await cached.list())).toEqual(["a", "b"]);
    await Promise.resolve();
    expect(ids(await cached.list())).toEqual(["a", "b"]);
  });

  it("19. kết quả bị bỏ vì phiên bản đổi: người chờ nhận dữ liệu của lần tải lại; không thử quá 2 lần", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    let writes = 1;
    repository.onList = () => { if (writes > 0) { writes -= 1; return cached.insert(b); } return undefined; };
    expect(ids(await cached.list())).toEqual(["a", "b"]);
    expect(repository.listCalls).toBe(2);

    // Bảng bị ghi liên tục trong lúc tải: dừng sau lần thử lại thứ 2, vẫn trả dữ liệu và bật stale
    const busy = fakeRepository([a]);
    const { repositories, status } = cacheRepositories({ employees: busy }, 30_000);
    let n = 0;
    busy.onList = () => repositories.employees.insert({ id: `x${n++}`, version: 1, name: "Ghi liên tục" });
    const rows = await repositories.employees.list();
    expect(rows.length).toBeGreaterThan(0);
    expect(busy.listCalls).toBe(3);
    expect(status().stale).toBe(true);
  });

  it("lần đầu tải lỗi thì báo lỗi (không có dữ liệu cũ để hiện)", async () => {
    const repository = fakeRepository([a]);
    const cached = withListCache(repository, { ttlMs: 30_000 });
    repository.failList = 1;
    await expect(cached.list()).rejects.toThrow("mạng lỗi");
    expect(ids(await cached.list())).toEqual(["a"]);
  });
});

describe("bảng liên quan, quay lại tab, phạm vi cache", () => {
  it("8. ghi certificates đánh dấu cả employees; ghi certificateTypes đánh dấu certificates", async () => {
    const employees = fakeRepository([a]);
    const certificates = fakeRepository([]);
    const certificateTypes = fakeRepository([]);
    const { repositories } = cacheRepositories({ employees, certificates, certificateTypes }, 30_000);
    await Promise.all([repositories.employees.list(), repositories.certificates.list(), repositories.certificateTypes.list()]);
    await repositories.certificates.insert({ id: "c1", version: 1, name: "ATLĐ" });
    await repositories.employees.list();
    await repositories.certificates.list();
    expect(employees.listCalls).toBe(2);
    expect(certificates.listCalls).toBe(2);
    await repositories.certificateTypes.insert({ id: "t1", version: 1, name: "Loại mới" });
    await repositories.certificates.list();
    expect(certificates.listCalls).toBe(3);
    expect(employees.listCalls).toBe(2);
  });

  it("9. tab hiện lại: chỉ làm mới bảng đã quá 30 giây và chặn hai lần cách nhau dưới 5 giây", async () => {
    let clock = 0;
    const employees = fakeRepository([a]);
    const certificates = fakeRepository([]);
    const { repositories, refreshExpired } = cacheRepositories({ employees, certificates }, { ttlMs: 30_000, now: () => clock });
    await repositories.employees.list();
    clock = 4_000;
    await repositories.certificates.list();
    clock = 31_000; // employees quá hạn (31 giây), certificates còn mới (27 giây)
    refreshExpired();
    expect(employees.listCalls).toBe(2);
    expect(certificates.listCalls).toBe(1);
    clock = 35_000; // certificates đã quá hạn nhưng chỉ 4 giây sau lần làm mới trước → bị chặn
    refreshExpired();
    expect(certificates.listCalls).toBe(1);
    clock = 36_500;
    refreshExpired();
    expect(certificates.listCalls).toBe(2);
    expect(employees.listCalls).toBe(2);
  });

  it("không cache audit và reminders; invalidateAll xóa sạch để lần đọc sau tải lại", async () => {
    const audit = { append: async () => undefined, list: async () => [] };
    const reminders = { add: async () => undefined, list: async () => [] };
    const employees = fakeRepository([a]);
    const { repositories, invalidateAll } = cacheRepositories({ employees, audit, reminders }, 30_000);
    expect(repositories.audit).toBe(audit);
    expect(repositories.reminders).toBe(reminders);
    await repositories.employees.list();
    invalidateAll();
    await repositories.employees.list();
    expect(employees.listCalls).toBe(2);
  });

  it("11. dispose (đăng xuất): xóa dữ liệu, hủy hẹn giờ thử lại, không còn đọc được từ bộ nhớ", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const employees = fakeRepository([a]);
    const { repositories, dispose } = cacheRepositories({ employees }, { ttlMs: 30_000, now: () => clock, retryMs: 30_000 });
    await repositories.employees.list();
    clock = 31_000;
    employees.failList = 1;
    await repositories.employees.list();
    await vi.advanceTimersByTimeAsync(0);
    dispose();
    const calls = employees.listCalls;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(employees.listCalls).toBe(calls);
    await repositories.employees.list();
    expect(employees.listCalls).toBe(calls + 1);
  });
});
