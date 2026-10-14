import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import type { Signature } from "../../modules/signatures/types";
import { err, type HrAppContext } from "../context";

export function createSignatureUseCases(ctx: HrAppContext) {
  const { deps, state: { signatures }, has, writeAudit } = ctx;

  const signatureUseCases = {
    add: async (actor: Actor, input: Omit<Signature, "id" | "version" | "isDefault">): Promise<Result<Signature>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      if (input.name.trim().length < 2 || input.name.trim().length > 100 || input.role.trim().length < 2 || input.role.trim().length > 100 || input.file.mime !== "image/png" || input.file.size > 2 * 1024 * 1024) return err("SIG_INVALID");
      if (!input.file.hasTransparency) return err("SIG_NOT_TRANSPARENT");
      const value: Signature = { ...input, id: deps.ids.next(), version: 1, isDefault: signatures.length === 0 };
      signatures.push(value); await writeAudit(actor, "signature.add", "signature", value.id, null, value); return success(value);
    },
    setDefault: async (actor: Actor, id: string): Promise<Result<Signature>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      const target = signatures.find((signature) => signature.id === id);
      if (!target) return err("SIGNATURE_NOT_FOUND");
      const before = signatures.map((signature) => ({ ...signature }));
      signatures.forEach((signature) => { signature.isDefault = signature.id === id; signature.version += 1; });
      const value = signatures.find((signature) => signature.id === id);
      if (!value) return err("SIGNATURE_NOT_FOUND");
      await writeAudit(actor, "signature.setDefault", "signature", id, before, signatures); return success(value);
    },
    remove: async (actor: Actor, id: string): Promise<Result<void>> => {
      if (!has(actor, "signatureWrite")) return err("FORBIDDEN");
      const index = signatures.findIndex((signature) => signature.id === id);
      if (index < 0) return err("SIGNATURE_NOT_FOUND");
      if (signatures.length === 1) return err("SIGNATURE_LAST");
      const [removed] = signatures.splice(index, 1);
      if (removed?.isDefault) { const next = signatures[0]; if (next) { next.isDefault = true; next.version += 1; } }
      await writeAudit(actor, "signature.remove", "signature", id, removed, null); return success(undefined);
    },
    list: async (actor: Actor): Promise<Result<Signature[]>> => has(actor, "signatureRead") ? success(signatures.map((item) => ({ ...item }))) : err("FORBIDDEN"),
  };

  return signatureUseCases;
}
