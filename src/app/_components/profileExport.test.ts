import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Certificate } from "../../modules/certificates/types";
import type { Employee } from "../../modules/employees/types";
import { exportCertificateFiles, exportCertificatesPdf, exportProfileBundle, mergesCertificates, zipFiles, type ProfileExportInput } from "./profileExport";

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

describe("exportCertificateFiles (xuất riêng chứng chỉ)", () => {
  const cert = (id: string, type: string, number: string, document: { id: string; name: string; mime: string }, supplementary: { id: string; name: string; mime: string }[] = []): Certificate => ({
    id, employeeId: "e1", type: type as Certificate["type"], title: "", number, issueDate: null, expiryDate: null, state: "current",
    document: { ...document, size: 10 }, supplementaryFiles: supplementary.map((file) => ({ file: { ...file, size: 10 } })),
  } as unknown as Certificate);

  it("mỗi chứng chỉ một tệp đánh số, không kèm số chứng chỉ, tên gọi riêng theo loại; tệp bổ sung gộp thành một PDF", async () => {
    const id = new File([new Uint8Array([0xff, 0xd8, 0xff])], "TNM0018CM.jpg", { type: "image/jpeg" });
    const labor = await pdfFile(2, "HD.pdf");
    const atld = await pdfFile(1, "ATD.pdf");
    const atldBack = await pdfFile(1, "ATD-sau.pdf");
    const result = await exportCertificateFiles({
      employee: { code: "TNM0018", name: "Trần Ngọc Đức", position: "Nhân viên hiện trường" },
      certificates: [
        cert("c1", "custom-ctype-cccd", "272765636", { id: "f1", name: "TNM0018CM.jpg", mime: "image/jpeg" }),
        cert("c2", "labor", "009/TNM-2023", { id: "f2", name: "HD.pdf", mime: "application/pdf" }),
        cert("c3", "atld", "25C2665", { id: "f3", name: "ATD.pdf", mime: "application/pdf" }, [{ id: "f4", name: "ATD-sau.pdf", mime: "application/pdf" }]),
        cert("c4", "atld", "26E11924", { id: "f5", name: "missing.pdf", mime: "application/pdf" }),
      ],
      certificateTypeNames: { "custom-ctype-cccd": "Căn cước công dân", labor: "HĐLĐ", atld: "An toàn lao động" },
      sessionFiles: { f1: id, f2: labor, f3: atld, f4: atldBack },
      config: { typeLabels: { "custom-ctype-cccd": "ID" } },
      fileNamePattern: "Vinci - {mã nhân viên} - {tên nhân viên}",
      exportDate: "2026-10-28",
    });
    expect(result.folder).toBe("Vinci - TNM0018 - Trần Ngọc Đức");
    expect(result.files.map((file) => file.name)).toEqual(["1. ID.jpg", "2. HĐLĐ.pdf", "3. An toàn lao động.pdf"]);
    expect((await PDFDocument.load(result.files[2]!.bytes)).getPageCount()).toBe(2);
    expect(result.warnings).toEqual(['An toàn lao động: chưa có dữ liệu tệp "missing.pdf" trong phiên này']);

    const zip = await JSZip.loadAsync(await (await zipFiles(result.files.map((file) => ({ ...file, folder: `Chứng chỉ - 28-10-2026/${result.folder}` })))).arrayBuffer());
    expect(Object.keys(zip.files).filter((name) => !zip.files[name]!.dir)).toEqual([
      "Chứng chỉ - 28-10-2026/Vinci - TNM0018 - Trần Ngọc Đức/1. ID.jpg",
      "Chứng chỉ - 28-10-2026/Vinci - TNM0018 - Trần Ngọc Đức/2. HĐLĐ.pdf",
      "Chứng chỉ - 28-10-2026/Vinci - TNM0018 - Trần Ngọc Đức/3. An toàn lao động.pdf",
    ]);
  });
});

describe("exportCertificatesPdf (gộp chứng chỉ thành 1 PDF)", () => {
  const cert = (id: string, type: string, document: { id: string; name: string; mime: string }, supplementary: { id: string; name: string; mime: string }[] = []): Certificate => ({
    id, employeeId: "e1", type: type as Certificate["type"], title: "", number: id, issueDate: null, expiryDate: null, state: "current",
    document: { ...document, size: 10 }, supplementaryFiles: supplementary.map((file) => ({ file: { ...file, size: 10 } })),
  } as unknown as Certificate);

  it("nối mọi chứng chỉ theo thứ tự truyền vào (tệp chính rồi tệp bổ sung) thành một PDF đặt tên theo quy tắc của mẫu", async () => {
    const result = await exportCertificatesPdf({
      employee: { code: "TNM0018", name: "Trần Ngọc Đức", position: "Nhân viên kỹ thuật" },
      certificates: [
        cert("c1", "elec", { id: "f1", name: "dien.pdf", mime: "application/pdf" }),
        cert("c2", "custom-ctype-height-health", { id: "f2", name: "cao.pdf", mime: "application/pdf" }, [{ id: "f3", name: "cao-sau.pdf", mime: "application/pdf" }]),
        cert("c3", "atld", { id: "f4", name: "missing.pdf", mime: "application/pdf" }),
      ],
      certificateTypeNames: { elec: "An toàn điện", "custom-ctype-height-health": "Làm việc trên cao", atld: "An toàn lao động" },
      sessionFiles: { f1: await pdfFile(1, "dien.pdf", [100, 100]), f2: await pdfFile(2, "cao.pdf", [200, 200]), f3: await pdfFile(1, "cao-sau.pdf", [300, 300]) },
      config: undefined,
      fileNamePattern: "Vinci - {mã nhân viên} - {tên nhân viên}",
      exportDate: "2026-10-28",
    });
    expect(result.name).toBe("Vinci - TNM0018 - Trần Ngọc Đức.pdf");
    expect(result.pageCount).toBe(4);
    expect((await PDFDocument.load(result.bytes)).getPages().map((page) => page.getSize().width)).toEqual([100, 200, 200, 300]);
    expect(result.warnings).toEqual(['An toàn lao động: chưa có dữ liệu tệp "missing.pdf" trong phiên này']);
  });

  it("gộp là mặc định; chỉ layout \"separate\" mới tách từng tệp", () => {
    expect(mergesCertificates(undefined)).toBe(true);
    expect(mergesCertificates({ layout: "merged" })).toBe(true);
    expect(mergesCertificates({ layout: "separate" })).toBe(false);
  });
});
