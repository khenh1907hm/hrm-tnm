import { describe, expect, it } from "vitest";
import { budgetSummary } from "./budget";
import { countDays, dayKind, defaultLine, weekStart } from "./calendar";
import { addRate, computeTimesheetCosts, lineAmount, resolveRate } from "./cost";
import { cumulativeCost, dailyStatus, flattenTimesheets, summarizeByPerson } from "./reports";
import { canEditTimesheet, canTransition, checkTimesheet, lineIssues, type TimesheetCheckContext } from "./timesheetRules";
import { buildMemberTree, treeIssues, wouldCreateCycle } from "./tree";
import { DEFAULT_LABOR_SETTINGS, type LaborRate, type ProjectMember, type Timesheet, type TimesheetCost, type TimesheetLine } from "./types";

const settings = DEFAULT_LABOR_SETTINGS;
const holidays = [{ day: "2026-09-02", name: "Quốc khánh" }];
const member = (id: string, parentId: string | null, extra: Partial<ProjectMember> = {}): ProjectMember => ({
  id, projectId: "p1", employeeId: `e-${id}`, displayName: `Người ${id}`, employeeCode: `TNM${id}`, role: "worker", parentId, team: "Tổ 1", subcontractId: null, joinedOn: "2026-01-01", leftOn: null, ...extra,
});
const line = (employeeId: string, extra: Partial<TimesheetLine> = {}): TimesheetLine => ({ id: `l-${employeeId}`, employeeId, attendance: "present", regularHours: 8, otHours: 0, otType: "weekday", nightHours: 0, note: "", ...extra });
const rate = (employeeId: string, hourlyRate: number, effectiveFrom: string, effectiveTo: string | null = null): LaborRate => ({ id: `${employeeId}-${effectiveFrom}`, employeeId, hourlyRate, effectiveFrom, effectiveTo, note: "" });

describe("calendar", () => {
  it("PRJ_01 holiday wins over weekly off; Sunday is weekly off by default; other days are workdays", () => {
    expect(dayKind("2026-11-08", [0], [])).toBe("weekly_off"); // Chủ nhật
    expect(dayKind("2026-11-09", [0], [])).toBe("workday");
    expect(dayKind("2026-09-02", [0], holidays)).toBe("holiday"); // thứ Tư, lễ
    expect(dayKind("2026-11-07", [0, 6], [])).toBe("weekly_off"); // thứ Bảy khi nghỉ cả T7
  });

  it("PRJ_02 default line uses standard hours on workdays and moves hours to OT of the right type on days off", () => {
    expect(defaultLine("e1", "workday", 8, "x")).toMatchObject({ attendance: "present", regularHours: 8, otHours: 0, otType: "weekday" });
    expect(defaultLine("e1", "weekly_off", 8, "x")).toMatchObject({ regularHours: 0, otHours: 8, otType: "weekly_off" });
    expect(defaultLine("e1", "holiday", 8, "x")).toMatchObject({ regularHours: 0, otHours: 8, otType: "holiday" });
  });

  it("PRJ_11 counts calendar and working days inclusively, skipping weekly off and holidays", () => {
    expect(countDays("2026-11-02", "2026-11-08", [0], [])).toEqual({ calendar: 7, working: 6 });
    expect(countDays("2026-09-01", "2026-09-03", [0], holidays)).toEqual({ calendar: 3, working: 2 });
    expect(countDays("2026-11-05", "2026-11-01", [0], [])).toEqual({ calendar: 0, working: 0 });
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
  });
});

