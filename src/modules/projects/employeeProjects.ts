import type { Project, ProjectMember } from "./types";

/** Một dự án nhân sự đang tham gia (cột "Dự án" ở danh sách nhân sự). */
export type EmployeeProject = { id: string; code: string; name: string; active: boolean };

/**
 * Gom dự án theo nhân sự: chỉ tính lần tham gia còn hiệu lực (chưa rời, hoặc ngày rời từ hôm nay trở đi),
 * bỏ dự án đã lưu trữ. Dự án đang thi công xếp trước, rồi theo mã.
 */
export function projectsByEmployee(members: readonly ProjectMember[], projects: readonly Project[], today: string): Record<string, EmployeeProject[]> {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const out: Record<string, EmployeeProject[]> = {};
  for (const member of members) {
    if (member.leftOn && member.leftOn < today) continue;
    const project = byId.get(member.projectId);
    if (!project || project.status === "archived") continue;
    const list = (out[member.employeeId] ??= []);
    if (!list.some((item) => item.id === project.id)) list.push({ id: project.id, code: project.code, name: project.name, active: project.status === "active" });
  }
  for (const list of Object.values(out)) list.sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
  return out;
}
