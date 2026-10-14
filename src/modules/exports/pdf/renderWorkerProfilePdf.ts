import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { buildWorkerProfileData } from "../workerProfile";
import type { FileRef } from "../../certificates/types";

export type WorkerProfilePdfData = ReturnType<typeof buildWorkerProfileData>;
export type ScanBinary = { bytes: Uint8Array; mime: string };
export type ScanBinaries = ReadonlyMap<string, ScanBinary>;
export type ProfileFonts = { regular: Uint8Array | null; bold: Uint8Array | null };
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const INK = rgb(0.1, 0.15, 0.2);

function wrapText(value: string, font: PDFFont, size: number, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrapped(page: PDFPage, value: string, x: number, y: number, width: number, font: PDFFont, size: number): number {
  const lines = wrapText(value, font, size, width);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + 3), size, font, color: INK }));
  return Math.max(1, lines.length) * (size + 3);
}

function scanTitle(data: WorkerProfilePdfData, file: FileRef): string {
  for (const certificate of data.certificates) {
    if (certificate.document?.id === file.id) return `${certificate.displayName} · Số ${certificate.number ?? ""} · Tệp chính`;
    const supplementary = certificate.supplementaryFiles.find((item) => item.file.id === file.id);
    if (supplementary) return `${certificate.displayName} · Số ${certificate.number ?? ""} · Tệp bổ sung: ${supplementary.label ?? supplementary.file.name}`;
  }
  return `Tệp scan · ${file.name}`;
}

