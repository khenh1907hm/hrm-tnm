import { getSupabaseClient } from "../../../lib/supabase/client";
import type { PurchaseStore } from "../../../modules/purchases/store";
import { cachePurchaseReads } from "../../../repositories/purchases/cachedPurchaseStore";
import { createMemoryPurchaseStore } from "../../../repositories/purchases/memoryPurchaseStore";
import { createSupabasePurchaseStore } from "../../../repositories/purchases/supabasePurchaseStore";
import { getProjectStore } from "../projects/useProjectStore";

let demoStore: PurchaseStore | null = null;
let liveStore: (PurchaseStore & { invalidate: () => void }) | null = null;

/** Một store đặt hàng cho cả phiên (demo: localStorage, ghi chi phí vào store dự án demo; thật: Supabase). */
export function getPurchaseStore(mode: "demo" | "live"): PurchaseStore {
  const client = mode === "live" ? getSupabaseClient() : null;
  // Chế độ thật: các lượt đọc dùng chung được nhớ tạm vài giây (mọi thao tác ghi xóa bộ nhớ tạm)
  if (client) return liveStore ??= cachePurchaseReads(createSupabasePurchaseStore(client));
  return demoStore ??= createMemoryPurchaseStore({ persistKey: "tnm-hrm:purchases:v1", projects: getProjectStore("demo") });
}

/** Dữ liệu đơn hàng vừa đổi ở nơi khác store (vd ký phiếu ở bảng Việc của tôi): bỏ bộ nhớ tạm để lần đọc sau lấy mới. */
export function invalidatePurchaseCache(): void { liveStore?.invalidate(); }
