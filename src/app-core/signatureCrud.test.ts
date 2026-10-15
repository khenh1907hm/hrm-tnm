import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };
const hr = { id: "hr", role: "hr" as const };
const png = (id: string, patch: Partial<{ mime: string; size: number; hasTransparency: boolean }> = {}) => ({ id, name: `${id}.png`, mime: "image/png", size: 1000, hasTransparency: true, ...patch });

describe("signature CRUD", () => {
  it("adds, edits (with and without a new image), sets default and removes signatures", async () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("sig") });
    const first = await app.signatures.add(admin, { name: "  Nguyễn Ký  ", role: "Giám đốc", file: png("f1") });
    const second = await app.signatures.add(admin, { name: "Trần Duyệt", role: "Phó giám đốc", file: png("f2") });
    if (!first.ok || !second.ok) throw new Error("add");
    expect(first.value).toMatchObject({ name: "Nguyễn Ký", isDefault: true });
    expect(second.value.isDefault).toBe(false);

    const renamed = await app.signatures.update(admin, { id: second.value.id, expectedVersion: 1, name: "Trần Văn Duyệt", role: "PGĐ kỹ thuật" });
    expect(renamed).toMatchObject({ ok: true, value: { name: "Trần Văn Duyệt", role: "PGĐ kỹ thuật", file: { id: "f2" }, version: 2 } });
    const newImage = await app.signatures.update(admin, { id: second.value.id, expectedVersion: 2, name: "Trần Văn Duyệt", role: "PGĐ kỹ thuật", file: png("f3") });
    expect(newImage.ok && newImage.value.file.id).toBe("f3");

    expect(await app.signatures.update(admin, { id: second.value.id, expectedVersion: 1, name: "X Y", role: "Z W" })).toMatchObject({ ok: false, errors: [{ code: "CONFLICT" }] });
    expect(await app.signatures.update(admin, { id: "missing", expectedVersion: 1, name: "X Y", role: "Z W" })).toMatchObject({ ok: false, errors: [{ code: "SIGNATURE_NOT_FOUND" }] });
    expect(await app.signatures.update(admin, { id: second.value.id, expectedVersion: 3, name: "X", role: "Z W" })).toMatchObject({ ok: false, errors: [{ code: "SIG_INVALID" }] });
    expect(await app.signatures.update(admin, { id: second.value.id, expectedVersion: 3, name: "X Y", role: "Z W", file: png("f4", { hasTransparency: false }) })).toMatchObject({ ok: false, errors: [{ code: "SIG_NOT_TRANSPARENT" }] });
    expect(await app.signatures.update(hr, { id: second.value.id, expectedVersion: 3, name: "X Y", role: "Z W" })).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });

    expect(await app.signatures.setDefault(admin, second.value.id)).toMatchObject({ ok: true, value: { isDefault: true } });
    expect(await app.signatures.remove(admin, second.value.id)).toMatchObject({ ok: true });
    const left = await app.signatures.list(admin);
    expect(left.ok && left.value.map((item) => [item.name, item.isDefault])).toEqual([["Nguyễn Ký", true]]);
    expect(await app.signatures.remove(admin, first.value.id)).toMatchObject({ ok: false, errors: [{ code: "SIGNATURE_LAST" }] });
  });
});
