import { decode } from "base64-arraybuffer";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { addDays, todayISO } from "./dates";
import { supabase } from "./supabase";

/**
 * Lịch sử chấm công theo tháng + giải trình (dùng chung dữ liệu với web: my_attendance_month, attendance_requests).
 * Giờ công tính giống web (src/modules/projects/attendance.ts → hoursFromCheck): trừ nghỉ trưa, giờ thường trong ca, tăng ca sau giờ ra ca.
 */
export type MonthRow = {
  workDate: string; projectId: string; code: string; projectName: string;
  checkInAt: string | null; checkOutAt: string | null; source: "gps" | "explanation" | null;
  sheetStatus: string | null; regularHours: number | null; otHours: number | null;
  workStart: string; workEnd: string; lunchStart: string; lunchEnd: string; stdHours: number; weeklyOff: number[];
};

export type ReasonCode = "forgot" | "outside_work" | "cannot_check" | "wrong_shift" | "other";
export const REASONS: { code: ReasonCode; label: string; hint: string }[] = [
  { code: "forgot", label: "Quên chấm công", hint: "Có đi làm nhưng quên bấm" },
  { code: "outside_work", label: "Làm việc công ty ở ngoài", hint: "Đi gặp khách, mua vật tư, công tác…" },
  { code: "cannot_check", label: "Không chấm công được", hint: "Mất mạng, lỗi GPS, điện thoại hỏng…" },
  { code: "wrong_shift", label: "Chọn sai ca", hint: "Chấm nhầm công trường hoặc nhầm giờ" },
  { code: "other", label: "Lý do khác", hint: "Ghi rõ ở phần ghi chú" },
];

export type Explanation = {
  id: string; projectId: string; workDate: string; activity: "in" | "out" | null; time: string | null;
  reason: string; reasonCode: ReasonCode | null; attachments: string[];
  status: "pending" | "approved" | "rejected" | "cancelled"; reviewNote: string; reviewerName: string; createdAt: string;
};

export type DayStatus = "full" | "missing" | "open" | "absent" | "off" | "future" | "none";
export type Day = { date: string; inMonth: boolean; isToday: boolean; status: DayStatus; rows: MonthRow[]; explanations: Explanation[] };

/** Ngày cuối tháng (YYYY-MM-DD) và tháng trước / sau (YYYY-MM). */
export const monthEnd = (month: string) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const hhmm = (v: unknown, fallback: string) => (v ? String(v).slice(0, 5) : fallback);

export async function loadMonthRows(month: string): Promise<MonthRow[]> {
  const { data, error } = await supabase.rpc("my_attendance_month", { p_month: month });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    workDate: str(row.work_date), projectId: str(row.project_id), code: str(row.code), projectName: str(row.project_name),
    checkInAt: row.check_in_at ? str(row.check_in_at) : null, checkOutAt: row.check_out_at ? str(row.check_out_at) : null,
    source: row.source === "explanation" ? "explanation" : row.source === "gps" ? "gps" : null,
    sheetStatus: row.sheet_status ? str(row.sheet_status) : null, regularHours: num(row.regular_hours), otHours: num(row.ot_hours),
    workStart: hhmm(row.work_start, "08:00"), workEnd: hhmm(row.work_end, "17:00"), lunchStart: hhmm(row.lunch_start, "12:00"), lunchEnd: hhmm(row.lunch_end, "13:00"),
    stdHours: Number(row.std_hours ?? 8), weeklyOff: Array.isArray(row.weekly_off) ? (row.weekly_off as unknown[]).map(Number) : [0],
  }));
}

/** Giải trình của chính mình trong tháng (Admin đọc được mọi phiếu nên phải lọc theo mã nhân viên). */
export async function loadMonthExplanations(month: string, employeeId: string): Promise<Explanation[]> {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const { data, error } = await supabase.from("attendance_requests")
    .select("id, project_id, work_date, kind, requested_in, requested_out, reason, reason_code, attachments, status, review_note, reviewer_name, created_at")
    .eq("employee_id", employeeId).gte("work_date", from).lte("work_date", to).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => {
    const kind = str(row.kind);
    const activity = kind === "missing_in" ? "in" : kind === "missing_out" ? "out" : null;
    return {
      id: str(row.id), projectId: str(row.project_id), workDate: str(row.work_date), activity,
      time: activity === "in" ? hhmm(row.requested_in, "") || null : activity === "out" ? hhmm(row.requested_out, "") || null : null,
      reason: str(row.reason), reasonCode: (row.reason_code as ReasonCode | null) ?? null,
      attachments: Array.isArray(row.attachments) ? (row.attachments as string[]) : [],
      status: (str(row.status) || "pending") as Explanation["status"], reviewNote: str(row.review_note), reviewerName: str(row.reviewer_name), createdAt: str(row.created_at),
    };
  });
}

// ───────── Giờ công (giống web) ─────────
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const halfHours = (minutes: number) => Math.floor(Math.max(0, minutes) / 30) / 2;
function vnMinutes(iso: string, workDate: string): number {
  const local = new Date(Date.parse(iso) + 7 * 3600_000);
  const localDate = local.toISOString().slice(0, 10);
  const offset = localDate === workDate ? 0 : localDate === addDays(workDate, 1) ? 1440 : localDate < workDate ? -1440 : 2880;
  return offset + local.getUTCHours() * 60 + local.getUTCMinutes();
}
export const weekdayOf = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();

