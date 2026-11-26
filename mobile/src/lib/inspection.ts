import { decode } from "base64-arraybuffer";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "./supabase";

/**
 * Báo cáo công trình (QHSE PHOTO REPORT), dùng chung bảng với web (src/modules/inspections/types.ts):
 * Sếp kiểm tra công trường chụp lỗi + khoanh tròn / ô vuông, ghi Vấn đề, Cách giải quyết, Thời gian hoàn thiện mong muốn;
 * trưởng dự án nhận thông báo, sửa xong chụp ảnh sau (khoanh được), ghi Comment, ngày hoàn thành (mặc định hôm nay).
 */
export type MarkShape = "circle" | "rect";
export type PhotoMark = { shape: MarkShape; x: number; y: number; w: number; h: number; color?: string };
export const MARK_COLOR = "#ef2b2b";
export type InspectionStatus = "draft" | "open" | "fixed" | "closed";
export const STATUS_LABEL: Record<InspectionStatus, string> = { draft: "Nháp", open: "Chờ khắc phục", fixed: "Đã khắc phục, chờ kiểm tra", closed: "Đã đóng" };

/** Ảnh: đã tải lên (path) hoặc mới chụp trên máy (uri). */
export type Photo = { path?: string | null; uri?: string; width?: number; height?: number };
export type Item = {
  id: string; seq: number; location: string; foundTime: string; problem: string; countermeasure: string; targetDate: string | null;
  before: Photo | null; beforeMarks: PhotoMark[]; after: Photo | null; afterMarks: PhotoMark[]; comment: string; finishDate: string | null; fixedByName: string;
};
export type Inspection = {
  id: string; projectId: string; number: string; checkDate: string; reporterId: string; reporterName: string;
  attentionEmployeeId: string | null; attentionName: string; cc: string; status: InspectionStatus; items: Item[];
};
export type InspectionProject = { projectId: string; code: string; name: string; site: string; pmEmployeeId: string | null; pmName: string };

const BUCKET = "site-inspection-photos";
type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const opt = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function parseMarks(raw: unknown): PhotoMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).flatMap((item) => {
    const m = (item ?? {}) as Row;
    if (m.shape !== "circle" && m.shape !== "rect") return [];
    const x = clamp(Number(m.x)), y = clamp(Number(m.y));
    const w = Math.min(clamp(Number(m.w)), 1 - x), h = Math.min(clamp(Number(m.h)), 1 - y);
    return w < 0.005 || h < 0.005 ? [] : [{ shape: m.shape, x, y, w, h }];
  });
}
export function markFromDrag(shape: MarkShape, from: { x: number; y: number }, to: { x: number; y: number }): PhotoMark | null {
  const x = clamp(Math.min(from.x, to.x)), y = clamp(Math.min(from.y, to.y));
  const w = clamp(Math.abs(to.x - from.x)), h = clamp(Math.abs(to.y - from.y));
  if (w < 0.01 && h < 0.01) return null;
  return { shape, x, y, w: Math.max(w, 0.02), h: Math.max(h, 0.02) };
}

const fail = (error: { message: string } | null) => {
  if (!error) return;
  const known: Record<string, string> = {
    FORBIDDEN: "Bạn không có quyền với báo cáo này.", INSPECTION_NO_ITEMS: "Chưa có lỗi nào trong báo cáo.", INSPECTION_NO_ASSIGNEE: "Dự án chưa có trưởng dự án (PM) để giao.",
    INSPECTION_ITEMS_NOT_FIXED: "Còn lỗi chưa có ảnh sau / ngày hoàn thành.",
  };
  throw new Error(Object.entries(known).find(([code]) => error.message.includes(code))?.[1] ?? error.message);
};
const toItem = (row: Row): Item => ({
  id: str(row.id), seq: Number(row.seq ?? 1), location: str(row.location), foundTime: str(row.found_time), problem: str(row.problem), countermeasure: str(row.countermeasure),
  targetDate: opt(row.target_date), before: row.before_photo ? { path: str(row.before_photo) } : null, beforeMarks: parseMarks(row.before_marks),
  after: row.after_photo ? { path: str(row.after_photo) } : null, afterMarks: parseMarks(row.after_marks), comment: str(row.comment), finishDate: opt(row.finish_date), fixedByName: str(row.fixed_by_name),
});
const toInspection = (row: Row): Inspection => ({
  id: str(row.id), projectId: str(row.project_id), number: str(row.number), checkDate: str(row.check_date), reporterId: str(row.reporter_id), reporterName: str(row.reporter_name),
  attentionEmployeeId: opt(row.attention_employee_id), attentionName: str(row.attention_name), cc: str(row.cc), status: str(row.status) as InspectionStatus,
  items: ((row.site_inspection_items ?? []) as Row[]).map(toItem).sort((a, b) => a.seq - b.seq),
});

