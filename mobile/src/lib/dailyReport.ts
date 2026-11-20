import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import { apiFetch } from "./auth";
import { supabase } from "./supabase";

/**
 * Báo cáo ngày của dự án, dùng chung với web (src/modules/projects/dailyReport.ts):
 * lưu bằng daily_report_save, rồi máy chủ VPS (/api/daily-report/send) điền mẫu Excel kèm ảnh thi công và gửi Telegram.
 * Chỉ PM / CHT của dự án (hoặc người quản lý dự án) mới lập được.
 */
export const MAX_TASKS = 12;
export const MAX_PHOTOS = 12;

export type ReportProject = { projectId: string; code: string; name: string; site: string };
export type RosterPerson = { name: string; code: string; team: string };
export type Task = { task: string; leader: string; members: string[] };
export type Draft = {
  date: string;
  total: number | null;
  present: number | null;
  absent: number | null;
  absentNames: string[];
  otCount: number;
  otHours: number;
  tasks: Task[];
};
export type SavedReport = Draft & { id: string; sentAt: string | null; sentError: string; createdByName: string };
export type Photo = { uri: string; width: number; height: number };

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const emptyDraft = (date: string): Draft => ({ date, total: null, present: null, absent: null, absentNames: [], otCount: 0, otHours: 0, tasks: [{ task: "", leader: "", members: [] }] });

export async function loadReportProjects(): Promise<ReportProject[]> {
  const { data, error } = await supabase.rpc("my_daily_report_projects");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ projectId: str(row.project_id), code: str(row.code), name: str(row.name), site: str(row.site) }));
}

export async function loadRoster(projectId: string): Promise<RosterPerson[]> {
  const { data, error } = await supabase.rpc("daily_report_roster", { p_project: projectId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ name: str(row.name), code: str(row.code), team: str(row.team) })).filter((p) => p.name);
}

export async function loadRecentReports(projectId: string): Promise<SavedReport[]> {
  const { data, error } = await supabase.from("project_daily_reports").select("*").eq("project_id", projectId).order("report_date", { ascending: false }).limit(14);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id), date: str(row.report_date), total: numOrNull(row.total), present: numOrNull(row.present), absent: numOrNull(row.absent),
    absentNames: ((row.absent_names ?? []) as unknown[]).map(String), otCount: Number(row.ot_count ?? 0), otHours: Number(row.ot_hours ?? 0),
    tasks: Array.isArray(row.tasks) ? (row.tasks as Row[]).map((t) => ({ task: str(t.task), leader: str(t.leader), members: ((t.members ?? []) as unknown[]).map(String) })) : [],
    sentAt: row.sent_at ? str(row.sent_at) : null, sentError: str(row.sent_error), createdByName: str(row.created_by_name),
  }));
}

export type Issue = { level: "error" | "warn"; text: string };

/** Kiểm tra trước khi gửi (giống web DR-02). Lỗi chặn gửi, cảnh báo chỉ nhắc. */
export function issuesOf(draft: Draft): Issue[] {
  const issues: Issue[] = [];
  const tasks = draft.tasks.filter((t) => t.task.trim() || t.members.length);
  if (!tasks.length) issues.push({ level: "error", text: "Cần ít nhất một công việc." });
  if (tasks.some((t) => !t.task.trim())) issues.push({ level: "error", text: "Có dòng chưa ghi tên công việc." });
  if (tasks.length > MAX_TASKS) issues.push({ level: "error", text: `Mẫu chỉ có ${MAX_TASKS} dòng công việc.` });
  if (draft.total !== null && draft.present !== null && draft.absent !== null && draft.present + draft.absent !== draft.total) {
    issues.push({ level: "warn", text: `Hiện diện ${draft.present} + vắng ${draft.absent} khác tổng ${draft.total}.` });
  }
  if (draft.absent !== null && draft.absentNames.length && draft.absentNames.length !== draft.absent) {
    issues.push({ level: "warn", text: `Ghi vắng ${draft.absent} người nhưng có ${draft.absentNames.length} tên.` });
  }
  return issues;
}

