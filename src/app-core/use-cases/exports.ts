import { isValidISODate } from "../../lib/dates";
import { failure, issue, success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import type { Employee } from "../../modules/employees/types";
import { buildWorkerProfileData } from "../../modules/exports/workerProfile";
import type { RosterData } from "../../modules/exports/employeeRoster";
import { currentSafetyGroup } from "../../modules/certificates/safetyGroup";
import { err, type HrAppContext } from "../context";
import { isValidOn } from "../../modules/certificates/status";

export function createExportUseCases(ctx: HrAppContext) {
  const { repositories, has, getEmployee, writeAudit, today } = ctx;
  const signatureRepository = repositories.signatures;

  const exportUseCases = {
    checkReadiness: async (actor: Actor, input: { employeeId: string; signDate: string; signerId: string }): Promise<Result<{ errors: { field: string; code: string }[]; warnings: string[] }>> => {
      if (!has(actor, "export")) return err("FORBIDDEN");
      const employee = await getEmployee(input.employeeId);
      if (!employee) return err("EMP_NOT_FOUND");
      const errors: { field: string; code: string }[] = [];
      const required: [keyof Employee, string][] = [["name", "name"], ["dob", "dob"], ["gender", "gender"], ["home", "home"], ["address", "address"], ["phone", "phone"], ["startDate", "startDate"]];
      for (const [key, field] of required) if (!employee[key]) errors.push({ field, code: "EXPORT_FIELD_REQUIRED" });
      if (!isValidISODate(input.signDate)) errors.push({ field: "signDate", code: "SIGN_DATE_INVALID" });
      const signatures = await signatureRepository.list();
      if (!signatures.some((signature) => signature.id === input.signerId)) errors.push({ field: "signerId", code: "SIGNATURE_NOT_FOUND" });
      if (employee.archivedAt !== null) errors.push({ field: "employeeId", code: "EMP_NOT_READY" });
      const atld = (await repositories.certificates.list()).find((certificate) => certificate.employeeId === employee.id && certificate.type === "atld" && certificate.state === "current" && isValidOn(certificate.expiryDate, input.signDate));
      const warnings = atld && currentSafetyGroup(employee, [atld]) === null ? ["EMP_GROUP_INVALID"] : [];
      return success({ errors, warnings });
    },
    buildWorkerProfile: async (actor: Actor, input: { employeeId: string; signDate: string; signerId: string; selectedCertificateIds?: string[]; extraCertificateIds?: string[]; includeSupplementary?: boolean; selectedFileIds?: string[]; contact?: { name: string; role: string; phone: string; address: string } | null }): Promise<Result<ReturnType<typeof buildWorkerProfileData>>> => {
      const ready = await exportUseCases.checkReadiness(actor, input);
      if (!ready.ok) return ready;
      if (ready.value.errors.length) return failure(ready.value.errors.map((item) => issue(item.code, item.field)), ready.value.warnings.map((code) => issue(code, undefined, "warning")));
      const employee = await getEmployee(input.employeeId);
      const signer = (await signatureRepository.list()).find((signature) => signature.id === input.signerId);
      if (!employee || !signer) return err("EMP_NOT_FOUND");
      const certificates = await repositories.certificates.list();
      const certificateTypes = await repositories.certificateTypes.list();
      const profileOptions = {
        ...(input.selectedCertificateIds === undefined ? {} : { selectedCertificateIds: input.selectedCertificateIds }),
        ...(input.extraCertificateIds === undefined ? {} : { extraCertificateIds: input.extraCertificateIds }),
        ...(input.includeSupplementary === undefined ? {} : { includeSupplementary: input.includeSupplementary }),
        ...(input.selectedFileIds === undefined ? {} : { selectedFileIds: input.selectedFileIds }),
      };
      // Liên hệ khẩn cấp chọn theo dự án khi xuất; không truyền thì dùng dữ liệu cũ (nếu có)
      const commander = input.contact !== undefined ? input.contact : employee.emergencyContactId ? await repositories.commanders.get(employee.emergencyContactId) : null;
      const value = buildWorkerProfileData(employee, certificates, signer, input.signDate, certificateTypes, profileOptions, commander);
      const warnings = ready.value.warnings.map((code) => issue(code, undefined, "warning"));
      if (employee.startDate > input.signDate) warnings.push(issue("EXP_START_AFTER_SIGN", "startDate", "warning"));
      return success(value, warnings);
    },
    /** Dữ liệu bảng tổng hợp nhân sự đã chọn (CCCD đầy đủ, có ghi nhật ký). */
    employeeRoster: async (actor: Actor, input: { employeeIds: readonly string[] }): Promise<Result<RosterData>> => {
      if (!has(actor, "export") || !has(actor, "employeeReveal")) return err("FORBIDDEN");
      const ids = [...new Set(input.employeeIds)];
      if (!ids.length || ids.length > 1000) return err("EXPORT_SELECTION_INVALID");
      const [allEmployees, allCertificates, types] = await Promise.all([repositories.employees.list(), repositories.certificates.list(), repositories.certificateTypes.list()]);
      const employees = allEmployees.filter((employee) => ids.includes(employee.id)).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
      if (employees.length !== ids.length) return err("EMP_NOT_FOUND");
      const certificates = allCertificates.filter((certificate) => certificate.state === "current" && ids.includes(certificate.employeeId));
      await writeAudit(actor, "employee.roster.export", "employee", employees.map((employee) => employee.id).join(","), null, { count: employees.length, codes: employees.map((employee) => employee.code) });
      return success({
        employees, certificates,
        certificateTypes: types.filter((type) => !type.archived).map((type) => ({ key: type.key, name: type.name, requiredForPositions: type.requiredForPositions })),
        today: today(), exportedBy: actor.id,
      });
    },
  };

  return exportUseCases;
}
