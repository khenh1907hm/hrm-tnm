import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, paginate } from "./paginate";

type Row = { id: string; score: number };
const rowsArb = fc.uniqueArray(fc.record({ id: fc.string({ minLength: 1, maxLength: 6 }), score: fc.integer({ min: 0, max: 5 }) }), { selector: (row) => row.id, maxLength: 120 });
const byScore = (a: Row, b: Row) => a.score - b.score;

describe("paginate: hợp đồng phân trang dùng chung", () => {
  it("ghép mọi trang lại bằng đúng toàn bộ kết quả, không trùng, không sót", () => {
    fc.assert(fc.property(rowsArb, fc.integer({ min: 1, max: 100 }), (rows, pageSize) => {
      const first = paginate(rows, { page: 1, pageSize, compare: byScore });
      const all: Row[] = [];
      for (let page = 1; page <= first.totalPages; page += 1) all.push(...paginate(rows, { page, pageSize, compare: byScore }).items);
      expect(all.map((row) => row.id).sort()).toEqual(rows.map((row) => row.id).sort());
      expect(new Set(all.map((row) => row.id)).size).toBe(all.length);
      expect(first.total).toBe(rows.length);
    }));
  });

  it("pageSize không bao giờ vượt 100; page ngoài khoảng luôn về khoảng hợp lệ", () => {
    fc.assert(fc.property(rowsArb, fc.oneof(fc.integer({ min: -50, max: 1000 }), fc.constant(Number.NaN)), fc.oneof(fc.integer({ min: -10, max: 500 }), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY)), (rows, pageSize, page) => {
      const result = paginate(rows, { page, pageSize, compare: byScore });
      expect(result.pageSize).toBeGreaterThanOrEqual(1);
      expect(result.pageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      expect(result.items.length).toBeLessThanOrEqual(result.pageSize);
      expect(result.page).toBeGreaterThanOrEqual(1);
      expect(result.page).toBeLessThanOrEqual(result.totalPages);
      // Trang vượt quá → trang cuối, không trả rỗng khi còn dữ liệu
      if (rows.length) expect(result.items.length).toBeGreaterThan(0);
    }));
  });

  it("mặc định 20 dòng mỗi trang; page không phải số thì về 1; vượt trần thì cắt về 100", () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ id: `r${String(index).padStart(3, "0")}`, score: 0 }));
    expect(paginate(rows, { compare: byScore }).pageSize).toBe(20);
    expect(paginate(rows, { page: Number.NaN, compare: byScore }).page).toBe(1);
    expect(paginate(rows, { pageSize: 5000, compare: byScore }).pageSize).toBe(100);
    expect(paginate(rows, { page: 99, pageSize: 100, compare: byScore })).toMatchObject({ page: 3, totalPages: 3 });
  });

  it("cùng đầu vào thì cùng thứ tự; đổi chiều sắp xếp thì thứ tự đảo đúng (khóa phụ id)", () => {
    fc.assert(fc.property(rowsArb, (rows) => {
      const shuffled = [...rows].reverse();
      const asc = paginate(rows, { pageSize: 100, compare: byScore }).items.map((row) => row.id);
      expect(paginate(shuffled, { pageSize: 100, compare: byScore }).items.map((row) => row.id)).toEqual(asc);
      const desc = paginate(rows, { pageSize: 100, compare: byScore, direction: "desc" }).items.map((row) => row.id);
      if (rows.length <= 100) expect(desc).toEqual([...asc].reverse());
    }));
  });
});
