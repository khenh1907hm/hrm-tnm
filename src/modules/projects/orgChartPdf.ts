/**
 * Xuất Sơ đồ tổ chức dự án (mẫu Excel BH-02-F02:2026.0) thành tệp PDF A3 ngang, một trang, nét vẽ vector.
 * Dùng cùng bố cục với màn hình (layoutOrgChart trên khung 1000 × 707), đổi sang điểm PDF.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { layoutOrgChart, ORG_CANVAS, signDateText, type OrgChart, type OrgPerson } from "./orgChart";

export type OrgChartPdfAssets = {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  boldItalic: Uint8Array;
  /** Logo Taikisha và chứng nhận BSI (PNG); thiếu thì bỏ qua. */
  logoLeft?: Uint8Array | null;
  logoRight?: Uint8Array | null;
};

/** A3 ngang (điểm PDF). */
export const A3_LANDSCAPE = { width: 1190.55, height: 841.89 } as const;

const BLUE = rgb(0x4f / 255, 0x81 / 255, 0xbd / 255);
const LINE = rgb(0x2f / 255, 0x55 / 255, 0x97 / 255);
const RED = rgb(1, 0, 0);
const DARK_RED = rgb(0.75, 0, 0);
const TITLE_BLUE = rgb(0x1f / 255, 0x3b / 255, 0xd6 / 255);
const ORANGE = rgb(0xf4 / 255, 0xa4 / 255, 0x60 / 255);
const INK = rgb(0.07, 0.07, 0.07);
const WHITE = rgb(1, 1, 1);
/** Be Vietnam Pro rộng hơn Calibri của mẫu: thu nhỏ cỡ chữ cho vừa như bản Excel. */
const FONT_FIT = 0.86;

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

/** Cắt chữ cho vừa bề ngang (thêm …). */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; png: boolean } | null {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]!);
  return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), png: match[1] === "png" };
}

