import ExcelJS from "exceljs";
import { SYSTEM_FIELDS } from "./fieldValues";
import { IMAGE_FIELDS } from "./profileConfig";
import { scanTemplate } from "./scanTemplate";
import { CATALOG_GROUP_LABELS, type CatalogField } from "./templateEdits";

export type MappingProblem = { level: "error" | "warning"; message: string };

/**
 * Nhãn hay gặp trên phiếu của khách cho từng mã (giúp AI nhận ra). Mỗi mã trong SYSTEM_FIELDS / IMAGE_FIELDS bắt buộc
 * có một dòng ở đây (test kiểm tra), nên thêm biến mới mà quên mô tả thì test báo ngay, bộ quy tắc luôn đồng bộ với app.
 */
export const FIELD_ALIASES: Readonly<Record<string, string>> = {
  code: "Mã NV, Mã số, Employee code, ID No.",
  fullName: "Họ tên (viết thường), Name",
  fullNameUpper: "HỌ VÀ TÊN, FULL NAME, Tên công nhân, Worker name (phiếu thường ghi in hoa)",
  dob: "Ngày sinh, Date of birth, DOB",
  gender: "Giới tính, Sex, Gender (ghi chữ Nam/Nữ)",
  genderMale: "ô ☐ Nam / Male",
  genderFemale: "ô ☐ Nữ / Female",
  cccd: "Số CCCD, CMND, ID card No., Identity No.",
  phone: "Điện thoại, SĐT, Tel, Phone",
  home: "Quê quán, Nguyên quán, Hometown, Motherland",
  address: "Thường trú, Hộ khẩu, Permanent address, Address",
  currentAddress: "Chỗ ở hiện tại, Tạm trú, Current address",
  position: "Chức vụ, Vị trí, Nghề, Position, Job title",
  startDate: "Ngày bắt đầu làm nghề, Năm vào nghề",
  companyStartDate: "Ngày vào công ty, Ngày vào TNM, Joining date",
  safetyGroup: "Nhóm an toàn, Bậc an toàn, Safety group",
  age: "Tuổi, Age",
  experience: "Kinh nghiệm, Thâm niên, Working experience, Years of experience",
  exportDate: "Ngày lập phiếu, Ngày ký, Date",
  contactName: "Người liên hệ khẩn cấp, Emergency contact",
  contactNameUpper: "NAME trong khung liên hệ khẩn cấp (in hoa)",
  contactRelation: "Quan hệ, Relation, Relationship",
  contactPhone: "SĐT người liên hệ, Emergency phone",
  contactAddress: "Địa chỉ người liên hệ",
  signerName: "Tên người ký dưới chữ ký",
  signerNameUpper: "TÊN NGƯỜI KÝ in hoa",
  signerRole: "Chức danh người ký (Giám đốc, Chỉ huy trưởng…)",
  signerTitle: "Một ô ghi cả 'Tên - Chức danh' người ký",
  photo3x4: "khung ảnh chân dung 3×4, Photo",
  cccdImage: "khung dán ảnh CCCD/CMND hai mặt",
  signature: "chỗ ký + đóng dấu của người ký/công ty",
  employeeSignature: "chữ ký của chính công nhân",
};

/** Mã chưa có mô tả trong FIELD_ALIASES (phải rỗng; dùng trong test). */
export const fieldsWithoutAlias = () => [...SYSTEM_FIELDS.map((field) => field.key), ...IMAGE_FIELDS.map((field) => field.key)].filter((key) => !FIELD_ALIASES[key]);

/** Một dòng trong bảng quy tắc đặt tên biến: cách ghi trong Excel, ý nghĩa, nhãn hay gặp. */
export type FieldRule = { group: CatalogField["group"]; key: string; label: string; write: string; aliases: string };

export function fieldRules(catalog: readonly CatalogField[]): FieldRule[] {
  return catalog.map((field) => ({
    group: field.group,
    key: field.key,
    label: field.label,
    write: field.kind === "image" ? `IMG_${field.key}` : `{{${field.key}}}`,
    aliases: FIELD_ALIASES[field.key] ?? (field.group === "certificate" ? "ô ☐ cạnh tên chứng chỉ trong bảng chứng chỉ đính kèm" : ""),
  }));
}

