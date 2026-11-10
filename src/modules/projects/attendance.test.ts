import { describe, expect, it } from "vitest";
import { distanceM, hoursFromCheck, vnClock, withinSite, DEFAULT_SCHEDULE } from "./attendance";
import { costsByPeriod } from "./capital";
import type { TimesheetCost } from "./types";

// Giờ Việt Nam = UTC+7: 08:00 VN = 01:00Z
const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();
const check = (inTime: string, outTime: string | null, date = "2026-11-09") => ({ workDate: date, checkInAt: at(date, inTime), checkOutAt: outTime ? at(date, outTime) : null });

describe("attendance", () => {
  it("PRJ_14 haversine distance in metres and radius check", () => {
    expect(distanceM(10.8231, 106.6297, 10.8231, 106.6297)).toBe(0);
    // 0,001 độ vĩ ≈ 111 m
    expect(distanceM(10.8231, 106.6297, 10.8241, 106.6297)).toBe(111);
    expect(withinSite(111, 300)).toBe(true);
    expect(withinSite(301, 300)).toBe(false);
  });

  it("PRJ_15 regular hours inside 08:00–17:00 minus lunch, overtime after 17:00, rounded down to 0.5 hour", () => {
    expect(hoursFromCheck(check("07:45", "17:00"), DEFAULT_SCHEDULE, "workday")).toEqual({ regularHours: 8, otHours: 0, late: 0, incomplete: false });
    expect(hoursFromCheck(check("08:00", "19:20"), DEFAULT_SCHEDULE, "workday")).toMatchObject({ regularHours: 8, otHours: 2 });
    expect(hoursFromCheck(check("08:40", "17:00"), DEFAULT_SCHEDULE, "workday")).toMatchObject({ regularHours: 7, late: 40 });
    expect(hoursFromCheck(check("13:00", "17:10"), DEFAULT_SCHEDULE, "workday")).toMatchObject({ regularHours: 4, otHours: 0 });
    expect(hoursFromCheck(check("08:00", "11:59"), DEFAULT_SCHEDULE, "workday")).toMatchObject({ regularHours: 3.5 });
    expect(hoursFromCheck(check("08:00", "01:30", "2026-11-09"), DEFAULT_SCHEDULE, "workday").otHours).toBe(0); // ra trước vào (sai giờ) → 0
  });

  it("PRJ_15 days off count everything as overtime; missing check-out is provisional until the end of the shift", () => {
    expect(hoursFromCheck(check("08:00", "17:00"), DEFAULT_SCHEDULE, "weekly_off")).toEqual({ regularHours: 0, otHours: 8, late: 0, incomplete: false });
    expect(hoursFromCheck(check("08:00", null), DEFAULT_SCHEDULE, "workday")).toEqual({ regularHours: 8, otHours: 0, late: 0, incomplete: true });
    expect(hoursFromCheck(check("09:00", null), DEFAULT_SCHEDULE, "holiday")).toMatchObject({ otHours: 0, incomplete: true });
    expect(vnClock(at("2026-11-09", "07:05"))).toBe("07:05");
  });

  it("PRJ_16 costs grouped by day, month and year with cumulative total and remaining capital", () => {
    const cost = (workDate: string, amount: number, category: TimesheetCost["category"] = "labor"): TimesheetCost => ({ lineId: `${workDate}${amount}`, projectId: "p", workDate, employeeId: "e", category, rate: 1, otMultiplier: 1.5, nightBonus: 0.3, amount });
    const input = {
      capital: 1_000_000,
      costs: [cost("2026-10-31", 100_000), cost("2026-11-01", 200_000), cost("2026-11-01", 50_000, "subcontract")],
      expenses: [{ id: "x", projectId: "p", spentOn: "2026-11-02", category: "material" as const, description: "Ống", supplier: "", amount: 300_000, status: "approved" as const }, { id: "y", projectId: "p", spentOn: "2026-11-02", category: "other" as const, description: "Chờ", supplier: "", amount: 9, status: "draft" as const }],
      payments: [{ id: "z", subcontractId: "s", payDate: "2027-01-05", amount: 500_000, status: "paid" as const, note: "" }, { id: "w", subcontractId: "s", payDate: "2027-01-06", amount: 1, status: "requested" as const, note: "" }],
    };
    expect(costsByPeriod({ ...input, granularity: "day" }).map((row) => [row.period, row.total, row.capitalLeft])).toEqual([
      ["2026-10-31", 100_000, 900_000], ["2026-11-01", 250_000, 650_000], ["2026-11-02", 300_000, 350_000], ["2027-01-05", 500_000, -150_000],
    ]);
    expect(costsByPeriod({ ...input, granularity: "month" }).map((row) => [row.period, row.labor, row.subcontract, row.material])).toEqual([["2026-10", 100_000, 0, 0], ["2026-11", 200_000, 50_000, 300_000], ["2027-01", 0, 500_000, 0]]);
    expect(costsByPeriod({ ...input, granularity: "year" }).map((row) => [row.period, row.cumulative])).toEqual([["2026", 650_000], ["2027", 1_150_000]]);
  });
});
