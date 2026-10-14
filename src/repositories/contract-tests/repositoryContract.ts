import type { Repository } from "../interfaces";
import { describe, expect, it } from "vitest";

export function repositoryContract(makeRepository: () => Repository<{ id: string; version: number; value: string }>) {
  describe("repository contract", () => {
    it("creates, reads, lists, and returns copies", async () => {
      const repo = makeRepository();
      const row = { id: "contract-1", version: 1, value: "fixture" };
      await repo.insert(row);
      row.value = "mutated input";
      expect(await repo.get("contract-1")).toEqual({ id: "contract-1", version: 1, value: "fixture" });
      const list = await repo.list();
      list[0]!.value = "mutated copy";
      expect((await repo.get("contract-1"))?.value).toBe("fixture");
    });
    it("checks expected version and atomically leaves conflicts unchanged", async () => {
      const repo = makeRepository();
      await repo.insert({ id: "contract-2", version: 1, value: "before" });
      expect(await repo.replace({ id: "contract-2", version: 2, value: "bad" }, 0)).toBe(false);
      expect(await repo.get("contract-2")).toEqual({ id: "contract-2", version: 1, value: "before" });
      expect(await repo.replace({ id: "contract-2", version: 2, value: "after" }, 1)).toBe(true);
    });
  });
}

export function certificateTypeRepositoryContract(makeRepository: () => Repository<{ id: string; version: number; name: string; archived: boolean }>) {
  describe("certificate type repository contract", () => {
    it("seeds and lists the seven system categories in the requested order", async () => {
      const repo = makeRepository();
      const rows = await repo.list();
      expect(rows.map((row) => row.name)).toEqual([
        "An toàn lao động", "Khám sức khỏe", "Bảo hiểm tai nạn lao động", "An toàn điện",
        "Chứng chỉ hàn", "Vận hành cần cẩu", "Vận hành xe nâng hàng",
      ]);
    });
    it("keeps archived categories and preserves data through reads and writes", async () => {
      const repo = makeRepository();
      const row = await repo.get("ctype-atld");
      expect(row).not.toBeNull();
      if (!row) return;
      const archived = { ...row, archived: true, version: row.version + 1 };
      expect(await repo.replace(archived, row.version)).toBe(true);
      expect((await repo.get(row.id))?.archived).toBe(true);
      expect(await repo.replace({ ...archived, version: archived.version + 1 }, row.version)).toBe(false);
    });
  });
}
