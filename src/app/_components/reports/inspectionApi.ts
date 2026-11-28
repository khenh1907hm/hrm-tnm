"use client";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { parseMarks, type Inspection, type InspectionItem, type InspectionProject, type InspectionStatus, type PhotoMark } from "../../../modules/inspections/types";

/** Gọi Supabase cho Báo cáo công trình (bảng site_inspections, site_inspection_items, kho ảnh site-inspection-photos). */
const BUCKET = "site-inspection-photos";
type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const opt = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error("Báo cáo công trình cần đăng nhập (chế độ thật).");
  return value;
}
const fail = (error: { message: string } | null) => {
  if (!error) return;
  const known: Record<string, string> = {
    FORBIDDEN: "Bạn không có quyền với báo cáo này.", INSPECTION_NO_ITEMS: "Chưa có lỗi nào trong báo cáo.", INSPECTION_NO_ASSIGNEE: "Chưa chọn người khắc phục (trưởng dự án).",
    INSPECTION_ITEMS_NOT_FIXED: "Còn lỗi chưa có ảnh sau / ngày hoàn thành.", INSPECTION_NOT_DRAFT: "Báo cáo đã gửi.",
  };
  throw new Error(Object.entries(known).find(([code]) => error.message.includes(code))?.[1] ?? error.message);
};

const toItem = (row: Row): InspectionItem => ({
  id: str(row.id), seq: Number(row.seq ?? 1), location: str(row.location), foundTime: str(row.found_time), problem: str(row.problem), countermeasure: str(row.countermeasure),
  targetDate: opt(row.target_date), beforePhoto: opt(row.before_photo), beforeMarks: parseMarks(row.before_marks), afterPhoto: opt(row.after_photo), afterMarks: parseMarks(row.after_marks),
  comment: str(row.comment), finishDate: opt(row.finish_date), fixedByName: str(row.fixed_by_name), fixedAt: opt(row.fixed_at),
});
const toInspection = (row: Row): Inspection => ({
  id: str(row.id), projectId: str(row.project_id), number: str(row.number), checkDate: str(row.check_date), reporterId: str(row.reporter_id), reporterName: str(row.reporter_name),
  attentionEmployeeId: opt(row.attention_employee_id), attentionName: str(row.attention_name), cc: str(row.cc), status: str(row.status) as InspectionStatus, note: str(row.note),
  submittedAt: opt(row.submitted_at), fixedAt: opt(row.fixed_at), closedAt: opt(row.closed_at), createdAt: str(row.created_at),
  leftLogoId: opt(row.left_logo_id), showCertLogo: row.show_cert_logo !== false,
  items: ((row.site_inspection_items ?? []) as Row[]).map(toItem).sort((a, b) => a.seq - b.seq),
});

export async function canCreateInspection(): Promise<boolean> {
  const { data } = await client().rpc("site_inspection_can_create");
  return data === true;
}
export async function inspectionProjects(): Promise<InspectionProject[]> {
  const { data, error } = await client().rpc("site_inspection_projects");
  fail(error);
  return ((data ?? []) as Row[]).map((row) => {
    const pmEmployeeId = opt(row.pm_employee_id);
    const assigneeEmployeeId = row.assignee_employee_id === undefined ? pmEmployeeId : opt(row.assignee_employee_id);
    return {
      projectId: str(row.project_id), code: str(row.code), name: str(row.name), site: str(row.site), status: str(row.status), pmEmployeeId, pmName: str(row.pm_name),
      canCreate: row.can_create !== false, assigneeEmployeeId, assigneeName: row.assignee_name === undefined ? str(row.pm_name) : str(row.assignee_name),
      assigneeIsCommander: Boolean(assigneeEmployeeId) && assigneeEmployeeId !== pmEmployeeId && assigneeEmployeeId === opt(row.commander_employee_id),
    };
  });
}
export async function listInspections(projectId?: string | null): Promise<Inspection[]> {
  let query = client().from("site_inspections").select("*, site_inspection_items(*)").order("check_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  fail(error);
  return ((data ?? []) as Row[]).map(toInspection);
}
export async function getInspection(id: string): Promise<Inspection | null> {
  const { data, error } = await client().from("site_inspections").select("*, site_inspection_items(*)").eq("id", id).maybeSingle();
  fail(error);
  return data ? toInspection(data as Row) : null;
}

export async function createInspection(input: { projectId: string; checkDate: string; attentionEmployeeId: string | null; attentionName: string; cc: string }): Promise<string> {
  const { data: auth } = await client().auth.getUser();
  const { data, error } = await client().from("site_inspections").insert({
    project_id: input.projectId, check_date: input.checkDate, reporter_id: auth.user?.id, number: "",
    attention_employee_id: input.attentionEmployeeId, attention_name: input.attentionName, cc: input.cc,
  }).select("id").single();
  fail(error);
  return str((data as Row).id);
}
export async function updateHeader(id: string, patch: Partial<{ checkDate: string; attentionEmployeeId: string | null; attentionName: string; cc: string; note: string; leftLogoId: string | null; showCertLogo: boolean }>) {
  const body: Row = {};
  if (patch.checkDate !== undefined) body.check_date = patch.checkDate;
  if (patch.attentionEmployeeId !== undefined) body.attention_employee_id = patch.attentionEmployeeId;
  if (patch.attentionName !== undefined) body.attention_name = patch.attentionName;
  if (patch.cc !== undefined) body.cc = patch.cc;
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.leftLogoId !== undefined) body.left_logo_id = patch.leftLogoId;
  if (patch.showCertLogo !== undefined) body.show_cert_logo = patch.showCertLogo;
  const { error } = await client().from("site_inspections").update(body).eq("id", id);
  fail(error);
}
export async function deleteInspection(id: string) { const { error } = await client().from("site_inspections").delete().eq("id", id); fail(error); }

