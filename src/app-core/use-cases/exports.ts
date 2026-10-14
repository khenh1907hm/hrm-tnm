import { isValidISODate } from "../../lib/dates";
import { failure, issue, success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import type { Employee } from "../../modules/employees/types";
import { buildWorkerProfileData } from "../../modules/exports/workerProfile";
import { err, type HrAppContext } from "../context";

export function createExportUseCases(ctx: HrAppContext) {
  const { repositories, state: { signatures }, has, getEmployee } = ctx;

  const exportUseCases = {
    checkReadiness: async (actor: Actor, input: { employeeId: string; signDate: string; signerId: string }): Promise<Result<{ errors: { field: string; code: string }[]; warnings: string[] }>> => {
      if (!has(actor, "export")) return err("FORBIDDEN");
      const employee = await getEmployee(input.employeeId);
      if (!employee) return err("EMP_NOT_FOUND");
      const errors: { field: string; code: string }[] = [];
      const required: [keyof Employee, string][] = [["name", "name"], ["dob", "dob"], ["gender", "gender"], ["home", "home"], ["address", "address"], ["phone", "phone"], ["startDate", "startDate"], ["emergencyContactId", "emergencyContactId"]];
      for (const [key, field] of required) if (!employee[key]) errors.push({ field, code: "EXPORT_FIELD_REQUIRED" });
      if (!isValidISODate(input.signDate)) errors.push({ field: "signDate", code: "SIGN_DATE_INVALID" });
      if (!signatures.some((signature) => signature.id === input.signerId)) errors.push({ field: "signerId", code: "SIGNATURE_NOT_FOUND" });
      if (employee.archivedAt !== null) errors.push({ field: "employeeId", code: "EMP_NOT_READY" });
      const atld = (await repositories.certificates.list()).find((certificate) => certificate.employeeId === employee.id && certificate.type === "atld" && certificate.state === "current" && certificate.expiryDate >= input.signDate);
      const warnings = atld && employee.group === null ? ["EMP_GROUP_INVALID"] : [];
      return success({ errors, warnings });
    },
    buildWorkerProfile: async (actor: Actor, input: { employeeId: string; signDate: string; signerId: string; selectedCertificateIds?: string[]; extraCertificateIds?: string[]; includeSupplementary?: boolean; selectedFileIds?: string[] }): Promise<Result<ReturnType<typeof buildWorkerProfileData>>> => {
      const ready = await exportUseCases.checkReadiness(actor, input);
      if (!ready.ok) return ready;
      if (ready.value.errors.length) return failure(ready.value.errors.map((item) => issue(item.code, item.field)), ready.value.warnings.map((code) => issue(code, undefined, "warning")));
      const employee = await getEmployee(input.employeeId);
      const signer = signatures.find((signature) => signature.id === input.signerId);
      if (!employee || !signer) return err("EMP_NOT_FOUND");
      const certificates = await repositories.certificates.list();
      const certificateTypes = await repositories.certificateTypes.list();
      const profileOptions = {
        ...(input.selectedCertificateIds === undefined ? {} : { selectedCertificateIds: input.selectedCertificateIds }),
        ...(input.extraCertificateIds === undefined ? {} : { extraCertificateIds: input.extraCertificateIds }),
        ...(input.includeSupplementary === undefined ? {} : { includeSupplementary: input.includeSupplementary }),
        ...(input.selectedFileIds === undefined ? {} : { selectedFileIds: input.selectedFileIds }),
      };
      const commander = employee.emergencyContactId ? await repositories.commanders.get(employee.emergencyContactId) : null;
      const value = buildWorkerProfileData(employee, certificates, signer, input.signDate, certificateTypes, profileOptions, commander);
      const warnings = ready.value.warnings.map((code) => issue(code, undefined, "warning"));
      if (employee.startDate > input.signDate) warnings.push(issue("EXP_START_AFTER_SIGN", "startDate", "warning"));
      return success(value, warnings);
    },
  };

  return exportUseCases;
}
