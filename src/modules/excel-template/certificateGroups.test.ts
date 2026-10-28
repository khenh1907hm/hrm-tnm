import { describe, expect, it } from "vitest";
import { certificateGroups, certificateUnits, DEFAULT_CERTIFICATE_GROUPS, expandUnitOrder } from "./certificateGroups";

const item = (id: string, type: string) => ({ id, type });
const units = (items: { id: string; type: string }[], groups = DEFAULT_CERTIFICATE_GROUPS) => certificateUnits(items, (entry) => entry.type, (entry) => entry.id, groups);

describe("certificateGroups", () => {
  it("chưa cài thì dùng nhóm mặc định An toàn; [] là không gộp; bỏ nhóm rỗng", () => {
    expect(certificateGroups(undefined).map((group) => group.name)).toEqual(["An toàn"]);
    expect(certificateGroups({ groups: [] })).toEqual([]);
    expect(certificateGroups({ groups: [{ id: "x", name: "Trống", types: [] }] })).toEqual([]);
  });

  it("gom cùng nhóm về vị trí cái đầu tiên, giữ thứ tự bên trong, chứng chỉ lẻ đứng nguyên", () => {
    const result = units([item("a", "custom-ctype-cccd"), item("b", "elec"), item("c", "health"), item("d", "atld"), item("e", "custom-ctype-height-health")]);
    expect(result.map((unit) => unit.id)).toEqual(["a", "group:an-toan", "c"]);
    expect(result[1]!.items.map((entry) => entry.id)).toEqual(["b", "d", "e"]);
  });

  it("đổi thứ tự theo đơn vị rồi trải lại thành thứ tự từng chứng chỉ", () => {
    const result = units([item("a", "custom-ctype-cccd"), item("b", "elec"), item("c", "health"), item("d", "atld")]);
    expect(expandUnitOrder(["c", "group:an-toan", "a"], result, (entry) => entry.id)).toEqual(["c", "b", "d", "a"]);
  });
});