describe("cost", () => {
  it("PRJ_03 project rate wins, then the general rate effective on the work date, else null", () => {
    const rates = [rate("e1", 40_000, "2026-01-01", "2026-06-30"), rate("e1", 45_000, "2026-07-01")];
    expect(resolveRate("e1", "2026-03-01", rates)).toBe(40_000);
    expect(resolveRate("e1", "2026-07-01", rates)).toBe(45_000);
    expect(resolveRate("e1", "2026-07-01", rates, 50_000)).toBe(50_000);
    expect(resolveRate("e1", "2025-12-31", rates)).toBeNull();
    expect(resolveRate("e2", "2026-07-01", rates)).toBeNull();
  });

  it("PRJ_04 amount = regular × rate + OT × rate × multiplier + night × rate × bonus, rounded; absent or missing rate is 0", () => {
    expect(lineAmount(line("e1", { otHours: 2 }), 40_000, settings)).toBe(440_000); // ví dụ trong spec
    expect(lineAmount(line("e1", { regularHours: 0, otHours: 8, otType: "weekly_off" }), 40_000, settings)).toBe(640_000);
    expect(lineAmount(line("e1", { regularHours: 0, otHours: 4, otType: "holiday" }), 40_000, settings)).toBe(480_000);
    expect(lineAmount(line("e1", { nightHours: 2 }), 40_000, settings)).toBe(344_000);
    expect(lineAmount(line("e1", { regularHours: 1 }), 33_333.4, settings)).toBe(33_333);
    expect(lineAmount(line("e1", { attendance: "absent", regularHours: 0 }), 40_000, settings)).toBe(0);
    expect(lineAmount(line("e1"), null, settings)).toBe(0);
  });

  it("PRJ_04 timesheet costs go to the subcontract bucket for subcontractor members and keep missing rate as null", () => {
    const members = [member("1", null), member("2", "1", { subcontractId: "s1" }), member("3", "1")];
    const sheet: Timesheet = { id: "t1", projectId: "p1", workDate: "2026-11-09", team: "Tổ 1", status: "submitted", submittedAt: null, approvedAt: null, rejectReason: "", lines: [line("e-1"), line("e-2"), line("e-3")] };
    const costs = computeTimesheetCosts(sheet, members, [rate("e-1", 40_000, "2026-01-01"), rate("e-2", 30_000, "2026-01-01")], [{ memberId: "1", hourlyRate: 50_000 }], settings);
    expect(costs.map((cost) => [cost.employeeId, cost.category, cost.rate, cost.amount])).toEqual([
      ["e-1", "labor", 50_000, 400_000],
      ["e-2", "subcontract", 30_000, 240_000],
      ["e-3", "labor", null, 0],
    ]);
  });

  it("PRJ_05 a new rate closes the open range the day before; overlaps and bad values are rejected", () => {
    const first = rate("e1", 40_000, "2026-01-01");
    const added = addRate([first], rate("e1", 45_000, "2026-07-01"));
    expect(added.ok && added.rates.find((item) => item.id === first.id)?.effectiveTo).toBe("2026-06-30");
    expect(addRate([rate("e1", 40_000, "2026-01-01", "2026-12-31")], rate("e1", 45_000, "2026-07-01"))).toEqual({ ok: false, code: "RATE_OVERLAP" });
    expect(addRate([], rate("e1", -1, "2026-01-01"))).toEqual({ ok: false, code: "RATE_INVALID" });
    expect(addRate([], rate("e1", 1, "2026-02-01", "2026-01-01"))).toEqual({ ok: false, code: "RATE_DATE_INVALID" });
    expect(addRate([rate("e2", 40_000, "2026-01-01")], rate("e1", 45_000, "2026-01-01")).ok).toBe(true);
  });
});

describe("tree", () => {
  it("PRJ_06 builds a tree from parentId, detects cycles and requires a single root", () => {
    const members = [member("pm", null, { role: "pm" }), member("cht", "pm", { role: "commander" }), member("tt", "cht", { role: "leader" }), member("tv", "tt")];
    const tree = buildMemberTree(members);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.children[0]!.member.id).toBe("tv");
    expect(wouldCreateCycle(members, "cht", "tv")).toBe(true);
    expect(wouldCreateCycle(members, "tv", "tv")).toBe(true);
    expect(wouldCreateCycle(members, "tv", "cht")).toBe(false);
    expect(treeIssues(members)).toEqual([]);
    expect(treeIssues([...members, member("x", null)])).toEqual(["TREE_MANY_ROOTS"]);
    const looped = [member("a", "b"), member("b", "a"), member("r", null)];
    expect(treeIssues(looped)).toEqual(["TREE_CYCLE"]);
    expect(buildMemberTree(looped).flatMap(function flat(node): string[] { return [node.member.id, ...node.children.flatMap(flat)]; }).sort()).toEqual(["a", "b", "r"]);
  });
});

