import type { Clock } from "../../lib/clock";
import type { IdGenerator } from "../../lib/ids";
import type { Certificate } from "../../modules/certificates/types";
import type { Employee } from "../../modules/employees/types";
import { createMemoryRepositories } from "./createMemoryRepositories";

const names = ["Minh An", "Quốc Bảo", "Thanh Bình", "Gia Cường", "Hoàng Dũng", "Kim Hà", "Tuấn Khang", "Bảo Long", "Hải Nam", "Ngọc Phúc", "Minh Quân", "Anh Sơn"];
const fakeCccd = (index: number) => `079${index % 2 === 0 ? "1" : "0"}88${String(index).padStart(6, "0")}`;
const fakePhone = (index: number) => `083${String(index).padStart(7, "0")}`;

export async function createDemoRepositories(clock: Clock, ids: IdGenerator) {
  const repositories = createMemoryRepositories();
  for (const [index, name] of names.entries()) {
    const employee: Employee = {
      id: ids.next(), code: `TNM${String(index + 1).padStart(3, "0")}`, name: `Nguyễn ${name}`, dob: "1988-05-12", gender: index % 2 === 0 ? "Nam" : "Nữ", cccd: fakeCccd(index + 1), phone: fakePhone(index + 1),
      home: "Tỉnh giả lập", address: "Địa chỉ mẫu, không có thật", position: index === 0 ? "Giám đốc" : "Nhân viên hiện trường", group: index % 6 + 1, startDate: "2020-01-15", emergencyContactId: `cmd-${index % 2 + 1}`, status: "active", endDate: null,
      version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null,
    };
    await repositories.employees.insert(employee);
    if (index < 8) {
      const expiryDate = index === 1 ? "2026-10-11" : index === 2 ? "2026-10-12" : index === 3 ? "2026-11-11" : "2027-03-15";
      const certificate: Certificate = {
        id: ids.next(), employeeId: employee.id, type: "atld", title: "", number: `ATLĐ-MẪU-${String(index + 1).padStart(3, "0")}`, expiryDate, issueDate: "2024-01-15",
        document: { id: `file-${index}`, name: "chung-chi-mau.pdf", mime: "application/pdf", size: 1_024 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null,
      };
      await repositories.certificates.insert(certificate);
    }
  }
  void clock;
  return repositories;
}
