import { describe, expect, it } from "vitest";
import {
  canArchiveCommander,
  isCommanderInUse,
  sortCommanders,
  validateCommander,
} from "./rules";
import type { Commander, CommanderInput } from "./types";

describe("commanders pure rules", () => {
  const sampleInput: CommanderInput = {
    name: "Phạm Văn Sơn",
    role: "Chỉ huy trưởng công trường",
    phone: "0902000111",
    address: "8 đường Mẫu, P. Tân Sơn Nhì, Q. Tân Phú, TP.HCM",
  };

  const sampleCommander: Commander = {
    ...sampleInput,
    id: "cmd-1",
    archived: false,
    version: 1,
  };

  describe("validateCommander", () => {
    it("accepts a valid commander input and normalizes name and phone", () => {
      const result = validateCommander(sampleInput);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.value.name).toBe("Phạm Văn Sơn");
      expect(result.value.phone).toBe("0902000111");
      expect(result.value.role).toBe("Chỉ huy trưởng công trường");
    });

    it("rejects an invalid phone number or invalid name", () => {
      const invalidPhone = validateCommander({ ...sampleInput, phone: "12345" });
      expect(invalidPhone.ok).toBe(false);
      if (invalidPhone.ok) throw new Error("Expected failure");
      expect(invalidPhone.errors.some((item) => item.field === "phone")).toBe(true);

      const invalidName = validateCommander({ ...sampleInput, name: "A" });
      expect(invalidName.ok).toBe(false);
      if (invalidName.ok) throw new Error("Expected failure");
      expect(invalidName.errors.some((item) => item.field === "name")).toBe(true);
    });
  });

  describe("isCommanderInUse", () => {
    it("returns true when an active employee references the commander", () => {
      const employees = [
        { emergencyContactId: "cmd-1", archivedAt: null },
        { emergencyContactId: "cmd-2", archivedAt: null },
      ];
      expect(isCommanderInUse("cmd-1", employees)).toBe(true);
    });

    it("returns false when no active employee references the commander or employee is archived", () => {
      const employees = [
        { emergencyContactId: "cmd-1", archivedAt: "2026-10-12T00:00:00Z" },
        { emergencyContactId: "cmd-2", archivedAt: null },
      ];
      expect(isCommanderInUse("cmd-1", employees)).toBe(false);
      expect(isCommanderInUse("cmd-999", employees)).toBe(false);
    });
  });

  describe("canArchiveCommander", () => {
    it("returns success when the commander is not in use by any active employee", () => {
      const employees = [{ emergencyContactId: "cmd-2", archivedAt: null }];
      const result = canArchiveCommander("cmd-1", employees);
      expect(result.ok).toBe(true);
    });

    it("returns failure with COMMANDER_IN_USE when the commander is currently in use", () => {
      const employees = [{ emergencyContactId: "cmd-1", archivedAt: null }];
      const result = canArchiveCommander("cmd-1", employees);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.errors.map((item) => item.code)).toContain("COMMANDER_IN_USE");
    });
  });

  describe("sortCommanders", () => {
    it("sorts active commanders before archived commanders", () => {
      const commanders: Commander[] = [
        { ...sampleCommander, id: "c1", name: "B", archived: true },
        { ...sampleCommander, id: "c2", name: "A", archived: false },
      ];
      const sorted = sortCommanders(commanders);
      expect(sorted[0]?.id).toBe("c2");
      expect(sorted[1]?.id).toBe("c1");
    });

    it("sorts commanders alphabetically by name using Vietnamese collation", () => {
      const commanders: Commander[] = [
        { ...sampleCommander, id: "c1", name: "Võ Hoàng Kha", archived: false },
        { ...sampleCommander, id: "c2", name: "Phạm Văn Sơn", archived: false },
        { ...sampleCommander, id: "c3", name: "Đặng Hữu Phước", archived: false },
      ];
      const sorted = sortCommanders(commanders);
      expect(sorted.map((item) => item.name)).toEqual([
        "Đặng Hữu Phước",
        "Phạm Văn Sơn",
        "Võ Hoàng Kha",
      ]);
    });
  });
});
