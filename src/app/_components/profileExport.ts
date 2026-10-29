import JSZip from "jszip";
import { buildSystemValues, resolveLayers, type Signer } from "../../modules/excel-template/engine/fieldValues";
import { fillWorkbook, type AttachmentPage, type TemplateImage } from "../../modules/excel-template/engine/fillWorkbook";
import { readImageInfo } from "../../modules/excel-template/engine/imageSize";
import { customImageSlots, customValues, fieldLabel, isIdCardImage, isPortraitImage, withoutDuplicatePortraits } from "../../modules/excel-template/engine/profileConfig";
import { normalizeText } from "../../lib/text";
import { applyFileNamePattern } from "../../modules/excel-template/fileNamePattern";
import { base64ToUint8Array } from "../../modules/excel-template/templateStorage";
import type { CertificateExportConfig, ExcelReportTemplate } from "../../modules/excel-template/types";
import { certificateFileBaseName, certificateGroupFolderName, certificateTypeLabel, employeeFolderName, groupCertificateEntries, uniqueFileNames } from "../../modules/excel-template/certificateExportNames";
import { certificateGroups, certificateUnits, type CertificateUnit } from "../../modules/excel-template/certificateGroups";
import type { Certificate } from "../../modules/certificates/types";
import type { Commander } from "../../modules/commanders/types";
import type { Employee } from "../../modules/employees/types";
import { mergeProfilePdf, type MergePart } from "../../modules/exports/pdf/mergeProfilePdf";
import { getSupabaseClient } from "../../lib/supabase/client";
import { photoFile } from "./employeePhoto";
import { formatExpiry } from "../../modules/certificates/status";

/** Cạnh dài tối đa của ảnh scan khi chèn vào Excel (~150 dpi trên A4), để file không quá nặng. */
const MAX_SCAN_SIDE = 1800;
/**
 * Cạnh dài tối đa của ảnh trong vùng IMG_ (3×4, CCCD, chữ ký): vùng lớn nhất trên phiếu cỡ nửa trang A4,
 * 1200px vẫn trên 200 dpi khi in. File Excel phải dưới 4 MB mới gửi đi đổi PDF được (giới hạn của Vercel).
 */
const SLOT_MAX_SIDE = 1200;
/** Ảnh gốc nặng hơn mức này thì luôn vẽ lại cho nhẹ, kể cả khi kích thước đã vừa. */
const MAX_PASSTHROUGH_BYTES = 600 * 1024;

/** PNG giữ nền trong suốt (chữ ký, logo); JPEG cho ảnh chụp không cần trong suốt (3×4, CCCD, scan) — nhẹ hơn 5–10 lần. */
async function canvasToImage(canvas: HTMLCanvasElement, opaque: boolean): Promise<TemplateImage> {
  const type = opaque ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không tạo được ảnh.")), type, opaque ? 0.9 : undefined));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: opaque ? "jpeg" : "png", width: canvas.width, height: canvas.height };
}

/** Xoay 90° theo chiều kim đồng hồ (ảnh CCCD chụp dọc → nằm ngang). */
async function rotateBitmap(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height; canvas.height = bitmap.width;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("Trình duyệt không xử lý được ảnh."); }
  context.translate(canvas.width, 0); context.rotate(Math.PI / 2);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return createImageBitmap(canvas);
}

/**
 * Đổi tệp ảnh thành ảnh chèn được vào Excel.
 * - `landscape`: ảnh đang dọc thì xoay cho nằm ngang (ảnh CCCD).
 * - `aspect`: cắt giữa ảnh theo tỉ lệ rộng/cao này (kiểu "lấp đầy" cho ảnh 3×4).
 * - `opaque`: ảnh chụp không cần nền trong suốt → vẽ lại thành JPEG (nhẹ), nền trắng.
 * - Ảnh PNG/JPEG vừa cỡ và nhẹ được giữ nguyên byte gốc; WebP, ảnh quá lớn hoặc quá nặng được vẽ lại.
 */