describe("timesheet rules", () => {
  const base = (extra: Partial<TimesheetCheckContext> = {}, lines = [line("e-1")]): TimesheetCheckContext => ({
    project: { status: "active", plannedStart: "2026-10-01", plannedEnd: "2026-12-31", actualEnd: null },
    timesheet: { id: "t1", projectId: "p1", workDate: "2026-11-09", lines },
    members: [member("1", null)], settings, today: "2026-11-10", isLead: false, lockedMonths: [], otherHours: [], ...extra,
  });
  const codes = (ctx: TimesheetCheckContext) => checkTimesheet(ctx).map((item) => `${item.severity}:${item.code}`);

  it("PRJ_07 hours use 0.5 steps within 0–24 and must match attendance", () => {
    expect(lineIssues(line("e1", { regularHours: 7.5 }))).toEqual([]);
    expect(lineIssues(line("e1", { regularHours: 7.3 })).map((item) => item.code)).toEqual(["TS_HOURS_STEP"]);
    expect(lineIssues(line("e1", { regularHours: 0 })).map((item) => item.code)).toEqual(["TS_ATTENDANCE_HOURS"]);
    expect(lineIssues(line("e1", { attendance: "leave", regularHours: 8 })).map((item) => item.code)).toEqual(["TS_ATTENDANCE_HOURS"]);
    expect(lineIssues(line("e1", { attendance: "leave", regularHours: 0 }))).toEqual([]);
  });

  it("PRJ_08 blocks inactive project, dates outside project or in the future, locked months, late backfill, empty sheets and non-members", () => {
    expect(codes(base())).toEqual([]);
    expect(codes(base({ project: { status: "paused", plannedStart: "2026-10-01", plannedEnd: "2026-12-31", actualEnd: null } }))).toContain("error:TS_PROJECT_NOT_ACTIVE");
    expect(codes(base({ timesheet: { id: "t1", projectId: "p1", workDate: "2026-09-30", lines: [line("e-1")] }, isLead: true }))).toContain("error:TS_OUTSIDE_PROJECT");
    expect(codes(base({ timesheet: { id: "t1", projectId: "p1", workDate: "2026-11-11", lines: [line("e-1")] } }))).toContain("error:TS_FUTURE_DATE");
    expect(codes(base({ lockedMonths: ["2026-11"] }))).toContain("error:TS_PERIOD_LOCKED");
    expect(codes(base({ timesheet: { id: "t1", projectId: "p1", workDate: "2026-11-06", lines: [line("e-1")] } }))).toContain("error:TS_BACKFILL_LIMIT");
    expect(codes(base({ timesheet: { id: "t1", projectId: "p1", workDate: "2026-11-06", lines: [line("e-1")] }, isLead: true }))).toEqual([]);
    expect(codes(base({}, []))).toEqual(["error:TS_EMPTY"]);
    expect(codes(base({}, [line("e-9")]))).toContain("error:TS_OUTSIDE_MEMBERSHIP");
    expect(codes(base({ members: [member("1", null, { leftOn: "2026-11-08" })] }))).toContain("error:TS_OUTSIDE_MEMBERSHIP");
  });

  it("PRJ_08 blocks over 24 hours across projects and warns on two projects, over 12 hours, OT caps, missing rate and expired safety card", () => {
    const other = (projectId: string, workDate: string, regularHours: number, otHours: number) => ({ employeeId: "e-1", projectId, workDate, regularHours, otHours });
    expect(codes(base({ otherHours: [other("p2", "2026-11-09", 10, 7)] }))).toContain("error:TS_DAY_OVER_24");
    const twoProjects = codes(base({ otherHours: [other("p2", "2026-11-09", 5, 0)] }));
    expect(twoProjects).toEqual(["warning:TS_OVER_DAY_LIMIT", "warning:TS_MULTI_PROJECT"]);
    expect(codes(base({ otherHours: [other("p1", "2026-11-03", 8, 39)] }, [line("e-1", { otHours: 2 })]))).toContain("warning:TS_OT_MONTH_LIMIT");
    expect(codes(base({ otherHours: [other("p1", "2026-03-03", 0, 199)] }, [line("e-1", { otHours: 2 })]))).toContain("warning:TS_OT_YEAR_LIMIT");
    expect(codes(base({ missingRate: new Set(["e-1"]), safetyExpired: new Set(["e-1"]) }))).toEqual(["warning:TS_MISSING_RATE", "warning:TS_SAFETY_EXPIRED"]);
  });

  it("PRJ_13 leaders edit drafts and rejected sheets; leads also edit submitted ones; approved sheets need an admin reopen", () => {
    expect(canEditTimesheet("draft", "leader", false)).toBe(true);
    expect(canEditTimesheet("submitted", "leader", false)).toBe(false);
    expect(canEditTimesheet("submitted", "lead", false)).toBe(true);
    expect(canEditTimesheet("approved", "admin", false)).toBe(false);
    expect(canEditTimesheet("draft", "admin", true)).toBe(false);
    expect(canTransition("draft", "submitted", "leader")).toBe(true);
    expect(canTransition("submitted", "approved", "leader")).toBe(false);
    expect(canTransition("submitted", "approved", "lead")).toBe(true);
    expect(canTransition("approved", "submitted", "lead")).toBe(false);
    expect(canTransition("approved", "submitted", "admin")).toBe(true);
  });
});

