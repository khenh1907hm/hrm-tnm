/**
 * Bộ nhớ tạm phía trình duyệt cho các bảng nhỏ (vài trăm nhân sự, vài nghìn chứng chỉ): nạp cả bảng một lần
 * rồi lọc, tìm kiếm, phân trang ngay trên máy thay vì mỗi thao tác lại đi một vòng tới Supabase (0,5–3 giây).
 * Chỉ là lớp tăng tốc nằm dưới interface repository: không phải nguồn sự thật, không kiểm quyền
 * (quyền kiểm ở createHrApp, RLS của Supabase là lớp cuối). Chỉ giữ trong bộ nhớ trang, không ghi ra ổ đĩa.
 *
 * Mỗi bảng có hai kiểu "cũ":
 * - expired (đã quá `ttlMs`): trả ngay dữ liệu đang có và tải lại ngầm; tải ngầm lỗi thì giữ dữ liệu,
 *   bật cờ stale và tự thử lại sau `retryMs` (khi tab đang ẩn thì hoãn).
 * - dirty (ngay sau khi chính người dùng ghi THÀNH CÔNG vào bảng này hoặc bảng liên quan): KHÔNG trả dữ liệu cũ,
 *   lần đọc kế tiếp chờ tải mới. Nhiều lần ghi liên tiếp (nhập Excel) chỉ gây một lần tải ở lần đọc sau đó.
 * Ghi lỗi hoặc replace trả false thì không đánh dấu gì.
 *
 * Chống ghi đè bằng dữ liệu cũ: mỗi lần đánh dấu tăng `generation`; lời gọi tải về mà generation đã đổi thì
 * bỏ kết quả và tải lại (tối đa MAX_RETRIES lần, sau đó trả dữ liệu mới nhất kèm cờ stale).
 *
 * Ngưỡng nâng cấp: khi một bảng vượt khoảng 10.000 dòng thì chuyển bảng đó sang phân trang ở máy chủ.
 */
export type CacheOptions = {
  ttlMs: number;
  now?: () => number;
  /** Hẹn thử lại sau khi tải ngầm lỗi (mặc định bằng ttlMs). */
  retryMs?: number;
  /** Tab đang ẩn thì không tự làm mới. */
  isHidden?: () => boolean;
};
export type TableCache = {
  /** Xóa sạch dữ liệu đã nạp (lần đọc sau tải lại từ đầu). */
  invalidate(): void;
  /** Đánh dấu dirty: lần đọc sau phải chờ dữ liệu mới. */
  markDirty(): void;
  /** Bảng đã nạp, không dirty và đã quá hạn → tải lại ngầm. */
  refreshIfExpired(): void;
  isStale(): boolean;
  /** Xóa dữ liệu và hủy mọi hẹn giờ (đăng xuất, đổi tài khoản). */
  dispose(): void;
};
export type CacheStatus = { stale: boolean; revision: number };

type Listable = { list(): Promise<unknown[]> };
type ChangeEvent = { replaced: boolean };

const MAX_RETRIES = 2;
/** Khoảng tối thiểu giữa hai lần làm mới do quay lại tab. */
export const TAB_REFRESH_GAP_MS = 5_000;
/** Không cache: bảng tăng mãi, luôn đọc ở máy chủ (theo lô hoặc theo trang). */
const UNCACHED = new Set(["audit", "reminders"]);
/** Ghi bảng bên trái thì bảng bên phải cũng phải đọc lại. */
const RELATED: Record<string, readonly string[]> = { certificates: ["employees"], certificateTypes: ["certificates"] };

const defaultHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function withListCache<R extends Listable>(repository: R, options: CacheOptions & { onChange?: (event: ChangeEvent) => void; onWrite?: () => void }): R & TableCache {
  const now = options.now ?? (() => Date.now());
  const retryMs = options.retryMs ?? options.ttlMs;
  const isHidden = options.isHidden ?? defaultHidden;
  let cached: { at: number; rows: unknown[]; json: string } | null = null;
  let dirty = false;
  let stale = false;
  let pending: Promise<unknown[]> | null = null;
  let generation = 0;
  // Tăng khi xóa sạch: lời gọi đang chạy của "đời" trước không được ghi vào bộ nhớ
  let epoch = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const setStale = (value: boolean) => { if (stale !== value) { stale = value; options.onChange?.({ replaced: false }); } };
  const cancelRetry = () => { if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; } };
  const expired = () => cached !== null && now() - cached.at >= options.ttlMs;

  const commit = (rows: unknown[]) => {
    const json = JSON.stringify(rows);
    const replaced = cached !== null && cached.json !== json;
    cached = { at: now(), rows, json };
    dirty = false;
    cancelRetry();
    const wasStale = stale;
    stale = false;
    if (replaced || wasStale) options.onChange?.({ replaced });
  };

  const load = (): Promise<unknown[]> => {
    if (pending) return pending;
    const startedEpoch = epoch;
    const request = (async () => {
      let latest: unknown[] = [];
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const started = generation;
        latest = await repository.list();
        if (startedEpoch !== epoch) return latest;
        if (started === generation) { commit(latest); return latest; }
        // Có ghi xen giữa lúc đang tải: kết quả này có thể thiếu thay đổi vừa ghi → tải lại
      }
      setStale(true);
      return latest;
    })();
    pending = request;
    const clear = () => { if (pending === request) pending = null; };
    request.then(clear, clear);
    return request;
  };

  const scheduleRetry = () => {
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isHidden()) { scheduleRetry(); return; }
      revalidate(true);
    }, retryMs);
  };

  /**
   * Tải ngầm: lỗi thì giữ dữ liệu cũ, bật stale, hẹn thử lại. Khi đang chờ hẹn thử lại, các lần đọc thường
   * không gọi mạng nữa (mất mạng thì gõ tìm kiếm không bắn request theo từng phím); hẹn giờ và quay lại tab thì có.
   */
  const revalidate = (force = false) => {
    if (pending || (!force && retryTimer !== null)) return;
    const startedEpoch = epoch;
    load().catch(() => { if (startedEpoch === epoch) { setStale(true); scheduleRetry(); } });
  };

  const invalidate = () => { cached = null; dirty = false; pending = null; generation += 1; epoch += 1; cancelRetry(); setStale(false); };
  const markDirty = () => { dirty = true; generation += 1; };

  const control: TableCache = {
    invalidate,
    markDirty,
    refreshIfExpired: () => { if (cached && !dirty && expired()) revalidate(true); },
    isStale: () => stale,
    dispose: invalidate,
  };

  const readRows = async (): Promise<unknown[]> => {
    if (cached && !dirty) {
      if (expired()) revalidate();
      return cached.rows;
    }
    return load();
  };

  return new Proxy(repository, {
    get(target, property, receiver) {
      if (Object.hasOwn(control, property)) return control[property as keyof TableCache];
      // Trả bản sao mảng: nơi gọi có thể push/sort mà không làm hỏng bộ nhớ tạm
      if (property === "list") return async () => [...await readRows()];
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (property === "get") {
        return async (id: string) => {
          if (cached && !dirty) {
            if (expired()) revalidate();
            const hit = (cached.rows as { id?: unknown }[]).find((row) => row.id === id);
            if (hit) return hit;
          }
          // Không có trong bộ nhớ (có thể người khác vừa thêm) hoặc bảng đang dirty: hỏi thẳng cơ sở dữ liệu
          return (value as (id: string) => Promise<unknown>).call(target, id);
        };
      }
      // Hàm ghi: chỉ đánh dấu khi ghi thành công (không ném lỗi, không trả false)
      return async (...args: unknown[]) => {
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        if (result !== false) (options.onWrite ?? markDirty)();
        return result;
      };
    },
  }) as R & TableCache;
}

/**
 * Bọc các kho có `list()` bằng bộ nhớ tạm (trừ audit và reminders). Trả kèm:
 * `status()`/`subscribe()` để giao diện biết dữ liệu vừa được thay (revision) hoặc có thể chưa mới (stale),
 * `refreshExpired()` khi tab hiện lại, `invalidateAll()`/`dispose()` khi đăng xuất hay đổi tài khoản.
 */
export function cacheRepositories<T extends object>(repositories: T, settings: number | CacheOptions) {
  const options: CacheOptions = typeof settings === "number" ? { ttlMs: settings } : settings;
  const now = options.now ?? (() => Date.now());
  const caches = new Map<string, TableCache>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let lastTabRefresh = Number.NEGATIVE_INFINITY;
  let snapshot: CacheStatus = { stale: false, revision: 0 };

  const emit = (event: ChangeEvent) => {
    if (event.replaced) revision += 1;
    const stale = [...caches.values()].some((cache) => cache.isStale());
    if (stale !== snapshot.stale || revision !== snapshot.revision) snapshot = { stale, revision };
    listeners.forEach((listener) => listener());
  };

  const wrapped = Object.fromEntries(Object.entries(repositories).map(([name, repository]) => {
    if (UNCACHED.has(name) || !repository || typeof (repository as Partial<Listable>).list !== "function") return [name, repository];
    const cachedRepository = withListCache(repository as Listable, {
      ...options,
      onChange: emit,
      onWrite: () => { caches.get(name)?.markDirty(); for (const related of RELATED[name] ?? []) caches.get(related)?.markDirty(); },
    });
    caches.set(name, cachedRepository);
    return [name, cachedRepository];
  })) as T;

  return {
    repositories: wrapped,
    invalidateAll: () => caches.forEach((cache) => cache.invalidate()),
    /** Quay lại tab: chỉ làm mới bảng đã quá hạn, cách lần trước ít nhất 5 giây. */
    refreshExpired: () => {
      if (now() - lastTabRefresh < TAB_REFRESH_GAP_MS) return;
      lastTabRefresh = now();
      caches.forEach((cache) => cache.refreshIfExpired());
    },
    status: (): CacheStatus => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => { caches.forEach((cache) => cache.dispose()); listeners.clear(); },
  };
}

export type RepositoryCache = ReturnType<typeof cacheRepositories>;
