// Chuyển ảnh chân dung kiểu cũ (data URL base64 nằm trong employees.doc.photo) sang bucket riêng tư
// `hr-files`, thư mục employees/<id tệp>, rồi thay trường photo bằng tham chiếu tệp { id, name, mime, size }.
//
// Mặc định chỉ liệt kê (không ghi gì). Thêm --apply để chuyển thật:
//   node --env-file=.env.local scripts/migrate-employee-photos.mjs
//   node --env-file=.env.local scripts/migrate-employee-photos.mjs --apply
// Cần NEXT_PUBLIC_SUPABASE_URL và SUPABASE_SECRET_KEY (khóa bí mật, bỏ qua RLS).
// Chạy lại an toàn: bản ghi đã chuyển không còn data URL nên bị bỏ qua.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const client = createClient(url, key, { auth: { persistSession: false } });
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const { data: rows, error } = await client.from("employees").select("id, version, doc").like("doc->>photo", "data:%");
if (error) { console.error(`Không đọc được bảng employees: ${error.message}`); process.exit(1); }
console.log(`${rows.length} nhân sự còn ảnh base64${apply ? "" : " (chạy thử, thêm --apply để chuyển)"}.`);

let failed = 0;
for (const row of rows) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(row.doc.photo);
  const label = `${row.doc.code} ${row.doc.name}`;
  if (!match || !EXTENSIONS[match[1]]) { console.warn(`- ${label}: ảnh không đọc được, bỏ qua`); failed++; continue; }
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  console.log(`- ${label}: ${mime}, ${(bytes.length / 1024).toFixed(0)} KB`);
  if (!apply) continue;

  const ref = { id: randomUUID(), name: `anh-3x4-${row.doc.code}.${EXTENSIONS[mime]}`, mime, size: bytes.length };
  const uploaded = await client.storage.from("hr-files").upload(`employees/${ref.id}`, bytes, { contentType: mime, upsert: false });
  if (uploaded.error) { console.error(`  tải ảnh lên lỗi: ${uploaded.error.message}`); failed++; continue; }
  // Khóa lạc quan như ứng dụng: chỉ ghi khi chưa ai sửa bản ghi trong lúc chạy
  const version = row.version + 1;
  const updated = await client.from("employees").update({ version, doc: { ...row.doc, photo: ref, version } }).eq("id", row.id).eq("version", row.version).select("id");
  if (updated.error || !updated.data?.length) {
    console.error(`  cập nhật bản ghi lỗi: ${updated.error?.message ?? "bản ghi vừa bị sửa, chạy lại sau"}`);
    await client.storage.from("hr-files").remove([`employees/${ref.id}`]);
    failed++;
    continue;
  }
  console.log(`  đã chuyển → employees/${ref.id}`);
}
if (failed) { console.error(`${failed} ảnh chưa chuyển được.`); process.exit(1); }