/** Bộ quy tắc + prompt dán vào đoạn chat AI kèm file Excel mẫu trống. AI trả lại chính file Excel đã gõ mã {{…}}. */
export function buildMappingRules(catalog: readonly CatalogField[]): string {
  const rules = fieldRules(catalog);
  const table = (Object.keys(CATALOG_GROUP_LABELS) as CatalogField["group"][]).flatMap((group) => {
    const rows = rules.filter((rule) => rule.group === group);
    if (!rows.length) return [];
    return [`\n### ${CATALOG_GROUP_LABELS[group]}\n`, "| Ghi trong Excel | Ý nghĩa | Nhãn hay gặp trên phiếu |", "|---|---|---|", ...rows.map((rule) => `| \`${rule.write}\` | ${rule.label} | ${rule.aliases} |`)];
  });
  return `# Bộ quy tắc cài mẫu Excel cho app Quản lý nhân sự TNM

> Dán toàn bộ nội dung này vào một đoạn chat mới, **gửi kèm file Excel mẫu trống** (không gửi file đã điền thông tin nhân viên).

## Việc cần làm

Bạn là trợ lý cài mẫu phiếu. Đọc file Excel đính kèm, tìm chỗ cần điền dữ liệu và **trả lại chính file Excel đó đã gõ mã \`{{…}}\` vào đúng ô**.

1. Mở file bằng openpyxl. Lấy **đúng địa chỉ ô thật**, không đoán theo mắt. Xem các sheet, print area, các vùng ô gộp.
2. Tìm các nhãn (chữ cố định) trên phiếu, khớp với bảng mã bên dưới.
3. **Chỗ nào chưa chắc thì hỏi lại trước, không tự đoán.** Hỏi gọn, đánh số, một lần cho tất cả câu hỏi. Chờ người dùng trả lời rồi mới sửa file.
4. Khi đã rõ hết: sửa file theo quy tắc dưới, lưu thành file mới \`<tên file gốc>-da-gan-ma.xlsx\` và gửi file cho người dùng tải về.
5. Kèm theo một bảng ngắn: Ô | Mã | Nhãn bên cạnh, để người dùng đối chiếu.

## Cách ghi mã vào file

- Gõ mã vào **ô trống ngay bên phải nhãn**; không có thì **ô trống ngay bên dưới**. Ô thuộc vùng gộp: ghi vào **ô đầu (trên trái)** của vùng gộp.
- Nhãn và chỗ điền **chung một ô** (vd \`Họ tên: ........\`): giữ nguyên chữ, thêm mã phía sau → \`Họ tên: {{fullNameUpper}}\`.
- Mỗi ô chỉ một mã. Không ghi mã đè lên ô đang chứa nhãn khi đã có ô trống bên cạnh.
- Ô ☐ Nam / ☐ Nữ: mỗi ô một mã \`{{genderMale}}\`, \`{{genderFemale}}\` (app tự điền ☑ hoặc ☐). Ô ghi chữ giới tính: \`{{gender}}\`.
- Bảng chứng chỉ đính kèm có ô ☐ cạnh mỗi loại: gõ đúng mã \`{{cert:…}}\` của loại đó vào ô ☐. Loại không có trong bảng thì hỏi lại.
- **Ảnh**: không gõ mã vào ô. Tạo **tên vùng (Defined Name)** \`IMG_<mã ảnh>\` trỏ tới **cả vùng khung ảnh**, vd \`IMG_photo3x4\` = \`'Tên sheet'!$C$19:$Z$33\`. Ảnh sẽ được kéo giãn lấp đầy đúng vùng này.
- **Vùng in**: giữ print area có sẵn; chưa có thì đặt print area bao trọn phiếu (thường 1 trang A4) và báo người dùng.
- **Thông tin phiếu cần mà không có trong bảng mã** (vd "Ngày bắt đầu dự án", "Số thẻ công trường"): tự đặt mã mới theo quy tắc đặt tên bên dưới, vd \`{{ngayBatDauDuAn}}\`. Ảnh mới (logo nhà thầu, ảnh dự án): tên vùng \`IMG_logoNhaThau\`.

## Quy tắc đặt tên mã mới

- Chỉ chữ cái không dấu và số, viết kiểu camelCase: chữ đầu viết thường, mỗi từ sau viết hoa chữ đầu. Vd "Số thẻ công trường" → \`soTheCongTruong\`.
- Bắt đầu bằng chữ cái, không dấu cách, không gạch ngang, không dấu tiếng Việt, tối đa 32 ký tự.
- **Không trùng** với mã có sẵn trong bảng dưới; trùng nghĩa thì dùng mã có sẵn.

## Không được làm

- Không đổi tên sheet, không chèn/xóa dòng hoặc cột, không gộp/tách ô, không đổi định dạng, màu, viền, cỡ chữ.
- Không xóa chữ cố định của phiếu. Không thêm sheet mới.
- (App chỉ lấy các mã \`{{…}}\`, tên vùng \`IMG_…\` và print area từ file bạn trả về rồi ghi vào file gốc, nên định dạng gốc luôn được giữ nguyên.)

## Bắt buộc hỏi lại khi

- Nhãn mơ hồ (vd chỉ ghi "Ngày", "Số", "Địa chỉ" mà không rõ của ai, loại nào).
- Một nhãn có nhiều ô trống có thể điền, hoặc chỗ điền chia nhiều ô nhỏ (dd | mm | yyyy, mỗi số một ô).
- Không biết một chỗ là mã có sẵn hay cần mã mới.
- Phiếu có text box / shape chứa chữ hoặc chỗ điền (app không điền được vào text box).
- Phiếu có bảng nhiều dòng cho nhiều người hoặc danh sách dài ngắn thay đổi.
- Không có print area, hoặc phiếu dài hơn 1 trang.
- Có nhiều sheet và không rõ sheet nào là phiếu.

## Bảng mã app điền được
${table.join("\n")}
`;
}

