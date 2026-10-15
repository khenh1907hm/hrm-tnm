import type { Employee } from "../employees/types";
import type { Commander } from "./types";

export const DEFAULT_CONTACT_RELATION = "Chỉ Huy Trưởng Công trường";

/**
 * Người liên hệ khẩn cấp theo dự án: một nhân sự được chọn làm chỉ huy trưởng khi xuất hồ sơ.
 * Lấy tên, số điện thoại, địa chỉ (ưu tiên địa chỉ hiện tại); quan hệ mặc định "Chỉ Huy Trưởng Công trường".
 */
export function contactFromEmployee(employee: Pick<Employee, "id" | "name" | "phone" | "address" | "currentAddress">, relation: string = DEFAULT_CONTACT_RELATION): Commander {
  return {
    id: `employee:${employee.id}`,
    name: employee.name,
    role: relation.trim() || DEFAULT_CONTACT_RELATION,
    phone: employee.phone,
    address: employee.currentAddress?.trim() || employee.address,
    archived: false,
    version: 1,
  };
}
