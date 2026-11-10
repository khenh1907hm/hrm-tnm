import { addDays } from "../../lib/dates";
import type { DayKind } from "./calendar";

/** Lượt tự chấm công Vào / Ra bằng GPS + ảnh (bảng attendance_checks). Giờ là thời điểm ISO do máy chủ ghi. */
export type AttendanceCheck = {
  id: string;
  projectId: string;
  employeeId: string;
  workDate: string;
  checkInAt: string;
  inLat: number;
  inLng: number;
  inAccuracyM: number | null;
  inDistanceM: number;
  inPhoto: string;
  checkOutAt: string | null;
  outLat: number | null;
  outLng: number | null;
  outAccuracyM: number | null;
  outDistanceM: number | null;
  outPhoto: string | null;
};

/** Giờ làm của dự án dạng "HH:MM" (giờ Việt Nam). */
export type WorkSchedule = { workStart: string; workEnd: string; lunchStart: string; lunchEnd: string; stdHours: number };
export const DEFAULT_SCHEDULE: WorkSchedule = { workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", stdHours: 8 };

/** PRJ-14: khoảng cách mặt đất (mét) theo haversine, làm tròn đến mét. Giống private.distance_m ở Supabase. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

/** PRJ-14: trong bán kính cho phép mới được chấm công. */
export const withinSite = (distance: number, radiusM: number) => distance <= radiusM;

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Phút trong ngày theo giờ Việt Nam (UTC+7) của một thời điểm ISO, tính từ 00:00 của workDate (qua nửa đêm thì lớn hơn 1440). */
export function vnMinutes(iso: string, workDate: string): number {
  const local = new Date(Date.parse(iso) + 7 * 3600_000);
  const localDate = local.toISOString().slice(0, 10);
  const dayOffset = localDate === workDate ? 0 : localDate === addDays(workDate, 1) ? 1440 : localDate < workDate ? -1440 : 2880;
  return dayOffset + local.getUTCHours() * 60 + local.getUTCMinutes();
}
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
/** Làm tròn xuống bước 0,5 giờ (30 phút): chưa đủ 30 phút thì chưa tính. */
const halfHours = (minutes: number) => Math.floor(Math.max(0, minutes) / 30) / 2;

export type HoursFromCheck = { regularHours: number; otHours: number; late: number; incomplete: boolean };

/**
 * PRJ-15: giờ công từ lượt Vào / Ra theo giờ làm của dự án (vd 08:00–17:00, nghỉ trưa 12:00–13:00).
 * Ngày làm việc: giờ thường = phần nằm trong giờ làm trừ giờ nghỉ trưa (tối đa giờ chuẩn); tăng ca = phần sau giờ kết thúc.
 * Đến sớm trước giờ bắt đầu không tính. Ngày nghỉ tuần, ngày lễ: mọi giờ làm (trừ nghỉ trưa) là tăng ca.
 * Làm tròn xuống bước 0,5 giờ. Chưa chấm Ra: tạm tính tới giờ kết thúc, không tăng ca, đánh dấu chưa đủ.
 * late = số phút đi muộn so với giờ bắt đầu.
 */
export function hoursFromCheck(check: Pick<AttendanceCheck, "checkInAt" | "checkOutAt" | "workDate">, schedule: WorkSchedule, kind: DayKind): HoursFromCheck {
  const start = minutesOf(schedule.workStart), end = minutesOf(schedule.workEnd), lunchStart = minutesOf(schedule.lunchStart), lunchEnd = minutesOf(schedule.lunchEnd);
  const inAt = vnMinutes(check.checkInAt, check.workDate);
  const incomplete = check.checkOutAt === null;
  const outAt = incomplete ? Math.max(inAt, end) : vnMinutes(check.checkOutAt!, check.workDate);
  const lunch = overlap(inAt, outAt, lunchStart, lunchEnd);
  const late = kind === "workday" ? Math.max(0, inAt - start) : 0;
  if (kind !== "workday") return { regularHours: 0, otHours: incomplete ? 0 : halfHours(outAt - inAt - lunch), late, incomplete };
  const regular = overlap(inAt, outAt, start, end) - overlap(Math.max(inAt, start), Math.min(outAt, end), lunchStart, lunchEnd);
  return { regularHours: Math.min(schedule.stdHours, halfHours(regular)), otHours: incomplete ? 0 : halfHours(overlap(inAt, outAt, end, 48 * 60)), late, incomplete };
}

/** "08:05" theo giờ Việt Nam từ thời điểm ISO. */
export function vnClock(iso: string): string {
  const local = new Date(Date.parse(iso) + 7 * 3600_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

/** Vị trí GPS đọc từ trình duyệt. */
export type GpsFix = { lat: number; lng: number; accuracy: number | null };

/** Một dự án đang thi công mà người đăng nhập là thành viên, kèm lượt chấm hôm nay (hàm my_attendance_context). */
export type AttendanceContext = {
  projectId: string;
  code: string;
  name: string;
  team: string;
  siteLat: number | null;
  siteLng: number | null;
  siteRadiusM: number;
  weeklyOff: number[];
  schedule: WorkSchedule;
  today: Pick<AttendanceCheck, "id" | "checkInAt" | "checkOutAt" | "inDistanceM" | "outDistanceM"> | null;
};

/** 40 → "40 phút", 95 → "1 giờ 35 phút". */
export const formatMinutes = (minutes: number) => minutes < 60 ? `${minutes} phút` : `${Math.floor(minutes / 60)} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ""}`;