export async function toTemplateImage(blob: Blob, options: { aspect?: number; maxSide?: number; landscape?: boolean; pad?: boolean; opaque?: boolean } = {}): Promise<TemplateImage | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = readImageInfo(bytes);
  const maxSide = options.maxSide ?? MAX_SCAN_SIDE;
  // Viền thêm khi "Vừa khung" phải trong suốt → luôn PNG
  const opaque = Boolean(options.opaque && !options.pad);
  // landscape luôn vẽ lại: byte gốc có thể mang cờ xoay EXIF mà Excel bỏ qua
  if (info && !options.aspect && !options.landscape && Math.max(info.width, info.height) <= maxSide && bytes.length <= MAX_PASSTHROUGH_BYTES) return { bytes, ...info };
  if (!blob.type.startsWith("image/")) return null;
  const decoded = await createImageBitmap(blob);
  const bitmap = options.landscape && decoded.height > decoded.width ? await rotateBitmap(decoded) : decoded;
  if (options.aspect && options.pad) {
    // Giữ nguyên cả ảnh, thêm viền trong suốt cho đủ tỉ lệ vùng → neo khít 4 góc vẫn căn giữa đều
    const [width, height] = bitmap.width / bitmap.height > options.aspect ? [bitmap.width, bitmap.width / options.aspect] : [bitmap.height * options.aspect, bitmap.height];
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); throw new Error("Trình duyệt không xử lý được ảnh."); }
    const drawWidth = bitmap.width * scale, drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close();
    return canvasToImage(canvas, false);
  }
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
  if (opaque) { context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToImage(canvas, opaque);
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
  /** Thứ tự ghép chứng chỉ sau phiếu do người xuất chọn (id); bỏ trống = theo thứ tự loại trong mẫu. */
  certificateOrder?: readonly string[];
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
  const imageSlots = withoutDuplicatePortraits([...profile.imageSlots, ...customImageSlots(profile)], profile);
  const images: Record<string, TemplateImage | null> = {};
  for (const slot of imageSlots) {
    // Mọi ảnh đều lấp đầy đúng vùng ô đã chọn (phủ kín 4 góc ô), không cắt, không chừa trống
    const idCard = isIdCardImage(slot.field, fieldLabel(slot.field, profile));
    const portrait = isPortraitImage(slot.field, fieldLabel(slot.field, profile));
    const fixed = profile.customFields.find((field) => field.key === slot.field && field.kind === "image" && field.scope === "template")?.defaultValue;
    const stored = input.employee.extraFiles?.[slot.field];
    // Ảnh chụp của nhân sự (3×4, CCCD, ảnh scan riêng) không cần trong suốt → JPEG; chữ ký, ảnh cố định của mẫu giữ PNG
    const opaque = idCard || portrait || (Boolean(stored) && !fixed && slot.field !== "employeeSignature");
    const options = { maxSide: SLOT_MAX_SIDE, ...(idCard ? { landscape: true } : {}), ...(opaque ? { opaque: true } : {}) };
    if (slot.field === "signature") {
      // Thiếu ảnh thì fillWorkbook tự báo "vùng ảnh chưa có ảnh" như các vùng khác
      if (input.signer?.image) images[slot.field] = await toTemplateImage(input.signer.image, { maxSide: SLOT_MAX_SIDE });
      continue;
    }
    if ((slot.field === "photo3x4" || (portrait && !fixed && !stored)) && input.employee.photo) {
      const photo = photoFile(input.employee.photo, input.sessionFiles);
      if (photo) images[slot.field] = await toTemplateImage(photo, options);
      else warnings.push(`${fieldLabel(slot.field, profile)}: chưa tải được ảnh chân dung`);
    }
    else if (slot.field === "employeeSignature" && input.employee.signatureImage) images[slot.field] = await toTemplateImage(await dataUrlToBlob(input.employee.signatureImage), options);
    else if (fixed) images[slot.field] = await toTemplateImage(await dataUrlToBlob(fixed), options);
    else if (stored && input.sessionFiles[stored.id]) images[slot.field] = await toTemplateImage(input.sessionFiles[stored.id]!, options);
    else if (stored) warnings.push(`${fieldLabel(slot.field, profile)}: chưa tải được ảnh "${stored.name}"`);
  }

  const attachments: AttachmentPage[] = [];
  const chosen = input.certificates.filter((certificate) => input.selectedCertificateIds.includes(certificate.id));
  // Người xuất đã sắp thứ tự (kéo thả / đánh số) thì theo đúng thứ tự đó; không thì theo thứ tự loại trong mẫu
  const order = input.certificateOrder;
  const ordered = [...chosen].sort(order
    ? (a, b) => order.indexOf(a.id) - order.indexOf(b.id)
    : (a, b) => {
      const rank = (type: string) => { const index = profile.attachments.indexOf(type); return index < 0 ? profile.attachments.length : index; };
      return rank(a.type) - rank(b.type);
    });
  for (const certificate of ordered) {
    const typeName = input.certificateTypeNames[certificate.type] ?? certificate.type;
    const files = [{ file: certificate.document, label: "Tệp chính" }, ...certificate.supplementaryFiles.map((item) => ({ file: item.file, label: `Tệp bổ sung: ${item.label ?? item.file.name}` }))];
    for (const { file, label } of files) {
      const binary = input.sessionFiles[file.id];
      if (!binary) { warnings.push(`${typeName}: chưa có dữ liệu tệp "${file.name}" trong phiên này`); continue; }
      const title = `${typeName}${certificate.title ? ` (${certificate.title})` : ""} · ${certificate.number ? `Số ${certificate.number}` : "Không ghi số"} · ${certificate.expiryDate ? `Hết hạn ${formatExpiry(certificate.expiryDate)}` : "Không thời hạn"} · ${label}`;
      if (forPdf && binary.type === "application/pdf") { mergeParts.push({ title, kind: "pdf", bytes: new Uint8Array(await binary.arrayBuffer()) }); continue; }
      if (binary.type === "application/pdf") { warnings.push(`${typeName}: tệp PDF "${file.name}" chưa hỗ trợ chèn vào Excel, hãy tải ảnh JPG/PNG`); continue; }
      const image = await toTemplateImage(binary, { opaque: true });
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
    imageSlots: imageSlots.map((slot) => ({ ...slot, fit: "stretch" as const })),
    images,
    attachments,
    cellValues,
  });
  const fieldWarnings = result.warnings.map((warning) => `${fieldLabel(warning.field, profile, input.certificateTypeNames)} (ô ${warning.location}) đang trống`);
  return { bytes: result.bytes, warnings: [...fieldWarnings, ...warnings], mergeParts };
}

