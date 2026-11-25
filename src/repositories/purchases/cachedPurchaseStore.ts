import type { PurchaseStore } from "../../modules/purchases/store";

/** Các hàm đọc dùng chung nhiều trang (Việc của tôi, Đặt hàng, tab mua hàng của dự án, thanh giai đoạn). */
const SHARED_READS = new Set<keyof PurchaseStore>(["myUserId", "myRoles", "approvers", "listOrders", "listPendingPayments", "stageDepartments", "costCodes", "departments"]);
/** Hàm chỉ đọc khác: không lưu tạm, cũng không làm mất dữ liệu tạm. */
const PURE_READ = /^(list|get|check|stagePermissions|myApprovals)/;

/**
 * Bọc store đặt hàng chế độ thật bằng bộ nhớ tạm ngắn cho các lượt đọc dùng chung:
 * - Nhiều khối trên cùng trang gọi cùng lúc (vd listOrders ở Việc của tôi + bảng tình trạng) chỉ tốn một lượt mạng.
 * - Chuyển qua lại giữa các trang trong vài giây không tải lại.
 * Mọi thao tác ghi (gửi, ký, lưu, xóa…) xóa bộ nhớ tạm ngay để lần đọc sau lấy dữ liệu mới.
 */
export function cachePurchaseReads(store: PurchaseStore, ttlMs = 15_000): PurchaseStore & { invalidate: () => void } {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const invalidate = () => cache.clear();
  const proxy = new Proxy(store, {
    get(target, key, receiver) {
      if (key === "invalidate") return invalidate;
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function" || typeof key !== "string") return value;
      const method = value as (...args: unknown[]) => Promise<unknown>;
      if (SHARED_READS.has(key as keyof PurchaseStore)) {
        return (...args: unknown[]) => {
          const id = `${key}:${JSON.stringify(args)}`;
          const hit = cache.get(id);
          if (hit && Date.now() - hit.at < ttlMs) return hit.value;
          const request = method.apply(proxy, args);
          cache.set(id, { at: Date.now(), value: request });
          // Lỗi thì không giữ lại, lần sau thử lại
          request.catch(() => { if (cache.get(id)?.value === request) cache.delete(id); });
          return request;
        };
      }
      if (PURE_READ.test(key)) return method.bind(proxy);
      return async (...args: unknown[]) => {
        invalidate();
        try { return await method.apply(proxy, args); } finally { invalidate(); }
      };
    },
  });
  return proxy as PurchaseStore & { invalidate: () => void };
}
