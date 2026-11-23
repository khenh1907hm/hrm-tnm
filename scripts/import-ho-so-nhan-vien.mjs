// Đưa hồ sơ nhân sự từ thư mục máy (HS Nhân sự/Nhan-vien/<TNMxxxx - Ten>/...) lên hrm-tnm:
// tải tệp vào bucket `hr-files` và gắn vào chứng chỉ / hồ sơ nhân sự theo quy ước tên tệp
//   TNM0013ATD-Nguyen Manh Cuong - 2028-0519.pdf  (mã NV + mã loại + tên + ngày)
//
// Mặc định chỉ chạy thử và ghi báo cáo CSV. Thêm --apply để ghi thật:
//   node --env-file=.env.local scripts/import-ho-so-nhan-vien.mjs --root "D:/WORKSPACE/Document_TNM/HS Nhân sự"
//   node --env-file=.env.local scripts/import-ho-so-nhan-vien.mjs --root "..." --apply
// Chạy lại an toàn: tệp đã có (trùng tên trên cùng nhân sự) thì bỏ qua.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const root = args[args.indexOf("--root") + 1];
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
if (!root || !fs.existsSync(path.join(root, "Nhan-vien"))) { console.error("Cần --root trỏ tới thư mục 'HS Nhân sự'."); process.exit(1); }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const ACTOR = "import-ho-so-22-11-26";
const TODAY = new Date().toISOString().slice(0, 10);
const BUCKET = "hr-files";
const MAX_BYTES = 10 * 1024 * 1024;
const VSLD = "custom-8907a52c-22e9-46ad-84cd-7773b90b8849"; // An toàn vệ sinh Lao Động (Nhóm 1/2)

// ---------- ngày ----------
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addYears = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y + n, m - 1, d)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const validDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

