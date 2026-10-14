import { describe, expect, it } from "vitest";
import { applyOcrToForm } from "./applyOcrToForm";
import type { EmployeeInput } from "../employees/types";
import type { ParsedId } from "./parseIdText";

const form: EmployeeInput = { code: "", name: "", dob: "", gender: "Nam", cccd: "", phone: "", home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "", emergencyContactId: null, status: "active", endDate: null };
const parsed = (values: Partial<ParsedId>): ParsedId => ({ cccd: null, name: null, dob: null, gender: null, home: null, addr: null, currentAddr: null, phone: null, ...values });

describe("applyOcrToForm", () => {
  it("does not overwrite a field the user has typed", () => {
    const result = applyOcrToForm({ ...form, name: "Nguyễn Minh An" }, { parsed: parsed({ name: "Trần Văn Bình" }) }, new Set(["name"]));
    expect(result.nextForm.name).toBe("Nguyễn Minh An");
    expect(result.skippedBecauseTyped).toContain("name");
  });

  it("rejects an invalid raw value instead of filling the form", () => {
    const result = applyOcrToForm(form, { parsed: parsed({ phone: "0123456789" }), raw: { phone: "0123456789" } }, new Set());
    expect(result.nextForm.phone).toBe("");
    expect(result.rejected).toEqual([{ field: "phone", raw: "0123456789", reason: "invalid" }]);
  });
});