export async function renderOrgChartPdf(chart: OrgChart, assets: OrgChartPdfAssets, printedAt: Date): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("Sơ đồ tổ chức dự án");
  pdf.setSubject(`${chart.header.contractor} · ${chart.header.client} · ${chart.header.item}`);
  const fonts: Fonts = {
    regular: await pdf.embedFont(assets.regular, { subset: true }),
    bold: await pdf.embedFont(assets.bold, { subset: true }),
    italic: await pdf.embedFont(assets.italic, { subset: true }),
    boldItalic: await pdf.embedFont(assets.boldItalic, { subset: true }),
  };
  const page = pdf.addPage([A3_LANDSCAPE.width, A3_LANDSCAPE.height]);
  const k = A3_LANDSCAPE.width / ORG_CANVAS.width;
  // Toạ độ khung 1000 × 707 (gốc trên trái) → điểm PDF (gốc dưới trái)
  const X = (x: number) => x * k;
  const Y = (y: number) => A3_LANDSCAPE.height - y * k;
  const size = (u: number) => u * k * FONT_FIT;
  const text = (value: string, x: number, y: number, u: number, font: PDFFont, color = INK, align: "left" | "center" | "right" = "left", maxWidth?: number) => {
    const s = size(u);
    const shown = maxWidth ? fit(value, font, s, maxWidth * k) : value;
    const width = font.widthOfTextAtSize(shown, s);
    const left = align === "center" ? X(x) - width / 2 : align === "right" ? X(x) - width : X(x);
    page.drawText(shown, { x: left, y: Y(y) - s * 0.35, size: s, font, color });
  };

  const { header } = chart;
  // Logo
  const drawLogo = async (bytes: Uint8Array | null | undefined, x: number, y: number, width: number) => {
    if (!bytes) return;
    const image = await pdf.embedPng(bytes);
    const height = width * image.height / image.width;
    page.drawImage(image, { x: X(x), y: Y(y + height), width: width * k, height: height * k });
  };
  if (header.showLogos) {
    await drawLogo(assets.logoLeft, 45, 30, 130);
    await drawLogo(assets.logoRight, 828, 34, 105);
  }
  // Tiêu đề
  text("SUBCONTRACTOR ORGANIZATION CHART", 500, 52, 16.5, fonts.regular, INK, "center");
  text(header.contractor, 500, 74, 16.5, fonts.italic, RED, "center");
  if (header.client) text(header.client, 500, 97, 11.5, fonts.boldItalic, TITLE_BLUE, "center", 480);
  if (header.item) text(`ITEM: ${header.item}`, 500, 113, 11.5, fonts.boldItalic, TITLE_BLUE, "center", 480);

  // Khung thông tin công ty
  drawCompany(page, chart, fonts, X, Y, size, k);

  // Sơ đồ: cùng phép thu nhỏ quanh trục như màn hình
  const layout = layoutOrgChart(chart.people);
  const s = layout.scale;
  const tx = (x: number) => 505 + (x - 505) * s;
  const ty = (y: number) => 132 + (y - 132) * s;
  for (const line of layout.lines) page.drawLine({ start: { x: X(tx(line.x1)), y: Y(ty(line.y1)) }, end: { x: X(tx(line.x2)), y: Y(ty(line.y2)) }, thickness: 1.4, color: LINE });
  const hoY = ty(layout.headOfficeY);
  page.drawLine({ start: { x: X(24), y: Y(hoY) }, end: { x: X(976), y: Y(hoY) }, thickness: 0.9, color: rgb(0.88, 0.25, 0.25), dashArray: [5, 4] });
  text("Head Office", 930, hoY - 8, 8.5, fonts.bold, DARK_RED, "right");
  for (const box of layout.boxes) await drawPerson(pdf, page, box.person, { x: tx(box.x), y: ty(box.y), w: box.w * s, h: box.h * s }, s, fonts, X, Y, size, k);

  // Chân trang như Excel: mã biểu mẫu, giờ ngày in, số trang
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${pad(printedAt.getHours())}:${pad(printedAt.getMinutes())}:${pad(printedAt.getSeconds())} ${pad(printedAt.getDate())}/${pad(printedAt.getMonth() + 1)}/${printedAt.getFullYear()}`;
  text(header.formCode, 45, 693, 8.5, fonts.regular);
  text(stamp, 500, 693, 8.5, fonts.regular, INK, "center");
  text("Page: 1/1", 955, 693, 8.5, fonts.regular, INK, "right");
  return pdf.save();
}

function drawCompany(page: PDFPage, chart: OrgChart, fonts: Fonts, X: (x: number) => number, Y: (y: number) => number, size: (u: number) => number, k: number) {
  const { header } = chart;
  const left = 56;
  const top = 108;
  const width = 330;
  const lineGap = 13.8;
  const lines: { value: string; font: PDFFont; underline?: boolean; gapAfter?: number }[] = [
    { value: "COMPANY INFORMATION", font: fonts.bold, underline: true },
    { value: "THÔNG TIN VỀ CÔNG TY", font: fonts.bold, underline: true, gapAfter: 5 },
  ];
  // Địa chỉ dài: xuống dòng theo bề ngang khung
  const wrap = (value: string, font: PDFFont): string[] => {
    const max = (width - 14) * k;
    const words = value.split(/\s+/);
    const out: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size(10.5)) > max && current) { out.push(current); current = word; } else current = next;
    }
    if (current) out.push(current);
    return out;
  };
  const body = [
    `Company Name/Tên công ty: ${header.companyName}`,
    `Address/Địa chỉ: ${header.companyAddress.replace(/\s*\n\s*/g, " ")}`,
    `Phone/Số điện thoại: ${header.companyPhone}`,
    `Fax/Số fax: ${header.companyFax ?? ""}`,
    `Email: ${header.companyEmail ?? ""}`,
  ];
  body.forEach((value, index) => wrap(value, index === 0 ? fonts.bold : fonts.regular).forEach((part) => lines.push({ value: part, font: index === 0 ? fonts.bold : fonts.regular })));
  let y = top + 14;
  for (const line of lines) {
    const s = size(line.underline ? 11 : 10.5);
    page.drawText(line.value, { x: X(left + 7), y: Y(y) - s * 0.35, size: s, font: line.font, color: INK });
    if (line.underline) page.drawLine({ start: { x: X(left + 7), y: Y(y) - s * 0.5 }, end: { x: X(left + 7) + line.font.widthOfTextAtSize(line.value, s), y: Y(y) - s * 0.5 }, thickness: 0.6, color: INK });
    y += lineGap + (line.gapAfter ?? 0);
  }
  // Chỗ Giám đốc ký, ghi rõ họ tên, đóng dấu, ghi ngày
  const signX = left + width * 0.62;
  y += 6;
  const center = (value: string, yy: number, font: PDFFont) => { const s = size(10.5); page.drawText(value, { x: X(signX) - font.widthOfTextAtSize(value, s) / 2, y: Y(yy) - s * 0.35, size: s, font, color: INK }); };
  center(signDateText(header.signDate), y, fonts.regular);
  center(header.signerTitle, y + lineGap, fonts.regular);
  center(header.signerName, y + lineGap * 3.6, fonts.bold);
  const bottom = y + lineGap * 3.6 + 12;
  page.drawRectangle({ x: X(left), y: Y(bottom), width: width * k, height: (bottom - top) * k, borderColor: ORANGE, borderWidth: 1.6 });
}

async function drawPerson(pdf: PDFDocument, page: PDFPage, person: OrgPerson, box: { x: number; y: number; w: number; h: number }, s: number, fonts: Fonts,
  X: (x: number) => number, Y: (y: number) => number, size: (u: number) => number, k: number) {
  page.drawRectangle({ x: X(box.x), y: Y(box.y + box.h), width: box.w * k, height: box.h * k, color: BLUE });
  // Ảnh 3×4 viền trắng; chưa có ảnh thì để khung trống
  const pad = 4 * s;
  const photoH = box.h - 2 * pad;
  const photoW = photoH * 3 / 4;
  const photo = { x: box.x + pad, y: box.y + pad };
  let image: PDFImage | null = null;
  const bytes = person.photo ? dataUrlBytes(person.photo) : null;
  if (bytes) image = await (bytes.png ? pdf.embedPng(bytes.bytes) : pdf.embedJpg(bytes.bytes)).catch(() => null);
  if (image) page.drawImage(image, { x: X(photo.x), y: Y(photo.y + photoH), width: photoW * k, height: photoH * k });
  page.drawRectangle({ x: X(photo.x), y: Y(photo.y + photoH), width: photoW * k, height: photoH * k, borderColor: WHITE, borderWidth: 1.2, ...(image ? {} : { color: rgb(0.45, 0.6, 0.8) }) });
  // Chữ căn giữa phần còn lại
  const textLeft = photo.x + photoW + 5 * s;
  const textWidth = box.x + box.w - pad - textLeft;
  const center = textLeft + textWidth / 2;
  const lines: { value: string; font: PDFFont }[] = [{ value: person.titleEn, font: fonts.regular }];
  if (person.titleVi) lines.push({ value: person.titleVi, font: fonts.regular });
  lines.push({ value: person.name, font: fonts.regular }, { value: `Phone: ${person.phone}`, font: fonts.regular });
  if (person.workerCount === null || person.email) lines.push({ value: `Email: ${person.email}`, font: fonts.regular });
  if (person.workerCount !== null) lines.push({ value: `Số lượng công nhân: ${person.workerCount}`, font: fonts.regular });
  const u = 10.4 * s;
  const lineH = u * 1.3;
  let y = box.y + box.h / 2 - (lines.length - 1) * lineH / 2;
  for (const line of lines) {
    const sz = size(line.value.startsWith("Email:") ? u * 0.92 : u);
    const shown = fit(line.value, line.font, sz, textWidth * k);
    page.drawText(shown, { x: X(center) - line.font.widthOfTextAtSize(shown, sz) / 2, y: Y(y) - sz * 0.35, size: sz, font: line.font, color: WHITE });
    y += lineH;
  }
}
