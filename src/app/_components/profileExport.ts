import { buildSystemValues, resolveLayers, type Signer } from "../../modules/excel-template/engine/fieldValues";
import { fillWorkbook, type AttachmentPage, type TemplateImage } from "../../modules/excel-template/engine/fillWorkbook";
import { readImageInfo } from "../../modules/excel-template/engine/imageSize";
import { customImageSlots, customValues, fieldLabel } from "../../modules/excel-template/engine/profileConfig";
import { normalizeText } from "../../lib/text";
import { base64ToUint8Array } from "../../modules/excel-template/templateStorage";
import type { ExcelReportTemplate } from "../../modules/excel-template/types";
import type { Certificate } from "../../modules/certificates/types";
import type { Commander } from "../../modules/commanders/types";
import type { Employee } from "../../modules/employees/types";
import { mergeProfilePdf, type MergePart } from "../../modules/exports/pdf/mergeProfilePdf";
import { getSupabaseClient } from "../../lib/supabase/client";

/** Cạnh dài tối đa của ảnh scan khi chèn vào Excel (~150 dpi trên A4), để file không quá nặng. */
const MAX_SCAN_SIDE = 1800;

async function canvasToPng(canvas: HTMLCanvasElement): Promise<TemplateImage> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không tạo được ảnh PNG.")), "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: "png", width: canvas.width, height: canvas.height };
}

/**
 * Đổi tệp ảnh thành ảnh chèn được vào Excel.
 * - `aspect`: cắt giữa ảnh theo tỉ lệ rộng/cao này (kiểu "lấp đầy" cho ảnh 3×4).
 * - Ảnh PNG/JPEG vừa cỡ được giữ nguyên byte gốc; WebP hoặc ảnh quá lớn được vẽ lại thành PNG.
 */
export async function toTemplateImage(blob: Blob, options: { aspect?: number; maxSide?: number } = {}): Promise<TemplateImage | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = readImageInfo(bytes);
  const maxSide = options.maxSide ?? MAX_SCAN_SIDE;
  if (info && !options.aspect && Math.max(info.width, info.height) <= maxSide) return { bytes, ...info };
  if (!blob.type.startsWith("image/")) return null;
  const bitmap = await createImageBitmap(blob);
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
  if (options.aspect) {
    if (sw / sh > options.aspect) { sw = Math.round(sh * options.aspect); sx = Math.round((bitmap.width - sw) / 2); }
    else { sh = Math.round(sw / options.aspect); sy = Math.round((bitmap.height - sh) / 2); }
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("Trình duyệt không xử lý được ảnh."); }
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToPng(canvas);
}

const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

export type ProfileExportInput = {
  template: ExcelReportTemplate & { profile: NonNullable<ExcelReportTemplate["profile"]> };
  employee: Employee;
  commander: Commander | null;
  /** Người ký chọn từ Thư viện chữ ký (tên, chức danh, ảnh PNG nền trong suốt). */
  signer?: (Signer & { image: Blob | null }) | null;
  certificates: readonly Certificate[];
  certificateTypeNames: Readonly<Record<string, string>>;
  /** Tệp nhị phân đang có trong phiên, theo id tệp. */
  sessionFiles: Readonly<Record<string, File>>;
  /** Id chứng chỉ người dùng chọn đính kèm. */
  selectedCertificateIds: readonly string[];
  /** Giá trị trường tùy chỉnh người xuất sửa (thô). */
  overrides: Readonly<Record<string, string>>;
  exportDate: string;
  /** "pdf": chứng chỉ không chèn vào Excel mà trả về để ghép sau phiếu PDF. */
  format?: "xlsx" | "pdf";
};