export type BeforeInput = { location: string; foundTime: string; problem: string; countermeasure: string; targetDate: string | null; beforePhoto: string | null; beforeMarks: PhotoMark[] };
export async function saveBefore(inspectionId: string, itemId: string | null, seq: number, input: BeforeInput) {
  const body = { inspection_id: inspectionId, seq, location: input.location.trim(), found_time: input.foundTime.trim(), problem: input.problem.trim(), countermeasure: input.countermeasure.trim(), target_date: input.targetDate, before_photo: input.beforePhoto, before_marks: input.beforeMarks };
  const { error } = itemId ? await client().from("site_inspection_items").update(body).eq("id", itemId) : await client().from("site_inspection_items").insert(body);
  fail(error);
}
export type AfterInput = { afterPhoto: string | null; afterMarks: PhotoMark[]; comment: string; finishDate: string | null };
export async function saveAfter(itemId: string, input: AfterInput, fixer: string) {
  const { error } = await client().from("site_inspection_items").update({ after_photo: input.afterPhoto, after_marks: input.afterMarks, comment: input.comment.trim(), finish_date: input.finishDate, fixed_by_name: fixer, fixed_at: new Date().toISOString() }).eq("id", itemId);
  fail(error);
}
export async function deleteItem(itemId: string) { const { error } = await client().from("site_inspection_items").delete().eq("id", itemId); fail(error); }

export async function submitInspection(id: string) { const { error } = await client().rpc("site_inspection_submit", { p_id: id }); fail(error); }
export async function markFixed(id: string) { const { error } = await client().rpc("site_inspection_mark_fixed", { p_id: id }); fail(error); }
export async function closeInspection(id: string, reopen = false) { const { error } = await client().rpc("site_inspection_close", { p_id: id, p_reopen: reopen }); fail(error); }

/** Thu nhỏ ảnh (cạnh dài 1600 px, JPEG) rồi tải lên <phiếu>/<người tải>/…; trả về đường dẫn trong kho. */
export async function uploadPhoto(inspectionId: string, file: Blob): Promise<string> {
  const supabase = client();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Cần đăng nhập.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không đọc được ảnh.")), "image/jpeg", 0.82));
  const path = `${inspectionId}/${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Chưa tải được ảnh: ${error.message}`);
  return path;
}
export async function photoUrls(paths: readonly string[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data } = await client().storage.from(BUCKET).createSignedUrls(list, 3600);
  return Object.fromEntries((data ?? []).filter((item) => item.path && item.signedUrl).map((item) => [item.path!, item.signedUrl as string]));
}
export async function photoBytes(path: string): Promise<Blob> {
  const { data, error } = await client().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("Không tải được ảnh.");
  return data;
}

/** Người được lập báo cáo (Sếp / Admin chỉnh). */
export async function listInspectors(): Promise<{ employeeId: string; code: string; name: string }[]> {
  const { data, error } = await client().rpc("site_inspectors_list");
  fail(error);
  return ((data ?? []) as Row[]).map((row) => ({ employeeId: str(row.employee_id), code: str(row.code), name: str(row.name) }));
}
export async function addInspector(employeeId: string) { const { error } = await client().from("site_inspectors").insert({ employee_id: employeeId }); fail(error); }
export async function removeInspector(employeeId: string) { const { error } = await client().from("site_inspectors").delete().eq("employee_id", employeeId); fail(error); }
