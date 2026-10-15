import type { Clock } from "../../lib/clock";
import type { IdGenerator } from "../../lib/ids";
import type { Certificate } from "../../modules/certificates/types";
import type { Employee } from "../../modules/employees/types";
import { createMemoryRepositories } from "./createMemoryRepositories";
import { DEFAULT_CONTACT_RELATION } from "../../modules/commanders/fromEmployee";

const names = ["Minh An", "Quốc Bảo", "Thanh Bình", "Gia Cường", "Hoàng Dũng", "Kim Hà", "Tuấn Khang", "Bảo Long", "Hải Nam", "Ngọc Phúc", "Minh Quân", "Anh Sơn"];
const fakeCccd = (index: number) => `079${index % 2 === 0 ? "1" : "0"}88${String(index).padStart(6, "0")}`;
const fakePhone = (index: number) => `083${String(index).padStart(7, "0")}`;

export async function createDemoRepositories(clock: Clock, ids: IdGenerator) {
  const repositories = createMemoryRepositories();
  const employeeIds: string[] = [];
  for (const [index, name] of names.entries()) {
    const employee: Employee = {
      id: ids.next(), code: `TNM${String(index + 1).padStart(3, "0")}`, name: `Nguyễn ${name}`, dob: "1988-05-12", gender: index % 2 === 0 ? "Nam" : "Nữ", cccd: fakeCccd(index + 1), phone: fakePhone(index + 1),
      home: "Tỉnh giả lập", address: "Địa chỉ mẫu, không có thật", position: index === 0 ? "Giám đốc" : "Nhân viên hiện trường", group: index % 6 + 1, startDate: "2020-01-15", emergencyContactId: `cmd-${index % 2 + 1}`, status: "active", endDate: null,
      version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null,
    };
    await repositories.employees.insert(employee);
    employeeIds.push(employee.id);
    if (index < 8) {
      const expiryDate = index === 1 ? "2026-10-11" : index === 2 ? "2026-10-12" : index === 3 ? "2026-11-11" : "2027-03-15";
      const certificate: Certificate = {
        id: ids.next(), employeeId: employee.id, type: "atld", title: index === 0 ? "Nhóm 1" : "Nhóm 3", number: `ATLĐ-MẪU-${String(index + 1).padStart(3, "0")}`, expiryDate, issueDate: "2024-01-15",
        document: { id: `file-${index}`, name: "chung-chi-mau.pdf", mime: "application/pdf", size: 1_024 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null, safetyGroup: index === 0 ? 1 : 3,
      };
      await repositories.certificates.insert(certificate);
    }
  }
  // Dự án mẫu: 6 người đi công trình Taikisha, TNM003 làm chỉ huy trưởng
  const now = clock.now();
  await repositories.projects.insert({
    id: ids.next(), version: 1, createdAt: now, updatedAt: now, archivedAt: null,
    name: "Taikisha – Nhà máy mẫu Bình Dương", customer: "Taikisha Việt Nam", location: "KCN mẫu, Bình Dương", startDate: "2026-10-20", endDate: null, status: "planning",
    templateId: "seed-taikisha", memberIds: employeeIds.slice(0, 6), commanderId: employeeIds[2]!, commanderRelation: DEFAULT_CONTACT_RELATION,
    exportValues: { projectStartDate: "2026-10-20" }, note: "Dữ liệu giả lập để thử chức năng.",
  });
  return repositories;
}
