import type { CostCategory, LaborRate, LaborSettings, MemberRate, OtType, ProjectMember, Timesheet, TimesheetCost, TimesheetLine } from "./types";

/** PRJ-03: đơn giá áp dụng = đơn giá riêng trong dự án → đơn giá chung có hiệu lực tại ngày làm việc → null (thiếu đơn giá). */
export function resolveRate(employeeId: string, workDate: string, rates: readonly LaborRate[], memberRate?: number | null): number | null {
  if (memberRate !== undefined && memberRate !== null) return memberRate;
  const match = rates
    .filter((rate) => rate.employeeId === employeeId && rate.effectiveFrom <= workDate && (rate.effectiveTo === null || rate.effectiveTo >= workDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return match ? match.hourlyRate : null;
}

export function otMultiplier(type: OtType, settings: LaborSettings): number {
  return type === "weekly_off" ? settings.otWeeklyOff : type === "holiday" ? settings.otHoliday : settings.otWeekday;
}

/**
 * PRJ-04: Thành tiền = giờ thường × đơn giá + giờ tăng ca × đơn giá × hệ số + giờ đêm × đơn giá × phụ cấp đêm, làm tròn đến đồng.
 * Không có mặt hoặc thiếu đơn giá → 0. Công thức giống hệt private.compute_timesheet_costs ở Supabase.
 */
export function lineAmount(line: Pick<TimesheetLine, "attendance" | "regularHours" | "otHours" | "otType" | "nightHours">, rate: number | null, settings: LaborSettings): number {
  if (line.attendance !== "present" || rate === null) return 0;
  return Math.round(rate * (line.regularHours + line.otHours * otMultiplier(line.otType, settings) + line.nightHours * settings.nightBonus));
}

/** Tiền công của cả phiếu, chụp cố định lúc duyệt. */
export function computeTimesheetCosts(timesheet: Timesheet, members: readonly ProjectMember[], rates: readonly LaborRate[], memberRates: readonly MemberRate[], settings: LaborSettings): TimesheetCost[] {
  return timesheet.lines.map((line) => {
    const member = members.find((item) => item.projectId === timesheet.projectId && item.employeeId === line.employeeId);
    const own = member ? memberRates.find((item) => item.memberId === member.id)?.hourlyRate ?? null : null;
    const rate = resolveRate(line.employeeId, timesheet.workDate, rates, own);
    const category: CostCategory = member?.subcontractId ? "subcontract" : "labor";
    return {
      lineId: line.id, projectId: timesheet.projectId, workDate: timesheet.workDate, employeeId: line.employeeId, category,
      rate, otMultiplier: otMultiplier(line.otType, settings), nightBonus: settings.nightBonus, amount: lineAmount(line, rate, settings),
    };
  });
}

export type RateIssue = "RATE_INVALID" | "RATE_DATE_INVALID" | "RATE_OVERLAP";

/**
 * PRJ-05: thêm đơn giá mới cho một người. Khoảng đang mở (đến ngày trống) bắt đầu trước ngày hiệu lực mới
 * được tự đóng vào ngày hôm trước; còn chồng lấn khoảng khác thì báo lỗi.
 */
export function addRate(existing: readonly LaborRate[], next: LaborRate): { ok: true; rates: LaborRate[] } | { ok: false; code: RateIssue } {
  if (!Number.isInteger(next.hourlyRate) || next.hourlyRate < 0) return { ok: false, code: "RATE_INVALID" };
  if (next.effectiveTo !== null && next.effectiveTo < next.effectiveFrom) return { ok: false, code: "RATE_DATE_INVALID" };
  const dayBefore = previousDay(next.effectiveFrom);
  const adjusted = existing.map((rate) => rate.employeeId === next.employeeId && rate.effectiveTo === null && rate.effectiveFrom < next.effectiveFrom ? { ...rate, effectiveTo: dayBefore } : rate);
  const overlaps = adjusted.some((rate) => rate.employeeId === next.employeeId && rate.id !== next.id
    && rate.effectiveFrom <= (next.effectiveTo ?? "9999-12-31") && (rate.effectiveTo ?? "9999-12-31") >= next.effectiveFrom);
  if (overlaps) return { ok: false, code: "RATE_OVERLAP" };
  return { ok: true, rates: [...adjusted.filter((rate) => rate.id !== next.id), next] };
}

function previousDay(date: string): string {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) - 1));
  return value.toISOString().slice(0, 10);
}

/** Định dạng tiền VNĐ: 1.234.567 đ */
export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString("vi-VN")} đ`;
}

/** Định dạng giờ: 8 → "8", 2.5 → "2,5" */
export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}
