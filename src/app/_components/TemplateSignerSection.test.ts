import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProfileTemplateConfig } from "../../modules/excel-template/types";
import type { Signature } from "../../modules/signatures/types";
import { TemplateSignerSection } from "./TemplateSignerSection";

const base: ProfileTemplateConfig = { sheetName: "Phieu thong tin", printArea: "A1:AV60", placeholders: ["fullName"], customFields: [], imageSlots: [], slotAspect: {}, attachments: [] };
const file = { id: "f", name: "sign.png", mime: "image/png", size: 1, hasTransparency: true };
const signatures: Signature[] = [
  { id: "s1", name: "Trần Văn Bình", role: "Phó Giám Đốc", file, isDefault: false, version: 1 },
  { id: "s2", name: "Nguyễn Gia Luân", role: "Giám Đốc", file, isDefault: true, version: 2 },
];
const render = (value: ProfileTemplateConfig, list: Signature[] | null = signatures) =>
  renderToStaticMarkup(createElement(TemplateSignerSection, { value, onChange: () => undefined, signatures: list }));

describe("mục Người ký trong form sửa mẫu", () => {
  it("mặc định chọn chữ ký mặc định của thư viện và chỉ ra việc còn thiếu trong mẫu", () => {
    const html = render(base);
    expect(html).toMatch(/<option value="s2" selected="">Nguyễn Gia Luân - Giám Đốc/);
    expect(html).toContain("chưa có. Trong Excel, thay dòng tên viết sẵn bằng");
    expect(html).toContain("Nguyễn Gia Luân - Giám Đốc”");
    expect(html.match(/class="todo"/g)).toHaveLength(2);
  });

  it("chữ ký cài riêng cho mẫu được chọn; mẫu đã có mã tên và vùng ảnh thì báo đã xong", () => {
    const html = render({ ...base, signatureId: "s1", placeholders: ["fullName", "signerTitle"], imageSlots: [{ field: "signature", range: "AB40:AK46", fit: "contain" }] });
    expect(html).toMatch(/<option value="s1" selected="">Trần Văn Bình/);
    expect(html).toContain("{{signerTitle}}");
    expect(html).toContain('value="AB40:AK46"');
    expect(html.match(/class="ok"/g)).toHaveLength(2);
  });

  it("thư viện trống thì hướng dẫn thêm chữ ký trước; vùng ô sai thì báo lỗi", () => {
    expect(render(base, [])).toContain("Thư viện chữ ký đang trống");
    expect(render({ ...base, imageSlots: [{ field: "signature", range: "AB40:", fit: "contain" }] })).toContain("Vùng ô chưa đúng");
  });
});
