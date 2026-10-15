import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { contactFromEmployee } from "../modules/commanders/fromEmployee";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };

describe("project emergency contact chosen at export time", () => {
  it("fills the worker profile with the chosen site commander and no longer requires a stored contact", async () => {
    const clock = fixedClock("2026-10-12T09:00:00+07:00");
    const repositories = await createDemoRepositories(clock, sequentialIds("seed-contact"));
    const app = createHrApp({ clock, ids: sequentialIds("contact"), repositories });
    const listed = await app.employees.list(admin, { pageSize: 3 });
    const signature = await app.signatures.add(admin, { name: "Nguyễn Ký", role: "Giám đốc", file: { id: "sig", name: "sig.png", mime: "image/png", size: 100, hasTransparency: true } });
    if (!listed.ok || !signature.ok) throw new Error("seed");
    const [worker, , manager] = listed.value.items;
    // Hồ sơ cũ không có người liên hệ vẫn xuất được
    await repositories.employees.replace({ ...(await repositories.employees.get(worker!.id))!, emergencyContactId: null }, worker!.version);
    const signerId = signature.value.id;
    const ready = await app.exports.checkReadiness(admin, { employeeId: worker!.id, signDate: "2026-10-12", signerId });
    expect(ready.ok && ready.value.errors).toEqual([]);

    const contact = contactFromEmployee(manager!);
    const built = await app.exports.buildWorkerProfile(admin, { employeeId: worker!.id, signDate: "2026-10-12", signerId, contact });
    if (!built.ok) throw new Error(built.errors[0]?.code);
    expect(built.value.emergencyContact).toMatchObject({ name: manager!.name, role: "Chỉ Huy Trưởng Công trường", phone: manager!.phone });

    const blank = await app.exports.buildWorkerProfile(admin, { employeeId: worker!.id, signDate: "2026-10-12", signerId, contact: null });
    expect(blank.ok && blank.value.emergencyContact).toBeFalsy();
  });
});
