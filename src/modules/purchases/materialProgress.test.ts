import { describe, expect, it } from "vitest";
import { materialCurrentLabel, materialProgress } from "./materials";

const states = (list: ReturnType<typeof materialProgress>) => Object.fromEntries(list.map((stage) => [stage.key, stage.state]));

describe("tiến độ phiếu yêu cầu vật tư", () => {
  it("đang ký duyệt", () => {
    const stages = materialProgress({ status: "submitted" }, 0, []);
    expect(states(stages)).toMatchObject({ draft: "done", signing: "current", quoting: "todo" });
    expect(materialCurrentLabel(stages)).toBe("Đang chờ ký");
  });
  it("đã duyệt: chưa có báo giá thì đang hỏi giá; có báo giá thì chờ chọn NCC", () => {
    expect(states(materialProgress({ status: "approved" }, 0, []))).toMatchObject({ signing: "done", quoting: "current", ordering: "todo" });
    expect(states(materialProgress({ status: "approved" }, 2, []))).toMatchObject({ quoting: "done", ordering: "current" });
  });
  it("đã lên đơn: tiến độ theo các đơn; mọi đơn xong thì hoàn tất", () => {
    const running = materialProgress({ status: "ordered" }, 2, [{ status: "completed" }, { status: "ordered" }]);
    expect(states(running)).toMatchObject({ ordering: "done", orders: "current", done: "todo" });
    expect(materialCurrentLabel(running)).toBe("1/2 đơn xong");
    expect(states(materialProgress({ status: "ordered" }, 1, [{ status: "completed" }]))).toMatchObject({ orders: "done", done: "done" });
  });
  it("bị trả về và đóng phiếu", () => {
    expect(states(materialProgress({ status: "rejected" }, 0, []))).toMatchObject({ draft: "bad", signing: "todo" });
    expect(states(materialProgress({ status: "closed" }, 0, []))).toMatchObject({ quoting: "skipped", done: "done" });
  });
});
