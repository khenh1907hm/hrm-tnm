import { addDays } from "../../../lib/dates";
import { dayKind, defaultLine } from "../../../modules/projects/calendar";
import type { ProjectStore } from "../../../modules/projects/store";
import type { EmployeeOption } from "./projectShared";

/**
 * Dữ liệu mẫu cho chế độ demo: một dự án đang thi công, cây 4 cấp, đơn giá, ngân sách và 10 ngày công đã duyệt,
 * để mở ra là thấy ngay sơ đồ, báo cáo và cảnh báo ngân sách.
 */
export async function seedDemoProjects(store: ProjectStore, employees: readonly EmployeeOption[], today: string): Promise<void> {
  if ((await store.listProjects()).length || employees.length < 6) return;
  const start = addDays(today, -20);
  const project = await store.saveProject({
    code: "DA-2026-001", name: "Lắp đặt hệ thống HVAC nhà máy Bình Dương", customerId: null, customerName: "Taikisha Việt Nam", site: "KCN VSIP II, Bình Dương",
    pmEmployeeId: employees[0]!.id, plannedStart: start, plannedEnd: addDays(today, 40), actualStart: start, actualEnd: null, stdHours: 8, weeklyOff: [0], status: "active", note: "",
  });
  await store.saveProject({
    code: "DA-2026-002", name: "Bảo trì đường ống khí nén", customerId: null, customerName: "Khách hàng mẫu", site: "Đồng Nai",
    pmEmployeeId: employees[0]!.id, plannedStart: addDays(today, 10), plannedEnd: addDays(today, 70), actualStart: null, actualEnd: null, stdHours: 8, weeklyOff: [0], status: "planning", note: "",
  });
  await store.saveBudgets(project.id, [
    { category: "labor", amount: 120_000_000, warnPct: 80, plannedHours: 3000 },
    { category: "subcontract", amount: 60_000_000, warnPct: 80, plannedHours: null },
    { category: "material", amount: 250_000_000, warnPct: 80, plannedHours: null },
    { category: "other", amount: 20_000_000, warnPct: 80, plannedHours: null },
  ], "Ngân sách ban đầu");
  const sub = await store.saveSubcontract({ projectId: project.id, partnerId: null, name: "Công ty Bảo ôn Minh Phát", mode: "lump_sum", contractNo: "HĐTP-01", contractValue: 45_000_000, signedOn: start, note: "" });
  await store.savePayment({ subcontractId: sub.id, payDate: addDays(start, 7), amount: 15_000_000, status: "paid", note: "Tạm ứng 1" });
  await store.saveExpense({ projectId: project.id, spentOn: addDays(start, 2), category: "material", description: "Ống đồng, bảo ôn đợt 1", supplier: "Vật tư Hòa Phát", amount: 180_000_000, status: "approved" });
  await store.saveExpense({ projectId: project.id, spentOn: addDays(today, -1), category: "other", description: "Tiền ăn ca tháng", supplier: "", amount: 6_500_000, status: "draft" });

  const people = employees.slice(0, Math.min(10, employees.length));
  const roles = ["pm", "commander", "leader", "worker", "worker", "worker", "leader", "worker", "worker", "worker"] as const;
  const created: { id: string; employeeId: string; team: string }[] = [];
  for (const [index, person] of people.entries()) {
    const role = roles[index]!;
    const team = index >= 2 && index <= 5 ? "Tổ ống gió" : index >= 6 ? "Tổ điện" : "";
    const parentId = index === 0 ? null : index === 1 ? created[0]!.id : role === "leader" ? created[1]!.id : created.find((item, at) => roles[at] === "leader" && item.team === team)?.id ?? created[1]!.id;
    const member = await store.saveMember({ projectId: project.id, employeeId: person.id, displayName: person.name, employeeCode: person.code, role, parentId, team, subcontractId: null, joinedOn: start, leftOn: null });
    created.push({ id: member.id, employeeId: person.id, team });
  }
  await store.upsertRates(people.map((person, index) => ({ id: `demo-rate-${person.id}`, employeeId: person.id, hourlyRate: [90_000, 75_000, 55_000, 42_000, 40_000, 40_000, 55_000, 45_000, 42_000, 40_000][index]!, effectiveFrom: addDays(today, -365), effectiveTo: null, note: "" })));

  for (let offset = 19; offset >= 1; offset--) {
    const date = addDays(today, -offset);
    const kind = dayKind(date, [0], []);
    if (kind !== "workday") continue;
    for (const team of ["Tổ ống gió", "Tổ điện"]) {
      const lines = created.filter((member) => member.team === team).map((member, index) => {
        const line = defaultLine(member.employeeId, kind, 8, `${date}-${member.employeeId}`);
        return (offset + index) % 4 === 0 ? { ...line, otHours: 2 } : (offset + index) % 9 === 0 ? { ...line, attendance: "leave" as const, regularHours: 0 } : line;
      });
      const sheet = await store.saveTimesheet({ id: `demo-${team}-${date}`, projectId: project.id, workDate: date, team, status: "draft", submittedAt: null, approvedAt: null, rejectReason: "", lines });
      await store.submitTimesheet(sheet.id);
      if (offset > 1) await store.approveTimesheet(sheet.id);
    }
  }
}