export async function canCreate(): Promise<boolean> { const { data } = await supabase.rpc("site_inspection_can_create"); return data === true; }
export async function loadProjects(): Promise<InspectionProject[]> {
  const { data, error } = await supabase.rpc("site_inspection_projects");
  fail(error);
  return ((data ?? []) as Row[]).map((r) => ({ projectId: str(r.project_id), code: str(r.code), name: str(r.name), site: str(r.site), pmEmployeeId: opt(r.pm_employee_id), pmName: str(r.pm_name) }));
}
export async function myEmployeeId(): Promise<string | null> {
  const { data } = await supabase.rpc("my_account");
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
  return row?.employee_id ? str(row.employee_id) : null;
}
export async function loadList(): Promise<Inspection[]> {
  const { data, error } = await supabase.from("site_inspections").select("*, site_inspection_items(*)").order("check_date", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  fail(error);
  return ((data ?? []) as Row[]).map(toInspection);
}
export async function loadOne(id: string): Promise<Inspection | null> {
  const { data, error } = await supabase.from("site_inspections").select("*, site_inspection_items(*)").eq("id", id).maybeSingle();
  fail(error);
  return data ? toInspection(data as Row) : null;
}
export async function create(project: InspectionProject, checkDate: string, cc: string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("site_inspections").insert({ project_id: project.projectId, check_date: checkDate, reporter_id: auth.user?.id, number: "", attention_employee_id: project.pmEmployeeId, attention_name: project.pmName, cc }).select("id").single();
  fail(error);
  return str((data as Row).id);
}
export async function remove(id: string) { const { error } = await supabase.from("site_inspections").delete().eq("id", id); fail(error); }
export async function removeItem(id: string) { const { error } = await supabase.from("site_inspection_items").delete().eq("id", id); fail(error); }
export async function submit(id: string) { const { error } = await supabase.rpc("site_inspection_submit", { p_id: id }); fail(error); }
export async function markFixed(id: string) { const { error } = await supabase.rpc("site_inspection_mark_fixed", { p_id: id }); fail(error); }
export async function close(id: string, reopen = false) { const { error } = await supabase.rpc("site_inspection_close", { p_id: id, p_reopen: reopen }); fail(error); }

/** Thu nhỏ cạnh dài 1600 px, JPEG ~80% rồi tải lên <phiếu>/<người tải>/…; trả về đường dẫn. */
async function upload(inspectionId: string, photo: Photo): Promise<string> {
  if (photo.path) return photo.path;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Cần đăng nhập.");
  const context = ImageManipulator.manipulate(photo.uri!);
  const w = photo.width ?? 0, h = photo.height ?? 0;
  if (Math.max(w, h) > 1600 || !w) context.resize(w >= h ? { width: 1600 } : { height: 1600 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error("Không đọc được ảnh.");
  const path = `${inspectionId}/${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const result = await supabase.storage.from(BUCKET).upload(path, decode(saved.base64), { contentType: "image/jpeg", upsert: false });
  if (result.error) throw new Error(`Chưa tải được ảnh: ${result.error.message}`);
  return path;
}

export async function saveBefore(inspectionId: string, item: Item) {
  if (!item.before || item.problem.trim().length < 2) throw new Error("Cần ảnh lỗi và nội dung Vấn đề.");
  const path = await upload(inspectionId, item.before);
  const body = { inspection_id: inspectionId, seq: item.seq, location: item.location.trim(), found_time: item.foundTime.trim(), problem: item.problem.trim(), countermeasure: item.countermeasure.trim(), target_date: item.targetDate, before_photo: path, before_marks: item.beforeMarks };
  const { error } = item.id ? await supabase.from("site_inspection_items").update(body).eq("id", item.id) : await supabase.from("site_inspection_items").insert(body);
  fail(error);
}
export async function saveAfter(inspectionId: string, item: Item, fixer: string) {
  if (!item.after) throw new Error("Chụp ảnh sau khi sửa.");
  const path = await upload(inspectionId, item.after);
  const { error } = await supabase.from("site_inspection_items").update({ after_photo: path, after_marks: item.afterMarks, comment: item.comment.trim(), finish_date: item.finishDate, fixed_by_name: fixer, fixed_at: new Date().toISOString() }).eq("id", item.id);
  fail(error);
}
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(list, 3600);
  const map: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  return map;
}
export function submitIssue(inspection: Pick<Inspection, "items" | "attentionEmployeeId">): string | null {
  if (!inspection.items.length) return "Thêm ít nhất một lỗi (ảnh + vấn đề).";
  if (!inspection.attentionEmployeeId) return "Dự án chưa có trưởng dự án để giao.";
  return null;
}
export function fixIssue(items: readonly Item[]): string | null {
  const missing = items.findIndex((item) => !item.after || !item.finishDate);
  return missing >= 0 ? `Lỗi ${missing + 1}: cần ảnh sau khi sửa và ngày hoàn thành.` : null;
}
