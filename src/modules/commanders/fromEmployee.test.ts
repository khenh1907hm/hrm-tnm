import { describe, expect, it } from "vitest";
import { contactFromEmployee, DEFAULT_CONTACT_RELATION } from "./fromEmployee";

const manager = { id: "e9", name: "Trần Văn Quản", phone: "0909000999", address: "12 Lê Lợi, Q.1, TP.HCM", currentAddress: "" };

describe("contactFromEmployee", () => {
  it("uses the chosen employee as the project emergency contact with the default relation", () => {
    expect(contactFromEmployee(manager)).toEqual({ id: "employee:e9", name: "Trần Văn Quản", role: DEFAULT_CONTACT_RELATION, phone: "0909000999", address: "12 Lê Lợi, Q.1, TP.HCM", archived: false, version: 1 });
  });

  it("prefers the current address and a custom relation, falling back to the default when blank", () => {
    const moved = { ...manager, currentAddress: " 5 Trần Phú, Đà Nẵng " };
    expect(contactFromEmployee(moved, "Đội trưởng")).toMatchObject({ role: "Đội trưởng", address: "5 Trần Phú, Đà Nẵng" });
    expect(contactFromEmployee({ id: "e1", name: "A", phone: "1", address: "X" }, "   ").role).toBe(DEFAULT_CONTACT_RELATION);
  });
});
