import { useEffect, useState } from "react";
import { systemClock, todayVN } from "../../../lib/clock";
import { getSupabaseClient } from "../../../lib/supabase/client";
import type { ProjectStore } from "../../../modules/projects/store";
import { createMemoryProjectStore } from "../../../repositories/projects/memoryProjectStore";
import { createSupabaseProjectStore } from "../../../repositories/projects/supabaseProjectStore";
import { seedDemoProjects } from "./demoSeed";
import type { EmployeeSource } from "./projectShared";

const DEMO_KEY = "tnm-hrm:projects:v1";
let demoStore: ProjectStore | null = null;
let liveStore: ProjectStore | null = null;
let seeding: Promise<void> | null = null;

/** Một store cho cả phiên: demo lưu localStorage (có dữ liệu mẫu), chế độ thật dùng Supabase. */
export function getProjectStore(mode: "demo" | "live"): ProjectStore {
  const client = mode === "live" ? getSupabaseClient() : null;
  if (client) return liveStore ??= createSupabaseProjectStore(client);
  return demoStore ??= createMemoryProjectStore({ persistKey: DEMO_KEY });
}

/** Store kèm cờ đã sẵn sàng (demo: chờ nạp dữ liệu mẫu lần đầu). */
export function useProjectStore(mode: "demo" | "live", employees: EmployeeSource): { store: ProjectStore; ready: boolean } {
  const store = getProjectStore(mode);
  const [ready, setReady] = useState(store.mode === "live");
  useEffect(() => {
    if (store.mode === "live") return;
    let active = true;
    // Chỉ nạp mẫu khi có danh sách nhân sự (khung Admin/HR); khung Nhân viên dùng dữ liệu đã có
    if (employees) seeding ??= employees.search("").then((list) => seedDemoProjects(store, list, todayVN(systemClock))).catch(() => undefined);
    void (seeding ?? Promise.resolve()).then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [store, employees]);
  return { store, ready };
}
