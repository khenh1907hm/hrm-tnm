import { describe, expect, it } from "vitest";
import { fixIssue, markFromDrag, parseMarks, submitIssue } from "./types";

describe("Báo cáo công trình", () => {
  it("nét khoanh từ kéo chuột theo mọi chiều", () => {
    expect(markFromDrag("circle", { x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ shape: "circle", x: 0.2, y: 0.1, w: 0.3, h: 0.5 });
    expect(markFromDrag("rect", { x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 })).toBeNull();
  });
  it("đọc nét từ JSON: bỏ giá trị lạ, giới hạn trong ảnh", () => {
    expect(parseMarks([{ shape: "rect", x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, { shape: "star", x: 0, y: 0, w: 1, h: 1 }, null])).toEqual([{ shape: "rect", x: 0.9, y: 0.9, w: 0.09999999999999998, h: 0.09999999999999998 }]);
    expect(parseMarks("x")).toEqual([]);
  });
  it("kiểm tra trước khi gửi và khi báo đã sửa", () => {
    const item = { beforePhoto: "a.jpg", problem: "Chưa xiết ốc", afterPhoto: null, finishDate: null };
    expect(submitIssue({ items: [], attentionEmployeeId: "e1" })).toMatch(/Chưa có lỗi/);
    expect(submitIssue({ items: [item as never], attentionEmployeeId: null })).toMatch(/người nhận/);
    expect(submitIssue({ items: [item as never], attentionEmployeeId: "e1" })).toBeNull();
    expect(fixIssue([item])).toMatch(/Lỗi 1/);
    expect(fixIssue([{ afterPhoto: "b.jpg", finishDate: "2026-11-26" }])).toBeNull();
  });
});