describe("budget and reports", () => {
  const cost = (workDate: string, amount: number, category: TimesheetCost["category"] = "labor"): TimesheetCost => ({ lineId: `${workDate}-${amount}`, projectId: "p1", workDate, employeeId: "e1", category, rate: 1, otMultiplier: 1.5, nightBonus: 0.3, amount });

  it("PRJ_09 sums used, pending, committed and remaining per bucket, with warning levels", () => {
    const summary = budgetSummary({
      budgets: [{ category: "labor", amount: 1_000_000, warnPct: 80, plannedHours: null }, { category: "subcontract", amount: 100_000_000, warnPct: 80, plannedHours: null }, { category: "material", amount: 500_000, warnPct: 80, plannedHours: null }],
      costs: [cost("2026-11-02", 500_000), cost("2026-11-03", 350_000)],
      expenses: [{ id: "x1", projectId: "p1", spentOn: "2026-11-02", category: "material", description: "Ống", supplier: "", amount: 600_000, status: "approved" }, { id: "x2", projectId: "p1", spentOn: "2026-11-03", category: "other", description: "Ăn", supplier: "", amount: 50_000, status: "draft" }],
      subcontracts: [{ id: "s1", projectId: "p1", partnerId: null, name: "Thầu A", mode: "lump_sum", contractNo: "", contractValue: 100_000_000, signedOn: null, note: "" }],
      payments: [{ id: "y1", subcontractId: "s1", payDate: "2026-11-01", amount: 30_000_000, status: "approved", note: "" }, { id: "y2", subcontractId: "s1", payDate: "2026-11-05", amount: 10_000_000, status: "requested", note: "" }],
      today: "2026-11-10", remainingWorkdays: 0,
    });
    const byCategory = Object.fromEntries(summary.lines.map((item) => [item.category, item]));
    expect(byCategory.labor).toMatchObject({ used: 850_000, remaining: 150_000, level: "warn" });
    expect(byCategory.subcontract).toMatchObject({ used: 30_000_000, committed: 70_000_000, pending: 10_000_000, level: "ok", forecast: 100_000_000 }); // tiêu chí nghiệm thu 7
    expect(byCategory.material).toMatchObject({ used: 600_000, level: "over" });
    expect(byCategory.other).toMatchObject({ used: 0, pending: 50_000, pct: 0, level: "ok" });
    expect(summary.total.used).toBe(31_450_000);
  });

  it("PRJ_10 forecast adds the 14-day average daily labor cost times remaining workdays and flags expected overrun", () => {
    const summary = budgetSummary({
      budgets: [{ category: "labor", amount: 3_000_000, warnPct: 80, plannedHours: null }],
      costs: [cost("2026-10-01", 9_000_000), cost("2026-11-09", 400_000), cost("2026-11-10", 600_000)],
      expenses: [], subcontracts: [], payments: [], today: "2026-11-10", remainingWorkdays: 10,
    });
    const labor = summary.lines.find((item) => item.category === "labor")!;
    expect(labor.forecast).toBe(10_000_000 + 500_000 * 10);
    expect(labor.forecastOver).toBe(true);
  });

  it("PRJ_12 summarizes hours and money per person, flags the monthly OT cap and lists teams that have not submitted", () => {
    const members = [member("1", null, { team: "Tổ A" }), member("2", null, { team: "Tổ B" })];
    const sheets: Timesheet[] = [
      { id: "t1", projectId: "p1", workDate: "2026-11-09", team: "Tổ A", status: "approved", submittedAt: null, approvedAt: null, rejectReason: "", lines: [line("e-1", { id: "a1", otHours: 30 })] },
      { id: "t2", projectId: "p1", workDate: "2026-11-10", team: "Tổ A", status: "submitted", submittedAt: null, approvedAt: null, rejectReason: "", lines: [line("e-1", { id: "a2", otHours: 12 })] },
      { id: "t3", projectId: "p1", workDate: "2026-11-10", team: "Tổ B", status: "rejected", submittedAt: null, approvedAt: null, rejectReason: "sai", lines: [line("e-2", { id: "b1" })] },
    ];
    const rows = flattenTimesheets(sheets, [{ ...cost("2026-11-09", 2_000_000), lineId: "a1" }]);
    expect(rows).toHaveLength(2);
    const [person] = summarizeByPerson(rows, members, settings);
    expect(person).toMatchObject({ employeeId: "e-1", name: "Người 1", daysPresent: 2, regularHours: 16, otHours: 42, amount: 2_000_000, hasPending: true, otOverMonth: true });
    expect(dailyStatus("2026-11-10", sheets, ["Tổ A", "Tổ B"]).missingTeams).toEqual(["Tổ B"]);
    expect(dailyStatus("2026-11-10", sheets, ["Tổ A", "Tổ B"]).pending.map((sheet) => sheet.id)).toEqual(["t2"]);
    expect(cumulativeCost([cost("2026-11-01", 100), cost("2026-11-03", 50)], [], [], "2026-11-02", "2026-11-03")).toEqual([{ date: "2026-11-02", total: 100 }, { date: "2026-11-03", total: 150 }]);
  });
});
