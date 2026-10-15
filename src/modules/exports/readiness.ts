import { isValidISODate } from "../../lib/dates";
import type { Employee } from "../employees/types";
import type { Signature } from "../signatures/types";
import type { Issue } from "../../lib/result";
import { issue } from "../../lib/result";

export function checkWorkerProfileReadiness(employee: Employee, signDate: string, signerId: string, signatures: Signature[]): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (employee.archivedAt !== null) errors.push(issue("EMP_NOT_READY", "employeeId"));
  for (const field of ["name", "dob", "gender", "home", "address", "phone", "startDate"] as const) {
    if (!employee[field]) errors.push(issue("EXPORT_FIELD_REQUIRED", field));
  }
  if (!isValidISODate(signDate)) errors.push(issue("SIGN_DATE_INVALID", "signDate"));
  if (!signatures.some((signature) => signature.id === signerId)) errors.push(issue("SIGNATURE_NOT_FOUND", "signerId"));
  if (!employee.group) warnings.push(issue("EMP_GROUP_INVALID", "group", "warning"));
  return { errors, warnings };
}
