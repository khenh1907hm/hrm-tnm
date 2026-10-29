import { describe, expect, it } from "vitest";
import type { Certificate } from "../certificates/types";
import { DEFAULT_CERTIFICATE_FOLDER_PRESET, parseCertificateFolderPresets, pickCertificatesForFolder } from "./certificateFolderPresets";

const cert = (id: string, type: string, expiryDate: string | null, state: Certificate["state"] = "current") => ({
  id, employeeId: "e1", type, title: "", number: "", expiryDate, issueDate: null,
  document: { id: `f-${id}`, name: `${id}.pdf`, mime: "application/pdf" }, supplementaryFiles: [],
  state, version: 1, replacedBy: null, archiveReason: null,
}) as unknown as Certificate;

const list = [cert("a", "atld", "2027-01-01"), cert("b", "cccd", null), cert("c", "atld", "2026-01-01"), cert("d", "health", "2026-12-01"), cert("e", "cccd", null, "replaced")];

describe("chọn chứng chỉ cho thư mục chứng chỉ", () => {
  it("theo thứ tự loại trong cấu hình, chỉ loại đã chọn, bỏ bản đã thay", () => {
    const picked = pickCertificatesForFolder(list, { typeKeys: ["cccd", "atld"], validOnly: false }, "2026-10-28");
    expect(picked.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("chỉ lấy chứng chỉ còn hạn khi bật", () => {
    const picked = pickCertificatesForFolder(list, { typeKeys: ["cccd", "atld"], validOnly: true }, "2026-10-28");
    expect(picked.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("không chọn loại nào = mọi loại, theo thứ tự loại chứng chỉ", () => {
    const picked = pickCertificatesForFolder(list, { typeKeys: [], validOnly: true }, "2026-10-28", ["health", "cccd", "atld"]);
    expect(picked.map((item) => item.id)).toEqual(["d", "b", "a"]);
  });
});

describe("đọc cấu hình đã lưu", () => {
  it("dữ liệu hỏng hoặc trống → cấu hình mặc định", () => {
    expect(parseCertificateFolderPresets(null)).toEqual([DEFAULT_CERTIFICATE_FOLDER_PRESET]);
    expect(parseCertificateFolderPresets("{oops")).toEqual([DEFAULT_CERTIFICATE_FOLDER_PRESET]);
  });

  it("bỏ bản ghi thiếu id/tên, bù giá trị thiếu", () => {
    const parsed = parseCertificateFolderPresets(JSON.stringify([{ id: "x", name: "Vinci", typeKeys: ["cccd", 3] }, { name: "no id" }]));
    expect(parsed).toEqual([{ id: "x", name: "Vinci", typeKeys: ["cccd"], validOnly: true, employeeFolderPattern: "", naming: {} }]);
  });
});
