import { describe, expect, it } from "vitest";
import { projectsByEmployee } from "./employeeProjects";
import type { Project, ProjectMember } from "./types";

const project = (id: string, code: string, status: Project["status"]) => ({ id, code, name: `Dự án ${code}`, status }) as Project;
const member = (employeeId: string, projectId: string, leftOn: string | null = null) => ({ id: `${employeeId}-${projectId}`, employeeId, projectId, leftOn }) as ProjectMember;

describe("projectsByEmployee", () => {
  it("chỉ lấy dự án đang tham gia (chưa rời, chưa lưu trữ), dự án đang thi công xếp trước", () => {
    const projects = [project("p1", "B02", "active"), project("p2", "A01", "planning"), project("p3", "C03", "archived"), project("p4", "D04", "active")];
    const result = projectsByEmployee([member("e1", "p2"), member("e1", "p1"), member("e1", "p3"), member("e1", "p4", "2026-11-01"), member("e2", "p4", "2026-12-01")], projects, "2026-11-16");
    expect(result.e1?.map((item) => item.code)).toEqual(["B02", "A01"]);
    expect(result.e2?.map((item) => item.code)).toEqual(["D04"]);
  });
});
