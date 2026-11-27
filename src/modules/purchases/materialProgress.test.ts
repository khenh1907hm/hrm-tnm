import { describe, expect, it } from "vitest";
import { materialCurrentLabel, materialProgress } from "./materials";

const states = (list: ReturnType<typeof materialProgress>) => Object.fromEntries(list.map((stage) => [stage.key, stage.state]));

describe("tiến độ phiếu yêu cầu vật tư: lập → ký → hỏi giá → PO nháp (mỗi báo giá một PO) → mua → hoàn tất", () => {
  it("đang soạn, bị trả về, đang ký", () => {
    expect(states(materialProgress({ status: "draft" }, 0, []))).toMatchObject({ draft: "current", signing: "todo" });
    expect(states(materialProgress({ status: "rejected" }, 0, []))).toMatchObject({ draft: "bad", signing: "todo" });
    const signing = materialProgress({ status: "submitted" }, 0, []);
    expect(states(signing)).toMatchObject({ draft: "done", signing: "current", quoting: "todo" });
    expect(materialCurrentLabel(signing)).toBe("Đang chờ ký");
  });
  it("đã duyệt: chưa có báo giá thì đang hỏi giá; có báo giá thì chọn báo giá để lập PO", () => {
    expect(states(materialProgress({ status: "approved" }, 0, []))).toMatchObject({ signing: "done", quoting: "current", po: "todo" });
    const quoted = materialProgress({ status: "approved" }, 2, []);
    expect(states(quoted)).toMatchObject({ quoting: "done", po: "current" });
    expect(materialCurrentLabel(quoted)).toBe("Chọn báo giá để lập PO");
  });
  it("đã có PO: PO nháp chưa gửi thì ở bước PO nháp; xong hết thì hoàn tất (PO hủy không tính)", () => {
    const stages = materialProgress({ status: "ordered" }, 2, [{ status: "draft" }, { status: "submitted" }]);
    expect(states(stages)).toMatchObject({ po: "current", orders: "current" });
    expect(materialCurrentLabel(stages)).toBe("1/2 PO nháp chưa gửi duyệt");
    const running = materialProgress({ status: "ordered" }, 2, [{ status: "completed" }, { status: "ordered" }, { status: "cancelled" }]);
    expect(states(running)).toMatchObject({ po: "done", orders: "current", done: "todo" });
    expect(states(materialProgress({ status: "ordered" }, 1, [{ status: "completed" }]))).toMatchObject({ orders: "done", done: "done" });
    expect(states(materialProgress({ status: "closed" }, 0, []))).toMatchObject({ quoting: "skipped", done: "done" });
  });
});