const CODE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const textOf = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return typeof value === "object" ? "" : String(value);
};
const plain = (text: string) => text.replace(CODE, "").replace(/[\s.…_:]+/g, " ").trim().toLowerCase();

export type AiTemplateMerge = {
  /** File gốc đã ghi thêm các mã lấy từ file AI (định dạng gốc giữ nguyên). */
  bytes: Uint8Array;
  /** Ô có mã: địa chỉ, nội dung ô sau khi ghi. */
  cells: { address: string; text: string }[];
  /** Vùng ảnh khai báo bằng tên vùng IMG_ trong file AI. */
  images: { field: string; range: string }[];
  printArea: string | null;
  /** Mã không có trong app → thành "Ô nhập thêm". */
  newKeys: string[];
  problems: MappingProblem[];
};

/**
 * Lấy mã {{…}}, tên vùng IMG_… và vùng in từ file Excel AI trả về, ghi các mã vào đúng ô của **file gốc**.
 * Không dùng thẳng file AI: thư viện AI dùng để lưu (openpyxl) có thể làm mất logo, text box, định dạng.
 */
export async function mergeAiTemplate(original: Uint8Array, ai: Uint8Array, sheetName: string, catalog: readonly CatalogField[]): Promise<AiTemplateMerge> {
  const problems: MappingProblem[] = [];
  const aiBook = new ExcelJS.Workbook();
  await aiBook.xlsx.load(ai.slice().buffer);
  const scan = await scanTemplate(ai);
  const aiSheet = aiBook.getWorksheet(scan.sheetName) ?? aiBook.worksheets[0];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(original.slice().buffer);
  const sheet = book.getWorksheet(scan.sheetName) ?? book.getWorksheet(sheetName) ?? book.worksheets[0];
  if (!aiSheet || !sheet) return { bytes: original, cells: [], images: [], printArea: null, newKeys: [], problems: [{ level: "error", message: "File AI trả về không có sheet nào." }] };
  if (sheet.name !== scan.sheetName) problems.push({ level: "warning", message: `File AI có mã ở sheet "${scan.sheetName}", file gốc không có sheet này nên ghi vào sheet "${sheet.name}". Kiểm tra lại trên ảnh phiếu.` });

  const known = new Set(catalog.map((field) => field.key));
  const cells: AiTemplateMerge["cells"] = [];
  const newKeys: string[] = [];
  aiSheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (aiCell) => {
    // Ô con của vùng gộp trả về giá trị của ô chủ: chỉ tính ô chủ một lần
    if (aiCell.isMerged && aiCell.master.address !== aiCell.address) return;
    const text = textOf(aiCell.value);
    if (!text.includes("{{")) return;
    const target = sheet.getCell(aiCell.address);
    const master = target.isMerged ? target.master : target;
    const before = textOf(master.value);
    // AI ghi đè mất chữ cố định của phiếu → giữ chữ gốc, thêm mã phía sau
    const kept = before.trim() && !before.includes("{{") && !plain(text).includes(plain(before)) ? `${before.replace(/\s+$/, "")} ${text.match(CODE)!.join(" ")}` : text;
    if (kept !== text) problems.push({ level: "warning", message: `Ô ${master.address}: AI xóa mất chữ "${before.trim()}", app giữ lại chữ và điền mã phía sau.` });
    master.value = kept;
    cells.push({ address: master.address, text: kept });
    for (const match of text.matchAll(CODE)) {
      const key = match[1]!;
      if (!known.has(key) && !newKeys.includes(key)) newKeys.push(key);
    }
  }));
  for (const key of newKeys) {
    if (key.startsWith("cert:")) problems.push({ level: "error", message: `Mã {{${key}}}: loại chứng chỉ này chưa có trong app. Thêm loại chứng chỉ trước, hoặc gỡ ô này.` });
    else if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(key)) problems.push({ level: "warning", message: `Mã mới {{${key}}} sai quy tắc đặt tên (camelCase, không dấu); vẫn dùng được như ô nhập thêm.` });
  }

  const imageKeys = new Set(IMAGE_FIELDS.map((field) => field.key as string));
  const images = scan.imageSlots.map((slot) => ({ field: slot.field, range: slot.range }));
  for (const image of images) if (!imageKeys.has(image.field)) problems.push({ level: "warning", message: `Vùng IMG_${image.field} (${image.range}) là ảnh mới, app thêm thành ô nhập thêm kiểu ảnh; tải ảnh ở mục "Ô nhập thêm".` });
  if (!cells.length && !images.length) problems.push({ level: "error", message: "File này không có mã {{…}} hay vùng IMG_ nào. Có thể đã gửi nhầm file gốc." });

  return { bytes: new Uint8Array(await book.xlsx.writeBuffer()), cells, images, printArea: scan.printArea, newKeys, problems };
}
