import { describe, expect, it } from "vitest";
import { materialCurrentLabel, materialProgress } from "./materials";

const states = (list: ReturnType<typeof materialProgress>) => Object.fromEntries(list.map((stage) => [stage.key, stage.state]));

describe("tiến độ phiếu yêu cầu vật tư (không ký duyệt / hỏi giá: lập xong ra PO nháp)", () => {
  it("đang soạn và bị trả về", () => {
    expect(states(materialProgress({ status: "draft" }, 0, []))).toMatchObject({ draft: "current", po: "todo" });
    expect(states(materialProgress({ status: "rejected" }, 0, []))).toMatchObject({ draft: "bad", po: "todo" });
  });
  it("đã gửi: PO nháp chưa gửi duyệt thì đang ở bước PO nháp", () => {
    const stages = materialProgress({ status: "ordered" }, 0, [{ status: "draft" }, { status: "submitted" }]);
    expect(states(stages)).toMatchObject({ draft: "done", po: "current", orders: "current" });
    expect(materialCurrentLabel(stages)).toBe("1/2 PO nháp chưa gửi duyệt");
    expect(materialCurrentLabel(materialProgress({ status: "approved" }, 0, []))).toBe("Chờ lập PO nháp");
  });
  it("mọi PO đã đi tiếp: theo dõi mua hàng; xong hết thì hoàn tất (PO hủy không tính)", () => {
    const running = materialProgress({ status: "ordered" }, 0, [{ status: "completed" }, { status: "ordered" }, { status: "cancelled" }]);
    expect(states(running)).toMatchObject({ po: "done", orders: "current", done: "todo" });
    expect(materialCurrentLabel(running)).toBe("1/2 PO xong");
    expect(states(materialProgress({ status: "ordered" }, 0, [{ status: "completed" }]))).toMatchObject({ orders: "done", done: "done" });
    expect(states(materialProgress({ status: "closed" }, 0, []))).toMatchObject({ po: "skipped", done: "done" });
  });
});
