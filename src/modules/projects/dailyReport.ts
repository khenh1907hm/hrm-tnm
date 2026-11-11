/**
 * Báo cáo ngày của dự án (mẫu "BC ngày"): đọc từ ảnh bảng phân công (scripts/daily_report/read_board.py),
 * chỉ huy trưởng kiểm tra / sửa, rồi máy chủ điền Excel kèm tối đa 4 ảnh và gửi Telegram. Chỉ lưu dữ liệu, không lưu ảnh.
 */

/** Một tên đọc từ bảng, đã so với danh sách công nhân dự án. */
export type NameConfidence = "exact" | "accent" | "fuzzy" | "none" | "manual";
export type NameRef = { text: string; name: string; matched: boolean; confidence: NameConfidence; fullName?: string; employeeId?: string | null };
export type DailyTaskDraft = { no: number; task: string; leader: NameRef | null; members: NameRef[] };
export type DailyReportDraft = {
  date: string;
  total: number | null;
  present: number | null;
  absent: number | null;
  absentNames: NameRef[];
  otCount: number;
  otHours: number;
  tasks: DailyTaskDraft[];
  /** Mô hình đã đọc ảnh ("" khi nhập tay). */
  model: string;
};

/** Báo cáo đã lưu (dữ liệu thuần, tên đã chốt). */
export type DailyTask = { no: number; task: string; leader: string; members: string[] };
export type DailyReport = {
  id: string;
  projectId: string;
  date: string;
  total: number | null;
  present: number | null;
  absent: number | null;
  absentNames: string[];
  otCount: number;
  otHours: number;
  tasks: DailyTask[];
  photoCount: number;
  createdByName: string;
  sentAt: string | null;
  sentError: string;
};
export type DailyReportInput = Omit<DailyReport, "id" | "projectId" | "createdByName" | "sentAt" | "sentError"> & { model: string };
export type DailyReportSaved = { id: string; projectCode: string; projectName: string; cumulativeWorkdays: number; cumulativeOtHours: number };

/** Mẫu Excel có 12 dòng công việc, khung 4 ảnh. */
export const DAILY_MAX_TASKS = 12;
export const DAILY_MAX_PHOTOS = 4;

export const manualName = (text: string): NameRef => ({ text: text.trim(), name: text.trim(), matched: false, confidence: "manual" });

export const emptyDraft = (date: string): DailyReportDraft => ({
  date, total: null, present: null, absent: null, absentNames: [], otCount: 0, otHours: 0, model: "",
  tasks: [{ no: 1, task: "", leader: null, members: [] }],
});

/** Tên cần kiểm tra lại: đọc ra không khớp ai, hoặc khớp nhờ bỏ dấu / gần giống. */
export const needsCheck = (ref: NameRef) => ref.confidence === "none" || ref.confidence === "accent" || ref.confidence === "fuzzy";

export type DraftIssue = { level: "error" | "warn"; code: string; text: string };

/** DR-02: kiểm tra trước khi gửi. Lỗi chặn gửi; cảnh báo chỉ nhắc. */
export function draftIssues(draft: DailyReportDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) issues.push({ level: "error", code: "DR_DATE_REQUIRED", text: "Chọn ngày báo cáo." });
  const tasks = draft.tasks.filter((task) => task.task.trim() || task.members.length);
  if (!tasks.length) issues.push({ level: "error", code: "DR_TASKS_REQUIRED", text: "Cần ít nhất một công việc." });
  if (tasks.length > DAILY_MAX_TASKS) issues.push({ level: "error", code: "DR_TOO_MANY_TASKS", text: `Mẫu chỉ có ${DAILY_MAX_TASKS} dòng công việc.` });
  if (tasks.some((task) => !task.task.trim())) issues.push({ level: "error", code: "DR_TASK_NAME", text: "Có dòng chưa có tên công việc." });
  for (const value of [draft.total, draft.present, draft.absent, draft.otCount, draft.otHours]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) { issues.push({ level: "error", code: "DR_BAD_NUMBER", text: "Số người / giờ không được âm." }); break; }
  }
  if (draft.total !== null && draft.present !== null && draft.absent !== null && draft.present + draft.absent !== draft.total) {
    issues.push({ level: "warn", code: "DR_TOTAL_MISMATCH", text: `Hiện diện ${draft.present} + vắng ${draft.absent} ≠ tổng ${draft.total}.` });
  }
  if (draft.absent !== null && draft.absentNames.length && draft.absentNames.length !== draft.absent) {
    issues.push({ level: "warn", code: "DR_ABSENT_NAMES", text: `Ghi vắng ${draft.absent} người nhưng có ${draft.absentNames.length} tên.` });
  }
  const unsure = [...draft.absentNames, ...tasks.flatMap((task) => [...task.members, ...(task.leader ? [task.leader] : [])])].filter(needsCheck);
  if (unsure.length) issues.push({ level: "warn", code: "DR_CHECK_NAMES", text: `${unsure.length} tên cần kiểm tra lại (tô màu).` });
  return issues;
}

/** Chốt bản nháp thành dữ liệu lưu / điền mẫu: bỏ dòng trống, đánh lại số thứ tự. */
export function toInput(draft: DailyReportDraft, photoCount: number): DailyReportInput {
  const tasks = draft.tasks.filter((task) => task.task.trim() || task.members.length).map((task, index) => ({
    no: index + 1, task: task.task.trim(), leader: task.leader?.name.trim() ?? "", members: task.members.map((member) => member.name.trim()).filter(Boolean),
  }));
  return {
    date: draft.date, total: draft.total, present: draft.present, absent: draft.absent,
    absentNames: draft.absentNames.map((ref) => ref.name.trim()).filter(Boolean), otCount: draft.otCount, otHours: draft.otHours,
    tasks, photoCount: Math.min(Math.max(photoCount, 0), DAILY_MAX_PHOTOS), model: draft.model,
  };
}

/** Báo cáo cũ thành bản nháp để sửa / gửi lại ("Sao chép hôm qua"). */
export function draftFromReport(report: DailyReport, date: string): DailyReportDraft {
  return {
    date, total: report.total, present: report.present, absent: report.absent, otCount: report.otCount, otHours: report.otHours, model: "",
    absentNames: report.absentNames.map(manualName),
    tasks: report.tasks.map((task) => ({ no: task.no, task: task.task, leader: task.leader ? manualName(task.leader) : null, members: task.members.map(manualName) })),
  };
}

/** Lời nhắn kèm file trên Telegram. */
export function telegramCaption(input: Pick<DailyReportInput, "date" | "total" | "present" | "absent" | "otCount" | "otHours" | "tasks" | "absentNames">, project: { code: string; name: string }, sender: string): string {
  const dmy = input.date.split("-").reverse().join("/");
  const lines = [
    `📋 BÁO CÁO NGÀY ${dmy}`,
    `Dự án: ${project.code} · ${project.name}`,
    `TS ${input.total ?? "–"} · Hiện diện ${input.present ?? "–"} · Vắng ${input.absent ?? "–"}${input.absentNames.length ? ` (${input.absentNames.join(", ")})` : ""}`,
    `Tăng ca: ${input.otCount} người · ${input.otHours} giờ`,
    `${input.tasks.length} công việc${sender ? ` · Gửi bởi ${sender}` : ""}`,
  ];
  return lines.join("\n").slice(0, 1000);
}
