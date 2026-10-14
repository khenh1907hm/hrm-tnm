import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createDefaultStarterTemplate,
  populateExcelTemplate,
} from "./populateTemplate";
import {
  isValidCellAddress,
  mapEmployeeToExcelData,
  normalizeCellAddress,
  type ExcelCellMapping,
} from "./types";
import type { Employee } from "../employees/types";

describe("Excel Template - Pure functions and population", () => {
  it("isValidCellAddress validates cell coordinates accurately", () => {
    expect(isValidCellAddress("A1")).toBe(true);
    expect(isValidCellAddress("c5")).toBe(true);
    expect(isValidCellAddress("AB100")).toBe(true);
    expect(isValidCellAddress("")).toBe(false);
    expect(isValidCellAddress("1A")).toBe(false);
    expect(isValidCellAddress("A0")).toBe(false);
    expect(isValidCellAddress("INVALID")).toBe(false);
  });

  it("normalizeCellAddress uppercases and trims cell coordinate", () => {
    expect(normalizeCellAddress(" c5 ")).toBe("C5");
    expect(normalizeCellAddress("b12")).toBe("B12");
  });

  it("mapEmployeeToExcelData formats employee fields for Excel export", () => {
    const dummyEmp: Employee = {
      id: "emp-1",
      code: "NV-001",
      name: "Nguyễn Văn An",
      dob: "1995-10-20",
      gender: "Nam",
      cccd: "034095001234",
      phone: "0912345678",
      home: "Xã Hoằng Phú, Tỉnh Thanh Hóa",
      address: "Thôn Ka Đê, Tỉnh Lâm Đồng",
      currentAddress: "Số 5, Quận 1, TP.HCM",
      position: "Nhân viên kỹ thuật",
      group: 3,
      startDate: "2024-01-15",
      status: "active",
      endDate: null,
      emergencyContactId: null,
      version: 1,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      cccdMismatchOverrideReason: null,
    };

    const mapped = mapEmployeeToExcelData(dummyEmp);
    expect(mapped.name).toBe("Nguyễn Văn An");
    expect(mapped.code).toBe("NV-001");
    expect(mapped.dob).toBe("20/10/1995");
    expect(mapped.startDate).toBe("15/01/2024");
    expect(mapped.currentAddress).toBe("Số 5, Quận 1, TP.HCM");
    expect(mapped.group).toBe("Nhóm 3");
    expect(mapped.status).toBe("Đang làm việc");
  });

  it("populateExcelTemplate fills cells by mapping coordinates and preserves template", async () => {
    // Tạo 1 template thử nghiệm
    const starterBuf = await createDefaultStarterTemplate();
    expect(starterBuf.length).toBeGreaterThan(0);

    const mappings: ExcelCellMapping[] = [
      { cell: "C5", field: "code" },
      { cell: "C6", field: "name" },
      { cell: "C7", field: "dob" },
      { cell: "C8", field: "cccd" },
      { cell: "E5", field: "position" },
    ];

    const data = {
      code: "EMP-999",
      name: "Trần Thị Bích",
      dob: "01/02/1992",
      cccd: "068203009852",
      position: "Kỹ sư giám sát",
    };

    const outputBytes = await populateExcelTemplate({
      templateBuffer: starterBuf,
      mappings,
      data,
    });

    expect(outputBytes.length).toBeGreaterThan(0);

    // Kiểm tra kết quả trong file Excel sau khi xuất
    const wb = new ExcelJS.Workbook();
    const ab = outputBytes.buffer.slice(outputBytes.byteOffset, outputBytes.byteOffset + outputBytes.byteLength);
    await wb.xlsx.load(ab as Parameters<typeof wb.xlsx.load>[0]);
    const sheet = wb.worksheets[0];
    expect(sheet).toBeDefined();
    if (!sheet) return;

    expect(sheet.getCell("C5").value).toBe("EMP-999");
    expect(sheet.getCell("C6").value).toBe("Trần Thị Bích");
    expect(sheet.getCell("C7").value).toBe("01/02/1992");
    expect(sheet.getCell("C8").value).toBe("068203009852");
    expect(sheet.getCell("E5").value).toBe("Kỹ sư giám sát");
  });

  it("populateExcelTemplate replaces {{tags}} when present in cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TagTest");
    ws.getCell("A1").value = "Họ tên: {{name}}, CCCD: {{cccd}}";
    ws.getCell("B2").value = "Chức vụ: {{position}}";
    const templateBuf = new Uint8Array(await wb.xlsx.writeBuffer());

    const outputBytes = await populateExcelTemplate({
      templateBuffer: templateBuf,
      mappings: [], // không cần mappings tọa độ nếu ô đã có tag
      data: {
        name: "Lê Văn Cường",
        cccd: "0123456789",
        position: "Thợ hàn",
      },
    });

    const verifyWb = new ExcelJS.Workbook();
    const ab = outputBytes.buffer.slice(outputBytes.byteOffset, outputBytes.byteOffset + outputBytes.byteLength);
    await verifyWb.xlsx.load(ab as Parameters<typeof verifyWb.xlsx.load>[0]);
    const sheet = verifyWb.worksheets[0];
    expect(sheet).toBeDefined();
    if (!sheet) return;

    expect(sheet.getCell("A1").value).toBe("Họ tên: Lê Văn Cường, CCCD: 0123456789");
    expect(sheet.getCell("B2").value).toBe("Chức vụ: Thợ hàn");
  });
});