function caption(input: Draft & { tasks: { task: string }[] }, project: { code: string; name: string }): string {
  return [
    `📋 BÁO CÁO NGÀY ${input.date.split("-").reverse().join("/")}`,
    `Dự án: ${project.code} · ${project.name}`,
    `TS ${input.total ?? "–"} · Hiện diện ${input.present ?? "–"} · Vắng ${input.absent ?? "–"}${input.absentNames.length ? ` (${input.absentNames.join(", ")})` : ""}`,
    `Tăng ca: ${input.otCount} người · ${input.otHours} giờ`,
    `${input.tasks.length} công việc · Gửi từ app điện thoại`,
  ].join("\n").slice(0, 1000);
}

/** Thu nhỏ ảnh thi công cạnh dài 1280 px để gửi nhanh. */
async function shrink(photo: Photo): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > 1280) context.resize(photo.width >= photo.height ? { width: 1280 } : { height: 1280 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  return saved.uri;
}

export type SendResult = { telegramSent: boolean; telegramError: string; cumulativeWorkdays: number; cumulativeOtHours: number };

export async function sendReport(projectId: string, draft: Draft, photos: Photo[]): Promise<SendResult> {
  const tasks = draft.tasks.filter((t) => t.task.trim() || t.members.length).map((t, i) => ({ no: i + 1, task: t.task.trim(), leader: t.leader.trim(), members: t.members.map((m) => m.trim()).filter(Boolean) }));
  const input = { ...draft, absentNames: draft.absentNames.map((n) => n.trim()).filter(Boolean), tasks, photoCount: Math.min(photos.length, MAX_PHOTOS), model: "" };

  const { data, error } = await supabase.rpc("daily_report_save", {
    p_project: projectId, p_date: input.date, p_total: input.total, p_present: input.present, p_absent: input.absent, p_absent_names: input.absentNames,
    p_ot_count: input.otCount, p_ot_hours: input.otHours, p_tasks: input.tasks, p_photo_count: input.photoCount, p_model: "",
  });
  if (error) throw new Error(error.message);
  const saved = ((data ?? []) as Row[])[0];
  if (!saved) throw new Error("DR_NOT_FOUND");
  const reportId = str(saved.id);
  const project = { code: str(saved.project_code), name: str(saved.project_name) };
  const cumulativeWorkdays = Number(saved.cumulative_workdays ?? 0);
  const cumulativeOtHours = Number(saved.cumulative_ot_hours ?? 0);

  const body = new FormData();
  body.append("project", projectId);
  body.append("data", JSON.stringify({ ...input, projectCode: project.code, projectName: project.name, cumulativeWorkdays, cumulativeOtHours, caption: caption(input, project) }));
  for (const [index, photo] of photos.slice(0, MAX_PHOTOS).entries()) {
    const uri = await shrink(photo);
    if (Platform.OS === "web") body.append("photos", await (await fetch(uri)).blob(), `anh-${index + 1}.jpg`);
    else body.append("photos", { uri, name: `anh-${index + 1}.jpg`, type: "image/jpeg" } as unknown as Blob);
  }

  type Reply = { ok?: boolean; message?: string; sent?: boolean; telegramError?: string };
  let result: Reply;
  try {
    const response = await apiFetch("/api/daily-report/send", { method: "POST", body });
    const reply = (await response.json().catch(() => null)) as Reply | null;
    if (!response.ok || !reply?.ok) throw new Error(reply?.message ?? "Máy chủ chưa tạo được file báo cáo.");
    result = reply;
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : "Máy chủ chưa tạo được file báo cáo.";
    await supabase.rpc("daily_report_mark_sent", { p_id: reportId, p_error: message });
    throw new Error(`Đã lưu báo cáo nhưng chưa gửi được: ${message}`);
  }
  await supabase.rpc("daily_report_mark_sent", { p_id: reportId, p_error: result.sent ? "" : result.telegramError ?? "" });
  return { telegramSent: Boolean(result.sent), telegramError: result.telegramError ?? "", cumulativeWorkdays, cumulativeOtHours };
}
