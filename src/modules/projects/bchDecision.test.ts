import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bchDateText, bchNumberText, fillBchDecision, type BchInput } from "./bchDecision";

const template = () => new Uint8Array(readFileSync("public/templates/bch/QD_BCH.xlsx"));
const base: BchInput = {
  number: 3, signedOn: "2026-11-13", packageName: "Cung cấp và lắp đặt điện", worksName: "Nhà xưởng X", responsibleTo: "Tổng thầu", directorName: "Nguyễn Văn Giám Đốc",
  members: [],
};
const people = (n: number) => Array.from({ length: n }, (_, index) => ({ name: `Người ${index + 1}`, title: index === 0 ? "Chỉ huy trưởng" : "Giám sát", phone: `09000000${index}` }));

async function read(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook.worksheets[0]!;
}

describe("Quyết định thành lập Ban chỉ huy công trường", () => {
  it("số và ngày quyết định", () => {
    expect(bchNumberText(3, "2026-11-13")).toBe("Số: 03/2026/QĐ-TNM");
    expect(bchDateText("2026-11-13")).toBe("TP.HCM, ngày 13 tháng 11 năm 2026");
  });

  it("8 thành viên: thêm dòng, đoạn sau dời xuống, bỏ khung không in", async () => {
    const ws = await read(await fillBchDecision(template(), { ...base, members: people(8) }));
    expect(ws.getCell("A7").value).toBe("Số: 03/2026/QĐ-TNM");
    expect(String(ws.getCell("B19").value)).toContain("Gói thầu “Cung cấp và lắp đặt điện” – Công trình Nhà xưởng X");
    expect(ws.getCell("B29").value).toBe("Người 8");
    expect(ws.getCell("A29").value).toBe(8);
    expect(ws.getCell("A31").value).toBe("Điều 2.");
    expect(String(ws.getCell("B31").value)).toContain("chịu trách nhiệm trước Tổng thầu");
    expect(ws.getCell("D42").value).toBe("NGUYỄN VĂN GIÁM ĐỐC");
    expect(ws.getCell("G1").value).toBeNull();
    expect(ws.getCell("H3").value).toBeNull();
    expect(ws.pageSetup.printArea).toBe("A1:E42");
  });

  it("2 thành viên: bớt dòng mẫu", async () => {
    const ws = await read(await fillBchDecision(template(), { ...base, members: people(2), directorName: "" }));
    expect(ws.getCell("B23").value).toBe("Người 2");
    expect(ws.getCell("A25").value).toBe("Điều 2.");
    expect(ws.getCell("D36").value).toBe("..................................");
    expect(ws.pageSetup.printArea).toBe("A1:E36");
  });
});
