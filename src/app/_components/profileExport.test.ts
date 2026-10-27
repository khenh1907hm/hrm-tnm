import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Certificate } from "../../modules/certificates/types";
import type { Employee } from "../../modules/employees/types";
import { exportProfileBundle, zipFiles, type ProfileExportInput } from "./profileExport";

async function templateBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Phieu");
  sheet.getCell("A1").value = "{{fullNameUpper}}";
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
}

async function pdfFile(pages: number, name: string, size: [number, number] = [300, 400]): Promise<File> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage(size);
  return new File([(await document.save()).slice().buffer], name, { type: "application/pdf" });
}

const employee = { id: "e1", code: "TNM001", name: "Nguyễn Văn An", dob: "1990-03-15", gender: "Nam", cccd: "001090012345", phone: "0912345678", home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "2015-06-01", emergencyContactId: null, status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null } satisfies Employee;
const certificate = (id: string, type: string, fileId: string): Certificate => ({ id, employeeId: "e1", type, title: "", number: id, expiryDate: "2027-01-01", issueDate: null, document: { id: fileId, name: `${fileId}.pdf`, mime: "application/pdf", size: 1 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null });

async function input(selected: string[]): Promise<ProfileExportInput> {
  return {
    template: { id: "t1", name: "Mẫu", fileName: "mau.xlsx", fileBase64: await templateBase64(), mappings: [], createdAt: "", updatedAt: "", profile: { sheetName: "Phieu", printArea: "A1:F20", placeholders: ["fullNameUpper"], customFields: [], imageSlots: [], slotAspect: {}, attachments: ["health", "atld"] } },
    employee, commander: null, certificates: [certificate("c-atld", "atld", "f-atld"), certificate("c-health", "health", "f-health")],
    certificateTypeNames: { atld: "An toàn lao động", health: "Khám sức khỏe" },
    sessionFiles: { "f-atld": await pdfFile(2, "atld.pdf"), "f-health": await pdfFile(1, "ksk.pdf", [200, 200]) },
    selectedCertificateIds: selected, overrides: {}, exportDate: "2026-10-22",
  };
}

describe("exportProfileBundle", () => {
  it("returns the filled Excel plus one PDF merging the chosen certificates in template order", async () => {
    const { files, warnings } = await exportProfileBundle(await input(["c-atld", "c-health"]));
    expect(warnings).toEqual([]);
    expect(files.map((file) => file.name)).toEqual(["HoSo_TNM001_nguyen_van_an_20261022.xlsx", "ChungChi_TNM001_nguyen_van_an_20261022.pdf"]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(files[0]!.bytes.slice().buffer);
    expect(workbook.getWorksheet("Phieu")!.getCell("A1").value).toBe("NGUYỄN VĂN AN");
    // Khám sức khỏe (1 trang) đứng trước An toàn lao động (2 trang) theo thứ tự của mẫu
    const merged = await PDFDocument.load(files[1]!.bytes);
    expect(merged.getPages().map((page) => page.getSize().width)).toEqual([200, 300, 300]);

    const zip = await JSZip.loadAsync(await (await zipFiles(files.map((file) => ({ ...file, folder: "HoSo_TNM001" })))).arrayBuffer());
    expect(Object.keys(zip.files).filter((name) => !name.endsWith("/")).sort()).toEqual(["HoSo_TNM001/ChungChi_TNM001_nguyen_van_an_20261022.pdf", "HoSo_TNM001/HoSo_TNM001_nguyen_van_an_20261022.xlsx"]);
  });

  it("merges certificates in the order the exporter chose (drag / number), not the template order", async () => {
    const { files } = await exportProfileBundle({ ...await input(["c-atld", "c-health"]), certificateOrder: ["c-atld", "c-health"] });
    // An toàn lao động (2 trang rộng 300) lên trước Khám sức khỏe (1 trang rộng 200)
    const merged = await PDFDocument.load(files[1]!.bytes);
    expect(merged.getPages().map((page) => page.getSize().width)).toEqual([300, 300, 200]);
  });

  it("gives only the Excel file and says so when no certificate is chosen", async () => {
    const { files, warnings } = await exportProfileBundle(await input([]));
    expect(files.map((file) => file.name)).toEqual(["HoSo_TNM001_nguyen_van_an_20261022.xlsx"]);
    expect(warnings).toEqual(["Không có chứng chỉ nào để gộp PDF, chỉ có tệp Excel"]);
  });
});
