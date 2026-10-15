import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import type { Signature } from "../../modules/signatures/types";
import { err, type HrAppContext } from "../context";

export function createSignatureUseCases(ctx: HrAppContext) {
  const { deps, repositories: { signatures }, has, writeAudit } = ctx;

  const textInvalid = (value: string) => value.trim().length < 2 || value.trim().length > 100;
  /** Kiểm tra tên, chức danh và ảnh chữ ký (PNG nền trong suốt, tối đa 2 MB). */
  const invalid = (input: { name: string; role: string; file: Signature["file"] }) =>
    textInvalid(input.name) || textInvalid(input.role) || input.file.mime !== "image/png" || input.file.size > 2 * 1024 * 1024 ? "SIG_INVALID" : !input.file.hasTransparency ? "SIG_NOT_TRANSPARENT" : null;

  const signatureUseCases = {
    add: async (actor: Actor, input: Omit<Signature, "id" | "version" | "isDefault">): Promise<Result<Signature>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      const problem = invalid(input);
      if (problem) return err(problem);
      const existing = await signatures.list();
      const value: Signature = { ...input, name: input.name.trim(), role: input.role.trim(), id: deps.ids.next(), version: 1, isDefault: existing.length === 0 };
      await signatures.insert(value); await writeAudit(actor, "signature.add", "signature", value.id, null, value); return success(value);
    },
    /** Sửa tên, chức danh; `file` có thì thay ảnh chữ ký. */
    update: async (actor: Actor, input: { id: string; expectedVersion: number; name: string; role: string; file?: Signature["file"] }): Promise<Result<Signature>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      const before = await signatures.get(input.id);
      if (!before) return err("SIGNATURE_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const value: Signature = { ...before, name: input.name.trim(), role: input.role.trim(), file: input.file ?? before.file, version: before.version + 1 };
      const problem = invalid(value);
      if (problem) return err(problem);
      if (!await signatures.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "signature.update", "signature", value.id, before, value);
      return success(value);
    },
    setDefault: async (actor: Actor, id: string): Promise<Result<Signature>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      const before = await signatures.list();
      if (!before.some((signature) => signature.id === id)) return err("SIGNATURE_NOT_FOUND");
      const after = before.map((signature) => ({ ...signature, isDefault: signature.id === id, version: signature.version + 1 }));
      for (const [index, signature] of after.entries()) {
        if (!await signatures.replace(signature, before[index]!.version)) return err("CONFLICT");
      }
      await writeAudit(actor, "signature.setDefault", "signature", id, before, after);
      return success(after.find((signature) => signature.id === id)!);
    },
    remove: async (actor: Actor, id: string): Promise<Result<void>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      const all = await signatures.list();
      const removed = all.find((signature) => signature.id === id);
      if (!removed) return err("SIGNATURE_NOT_FOUND");
      if (all.length === 1) return err("SIGNATURE_LAST");
      if (!await signatures.remove(id)) return err("SIGNATURE_NOT_FOUND");
      const next = all.find((signature) => signature.id !== id);
      if (removed.isDefault && next) await signatures.replace({ ...next, isDefault: true, version: next.version + 1 }, next.version);
      await writeAudit(actor, "signature.remove", "signature", id, removed, null); return success(undefined);
    },
    list: async (actor: Actor): Promise<Result<Signature[]>> => has(actor, "signatureRead") ? success(await signatures.list()) : err("FORBIDDEN"),
  };

  return signatureUseCases;
}