export type Hours = { total: number; regular: number; ot: number; lunch: number; fromSheet: boolean };

/** Tổng giờ có mặt (đã trừ nghỉ trưa), giờ thường trong ca, tăng ca. Có phiếu công đã nộp thì lấy giờ trên phiếu. */
export function hoursOf(row: MonthRow): Hours | null {
  if (!row.checkInAt || !row.checkOutAt) {
    if (row.sheetStatus && row.regularHours !== null) return { total: row.regularHours + (row.otHours ?? 0), regular: row.regularHours, ot: row.otHours ?? 0, lunch: 0, fromSheet: true };
    return null;
  }
  const inAt = vnMinutes(row.checkInAt, row.workDate), outAt = vnMinutes(row.checkOutAt, row.workDate);
  const start = minutesOf(row.workStart), end = minutesOf(row.workEnd), ls = minutesOf(row.lunchStart), le = minutesOf(row.lunchEnd);
  const lunch = overlap(inAt, outAt, ls, le);
  const total = Math.max(0, outAt - inAt - lunch) / 60;
  const workday = !row.weeklyOff.includes(weekdayOf(row.workDate));
  const computed = workday
    ? { regular: Math.min(row.stdHours, halfHours(overlap(inAt, outAt, start, end) - overlap(Math.max(inAt, start), Math.min(outAt, end), ls, le))), ot: halfHours(overlap(inAt, outAt, end, 48 * 60)) }
    : { regular: 0, ot: halfHours(outAt - inAt - lunch) };
  if (row.sheetStatus && row.regularHours !== null) return { total, regular: row.regularHours, ot: row.otHours ?? 0, lunch: lunch / 60, fromSheet: true };
  return { total, ...computed, lunch: lunch / 60, fromSheet: false };
}

/** "8 giờ 30 phút" */
export function hoursText(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h && !m) return "0 phút";
  return [h ? `${h} giờ` : "", m ? `${m} phút` : ""].filter(Boolean).join(" ");
}

/** Lịch tháng, tuần bắt đầu thứ Hai. */
export function buildCalendar(month: string, rows: MonthRow[], explanations: Explanation[], fallbackWeeklyOff: number[] = [0], now = new Date()): Day[] {
  const today = todayISO(now);
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const start = addDays(first, -lead);
  const last = monthEnd(month);
  const end = addDays(last, 6 - ((weekdayOf(last) + 6) % 7));
  const days: Day[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const inMonth = date.slice(0, 7) === month;
    const mine = rows.filter((row) => row.workDate === date);
    const notes = explanations.filter((item) => item.workDate === date && item.status !== "cancelled");
    const weeklyOff = mine[0]?.weeklyOff ?? fallbackWeeklyOff;
    let status: DayStatus;
    if (date > today) status = "future";
    else if (mine.some((row) => row.checkInAt)) {
      const allOut = mine.filter((row) => row.checkInAt).every((row) => row.checkOutAt);
      status = allOut ? "full" : date === today ? "open" : "missing";
    } else if (mine.some((row) => row.regularHours)) status = "full";
    else if (weeklyOff.includes(weekdayOf(date))) status = "off";
    else if (date === today) status = "none";
    else status = "absent";
    days.push({ date, inMonth, isToday: date === today, status, rows: mine, explanations: notes });
  }
  return days;
}

/** Ngày cần giải trình: thiếu giờ Ra, hoặc ngày làm việc không có lượt chấm (trong 45 ngày gần đây). */
export const needsExplanation = (day: Day, now = new Date()) =>
  (day.status === "missing" || day.status === "absent") && day.date >= addDays(todayISO(now), -45) && !day.explanations.some((item) => item.status === "pending" || item.status === "approved");

// ───────── Gửi giải trình ─────────
const BUCKET = "attendance-attachments";

/** Thu nhỏ ảnh đính kèm (cạnh dài 1280 px) rồi tải lên kho riêng tư. Trả đường dẫn trong kho. */
export async function uploadAttachment(projectId: string, userId: string, asset: { uri: string; width: number; height: number }, index: number): Promise<string> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > 1280) context.resize(asset.width >= asset.height ? { width: 1280 } : { height: 1280 });
  const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!saved.base64) throw new Error("ATR_ATTACHMENT_INVALID");
  const path = `${projectId}/${userId}/${new Date().toISOString().replace(/[:.]/g, "-")}-${index}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(saved.base64), { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function attachmentUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) return [];
  return (data ?? []).map((item) => item.signedUrl ?? "").filter(Boolean);
}

export async function submitExplanation(input: {
  projectId: string; date: string; activity: "in" | "out"; time: string; reason: ReasonCode; note: string; attachments: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("attendance_request_submit_mobile", {
    p_project: input.projectId, p_date: input.date, p_activity: input.activity, p_time: input.time,
    p_reason_code: input.reason, p_note: input.note, p_attachments: input.attachments,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function cancelExplanation(id: string): Promise<void> {
  const { error } = await supabase.rpc("attendance_request_cancel", { p_id: id });
  if (error) throw new Error(error.message);
}
