import { parseRange } from "./fillWorkbook";
import { CATALOG_GROUP_LABELS, type CatalogField, type FieldPlacement } from "./templateEdits";

/**
 * Cấu hình mẫu do AI đề xuất (theo bộ quy tắc `buildMappingRules`): ô nào điền trường nào, vùng ảnh, ô nhập thêm, vùng in.
 * App kiểm tra lại từng dòng trước khi áp dụng, không tin thẳng kết quả của AI.
 */
export type MappingPlan = {
  sheet?: string;
  printArea?: string;
  fields: FieldPlacement[];
  images: { range: string; field: string }[];
  customFields: { cell: string; label: string; kind: "text" | "date" | "checkbox" }[];
};
export type MappingProblem = { level: "error" | "warning"; message: string };

/** Nhãn hay gặp trên phiếu của khách cho từng trường (giúp AI nhận ra, không phải danh sách đầy đủ). */
const ALIASES: Readonly<Record<string, string>> = {
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

/** Bộ quy tắc + prompt dán vào đoạn chat AI kèm file Excel mẫu trống; luôn lấy theo danh sách trường hiện tại của app. */
export function buildMappingRules(catalog: readonly CatalogField[]): string {
  const groups = Object.keys(CATALOG_GROUP_LABELS) as CatalogField["group"][];
  const table = groups.flatMap((group) => {
    const rows = catalog.filter((field) => field.group === group);
    if (!rows.length) return [];
    return [`\n### ${CATALOG_GROUP_LABELS[group]}\n`, "| Mã | Ý nghĩa | Nhãn hay gặp trên phiếu |", "|---|---|---|", ...rows.map((field) => `| \`${field.key}\` | ${field.label} | ${ALIASES[field.key] ?? (field.group === "certificate" ? "ô ☐ cạnh tên chứng chỉ trong bảng chứng chỉ đính kèm" : "")} |`)];
  });
  return `# Bộ quy tắc cài mẫu Excel cho app Quản lý nhân sự TNM

> Dán toàn bộ nội dung này vào một đoạn chat mới, **gửi kèm file Excel mẫu trống** (không gửi file đã điền thông tin nhân viên).

## Việc cần làm

Bạn là trợ lý cài mẫu phiếu. Đọc file Excel đính kèm và đề xuất **ô nào app cần tự điền dữ liệu gì**. App sẽ tự ghi mã vào ô, người dùng không sửa file Excel.

1. Mở file bằng công cụ đọc Excel (vd openpyxl). Lấy **đúng địa chỉ ô thật** trong file, không đoán theo mắt. Liệt kê sheet, vùng in (print area), các vùng ô gộp.
2. Tìm các nhãn (chữ cố định) trên phiếu, khớp với bảng trường bên dưới.
3. **Chỗ nào chưa chắc thì hỏi lại, không tự đoán.** Hỏi gọn, đánh số, một lần cho tất cả câu hỏi. Chờ người dùng trả lời rồi mới đưa kết quả cuối.
4. Khi đã rõ hết, trả về **đúng một khối JSON** theo mẫu ở cuối, không kèm giải thích trong khối.

## Quy tắc chọn ô

- Chỗ điền là **ô trống ngay bên phải nhãn**; không có thì **ô trống ngay bên dưới**. Ô thuộc vùng gộp thì ghi **ô đầu (trên trái)** của vùng gộp.
- Nhãn và chỗ điền **chung một ô** (vd ô ghi \`Họ tên: ........\`): dùng ô đó với \`"mode": "append"\` (app giữ chữ, điền sau). Còn lại dùng \`"mode": "replace"\`.
- Không gán hai trường vào cùng một ô. Không gán vào ô đang chứa nhãn khi đã có ô trống bên cạnh.
- Phiếu có cả "Họ tên" viết thường và chỗ in hoa: theo cách phiếu mẫu đang viết (thường là in hoa \`fullNameUpper\`).
- Ô ☐ Nam / ☐ Nữ: mỗi ô một trường \`genderMale\`, \`genderFemale\`. Ô ghi chữ giới tính: \`gender\`.
- Bảng chứng chỉ đính kèm có ô ☐ cạnh mỗi loại: gán ô ☐ đó với mã \`cert:…\` đúng loại. Loại không có trong danh sách thì hỏi lại.
- **Ảnh** (\`images\`): chọn **cả vùng khung** dành cho ảnh (vd khung 3×4, khung dán CCCD, chỗ ký + đóng dấu). Ảnh sẽ được kéo giãn lấp đầy đúng vùng này.
- **Vùng in** (\`printArea\`): lấy print area có sẵn trong file; không có thì đề xuất vùng bao trọn phiếu (thường 1 trang A4) và hỏi lại.
- Thông tin phiếu cần mà **không có trong bảng trường** (vd "Ngày bắt đầu dự án", "Số thẻ công trường"): đưa vào \`customFields\` với tên dễ hiểu, kiểu \`text\` / \`date\` / \`checkbox\`.
- Chữ ký, tên người ký: phiếu có chỗ "Người lập phiếu / Đại diện công ty ký tên" thì dùng nhóm Người ký.

## Bắt buộc hỏi lại khi

- Nhãn mơ hồ (vd chỉ ghi "Ngày", "Số", "Địa chỉ" mà không rõ của ai, loại nào).
- Một nhãn có nhiều ô trống có thể điền, hoặc chỗ điền chia nhiều ô nhỏ (dd | mm | yyyy, mỗi số một ô).
- Không biết một chỗ thuộc trường có sẵn hay là ô nhập thêm.
- Phiếu có text box / shape chứa chữ hoặc chỗ điền (app không điền được vào text box).
- Phiếu có bảng nhiều dòng cho nhiều người hoặc danh sách dài ngắn thay đổi.
- Không có print area, hoặc phiếu dài hơn 1 trang.
- Có nhiều sheet và không rõ sheet nào là phiếu.

## Bảng trường app điền được
${table.join("\n")}

## Mẫu kết quả (chỉ trả khi đã hết câu hỏi)

\`\`\`json
{
  "sheet": "Tên sheet phiếu",
  "printArea": "B1:AZ73",
  "fields": [
    { "cell": "E9", "field": "fullNameUpper", "mode": "replace" },
    { "cell": "B12", "field": "dob", "mode": "append" }
  ],
  "images": [
    { "range": "AB8:AH16", "field": "photo3x4" }
  ],
  "customFields": [
    { "cell": "X20", "label": "Ngày bắt đầu dự án", "kind": "date" }
  ]
}
\`\`\`

Chỉ dùng mã trong bảng trường. Địa chỉ ô viết hoa, không có dấu $.
`;
}

const isRange = (value: string) => { try { parseRange(value); return true; } catch { return false; } };
const isCell = (value: string) => /^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(value);
const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/\$/g, "");