/** Lỗi chuyển PDF kèm mã từ /api/convert-pdf (vd PDF_CONVERTER_MISSING khi chưa cài ComPDF / Gotenberg). */
export class PdfConvertError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** Gửi file Excel lên /api/convert-pdf (ComPDF hoặc máy chủ LibreOffice) và nhận lại PDF. */
export async function convertXlsxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const session = await getSupabaseClient()?.auth.getSession();
  const token = session?.data.session?.access_token;
  const response = await fetch("/api/convert-pdf", { method: "POST", body: bytes.slice().buffer, headers: { "content-type": "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new PdfConvertError(problem?.message ?? `Không chuyển được sang PDF (${response.status}).`, problem?.code ?? "PDF_CONVERTER_FAILED");
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Chưa cài máy chuyển PDF trên máy chủ → quay về bộ hồ sơ ZIP (phiếu Excel + PDF gộp chứng chỉ). */
export const isConverterMissing = (error: unknown) => error instanceof PdfConvertError && error.code === "PDF_CONVERTER_MISSING";

/** Hồ sơ PDF gộp: phiếu (Excel → PDF) rồi lần lượt các chứng chỉ được chọn, từ trên xuống dưới. */
export async function exportProfilePdf(input: ProfileExportInput): Promise<{ bytes: Uint8Array; warnings: string[]; pageCount: number }> {
  const workbook = await exportProfileWorkbook({ ...input, format: "pdf" });
  const cover = await convertXlsxToPdf(workbook.bytes);
  const merged = await mergeProfilePdf(cover, workbook.mergeParts);
  return { bytes: merged.bytes, pageCount: merged.pageCount, warnings: [...workbook.warnings, ...merged.warnings] };
}

export type ProfileBundleFile = { name: string; bytes: Uint8Array };

/**
 * Bộ hồ sơ không cần máy chủ chuyển PDF: phiếu Excel (không chèn chứng chỉ) + một PDF gộp mọi chứng chỉ đã chọn,
 * theo thứ tự của mẫu. Không có chứng chỉ nào ghép được thì chỉ có tệp Excel.
 */
export async function exportProfileBundle(input: ProfileExportInput): Promise<{ files: ProfileBundleFile[]; warnings: string[] }> {
  const workbook = await exportProfileWorkbook({ ...input, format: "pdf" });
  const files: ProfileBundleFile[] = [{ name: profileFileName(input.employee, input.exportDate), bytes: workbook.bytes }];
  const warnings = [...workbook.warnings];
  if (workbook.mergeParts.length) {
    const merged = await mergeProfilePdf(null, workbook.mergeParts);
    warnings.push(...merged.warnings);
    if (merged.pageCount) files.push({ name: certificatesFileName(input.employee, input.exportDate), bytes: merged.bytes });
  } else warnings.push("Không có chứng chỉ nào để gộp PDF, chỉ có tệp Excel");
  return { files, warnings };
}

const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
const extensionOf = (name: string, mime: string) => /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? EXTENSIONS[mime] ?? "bin";

/** Tệp của một chứng chỉ → các phần ghép PDF (PDF giữ nguyên trang, ảnh mỗi ảnh một trang). */
async function toMergeParts(binaries: readonly { file: { name: string }; binary: File }[], typeLabel: string, warnings: string[]): Promise<MergePart[]> {
  const parts: MergePart[] = [];
  for (const { file, binary } of binaries) {
    if (binary.type === "application/pdf") { parts.push({ title: `${typeLabel} · ${file.name}`, kind: "pdf", bytes: new Uint8Array(await binary.arrayBuffer()) }); continue; }
    const image = await toTemplateImage(binary, { opaque: true });
    if (image) parts.push({ title: `${typeLabel} · ${file.name}`, kind: "image", bytes: image.bytes, extension: image.extension });
    else warnings.push(`${typeLabel}: không đọc được ảnh "${file.name}"`);
  }
  return parts;
}

/** Ngày hết hạn sớm nhất trong nhóm (cho biến {ngày hết hạn}); không cái nào có hạn → null. */
const earliestExpiry = (items: readonly Certificate[]) => items.map((item) => item.expiryDate).filter((date): date is string => Boolean(date)).sort()[0] ?? null;

/** Tệp chính rồi tệp bổ sung của một chứng chỉ có trong phiên; thiếu tệp nào thì ghi cảnh báo. */
function certificateBinaries(certificate: Certificate, typeLabel: string, sessionFiles: Readonly<Record<string, File>>, warnings: string[]) {
  return [certificate.document, ...certificate.supplementaryFiles.map((item) => item.file)].flatMap((file) => {
    const binary = sessionFiles[file.id];
    if (!binary) warnings.push(`${typeLabel}: chưa có dữ liệu tệp "${file.name}" trong phiên này`);
    return binary ? [{ file, binary }] : [];
  });
}

export type CertificateExportInput = {
  employee: Pick<Employee, "code" | "name" | "position">;
  /** Chứng chỉ đã chọn, đúng thứ tự đánh số. */
  certificates: readonly Certificate[];
  certificateTypeNames: Readonly<Record<string, string>>;
  sessionFiles: Readonly<Record<string, File>>;
  config: CertificateExportConfig | undefined;
  fileNamePattern: string | undefined;
  exportDate: string;
};

/** "merged" = mọi chứng chỉ của một người thành một PDF; mặc định mỗi chứng chỉ (hoặc mỗi nhóm) một tệp. */
export const mergesCertificates = (config: CertificateExportConfig | undefined) => config?.layout === "merged";

/**
 * Xuất chứng chỉ của một nhân sự thành MỘT tệp PDF (không kèm phiếu), vd "Vinci - TNM0018 - Trần Ngọc Đức.pdf":
 * lần lượt từng chứng chỉ theo thứ tự truyền vào, mỗi chứng chỉ tệp chính rồi tệp bổ sung.
 */
export async function exportCertificatesPdf(input: CertificateExportInput): Promise<{ name: string; bytes: Uint8Array; pageCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  const parts: MergePart[] = [];
  for (const certificate of input.certificates) {
    const typeLabel = certificateTypeLabel(input.config, certificate.type, input.certificateTypeNames);
    parts.push(...await toMergeParts(certificateBinaries(certificate, typeLabel, input.sessionFiles, warnings), typeLabel, warnings));
  }
  if (!input.certificates.length) warnings.push("Không có chứng chỉ nào được chọn để xuất");
  const merged = parts.length ? await mergeProfilePdf(null, parts) : { bytes: new Uint8Array(), pageCount: 0, warnings: [] };
  return { name: `${employeeFolderName(input.fileNamePattern, input.employee, input.exportDate)}.pdf`, bytes: merged.bytes, pageCount: merged.pageCount, warnings: [...warnings, ...merged.warnings] };
}

/**
 * Xuất riêng chứng chỉ của một nhân sự (không kèm phiếu): mỗi chứng chỉ một tệp trong thư mục nhân sự (chứng chỉ cùng nhóm
 * gộp chung một PDF mang tên nhóm, vd "3. An toàn.pdf"),
 * đánh số theo thứ tự truyền vào, vd "1. ID.jpg", "2. HĐLĐ.pdf". Tệp chính giữ nguyên byte gốc;
 * chứng chỉ có tệp bổ sung thì gộp thành một PDF để mỗi chứng chỉ vẫn đúng một số thứ tự.
 */
export async function exportCertificateFiles(input: CertificateExportInput): Promise<{ folder: string; files: ProfileBundleFile[]; warnings: string[] }> {
  const { employee, exportDate } = input;
  const folder = employeeFolderName(input.fileNamePattern, employee, exportDate);
  const warnings: string[] = [];
  const labelOf = (certificate: Certificate) => certificateTypeLabel(input.config, certificate.type, input.certificateTypeNames);
  /** Một đơn vị → một tệp: chứng chỉ lẻ, hoặc các chứng chỉ cùng nhóm gộp chung một PDF mang tên nhóm. */
  const unitFile = async (unit: CertificateUnit<Certificate>, index: number): Promise<ProfileBundleFile | null> => {
    const typeLabel = unit.group ? unit.group.name.trim() || labelOf(unit.items[0]!) : labelOf(unit.items[0]!);
    const binaries = unit.items.flatMap((certificate) => certificateBinaries(certificate, labelOf(certificate), input.sessionFiles, warnings).map((entry) => ({ ...entry, label: labelOf(certificate) })));
    if (!binaries.length) return null;
    const first = unit.items[0]!;
    const base = certificateFileBaseName(input.config, { index, typeLabel, title: unit.group ? "" : first.title, expiryDate: unit.group ? earliestExpiry(unit.items) : first.expiryDate }, employee, exportDate);
    if (binaries.length === 1) {
      const { file, binary } = binaries[0]!;
      return { name: `${base}.${extensionOf(file.name, binary.type || file.mime)}`, bytes: new Uint8Array(await binary.arrayBuffer()) };
    }
    const mergeParts: MergePart[] = [];
    for (const entry of binaries) mergeParts.push(...await toMergeParts([entry], entry.label, warnings));
    const merged = await mergeProfilePdf(null, mergeParts);
    warnings.push(...merged.warnings);
    return merged.pageCount ? { name: `${base}.pdf`, bytes: merged.bytes } : null;
  };
  // Chứng chỉ cùng nhóm (mặc định: làm việc trên cao, an toàn điện, an toàn lao động) ra chung một tệp mang tên nhóm;
  // sau đó mỗi vị trí đánh số là một tệp, hoặc một thư mục con (folders) chứa các tệp đánh số lại từ 1
  const units = certificateUnits(input.certificates, (item) => item.type, (item) => item.id, certificateGroups(input.config));
  const top: ProfileBundleFile[] = [];
  let position = 0;
  for (const entry of groupCertificateEntries(units, (unit) => unit.items[0]!.type, input.config?.folders)) {
    if (!entry.group) {
      const file = await unitFile(entry.items[0]!, position + 1);
      if (file) { position += 1; top.push(file); }
      continue;
    }
    const inner: ProfileBundleFile[] = [];
    for (const unit of entry.items) {
      const file = await unitFile(unit, inner.length + 1);
      if (file) inner.push(file);
    }
    if (!inner.length) continue;
    position += 1;
    const sub = certificateGroupFolderName(position, entry.group, exportDate);
    const innerNames = uniqueFileNames(inner.map((file) => file.name));
    top.push(...inner.map((file, index) => ({ ...file, name: `${sub}/${innerNames[index]!}` })));
  }
  if (!input.certificates.length) warnings.push("Không có chứng chỉ nào được chọn để xuất");
  const names = uniqueFileNames(top.map((file) => file.name));
  return { folder, files: top.map((file, index) => ({ ...file, name: names[index]! })), warnings };
}

/** Nén các tệp thành ZIP; folder (nếu có) để mỗi nhân sự một thư mục khi xuất hàng loạt. */
export async function zipFiles(files: readonly (ProfileBundleFile & { folder?: string })[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.folder ? `${file.folder}/${file.name}` : file.name, file.bytes);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

const safeName = (value: string) => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");

/** Tên tệp hồ sơ: HoSo_<mã>_<tên không dấu>_<yyyymmdd>.xlsx */
export function profileFileName(employee: Pick<Employee, "code" | "name"> & { position?: string }, exportDate: string, extension: "xlsx" | "pdf" | "zip" = "xlsx", pattern?: string): string {
  // Mẫu có quy tắc đặt tên (vd "Vinci - {mã nhân viên} - {tên nhân viên}") thì theo quy tắc đó
  const named = pattern?.trim() ? applyFileNamePattern(pattern, employee, exportDate).name : "";
  return named ? `${named}.${extension}` : `HoSo_${employee.code}_${safeName(employee.name)}_${exportDate.replaceAll("-", "")}.${extension}`;
}

/** Tên tệp PDF gộp chứng chỉ: ChungChi_<mã>_<tên không dấu>_<yyyymmdd>.pdf */
export function certificatesFileName(employee: Pick<Employee, "code" | "name">, exportDate: string): string {
  return `ChungChi_${employee.code}_${safeName(employee.name)}_${exportDate.replaceAll("-", "")}.pdf`;
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
