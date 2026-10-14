import { failure, issue, success, type Result } from "../../lib/result";
import { compareNormalizedText } from "../../lib/text";
import type { Actor } from "../../modules/auth/permissions";
import { archiveCertificateType, createCertificateType, sortCertificateTypes, updateCertificateType } from "../../modules/certificate-types/rules";
import { certificateTypeInputSchema } from "../../modules/certificate-types/schema";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import { err, type HrAppContext } from "../context";

export function createCertificateTypeUseCases(ctx: HrAppContext) {
  const { deps, repositories, has, writeAudit } = ctx;

  const certificateTypeUseCases = {
    list: async (actor: Actor, includeArchived = false): Promise<Result<CertificateTypeRecord[]>> => {
      if (!has(actor, "certificateTypeRead")) return err("FORBIDDEN");
      const all = await repositories.certificateTypes.list();
      return success(includeArchived && actor.role === "admin" ? all.sort((a, b) => a.sortOrder - b.sortOrder || compareNormalizedText(a.name, b.name) || compareNormalizedText(a.id, b.id)) : sortCertificateTypes(all));
    },
    create: async (actor: Actor, input: { name: string; englishName?: string | null; requiredForPositions: CertificateTypeRecord["requiredForPositions"] }): Promise<Result<CertificateTypeRecord>> => {
      if (!has(actor, "certificateTypeWrite")) return err("FORBIDDEN");
      const shape = certificateTypeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => issue("CTYPE_INPUT_INVALID", String(item.path[0] ?? "form"))));
      const all = await repositories.certificateTypes.list();
      const result = createCertificateType({ ...shape.data, englishName: shape.data.englishName ?? null }, all, deps.ids.next());
      if (!result.ok) return result;
      await repositories.certificateTypes.insert(result.value);
      await writeAudit(actor, "certificateType.create", "certificateType", result.value.id, null, result.value);
      return result;
    },
    update: async (actor: Actor, input: { id: string; expectedVersion: number; name: string; englishName?: string | null; requiredForPositions: CertificateTypeRecord["requiredForPositions"]; sortOrder: number }): Promise<Result<CertificateTypeRecord>> => {
      if (!has(actor, "certificateTypeWrite")) return err("FORBIDDEN");
      const shape = certificateTypeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => issue("CTYPE_INPUT_INVALID", String(item.path[0] ?? "form"))));
      const before = await repositories.certificateTypes.get(input.id);
      if (!before) return err("CTYPE_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const result = updateCertificateType(before, { ...shape.data, englishName: shape.data.englishName ?? null }, input.sortOrder, await repositories.certificateTypes.list());
      if (!result.ok) return result;
      if (!await repositories.certificateTypes.replace(result.value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificateType.update", "certificateType", result.value.id, before, result.value);
      return result;
    },
    archive: async (actor: Actor, input: { id: string; expectedVersion: number; reason: string }): Promise<Result<CertificateTypeRecord>> => {
      if (!has(actor, "certificateTypeWrite")) return err("FORBIDDEN");
      const before = await repositories.certificateTypes.get(input.id);
      if (!before) return err("CTYPE_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const hasCurrent = (await repositories.certificates.list()).some((certificate) => certificate.type === before.key && certificate.state === "current");
      const result = archiveCertificateType(before, input.reason, hasCurrent);
      if (!result.ok) return result;
      if (!await repositories.certificateTypes.replace(result.value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificateType.archive", "certificateType", result.value.id, before, result.value);
      return result;
    },
  };

  return certificateTypeUseCases;
}