/** Đọc khối JSON AI trả về (dán nguyên cả câu trả lời cũng được), kiểm tra từng dòng theo danh sách trường của app. */
export function parseMappingPlan(text: string, catalog: readonly CatalogField[]): { plan: MappingPlan | null; problems: MappingProblem[] } {
  const problems: MappingProblem[] = [];
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { plan: null, problems: [{ level: "error", message: "Không thấy khối JSON trong nội dung dán vào." }] };
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return { plan: null, problems: [{ level: "error", message: "Khối JSON bị lỗi cú pháp, hãy chép lại nguyên khối từ đoạn chat." }] }; }

  const known = new Map(catalog.map((field) => [field.key, field]));
  const used = new Map<string, string>();
  const claim = (cell: string, what: string) => {
    const before = used.get(cell);
    if (before) { problems.push({ level: "error", message: `Ô ${cell} bị gán hai lần: ${before} và ${what}, bỏ dòng sau.` }); return false; }
    used.set(cell, what);
    return true;
  };
  const list = (value: unknown) => (Array.isArray(value) ? value as Record<string, unknown>[] : []);

  const printArea = raw.printArea ? normalize(raw.printArea) : undefined;
  if (printArea && !isRange(printArea)) problems.push({ level: "error", message: `Vùng in "${printArea}" không hợp lệ.` });
  const inPrint = (range: string) => {
    if (!printArea || !isRange(printArea) || !isRange(range)) return true;
    const [a, b] = parseRange(printArea), [c, d] = parseRange(range);
    return c.col >= a.col && d.col <= b.col && c.row >= a.row && d.row <= b.row;
  };

  const fields: FieldPlacement[] = [];
  for (const item of list(raw.fields)) {
    const cell = normalize(item.cell), field = String(item.field ?? "").trim();
    const info = known.get(field);
    if (!isCell(cell)) { problems.push({ level: "error", message: `Ô "${cell}" của trường ${field || "(trống)"} không hợp lệ.` }); continue; }
    if (!info) { problems.push({ level: "error", message: `Ô ${cell}: mã "${field}" không có trong app, bỏ qua.` }); continue; }
    if (info.kind === "image") { problems.push({ level: "error", message: `Ô ${cell}: "${info.label}" là ảnh, phải nằm trong "images" với cả vùng ô.` }); continue; }
    if (!inPrint(cell)) problems.push({ level: "warning", message: `Ô ${cell} (${info.label}) nằm ngoài vùng in, sẽ không hiện khi in.` });
    if (!claim(cell, info.label)) continue;
    fields.push({ cell, field, mode: item.mode === "append" ? "append" : "replace" });
  }

  const images: MappingPlan["images"] = [];
  for (const item of list(raw.images)) {
    const range = normalize(item.range), field = String(item.field ?? "").trim();
    const info = known.get(field);
    if (!info || info.kind !== "image") { problems.push({ level: "error", message: `Vùng ${range || "(trống)"}: "${field}" không phải loại ảnh app có.` }); continue; }
    if (!isRange(range)) { problems.push({ level: "error", message: `Vùng ảnh "${range}" (${info.label}) không hợp lệ.` }); continue; }
    if (images.some((image) => image.field === field)) { problems.push({ level: "warning", message: `${info.label} có hai vùng, chỉ lấy vùng đầu.` }); continue; }
    if (!inPrint(range)) problems.push({ level: "warning", message: `Vùng ảnh ${range} (${info.label}) nằm ngoài vùng in.` });
    images.push({ range, field });
  }

  const customFields: MappingPlan["customFields"] = [];
  for (const item of list(raw.customFields)) {
    const cell = normalize(item.cell), label = String(item.label ?? "").trim();
    const kind = item.kind === "date" || item.kind === "checkbox" ? item.kind : "text";
    if (!label || !isCell(cell)) { problems.push({ level: "error", message: `Ô nhập thêm "${label || "(chưa đặt tên)"}" ở ô "${cell}" không hợp lệ.` }); continue; }
    if (!claim(cell, label)) continue;
    customFields.push({ cell, label, kind });
  }

  if (!fields.length && !images.length && !customFields.length && !printArea) problems.push({ level: "error", message: "Khối JSON không có ô nào để gán." });
  const sheet = typeof raw.sheet === "string" && raw.sheet.trim() ? raw.sheet.trim() : undefined;
  return { plan: { ...(sheet ? { sheet } : {}), ...(printArea && isRange(printArea) ? { printArea } : {}), fields, images, customFields }, problems };
}