// ---------- bảo hiểm: thời hạn đọc từ hợp đồng gốc (BH24G) ----------
// Tên tệp hợp đồng: "<ngày ký> - ADxxxx-..." hoặc "<ngày ký>_ADxxxx.26IB08203 - <ngày hết hạn>". Thời hạn luôn 90 ngày (gồm cả hai ngày).
// Các hợp đồng tên không ghi ngày hết hạn hoặc ghi sai được đọc trực tiếp trên bản scan:
const POLICY_OVERRIDES = {
  "PJICO": { start: "2026-01-01", end: "2026-12-31", number: "P-25/BTA/P56/6201/000024", title: "PJICO-BT" },
  "AD0003": { start: "2026-01-13", end: "2026-04-12" }, "AD0008": { start: "2026-02-03", end: "2026-05-03" },
  "AD0011": { start: "2026-02-25", end: "2026-05-25" }, "AD0012": { start: "2026-03-04", end: "2026-06-01" },
  "AD0013": { start: "2026-03-10", end: "2026-06-07" }, "AD0014": { start: "2026-03-14", end: "2026-06-11" },
  "AD0015": { start: "2026-03-17", end: "2026-06-14" }, "AD0016": { start: "2026-03-24", end: "2026-06-21" },
  "AD0061": { start: "2026-09-15", end: "2026-12-13" }, // tên tệp ghi nhầm 2026-0213
  "AD0069": { start: "2026-10-31", end: "2027-01-28" }, // tên tệp ghi nhầm 2026-0128
};
function policyFromSource(name) {
  if (name.includes("PJICO")) return POLICY_OVERRIDES.PJICO;
  const ad = /AD(\d{4})/.exec(name)?.[0];
  if (!ad) return null;
  const number = `${ad}/26IB08203`;
  if (POLICY_OVERRIDES[ad]) return { ...POLICY_OVERRIDES[ad], number, title: "Bao-Minh-BT" };
  const m = / - (\d{4})-(\d{2})(\d{2})\.pdf$/.exec(name);
  if (!m) return null;
  const end = iso(m[1], m[2], m[3]);
  return { start: addDays(end, -89), end, number, title: "Bao-Minh-BT" };
}
const insuranceMap = new Map(); // tên tệp tạo ra -> hợp đồng
{
  const csv = fs.readFileSync(path.join(root, "_bao-hiem-to-vang.csv"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).slice(1);
  for (const line of csv) {
    const [source, , created] = line.split(",");
    if (!created) continue;
    const policy = policyFromSource(source);
    if (policy) insuranceMap.set(created.trim(), policy);
  }
}

// ---------- CCCD: hạn theo mốc tuổi 25/40/60 (Luật Căn cước), CMND 9 số: 15 năm ----------
function cccdExpiry(issue, dob) {
  if (!dob) return null;
  const birthday = (age) => addYears(dob, age);
  for (const age of [25, 40, 60]) {
    const milestone = birthday(age);
    if (milestone > addYears(issue, 2)) return milestone; // cấp trong vòng 2 năm trước mốc thì dùng mốc kế tiếp
  }
  return null; // cấp từ sau 58 tuổi: có giá trị suốt đời
}

// ---------- quy ước mã loại ----------
// key: "expiry" = ngày trên tên tệp là ngày hết hạn; "issue" = ngày cấp
const KINDS = {
  ATXD: { type: "atld", title: "Xây dựng", key: "expiry" },
  ATTC: { type: "atld", title: "Trên cao", key: "expiry" },
  ATKGK: { type: "atld", title: "Không gian kín", key: "expiry" },
  ATD: { type: "elec", title: null, key: "expiry" },
  ATXN: { type: "fork", title: null, key: "expiry" },
  ATCK: { type: "weld", title: null, key: "expiry" },
  ATC: { type: "crane", title: null, key: "expiry" },
  N1: { type: VSLD, title: "Nhóm 1", key: "expiry" },
  N2: { type: VSLD, title: "Nhóm 2", key: "expiry" },
  K: { type: "health", title: null, key: "issue", years: 1 },
  HD: { type: "custom-ctype-labor-contract", title: null, key: "contract" },
  BH: { type: "ins", title: null, key: "insurance" },
  CM: { type: "custom-ctype-cccd", title: null, key: "cccd" },
  CCDT: { type: "custom-ctype-cccd", title: null, key: "cccd", extraOnly: true },
};
const kindOf = (code) => KINDS[code] ?? (/^B[CN]/.test(code) ? { type: "custom-ctype-degree", title: null, key: "issue", noExpiry: true } : null);
const normTitle = (t) => (t ?? "").trim().toLowerCase().replace(/^an toàn\s+/, "");

const FILE_RE = /^(?:\d+\.\s*)?TNM(\d{4,5})([A-Z][A-Z0-9_]*)-(.*?)(?: - (\d{4})-(\d{2})(\d{2})(?:-(\d+))?)?(?: - (.+?))?(?:_compressed)?\.([A-Za-z]+)$/;
const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

// ---------- đọc DB ----------
async function selectAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const employees = await selectAll("employees", "id, version, code, cccd, doc");
const certRows = await selectAll("certificates", "id, version, doc");
const certs = certRows.map((r) => ({ ...r.doc, id: r.id, version: r.version }));
const byCode = new Map(employees.map((e) => [e.code, e]));

// ---------- quét thư mục ----------
const report = [];
const log = (emp, file, action, detail = "") => report.push({ code: emp?.code ?? "", name: emp?.doc?.name ?? "", file, action, detail });
const empDir = path.join(root, "Nhan-vien");
const folders = fs.readdirSync(empDir, { withFileTypes: true }).filter((d) => d.isDirectory());
let notInDb = 0, notInDbFiles = 0;
const plans = [];
for (const folder of folders) {
  const code = /^(TNM\d{4,5})/.exec(folder.name)?.[1];
  const emp = code && byCode.get(code);
  const dir = path.join(empDir, folder.name);
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  if (!emp) { notInDb++; notInDbFiles += files.length; continue; }
  if (only && !only.includes(code)) continue;
  if (emp.doc.archivedAt) { for (const f of files) log(emp, f, "BO QUA", "nhân sự đã lưu trữ"); continue; }
  plans.push({ emp, dir, files });
}

// ---------- lập kế hoạch ----------
const actions = []; // mỗi phần tử: { emp, kind: "photo"|"cccdImage"|"attach"|"insert"|"update"|"renew", ... }
for (const { emp, dir, files } of plans) {
  const parsed = [];
  for (const f of files) {
    const m = FILE_RE.exec(f);
    const ext = m?.[9]?.toLowerCase();
    if (!m || !MIME[ext]) { log(emp, f, "BO QUA", "tên tệp không đúng quy ước"); continue; }
    if (`TNM${m[1]}` !== emp.code) { log(emp, f, "BO QUA", `mã trong tên tệp khác thư mục (${emp.code})`); continue; }
    const date = m[4] ? iso(m[4], m[5], m[6]) : null;
    if (date && !validDate(date)) { log(emp, f, "BO QUA", `ngày không hợp lệ ${date}`); continue; }
    parsed.push({ file: f, full: path.join(dir, f), code: m[2], date, page: m[7] ? Number(m[7]) : 0, suffix: m[8] ?? "", mime: MIME[ext], size: fs.statSync(path.join(dir, f)).size });
  }
  const empCerts = certs.filter((c) => c.employeeId === emp.id);
  const knownNames = new Set(empCerts.flatMap((c) => [c.document?.name, ...(c.supplementaryFiles ?? []).map((s) => s.file?.name)]).filter(Boolean));
  for (const k of ["photo"]) if (emp.doc[k]?.name) knownNames.add(emp.doc[k].name);
  if (emp.doc.extraFiles?.cccdImage?.name) knownNames.add(emp.doc.extraFiles.cccdImage.name);

  // ảnh 3x4
  const photos = parsed.filter((p) => p.code === "HT");
  if (photos.length) {
    const p = photos[photos.length - 1];
    if (emp.doc.photo) log(emp, p.file, "DA CO", "nhân sự đã có ảnh 3x4");
    else actions.push({ emp, op: "photo", file: p });
  }
  // ảnh CCCD trên hồ sơ nhân sự
  const ids = parsed.filter((p) => p.code === "CM" || p.code === "CCDT").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.code === "CM" ? 1 : -1) - (b.code === "CM" ? 1 : -1));
  if (ids.length && !emp.doc.extraFiles?.cccdImage) actions.push({ emp, op: "cccdImage", file: ids[ids.length - 1] });

  // chứng chỉ: gom theo (loại, tiêu đề, ngày) -> 1 chứng chỉ; các trang -1, -2 là tệp bổ sung
  const groups = new Map();
  for (const p of parsed) {
    if (p.code === "HT") continue;
    const kind = kindOf(p.code);
    if (!kind) { log(emp, p.file, "BO QUA", `mã loại chưa có quy ước: ${p.code}`); continue; }
    let issueDate = null, expiryDate = null, number = "", title = kind.title;
    if (kind.key === "expiry") expiryDate = p.date;
    else if (kind.key === "issue") { issueDate = p.date; expiryDate = kind.noExpiry || !p.date ? null : addYears(p.date, kind.years); }
    else if (kind.key === "contract") { if (/KXDTH/i.test(p.suffix)) issueDate = p.date; else expiryDate = p.date; }
    else if (kind.key === "insurance") {
      const policy = insuranceMap.get(p.file);
      if (policy) { issueDate = policy.start; expiryDate = policy.end; number = policy.number; title = policy.title; }
      else expiryDate = p.date;
    } else if (kind.key === "cccd") { issueDate = p.date; expiryDate = p.date ? cccdExpiry(p.date, emp.doc.dob) : null; }
    const gk = `${kind.type}|${title ?? ""}|${issueDate}|${expiryDate}`;
    if (!groups.has(gk)) groups.set(gk, { kind, title, issueDate, expiryDate, number, files: [] });
    groups.get(gk).files.push(p);
  }
  // CCCD: số chỉ ghi cho thẻ mới nhất, khớp số trên hồ sơ
  const cccdGroups = [...groups.values()].filter((g) => g.kind.type === "custom-ctype-cccd").sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));
  if (cccdGroups.length && emp.cccd) cccdGroups[cccdGroups.length - 1].number = emp.cccd;

  const sortKey = (g) => g.expiryDate ?? g.issueDate ?? "";
  const list = [...groups.values()].sort((a, b) => sortKey(b).localeCompare(sortKey(a))); // mới trước
  const newerInSlot = new Map(); // slot -> id chứng chỉ mới hơn vừa xử lý
  for (const g of list) {
    // CM trước CCDT, trang nhỏ trước
    g.files.sort((a, b) => (a.code === "CM" ? 0 : 1) - (b.code === "CM" ? 0 : 1) || a.page - b.page || a.file.localeCompare(b.file));
    const pending = g.files.filter((f) => !knownNames.has(f.file));
    for (const f of g.files) if (knownNames.has(f.file)) log(emp, f.file, "DA CO", "tệp đã có trên web");
    if (!pending.length) continue;
    const type = g.kind.type;
    const sameType = empCerts.filter((c) => c.type === type && c.state !== "archived");
    // 1) khớp chứng chỉ có sẵn theo ngày
    const match = sameType.find((c) => (g.kind.key === "insurance" ? (c.issueDate === g.issueDate && c.expiryDate === g.expiryDate) || (!!g.expiryDate && c.expiryDate === g.expiryDate)
      : g.kind.key === "expiry" ? !!g.expiryDate && c.expiryDate === g.expiryDate && (g.title === null || normTitle(c.title) === normTitle(g.title) || !c.document)
      : g.kind.key === "contract" ? (g.issueDate ? c.issueDate === g.issueDate : c.expiryDate === g.expiryDate)
      : !!g.issueDate && c.issueDate === g.issueDate));
    // ATLĐ / ATVSLĐ: mỗi tiêu đề (Xây dựng, Trên cao, Nhóm 1…) là một suất riêng; các loại khác (kể cả bảo hiểm) một suất
    const titled = ["atld", VSLD].includes(type);
    const slotOf = (c) => (titled ? `${type}|${normTitle(c.title)}` : type);
    const slot = titled ? `${type}|${normTitle(g.title)}` : type;
    if (match) {
      actions.push({ emp, op: "attach", cert: match, group: g, files: pending });
      newerInSlot.set(slotOf(match), match.id);
      continue;
    }
    const current = titled ? sameType.find((c) => c.state === "current" && slotOf(c) === slot)
      : sameType.filter((c) => c.state === "current").sort((a, b) => (b.expiryDate ?? "9999").localeCompare(a.expiryDate ?? "9999"))[0];
    // Giấy khám ghi ngày ở tương lai: không đoán ngày, gắn làm tệp bổ sung của giấy khám hiện hành
    if (type === "health" && g.issueDate > TODAY && current) {
      actions.push({ emp, op: "attach", cert: current, group: g, files: pending, note: "ngày khám trên tên tệp ở tương lai, gắn làm tệp bổ sung" });
      continue;
    }
    const placeholder = current && !current.document && !current.number;
    const curKey = current ? (g.kind.key === "issue" || g.kind.key === "cccd" ? current.issueDate : current.expiryDate) ?? "" : "";
    const myKey = g.kind.key === "issue" || g.kind.key === "cccd" ? g.issueDate ?? "" : sortKey(g);
    const isNewestHere = !newerInSlot.has(slot);
    // HĐLĐ: hợp đồng không xác định thời hạn thay cho dòng nhập từ Excel; hợp đồng có hạn chỉ thay khi không cũ hơn
    const contractNewer = g.kind.key === "contract" && current && (!g.expiryDate || !current.expiryDate || g.expiryDate >= current.expiryDate);
    if (!current) {
      const id = randomUUID();
      actions.push({ emp, op: "insert", id, group: g, files: pending, state: isNewestHere ? "current" : "replaced", replacedBy: newerInSlot.get(slot) ?? null, title: g.title ?? "" });
      newerInSlot.set(slot, id);
    } else if (isNewestHere && placeholder && (g.kind.key === "contract" ? contractNewer : myKey >= curKey)) {
      actions.push({ emp, op: "update", cert: current, group: g, files: pending });
      newerInSlot.set(slot, current.id);
    } else if (isNewestHere && (g.kind.key === "contract" ? contractNewer && g.expiryDate !== current.expiryDate : myKey > curKey)) {
      const id = randomUUID();
      actions.push({ emp, op: "renew", cert: current, id, group: g, files: pending });
      newerInSlot.set(slot, id);
    } else {
      const id = randomUUID();
      actions.push({ emp, op: "insert", id, group: g, files: pending, state: "replaced", replacedBy: newerInSlot.get(slot) ?? current.id, title: current.title ?? g.title ?? "" });
      newerInSlot.set(slot, id);
    }
  }
}