/** Dựng file Excel hồ sơ cho một nhân sự; trả về cảnh báo dễ đọc. */
export async function exportProfileWorkbook(input: ProfileExportInput): Promise<{ bytes: Uint8Array; warnings: string[]; mergeParts: MergePart[] }> {
  const forPdf = input.format === "pdf";
  const mergeParts: MergePart[] = [];
  const { profile } = input.template;
  const warnings: string[] = [];
  const values = resolveLayers(
    buildSystemValues({ employee: input.employee, commander: input.commander, signer: input.signer ?? null, certificates: input.certificates, certificateTypes: Object.keys(input.certificateTypeNames), exportDate: input.exportDate }),
    customValues(profile, input.overrides, input.employee.extraFields),
  );
  // Trường tự thêm có ô đích: ghi thẳng vào ô
  const cellValues = profile.customFields
    .filter((field) => field.kind !== "image" && field.target)
    .map((field) => ({ address: field.target!.toUpperCase(), field: field.key, value: values[field.key] ?? "" }));

  // Ảnh: 3×4 từ hồ sơ; ảnh theo nhân sự (kể cả vùng IMG_ như ảnh CCCD) từ extraFiles; ảnh cố định từ mẫu
  const imageSlots = [...profile.imageSlots, ...customImageSlots(profile)];
  const images: Record<string, TemplateImage | null> = {};
  for (const slot of imageSlots) {
    const fit = profile.imageSlots.find((item) => item.field === slot.field)?.fit;
    const aspect = fit === "cover" ? profile.slotAspect[slot.field] : undefined;
    const options = aspect ? { aspect } : {};
    const fixed = profile.customFields.find((field) => field.key === slot.field && field.kind === "image" && field.scope === "template")?.defaultValue;
    const stored = input.employee.extraFiles?.[slot.field];
    if (slot.field === "signature") {
      // Thiếu ảnh thì fillWorkbook tự báo "vùng ảnh chưa có ảnh" như các vùng khác
      if (input.signer?.image) images[slot.field] = await toTemplateImage(input.signer.image);
      continue;
    }
    if (slot.field === "photo3x4" && input.employee.photo) images[slot.field] = await toTemplateImage(await dataUrlToBlob(input.employee.photo), options);
    else if (fixed) images[slot.field] = await toTemplateImage(await dataUrlToBlob(fixed), options);
    else if (stored && input.sessionFiles[stored.id]) images[slot.field] = await toTemplateImage(input.sessionFiles[stored.id]!, options);
    else if (stored) warnings.push(`${fieldLabel(slot.field, profile)}: chưa tải được ảnh "${stored.name}"`);
  }

  const attachments: AttachmentPage[] = [];
  const chosen = input.certificates.filter((certificate) => input.selectedCertificateIds.includes(certificate.id));
  const ordered = [...chosen].sort((a, b) => {
    const rank = (type: string) => { const index = profile.attachments.indexOf(type); return index < 0 ? profile.attachments.length : index; };
    return rank(a.type) - rank(b.type);
  });
  for (const certificate of ordered) {
    const typeName = input.certificateTypeNames[certificate.type] ?? certificate.type;
    const files = [{ file: certificate.document, label: "Tệp chính" }, ...certificate.supplementaryFiles.map((item) => ({ file: item.file, label: `Tệp bổ sung: ${item.label ?? item.file.name}` }))];
    for (const { file, label } of files) {
      const binary = input.sessionFiles[file.id];
      if (!binary) { warnings.push(`${typeName}: chưa có dữ liệu tệp "${file.name}" trong phiên này`); continue; }
      const [y, m, d] = certificate.expiryDate.split("-");
      const title = `${typeName}${certificate.title ? ` (${certificate.title})` : ""} · Số ${certificate.number} · Hết hạn ${d}/${m}/${y} · ${label}`;
      if (forPdf && binary.type === "application/pdf") { mergeParts.push({ title, kind: "pdf", bytes: new Uint8Array(await binary.arrayBuffer()) }); continue; }
      if (binary.type === "application/pdf") { warnings.push(`${typeName}: tệp PDF "${file.name}" chưa hỗ trợ chèn vào Excel, hãy tải ảnh JPG/PNG`); continue; }
      const image = await toTemplateImage(binary);
      if (!image) { warnings.push(`${typeName}: không đọc được ảnh "${file.name}"`); continue; }
      if (forPdf) mergeParts.push({ title, kind: "image", bytes: image.bytes, extension: image.extension });
      else attachments.push({ title, image });
    }
  }

  const result = await fillWorkbook({
    template: base64ToUint8Array(input.template.fileBase64),
    sheetName: profile.sheetName,
    printArea: profile.printArea,
    values,
    imageSlots,
    images,
    attachments,
    cellValues,
  });
  const fieldWarnings = result.warnings.map((warning) => `${fieldLabel(warning.field, profile, input.certificateTypeNames)} (ô ${warning.location}) đang trống`);
  return { bytes: result.bytes, warnings: [...fieldWarnings, ...warnings], mergeParts };
}

/** Gửi file Excel lên /api/convert-pdf (máy chủ LibreOffice) và nhận lại PDF. */
export async function convertXlsxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const session = await getSupabaseClient()?.auth.getSession();
  const token = session?.data.session?.access_token;
  const response = await fetch("/api/convert-pdf", { method: "POST", body: bytes.slice().buffer, headers: { "content-type": "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(problem?.message ?? `Không chuyển được sang PDF (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Hồ sơ PDF gộp: phiếu (Excel → PDF) rồi lần lượt các chứng chỉ được chọn, từ trên xuống dưới. */
export async function exportProfilePdf(input: ProfileExportInput): Promise<{ bytes: Uint8Array; warnings: string[]; pageCount: number }> {
  const workbook = await exportProfileWorkbook({ ...input, format: "pdf" });
  const cover = await convertXlsxToPdf(workbook.bytes);
  const merged = await mergeProfilePdf(cover, workbook.mergeParts);
  return { bytes: merged.bytes, pageCount: merged.pageCount, warnings: [...workbook.warnings, ...merged.warnings] };
}

const safeName = (value: string) => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");

/** Tên tệp hồ sơ: HoSo_<mã>_<tên không dấu>_<yyyymmdd>.xlsx */
export function profileFileName(employee: Pick<Employee, "code" | "name">, exportDate: string, extension: "xlsx" | "pdf" = "xlsx"): string {
  return `HoSo_${employee.code}_${safeName(employee.name)}_${exportDate.replaceAll("-", "")}.${extension}`;
}

export function zipFileName(templateName: string, exportDate: string, count: number): string {
  return `HoSo_${safeName(templateName) || "mau"}_${count}nguoi_${exportDate.replaceAll("-", "")}.zip`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadXlsx(bytes: Uint8Array, fileName: string): void {
  downloadBlob(new Blob([bytes.slice().buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}

export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  downloadBlob(new Blob([bytes.slice().buffer], { type: "application/pdf" }), fileName);
}
