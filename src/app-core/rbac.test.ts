import { describe, expect, it } from "vitest";
import { createHrApp } from "./createHrApp";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { FACADE_PERMISSION_MATRIX } from "../modules/auth/permissions";

function inspectFacadePermissionCoverage(facade: Record<string, unknown>, matrix: Record<string, Record<string, { admin: boolean; hr: boolean }>>) {
  const groups = Object.entries(facade).filter(([, value]) => typeof value === "object" && value !== null && Object.values(value).some((item) => typeof item === "function"));
  const missing: string[] = [];
  let useCasesChecked = 0;
  let roleCellsChecked = 0;
  for (const [group, value] of groups) {
    const cases = value as Record<string, unknown>;
    const declared = matrix[group];
    for (const useCase of Object.keys(cases)) {
      useCasesChecked += 1;
      const roles = declared?.[useCase];
      if (!roles || typeof roles.admin !== "boolean" || typeof roles.hr !== "boolean") missing.push(`${group}.${useCase}`);
      else roleCellsChecked += 2;
    }
    for (const useCase of Object.keys(declared ?? {})) {
      if (!Object.keys(cases).includes(useCase)) missing.push(`${group}.${useCase} (stale)`);
    }
  }
  return { missing, useCasesChecked, roleCellsChecked };
}

describe("RBAC-03 facade permission matrix", () => {
  it("RBAC_03 covers every facade use case and both roles in the declared matrix", () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("rbac03") });
    const audit = inspectFacadePermissionCoverage(app, FACADE_PERMISSION_MATRIX);
    expect(audit.missing).toEqual([]);
    expect(audit.useCasesChecked).toBe(38);
    expect(audit.roleCellsChecked).toBe(76);
    const matrixCases = Object.values(FACADE_PERMISSION_MATRIX).flatMap((group) => Object.values(group));
    expect(matrixCases.length).toBeGreaterThan(0);
    expect(matrixCases.every((roles) => typeof roles.admin === "boolean" && typeof roles.hr === "boolean")).toBe(true);
  });

  it("RBAC_03 rejects a facade use case missing from the permission matrix", () => {
    const facade = { ...createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("rbac03-mutation") }), employees: {
      ...createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("rbac03-mutation") }).employees,
      injectedUseCase: () => undefined,
    } };
    expect(inspectFacadePermissionCoverage(facade, FACADE_PERMISSION_MATRIX).missing).toContain("employees.injectedUseCase");
  });
});
