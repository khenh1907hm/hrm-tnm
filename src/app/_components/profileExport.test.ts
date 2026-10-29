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
      config: { typeLabels: { "custom-ctype-cccd": "ID" }, groups: [] },
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

  it("gom các loại cùng nhóm vào một thư mục con đánh số, bên trong đánh số lại từ 1; nhóm trống không chiếm số", async () => {
    const pdf = (name: string) => pdfFile(1, name);
    const result = await exportCertificateFiles({
      employee: { code: "TNM0018", name: "Trần Ngọc Đức", position: "Nhân viên hiện trường" },
      certificates: [
        cert("c1", "cccd", "1", { id: "f1", name: "id.pdf", mime: "application/pdf" }),
        cert("c2", "atd", "2", { id: "f2", name: "atd.pdf", mime: "application/pdf" }),
        cert("c3", "health", "3", { id: "f3", name: "ksk.pdf", mime: "application/pdf" }),
        cert("c4", "han", "4", { id: "f4", name: "han.pdf", mime: "application/pdf" }),
        cert("c5", "bang", "5", { id: "f5", name: "missing.pdf", mime: "application/pdf" }),
        cert("c6", "insurance", "6", { id: "f6", name: "bh.pdf", mime: "application/pdf" }),
      ],
      certificateTypeNames: { cccd: "ID", atd: "An toàn điện", health: "KSK", han: "An toàn hàn cắt", bang: "Bằng kỹ sư", insurance: "Bảo hiểm tai nạn" },
      sessionFiles: { f1: await pdf("id.pdf"), f2: await pdf("atd.pdf"), f3: await pdf("ksk.pdf"), f4: await pdf("han.pdf"), f6: await pdf("bh.pdf") },
      config: { folders: [{ id: "g1", name: "Safety certificate", typeKeys: ["atd", "han"] }, { id: "g2", name: "Qualification", typeKeys: ["bang"] }, { id: "g3", name: "Accident insurance", typeKeys: ["insurance"] }] },
      fileNamePattern: "{mã nhân viên}",
      exportDate: "2026-10-28",
    });
    expect(result.files.map((file) => file.name)).toEqual([
      "1. ID.pdf",
      "2. Safety certificate/1. An toàn điện.pdf",
      "2. Safety certificate/2. An toàn hàn cắt.pdf",
      "3. KSK.pdf",
      "4. Accident insurance/1. Bảo hiểm tai nạn.pdf",
    ]);
  });

  it("nhóm gộp 1 PDF (An toàn) và thư mục con dùng chung: nhóm thành một tệp bên trong thư mục con", async () => {
    const pdf = (name: string) => pdfFile(1, name);
    const result = await exportCertificateFiles({
      employee: { code: "TNM0848", name: "Phan Đức Phi", position: "Nhân viên hiện trường" },
      certificates: [
        cert("c1", "custom-ctype-cccd", "1", { id: "f1", name: "id.pdf", mime: "application/pdf" }),
        cert("c2", "atld", "2", { id: "f2", name: "atld.pdf", mime: "application/pdf" }),
        cert("c3", "elec", "3", { id: "f3", name: "elec.pdf", mime: "application/pdf" }),
        cert("c4", "custom-ctype-height-health", "4", { id: "f4", name: "cao.pdf", mime: "application/pdf" }),
        cert("c5", "weld", "5", { id: "f5", name: "han.pdf", mime: "application/pdf" }),
      ],
      certificateTypeNames: { "custom-ctype-cccd": "ID", atld: "An toàn lao động", elec: "An toàn điện", "custom-ctype-height-health": "Làm việc trên cao", weld: "Chứng chỉ hàn" },
      sessionFiles: { f1: await pdf("id.pdf"), f2: await pdf("atld.pdf"), f3: await pdf("elec.pdf"), f4: await pdf("cao.pdf"), f5: await pdf("han.pdf") },
      config: { folders: [{ id: "s", name: "Safety certificate", typeKeys: ["atld", "weld"] }] },
      fileNamePattern: "{mã nhân viên}",
      exportDate: "2026-10-28",
    });
    expect(result.files.map((file) => file.name)).toEqual(["1. ID.pdf", "2. Safety certificate/1. An toàn.pdf", "2. Safety certificate/2. Chứng chỉ hàn.pdf"]);
    expect((await PDFDocument.load(result.files[1]!.bytes)).getPageCount()).toBe(3);
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

  it("mặc định tải từng tệp; chỉ layout \"merged\" mới gộp tất cả", () => {
    expect(mergesCertificates(undefined)).toBe(false);
    expect(mergesCertificates({ layout: "separate" })).toBe(false);
    expect(mergesCertificates({ layout: "merged" })).toBe(true);
  });
});

