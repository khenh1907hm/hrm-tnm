import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE } from "./attendance";
import { buildMonthCalendar, type MonthRecord } from "./attendanceMonth";
import { canReview, requestIssue } from "./attendanceRequests";

const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();
const record = (workDate: string, extra: Partial<MonthRecord> = {}): MonthRecord => ({
  workDate, projectId: "p1", code: "DA-1", projectName: "Dự án", checkInAt: at(workDate, "08:00"), checkOutAt: at(workDate, "17:00"), source: "gps",
  sheetStatus: null, attendance: null, regularHours: null, otHours: null, schedule: DEFAULT_SCHEDULE, weeklyOff: [0], ...extra,
});

describe("attendance month", () => {
  it("ATT_01 builds a Monday-first calendar with day states and month totals (sheet hours win over GPS estimates)", () => {
    const records = [
      record("2026-11-02", { checkOutAt: at("2026-11-02", "19:00") }),
      record("2026-11-03", { sheetStatus: "approved", attendance: "present", regularHours: 7, otHours: 1 }),
      record("2026-11-04", { sheetStatus: "submitted", attendance: "present", regularHours: 8, otHours: 0 }),
      record("2026-11-05", { checkInAt: null, checkOutAt: null, sheetStatus: "approved", attendance: "leave", regularHours: 0, otHours: 0 }),
    ];
    const { days, summary } = buildMonthCalendar("2026-11", records, [], "2026-11-10");
    expect(days[0]!.date).toBe("2026-10-26");
    expect(days.length % 7).toBe(0);
    expect(days.at(-1)!.date >= "2026-11-30").toBe(true);
    const state = (date: string) => days.find((day) => day.date === date)!.state;
    expect([state("2026-11-02"), state("2026-11-03"), state("2026-11-04"), state("2026-11-05"), state("2026-11-06")]).toEqual(["checked", "approved", "pending", "absent", "none"]);
    expect(days.find((day) => day.date === "2026-11-02")!.records[0]).toMatchObject({ inText: "08:00", outText: "19:00", regular: 8, ot: 2 });
    expect(summary).toEqual({ daysWorked: 3, regular: 23, ot: 3, approved: 1, pending: 2 });
    expect(days.find((day) => day.date === "2026-11-11")!.isFuture).toBe(true);
  });

  it("ATT_02 validates an explanation: date window, reason, required times and order", () => {
    const base = { projectId: "p1", workDate: "2026-11-09", kind: "missing_in" as const, requestedIn: "08:00", requestedOut: null, reason: "Quên bấm vì điện thoại hết pin" };
    expect(requestIssue(base, "2026-11-10")).toBeNull();
    expect(requestIssue({ ...base, workDate: "2026-11-11" }, "2026-11-10")).toBe("TS_FUTURE_DATE");
    expect(requestIssue({ ...base, workDate: "2026-09-20" }, "2026-11-10")).toBe("ATR_TOO_OLD");
    expect(requestIssue({ ...base, reason: "abc" }, "2026-11-10")).toBe("ATR_REASON_REQUIRED");
    expect(requestIssue({ ...base, requestedIn: null }, "2026-11-10")).toBe("ATR_TIME_REQUIRED");
    expect(requestIssue({ ...base, kind: "wrong_time", requestedOut: null }, "2026-11-10")).toBe("ATR_TIME_REQUIRED");
    expect(requestIssue({ ...base, kind: "wrong_time", requestedIn: "17:00", requestedOut: "08:00" }, "2026-11-10")).toBe("ATR_TIME_ORDER");
    expect(requestIssue({ ...base, kind: "other", requestedIn: null }, "2026-11-10")).toBeNull();
  });

  it("ATT_03 only the project PM (or Admin) reviews, and only pending requests", () => {
    expect(canReview({ status: "pending" }, { isPm: true })).toBe(true);
    expect(canReview({ status: "pending" }, { isPm: false })).toBe(false);
    expect(canReview({ status: "approved" }, { isPm: true })).toBe(false);
  });
});