// ---------- báo cáo kế hoạch ----------
const OP_LABEL = { photo: "ANH 3x4", cccdImage: "ANH CCCD HO SO", attach: "GAN VAO CC CO SAN", update: "CAP NHAT CC (ngay + tep)", renew: "GIA HAN (CC moi, cu -> thay the)", insert: "THEM CC" };
for (const a of actions) {
  const g = a.group;
  const files = a.files ?? [a.file];
  const detail = (a.note ? `${a.note} | ` : "") + (g ? `${g.kind.type}` : "") + (g ? `${g.title ? ` / ${g.title}` : ""} | cấp ${g.issueDate ?? "-"} | hạn ${g.expiryDate ?? "-"}${g.number ? ` | số ${g.number}` : ""}${a.state ? ` | ${a.state}` : ""}${a.cert ? ` | CC có sẵn hạn ${a.cert.expiryDate ?? "-"} cấp ${a.cert.issueDate ?? "-"}` : ""}` : "");
  for (const f of files) log(a.emp, f.file, OP_LABEL[a.op], detail);
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const reportPath = path.join(root, `_day-len-web_${apply ? "thuc-hien" : "chay-thu"}_${stamp}.csv`);
const writeReport = () => fs.writeFileSync(reportPath, "\uFEFFma,ten,tep,hanh dong,chi tiet\n" + report.map((r) => [r.code, r.name, r.file, r.action, r.detail].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"));
writeReport();
const count = (k) => report.filter((r) => r.action === k).length;
console.log(`Thư mục nhân sự: ${folders.length} (có trên web: ${plans.length}; chưa có trên web: ${notInDb} thư mục / ${notInDbFiles} tệp)`);
console.log(Object.entries(Object.groupBy(report, (r) => r.action)).map(([k, v]) => `  ${k}: ${v.length}`).join("\n"));
console.log(`Báo cáo: ${reportPath}`);
if (!apply) process.exit(0);

// ---------- ghi thật ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hoso-"));
function bytesFor(f) {
  if (f.size <= MAX_BYTES) return fs.readFileSync(f.full);
  if (f.mime !== "application/pdf") throw new Error(`ảnh lớn hơn 10 MB`);
  const out = path.join(tmp, `${randomUUID()}.pdf`);
  execFileSync("python", ["-I", path.join(import.meta.dirname, "compress-pdf.py"), f.full, out, String(MAX_BYTES)], { stdio: "pipe" });
  const buf = fs.readFileSync(out);
  if (buf.length > MAX_BYTES) throw new Error(`nén xong vẫn ${(buf.length / 1048576).toFixed(1)} MB`);
  return buf;
}
const uploaded = [];
async function upload(folder, f) {
  const bytes = bytesFor(f);
  const ref = { id: randomUUID(), name: f.file, mime: f.mime, size: bytes.length };
  const { error } = await db.storage.from(BUCKET).upload(`${folder}/${ref.id}`, bytes, { contentType: f.mime, upsert: false });
  if (error) throw new Error(`tải tệp lỗi: ${error.message}`);
  uploaded.push(`${folder}/${ref.id}`);
  return ref;
}
async function audit(action, entityType, entityId, before, after) {
  const event = { id: randomUUID(), at: new Date().toISOString(), role: "admin", actorId: ACTOR, action, entityType, entityId, before, after };
  const { error } = await db.from("audit_events").insert({ id: event.id, at: event.at, actor_id: ACTOR, action, entity_type: entityType, entity_id: entityId, doc: event });
  if (error) throw new Error(`audit: ${error.message}`);
}
const certRow = (c) => ({ id: c.id, version: c.version, employee_id: c.employeeId, type: c.type, state: c.state, expiry_date: c.expiryDate, doc: c });
async function saveCert(before, value) {
  const { data, error } = await db.from("certificates").update(certRow(value)).eq("id", value.id).eq("version", before.version).select("id");
  if (error || !data?.length) throw new Error(`cập nhật chứng chỉ lỗi: ${error?.message ?? "bản ghi vừa bị sửa"}`);
}
async function insertCert(value) {
  const { error } = await db.from("certificates").insert(certRow(value));
  if (error) throw new Error(`thêm chứng chỉ lỗi: ${error.message}`);
}
const supp = (refs) => refs.map((file) => ({ file, label: null }));
const empState = new Map(employees.map((e) => [e.id, e]));
const certState = new Map(certs.map((c) => [c.id, c]));

let done = 0, failed = 0;
const results = new Map(); // action -> ok/error
async function run(a) {
  const g = a.group;
  if (a.op === "photo" || a.op === "cccdImage") {
    const emp = empState.get(a.emp.id);
    const ref = await upload("employees", a.file);
    const version = emp.version + 1;
    const doc = a.op === "photo" ? { ...emp.doc, photo: ref, version } : { ...emp.doc, extraFiles: { ...(emp.doc.extraFiles ?? {}), cccdImage: ref }, version };
    const { data, error } = await db.from("employees").update({ version, doc }).eq("id", emp.id).eq("version", emp.version).select("id");
    if (error || !data?.length) throw new Error(`cập nhật nhân sự lỗi: ${error?.message ?? "bản ghi vừa bị sửa"}`);
    await audit("employee.update", "employee", emp.id, emp.doc, doc);
    empState.set(emp.id, { ...emp, version, doc });
    return;
  }
  const refs = [];
  for (const f of a.files) refs.push(await upload("certificates", f));
  if (a.op === "attach" || a.op === "update") {
    const before = certState.get(a.cert.id);
    let document = before.document, extra = refs;
    if (!document && !a.note) { document = refs[0]; extra = refs.slice(1); }
    const value = { ...before, document, supplementaryFiles: [...(before.supplementaryFiles ?? []), ...supp(extra)].slice(0, 10), version: before.version + 1 };
    if (a.op === "update") {
      // Ngày theo tệp; tệp chỉ ghi ngày hết hạn thì giữ ngày cấp cũ nếu vẫn hợp lệ
      const issueDate = g.issueDate ?? (before.issueDate && (!g.expiryDate || before.issueDate <= g.expiryDate) ? before.issueDate : null);
      Object.assign(value, { issueDate, expiryDate: g.expiryDate, number: g.number || before.number, title: before.title || g.title || "" });
    } else if (!a.note) Object.assign(value, { issueDate: before.issueDate ?? g.issueDate, expiryDate: before.expiryDate ?? g.expiryDate, number: before.number || g.number });
    await saveCert(before, value);
    await audit(a.op === "attach" ? "certificate.attachments.update" : "certificate.update", "certificate", value.id, before, value);
    certState.set(value.id, value);
  } else if (a.op === "renew") {
    const before = certState.get(a.cert.id);
    const value = { id: a.id, employeeId: a.emp.id, type: before.type, title: (before.type === "ins" ? g.title : null) ?? before.title ?? "", number: g.number, issueDate: g.issueDate, expiryDate: g.expiryDate, document: refs[0], supplementaryFiles: supp(refs.slice(1)), state: "current", version: 1, replacedBy: null, archiveReason: null, safetyGroup: before.safetyGroup ?? null };
    const old = { ...before, state: "replaced", replacedBy: a.id, version: before.version + 1 };
    await saveCert(before, old);
    await insertCert(value);
    await audit("certificate.renew", "certificate", value.id, before, value);
    certState.set(old.id, old); certState.set(value.id, value);
  } else if (a.op === "insert") {
    const value = { id: a.id, employeeId: a.emp.id, type: g.kind.type, title: a.title, number: g.number, issueDate: g.issueDate, expiryDate: g.expiryDate, document: refs[0], supplementaryFiles: supp(refs.slice(1)), state: a.state, version: 1, replacedBy: a.replacedBy, archiveReason: null, safetyGroup: null };
    await insertCert(value);
    await audit("certificate.add", "certificate", value.id, null, value);
    certState.set(value.id, value);
  }
}
// theo từng nhân sự tuần tự (giữ đúng thứ tự mới -> cũ), nhiều nhân sự song song
const byEmp = Object.values(Object.groupBy(actions, (a) => a.emp.id));
let cursor = 0;
async function worker() {
  while (cursor < byEmp.length) {
    const list = byEmp[cursor++];
    for (const a of list) {
      try { await run(a); results.set(a, "OK"); done++; }
      catch (e) { results.set(a, `LOI: ${e.message}`); failed++; console.error(`  ${a.emp.code} ${a.op}: ${e.message}`); }
    }
    process.stdout.write(`\r  đã xong ${done}, lỗi ${failed} / ${actions.length}   `);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log();
for (const r of report) {
  const a = actions.find((x) => x.emp.code === r.code && (x.files ?? [x.file]).some((f) => f.file === r.file) && OP_LABEL[x.op] === r.action);
  if (a) r.detail += ` | ${results.get(a) ?? "CHUA CHAY"}`;
}
writeReport();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Hoàn tất: ${done} thao tác thành công, ${failed} lỗi. Báo cáo: ${reportPath}`);
if (failed) process.exit(1);
