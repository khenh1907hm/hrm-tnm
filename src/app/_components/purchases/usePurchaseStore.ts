import { getSupabaseClient } from "../../../lib/supabase/client";
import type { PurchaseStore } from "../../../modules/purchases/store";
import { createMemoryPurchaseStore } from "../../../repositories/purchases/memoryPurchaseStore";
import { createSupabasePurchaseStore } from "../../../repositories/purchases/supabasePurchaseStore";
import { getProjectStore } from "../projects/useProjectStore";

let demoStore: PurchaseStore | null = null;
let liveStore: PurchaseStore | null = null;

/** Một store đặt hàng cho cả phiên (demo: localStorage, ghi chi phí vào store dự án demo; thật: Supabase). */
export function getPurchaseStore(mode: "demo" | "live"): PurchaseStore {
  const client = mode === "live" ? getSupabaseClient() : null;
  if (client) return liveStore ??= createSupabasePurchaseStore(client);
  return demoStore ??= createMemoryPurchaseStore({ persistKey: "tnm-hrm:purchases:v1", projects: getProjectStore("demo") });
}
