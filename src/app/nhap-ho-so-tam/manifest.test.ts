// TẠM: chạy thử dữ liệu nhập qua đúng các luật kiểm tra của app (dữ liệu trong bộ nhớ).
import { describe, expect, it } from "vitest";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { IMPORT_EMPLOYEES, LABOR_TYPE } from "./manifest";

describe("nhập hồ sơ 3 nhân sự", () => {
  it("mọi nhân sự và chứng chỉ đều qua kiểm tra", async () => {
    const clock = fixedClock("2026-10-27T15:00:00+07:00");
    const app = createHrApp({ clock, ids: sequentialIds("imp"), repositories: await createDemoRepositories(clock, sequentialIds("seed")) });
    const admin = { id: "admin", role: "admin" as const };
    const keys: Record<string, string> = {};
    for (const [key, name, noExpiry] of [["labor", LABOR_TYPE.name, false], ["custom-ctype-cccd", "Căn cước công dân", false], ["custom-ctype-degree", "Bằng cấp chuyên môn", true]] as const) {
      const created = await app.certificateTypes.create(admin, { name, requiredForPositions: [], noExpiry });
      expect(created.ok, name).toBe(true);
      if (created.ok) keys[key] = created.value.key;
    }
    const failures: string[] = [];
    for (const { input, certs } of IMPORT_EMPLOYEES) {
      const employee = await app.employees.create(admin, input);
      if (!employee.ok) { failures.push(`${input.code}: ${JSON.stringify(employee.errors)}`); continue; }
      for (const cert of certs) {
        const document = { id: `f-${cert.number}`, name: cert.file.split("/").pop()!, mime: cert.file.endsWith(".pdf") ? "application/pdf" : "image/jpeg", size: 1000 };
        const result = await app.certificates.add(admin, { employeeId: employee.value.id, type: keys[cert.type] ?? cert.type, title: cert.title, number: cert.number, issueDate: cert.issueDate, expiryDate: cert.expiryDate, document, supplementaryFiles: [], ...(cert.expiryDate === null ? { noExpiry: true } : {}), ...(cert.safetyGroup ? { safetyGroup: cert.safetyGroup } : {}) });
        if (!result.ok) failures.push(`${input.code} ${cert.number}: ${JSON.stringify(result.errors)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
