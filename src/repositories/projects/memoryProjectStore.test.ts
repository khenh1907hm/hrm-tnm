import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { createMemoryProjectStore } from "./memoryProjectStore";
import { DEFAULT_SITE_SETTINGS, type ProjectInput, type Timesheet } from "../../modules/projects/types";

const projectInput: ProjectInput = {
  code: "DA-2026-001", name: "Nhà máy A", customerId: null, customerName: "Khách A", site: "Bình Dương", pmEmployeeId: "e-pm",
  plannedStart: "2026-10-01", plannedEnd: "2026-12-31", actualStart: null, actualEnd: null, stdHours: 8, weeklyOff: [0], status: "active", note: "", ...DEFAULT_SITE_SETTINGS,
};

async function setup() {
  let seq = 0;
  const store = createMemoryProjectStore({ clock: fixedClock("2026-11-10T09:00:00+07:00"), newId: () => `id${++seq}` });
  const project = await store.saveProject(projectInput);
  const leader = await store.saveMember({ projectId: project.id, employeeId: "e1", displayName: "Nguyễn Văn A", employeeCode: "TNM001", role: "leader", parentId: null, team: "Tổ 1", subcontractId: null, joinedOn: "2026-10-01", leftOn: null });
  await store.upsertRates([{ id: "r1", employeeId: "e1", hourlyRate: 40_000, effectiveFrom: "2026-01-01", effectiveTo: null, note: "" }]);
  const draft: Timesheet = { id: "t1", projectId: project.id, workDate: "2026-11-09", team: "Tổ 1", status: "draft", submittedAt: null, approvedAt: null, rejectReason: "", lines: [{ id: "l1", employeeId: "e1", attendance: "present", regularHours: 8, otHours: 2, otType: "weekday", nightHours: 0, note: "" }] };
  return { store, project, leader, sheet: await store.saveTimesheet(draft) };
}

describe("memory project store", () => {
  it("PRJ_13 submit → approve snapshots the cost; reject needs a reason; reopen removes the cost", async () => {
    const { store, project, sheet } = await setup();
    await expect(store.approveTimesheet(sheet.id)).rejects.toThrow("TS_NOT_SUBMITTED");
    await store.submitTimesheet(sheet.id);
    await expect(store.rejectTimesheet(sheet.id, "x")).rejects.toThrow("TS_REJECT_REASON");
    await store.approveTimesheet(sheet.id);
    expect((await store.listCosts(project.id, "2026-11-01", "2026-11-30"))?.map((cost) => cost.amount)).toEqual([440_000]);
    // Đổi đơn giá sau khi duyệt: tiền đã chốt không đổi cho tới khi tính lại
    await store.upsertRates([{ id: "r1", employeeId: "e1", hourlyRate: 50_000, effectiveFrom: "2026-01-01", effectiveTo: null, note: "" }]);
    expect((await store.listCosts(project.id, "2026-11-01", "2026-11-30"))?.[0]?.amount).toBe(440_000);
    expect(await store.recalcCosts(project.id, "2026-11-01", "2026-11-30")).toBe(1);
    expect((await store.listCosts(project.id, "2026-11-01", "2026-11-30"))?.[0]?.amount).toBe(550_000);
    await expect(store.saveTimesheet({ ...sheet, lines: [] })).rejects.toThrow("TS_NOT_EDITABLE");
    await store.reopenTimesheet(sheet.id, "Nhập sai giờ");
    expect(await store.listCosts(project.id, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("PRJ_08 submit is blocked over 24 hours across projects and in a locked month", async () => {
    const { store, project, sheet } = await setup();
    const other = await store.saveProject({ ...projectInput, code: "DA-2026-002" });
    await store.saveMember({ projectId: other.id, employeeId: "e1", displayName: "Nguyễn Văn A", employeeCode: "TNM001", role: "worker", parentId: null, team: "Tổ 9", subcontractId: null, joinedOn: "2026-10-01", leftOn: null });
    const second = await store.saveTimesheet({ ...sheet, id: "t2", projectId: other.id, team: "Tổ 9", lines: [{ ...sheet.lines[0]!, id: "l2", regularHours: 8, otHours: 8 }] });
    await store.submitTimesheet(second.id);
    await expect(store.submitTimesheet(sheet.id)).rejects.toThrow("TS_DAY_OVER_24:Nguyễn Văn A");
    await store.lockMonth(project.id, "2026-11");
    await expect(store.saveTimesheet(sheet)).rejects.toThrow("TS_PERIOD_LOCKED");
    await expect(store.unlockMonth(project.id, "2026-11", "")).rejects.toThrow("PERIOD_UNLOCK_REASON");
  });

  it("PRJ_06 a member with direct reports cannot be removed", async () => {
    const { store, project, leader } = await setup();
    await store.saveMember({ projectId: project.id, employeeId: "e2", displayName: "B", employeeCode: "TNM002", role: "worker", parentId: leader.id, team: "Tổ 1", subcontractId: null, joinedOn: "2026-10-01", leftOn: null });
    await expect(store.removeMember(leader.id)).rejects.toThrow("TREE_HAS_CHILDREN");
    await expect(store.saveProject({ ...projectInput, code: " da-2026-001 " })).rejects.toThrow("PROJECT_CODE_DUPLICATE");
  });
});