function drawCover(document: PDFDocument, data: WorkerProfilePdfData, regular: PDFFont, bold: PDFFont, signature?: PDFImage): void {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const center = (text: string, y: number, font: PDFFont, size: number) => page.drawText(text, { x: (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: INK });
  center("WORKER PROFILE", 795, bold, 17);
  center("BẢN THÔNG TIN VỀ CÔNG NHÂN", 774, bold, 14);
  center("NHÀ THẦU PHỤ: THIÊN NHẬT MINH", 753, regular, 10);
  page.drawRectangle({ x: PAGE_WIDTH - MARGIN - 72, y: 650, width: 72, height: 96, borderColor: INK, borderWidth: 1 });
  page.drawText("Ảnh 3×4", { x: PAGE_WIDTH - MARGIN - 61, y: 695, size: 10, font: regular, color: INK });
  let y = 730;
  const labelWidth = 175;
  const valueWidth = PAGE_WIDTH - 2 * MARGIN - labelWidth - 86;
  const row = (vi: string, en: string, value: string) => {
    const label = `${vi} / ${en}`;
    page.drawText(label, { x: MARGIN, y, size: 8, font: bold, color: INK });
    const height = drawWrapped(page, value || "—", MARGIN + labelWidth, y, valueWidth, regular, 9);
    y -= Math.max(19, height + 3);
  };
  row("Họ và tên", "Full name", data.employee.name.toLocaleUpperCase("vi"));
  row("Ngày sinh / Giới tính", "Date of birth / Sex", `${data.employee.dob} · ${data.employee.gender}`);
  row("Nguyên quán", "Place of origin", data.employee.home);
  row("Thường trú", "Permanent address", data.employee.address);
  row("Điện thoại", "Telephone", data.employee.phone);
  row("Thầu phụ", "Subcontractor", "Thiên Nhật Minh");
  row("Ngày bắt đầu làm việc", "Start date", data.employee.startDate);
  row("Kinh nghiệm công việc tương tự", "Similar work experience", data.employee.tenure);
  y -= 4;
  page.drawText("LIÊN HỆ KHẨN CẤP / EMERGENCY CONTACT", { x: MARGIN, y, size: 9, font: bold, color: INK }); y -= 14;
  if (data.emergencyContact) {
    page.drawText(`Họ tên: ${data.emergencyContact.name}    Quan hệ: ${data.emergencyContact.role}    Điện thoại: ${data.emergencyContact.phone}`, { x: MARGIN, y, size: 8, font: regular, color: INK }); y -= 12;
    page.drawText(`Địa chỉ: ${data.emergencyContact.address || "—"}`, { x: MARGIN, y, size: 8, font: regular, color: INK }); y -= 18;
  } else {
    page.drawText("Người liên hệ: —    Điện thoại: —", { x: MARGIN, y, size: 8, font: regular, color: INK }); y -= 22;
  }
  page.drawText("CHỨNG CHỈ ĐÍNH KÈM / ATTACHED CERTIFICATES", { x: MARGIN, y, size: 9, font: bold, color: INK }); y -= 17;
  for (const certificate of data.certificates) {
    page.drawRectangle({ x: MARGIN, y: y - 2, width: 10, height: 10, borderWidth: 1, borderColor: INK });
    if (certificate.ticked) {
      page.drawLine({ start: { x: MARGIN + 2, y: y + 2 }, end: { x: MARGIN + 4, y: y }, thickness: 1.2, color: INK });
      page.drawLine({ start: { x: MARGIN + 4, y }, end: { x: MARGIN + 9, y: y + 7 }, thickness: 1.2, color: INK });
    }
    const note = certificate.note ? ` (${certificate.note})` : "";
    const group = certificate.type === "atld" && certificate.group ? ` · Nhóm ${certificate.group}` : "";
    const text = `${certificate.displayName}${note}${group}`;
    drawWrapped(page, text, MARGIN + 17, y, PAGE_WIDTH - 2 * MARGIN - 17, regular, 8);
    y -= 15;
  }
  y -= 12;
  page.drawText("TVE XÁC NHẬN / TVE CONFIRMATION", { x: MARGIN, y, size: 8, font: bold, color: INK });
  page.drawText("GIÁM ĐỐC THẦU PHỤ / SUBCONTRACTOR DIRECTOR", { x: PAGE_WIDTH / 2 + 10, y, size: 8, font: bold, color: INK });
  if (signature) page.drawImage(signature, { x: PAGE_WIDTH / 2 + 26, y: y - 55, width: 130, height: 38 });
  page.drawText(data.signer.name, { x: PAGE_WIDTH / 2 + 20, y: y - 68, size: 9, font: bold, color: INK });
  page.drawText(`${data.signDate} · ${data.signer.role}`, { x: PAGE_WIDTH / 2 + 20, y: y - 82, size: 8, font: regular, color: INK });
  page.drawText("Thông tin được lập từ hồ sơ trong phiên làm việc này.", { x: MARGIN, y: MARGIN - 5, size: 7, font: regular, color: INK });
}

async function embedScan(document: PDFDocument, scan: ScanBinary): Promise<PDFImage> {
  if (scan.mime === "image/png") return document.embedPng(scan.bytes);
  if (scan.mime === "image/jpeg") return document.embedJpg(scan.bytes);
  throw new Error("Định dạng tệp scan chưa được chuyển đổi sang PNG hoặc JPEG.");
}

export async function renderWorkerProfilePdf(data: WorkerProfilePdfData, scanFiles: ScanBinaries, fonts: ProfileFonts): Promise<Uint8Array> {
  if (!fonts.regular || !fonts.bold) {
    const missing: string[] = [];
    if (!fonts.regular) missing.push("public/fonts/BeVietnamPro-Regular.ttf");
    if (!fonts.bold) missing.push("public/fonts/BeVietnamPro-Bold.ttf");
    throw new Error(`Thiếu ${missing.join(", ")}. Thiếu phông Be Vietnam Pro. Hãy đặt hai tệp phông theo mục Phông chữ xuất PDF trong README.md.`);
  }
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(fonts.regular, { subset: true });
  const bold = await document.embedFont(fonts.bold, { subset: true });
  const signatureBinary = scanFiles.get(data.signer.fileId);
  const signature = signatureBinary?.mime === "image/png" ? await document.embedPng(signatureBinary.bytes) : undefined;
  drawCover(document, data, regular, bold, signature);
  for (const file of data.scans) {
    const binary = scanFiles.get(file.id);
    if (!binary) throw new Error(`Thiếu dữ liệu tệp ${file.name} trong phiên làm việc này.`);
    const title = scanTitle(data, file);
    if (binary.mime === "application/pdf") {
      const source = await PDFDocument.load(binary.bytes);
      const copied = await document.copyPages(source, source.getPageIndices());
      copied.forEach((page) => { document.addPage(page); page.drawText(title, { x: MARGIN, y: PAGE_HEIGHT - MARGIN / 2, size: 8, font: regular, color: INK }); });
      continue;
    }
    const image = await embedScan(document, binary);
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText(title, { x: MARGIN, y: PAGE_HEIGHT - MARGIN, size: 9, font: bold, color: INK });
    const maxWidth = PAGE_WIDTH - 2 * MARGIN;
    const maxHeight = PAGE_HEIGHT - 2 * MARGIN - 24;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (PAGE_WIDTH - width) / 2, y: (PAGE_HEIGHT - height) / 2 - 10, width, height });
  }
  return document.save();
}
