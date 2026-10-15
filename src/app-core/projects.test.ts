import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { validateProject } from "../modules/projects/rules";
import type { ProjectInput } from "../modules/projects/types";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };
const hr = { id: "hr", role: "hr" as const };
const base: ProjectInput = { name: "Taikisha – Nhà máy ABC", customer: "Taikisha", location: "Bình Dương", startDate: "2026-10-20", endDate: "2027-03-31", status: "planning", templateId: "tpl-1", memberIds: [], commanderId: null, commanderRelation: "", exportValues: {}, note: "" };

async function setup() {
  const clock = fixedClock("2026-10-12T09:00:00+07:00");
  const app = createHrApp({ clock, ids: sequentialIds("proj"), repositories: await createDemoRepositories(clock, sequentialIds("seed-proj")) });
  const listed = await app.employees.list(admin, { pageSize: 5 });
  if (!listed.ok) throw new Error("seed");
  return { app, ids: listed.value.items.map((item) => item.id) };
}

describe("validateProject", () => {
  it("normalises text, removes duplicate members and defaults the commander relation", () => {
    const result = validateProject({ ...base, name: "  Dự án A  ", memberIds: ["a", "b", "a"], commanderId: "b", startDate: "", endDate: "", templateId: "", exportValues: { projectStartDate: "2026-10-20", empty: "" }, note: " ghi chú " } as unknown as ProjectInput, ["a", "b"]);
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ name: "Dự án A", memberIds: ["a", "b"], commanderId: "b", startDate: null, endDate: null, templateId: null, commanderRelation: "Chỉ Huy Trưởng Công trường", exportValues: { projectStartDate: "2026-10-20" }, note: "ghi chú" });
  });

  it("reports every invalid field", () => {
    const codes = validateProject({ ...base, name: "A", memberIds: ["x"], commanderId: "y", startDate: "2026-13-01", endDate: "2026-01-01", status: "unknown" as never, exportValues: { "1bad": "v" } }, ["a"]).errors.map((item) => item.code);
    expect(codes).toEqual(["PROJECT_NAME_INVALID", "PROJECT_MEMBER_NOT_FOUND", "PROJECT_COMMANDER_NOT_MEMBER", "PROJECT_DATE_INVALID", "PROJECT_DATE_ORDER", "PROJECT_STATUS_INVALID", "PROJECT_VALUES_INVALID"]);
    expect(validateProject({ ...base, memberIds: Array.from({ length: 501 }, (_, index) => `e${index}`) }, Array.from({ length: 501 }, (_, index) => `e${index}`)).errors.map((item) => item.code)).toEqual(["PROJECT_MEMBERS_INVALID"]);
  });
});

describe("project use cases", () => {
  it("creates, updates, archives and restores a project with members and a site commander", async () => {
    const { app, ids } = await setup();
    const created = await app.projects.create(hr, { ...base, memberIds: ids, commanderId: ids[2]! });
    if (!created.ok) throw new Error(created.errors[0]?.code);
    expect(created.value).toMatchObject({ version: 1, memberIds: ids, commanderId: ids[2], commanderRelation: "Chỉ Huy Trưởng Công trường", archivedAt: null });

    expect(await app.projects.create(admin, { ...base, memberIds: ids.slice(0, 2), commanderId: ids[3]! })).toMatchObject({ ok: false, errors: [{ code: "PROJECT_COMMANDER_NOT_MEMBER" }] });

    const updated = await app.projects.update(admin, { ...created.value, status: "active", memberIds: ids.slice(0, 3), expectedVersion: 1 });
    expect(updated).toMatchObject({ ok: true, value: { status: "active", version: 2 } });
    expect(await app.projects.update(admin, { ...created.value, expectedVersion: 1 })).toMatchObject({ ok: false, errors: [{ code: "CONFLICT" }] });
    expect(await app.projects.update(admin, { ...created.value, name: "", expectedVersion: 2 })).toMatchObject({ ok: false, errors: [{ code: "PROJECT_NAME_INVALID" }] });
    expect(await app.projects.update(admin, { ...created.value, id: "missing", expectedVersion: 1 })).toMatchObject({ ok: false, errors: [{ code: "PROJECT_NOT_FOUND" }] });

    // Thành viên bị lưu trữ sau khi vào dự án vẫn giữ được khi sửa dự án
    const member = await app.employees.get(admin, ids[0]!);
    if (!member.ok) throw new Error("member");
    await app.employees.archive(admin, { id: ids[0]!, expectedVersion: member.value.version, reason: "Nghỉ việc" });
    expect(await app.projects.update(admin, { ...created.value, memberIds: ids.slice(0, 3), note: "giữ người cũ", expectedVersion: 2 })).toMatchObject({ ok: true, value: { version: 3 } });

    const archived = await app.projects.archive(admin, { id: created.value.id, expectedVersion: 3 });
    expect(archived.ok && archived.value.archivedAt).toBeTruthy();
    const active = await app.projects.list(admin);
    expect(active.ok && active.value.map((item) => item.id)).not.toContain(created.value.id);
    const all = await app.projects.list(admin, true);
    expect(all.ok && all.value.map((item) => item.id)).toContain(created.value.id);
    expect(await app.projects.archive(admin, { id: created.value.id, expectedVersion: 3 })).toMatchObject({ ok: false, errors: [{ code: "CONFLICT" }] });
    expect(await app.projects.restore(admin, { id: created.value.id, expectedVersion: 4 })).toMatchObject({ ok: true, value: { archivedAt: null, version: 5 } });
    expect(await app.projects.restore(admin, { id: created.value.id, expectedVersion: 4 })).toMatchObject({ ok: false, errors: [{ code: "CONFLICT" }] });
    expect(await app.projects.get(hr, created.value.id)).toMatchObject({ ok: true });
    expect(await app.projects.get(hr, "missing")).toMatchObject({ ok: false, errors: [{ code: "PROJECT_NOT_FOUND" }] });
    expect(await app.projects.archive(admin, { id: "missing", expectedVersion: 1 })).toMatchObject({ ok: false });
    expect(await app.projects.restore(admin, { id: "missing", expectedVersion: 1 })).toMatchObject({ ok: false });
  });

  it("sorts the most recently updated project first", async () => {
    const { app } = await setup();
    await app.projects.create(admin, { ...base, name: "Dự án 1" });
    const second = await app.projects.create(admin, { ...base, name: "Dự án 2" });
    if (!second.ok) throw new Error("create");
    const list = await app.projects.list(admin);
    expect(list.ok && list.value.map((item) => item.name)).toEqual(expect.arrayContaining(["Dự án 1", "Dự án 2", "Taikisha – Nhà máy mẫu Bình Dương"]));
  });
});
