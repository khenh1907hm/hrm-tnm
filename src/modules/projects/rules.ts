import { isValidISODate } from "../../lib/dates";
import { issue, type Issue } from "../../lib/result";
import { DEFAULT_CONTACT_RELATION } from "../commanders/fromEmployee";
import { PROJECT_STATUS_LABELS, type ProjectInput } from "./types";

const MAX_MEMBERS = 500;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * Chuẩn hóa và kiểm tra dự án.
 * - `activeEmployeeIds`: nhân sự còn hoạt động (không lưu trữ) — chỉ những người này được thêm vào dự án.
 */
export function validateProject(input: ProjectInput, activeEmployeeIds: readonly string[]): { value: ProjectInput; errors: Issue[] } {
  const errors: Issue[] = [];
  const name = input.name.trim();
  if (name.length < 2 || name.length > 150) errors.push(issue("PROJECT_NAME_INVALID", "name"));
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length > MAX_MEMBERS) errors.push(issue("PROJECT_MEMBERS_INVALID", "memberIds"));
  if (memberIds.some((id) => !activeEmployeeIds.includes(id))) errors.push(issue("PROJECT_MEMBER_NOT_FOUND", "memberIds"));
  if (input.commanderId !== null && !memberIds.includes(input.commanderId)) errors.push(issue("PROJECT_COMMANDER_NOT_MEMBER", "commanderId"));
  const startDate = input.startDate || null, endDate = input.endDate || null;
  for (const [field, value] of [["startDate", startDate], ["endDate", endDate]] as const) {
    if (value !== null && !isValidISODate(value)) errors.push(issue("PROJECT_DATE_INVALID", field));
  }
  if (startDate && endDate && endDate < startDate) errors.push(issue("PROJECT_DATE_ORDER", "endDate"));
  if (!(input.status in PROJECT_STATUS_LABELS)) errors.push(issue("PROJECT_STATUS_INVALID", "status"));
  const exportValues = Object.fromEntries(Object.entries(input.exportValues).filter(([, value]) => value !== ""));
  if (Object.entries(exportValues).some(([key, value]) => !KEY.test(key) || value.length > 500)) errors.push(issue("PROJECT_VALUES_INVALID", "exportValues"));
  return {
    errors,
    value: {
      name, customer: input.customer.trim(), location: input.location.trim(), startDate, endDate, status: input.status,
      templateId: input.templateId || null, memberIds, commanderId: input.commanderId || null,
      commanderRelation: input.commanderRelation.trim() || DEFAULT_CONTACT_RELATION, exportValues, note: input.note.trim().slice(0, 2000),
    },
  };
}