describe("exportCertificateFiles: nhóm gộp chung một tệp", () => {
  const cert = (id: string, type: string, fileId: string): Certificate => ({
    id, employeeId: "e1", type: type as Certificate["type"], title: "", number: id, issueDate: null, expiryDate: null, state: "current",
    document: { id: fileId, name: `${fileId}.pdf`, mime: "application/pdf", size: 10 }, supplementaryFiles: [],
  } as unknown as Certificate);

  it("mặc định: làm việc trên cao, an toàn điện, an toàn lao động ra chung \"An toàn.pdf\" ở vị trí cái đầu tiên", async () => {
    const result = await exportCertificateFiles({
      employee: { code: "TNM0848", name: "Phan Đức Phi", position: "Nhân viên kỹ thuật" },
      certificates: [cert("c1", "custom-ctype-cccd", "f1"), cert("c2", "elec", "f2"), cert("c3", "custom-ctype-labor-contract", "f3"), cert("c4", "custom-ctype-height-health", "f4"), cert("c5", "atld", "f5")],
      certificateTypeNames: { "custom-ctype-cccd": "CCCD", elec: "An toàn điện", "custom-ctype-labor-contract": "HĐLĐ", "custom-ctype-height-health": "Làm việc trên cao", atld: "An toàn lao động" },
      sessionFiles: { f1: await pdfFile(1, "f1.pdf", [10, 10]), f2: await pdfFile(1, "f2.pdf", [20, 20]), f3: await pdfFile(1, "f3.pdf", [30, 30]), f4: await pdfFile(2, "f4.pdf", [40, 40]), f5: await pdfFile(1, "f5.pdf", [50, 50]) },
      config: undefined, fileNamePattern: undefined, exportDate: "2026-10-28",
    });
    expect(result.files.map((file) => file.name)).toEqual(["1. CCCD.pdf", "2. An toàn.pdf", "3. HĐLĐ.pdf"]);
    // Trong nhóm giữ thứ tự đang sắp: điện → làm việc trên cao (2 trang) → lao động
    expect((await PDFDocument.load(result.files[1]!.bytes)).getPages().map((page) => page.getSize().width)).toEqual([20, 40, 40, 50]);
    expect(result.warnings).toEqual([]);
  });

  it("chỉ chọn một chứng chỉ của nhóm thì vẫn mang tên nhóm, giữ nguyên tệp gốc", async () => {
    const result = await exportCertificateFiles({
      employee: { code: "TNM0848", name: "Phan Đức Phi", position: "Nhân viên kỹ thuật" }, certificates: [cert("c2", "elec", "f2")],
      certificateTypeNames: { elec: "An toàn điện" }, sessionFiles: { f2: await pdfFile(1, "f2.pdf") },
      config: { groups: [{ id: "g", name: "Chứng chỉ an toàn", types: ["elec", "atld"] }] }, fileNamePattern: undefined, exportDate: "2026-10-28",
    });
    expect(result.files.map((file) => file.name)).toEqual(["1. Chứng chỉ an toàn.pdf"]);
  });
});
