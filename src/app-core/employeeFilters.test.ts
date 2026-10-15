import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };

describe("employee list filters for batch export", () => {
  it("SRCH_03 keeps only employees holding a valid certificate of the chosen type", async () => {
    const clock = fixedClock("2026-10-12T09:00:00+07:00");
    const app = createHrApp({ clock, ids: sequentialIds("filter"), repositories: await createDemoRepositories(clock, sequentialIds("seed-filter")) });
    // Dữ liệu mẫu: 8 người có ATLĐ, riêng TNM002 đã hết hạn hôm qua
    const withSafety = await app.employees.list(admin, { certificateType: "atld", pageSize: 100 });
    expect(withSafety.ok && withSafety.value.items.map((item) => item.code)).toEqual(["TNM001", "TNM003", "TNM004", "TNM005", "TNM006", "TNM007", "TNM008"]);
    const withHealth = await app.employees.list(admin, { certificateType: "health" });
    expect(withHealth.ok && withHealth.value.total).toBe(0);
    const expired = await app.employees.list(admin, { expiredCertificates: true });
    expect(expired.ok && expired.value.items.map((item) => item.code)).toEqual(["TNM002"]);
  });
});
