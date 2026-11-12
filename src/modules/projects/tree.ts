import type { ProjectMember } from "./types";

export type MemberNode = { member: ProjectMember; children: MemberNode[] };

const ROLE_ORDER = ["pm", "commander", "supervisor", "engineer", "leader", "worker", "member"];
const byRoleThenName = (a: ProjectMember, b: ProjectMember) =>
  ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.team.localeCompare(b.team, "vi") || a.displayName.localeCompare(b.displayName, "vi");

/**
 * PRJ-06: dựng cây từ parentId. Người có parentId trỏ ra ngoài dự án (hoặc nằm trong vòng lặp) được treo vào danh sách gốc
 * để không bị mất khỏi sơ đồ.
 */
export function buildMemberTree(members: readonly ProjectMember[]): MemberNode[] {
  const ids = new Set(members.map((member) => member.id));
  const children = new Map<string, ProjectMember[]>();
  for (const member of members) {
    if (member.parentId && ids.has(member.parentId)) children.set(member.parentId, [...(children.get(member.parentId) ?? []), member]);
  }
  const visited = new Set<string>();
  const build = (member: ProjectMember): MemberNode => {
    visited.add(member.id);
    return { member, children: (children.get(member.id) ?? []).filter((child) => !visited.has(child.id)).sort(byRoleThenName).map(build) };
  };
  const roots = members.filter((member) => !member.parentId || !ids.has(member.parentId)).sort(byRoleThenName).map(build);
  // Thành viên nằm trong vòng lặp (không đi tới được từ gốc nào)
  const orphans: MemberNode[] = [];
  for (const member of [...members].sort(byRoleThenName)) if (!visited.has(member.id)) orphans.push(build(member));
  return [...roots, ...orphans];
}

/** PRJ-06: đổi quản lý của memberId sang newParentId có tạo vòng lặp không (kể cả tự quản lý chính mình). */
export function wouldCreateCycle(members: readonly ProjectMember[], memberId: string, newParentId: string | null): boolean {
  let cursor = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === memberId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = members.find((member) => member.id === cursor)?.parentId ?? null;
  }
  return false;
}

export type TreeIssue = "TREE_NO_ROOT" | "TREE_MANY_ROOTS" | "TREE_CYCLE" | "TREE_HAS_CHILDREN";

/** PRJ-06: mỗi dự án đúng một gốc, không có vòng lặp. */
export function treeIssues(members: readonly ProjectMember[]): TreeIssue[] {
  if (!members.length) return [];
  const ids = new Set(members.map((member) => member.id));
  const roots = members.filter((member) => !member.parentId || !ids.has(member.parentId));
  const issues: TreeIssue[] = [];
  if (roots.length === 0) issues.push("TREE_NO_ROOT");
  if (roots.length > 1) issues.push("TREE_MANY_ROOTS");
  const parentOf = new Map(members.map((member) => [member.id, member.parentId]));
  const inCycle = (start: string) => {
    const seen = new Set<string>();
    for (let cursor = parentOf.get(start) ?? null; cursor && ids.has(cursor); cursor = parentOf.get(cursor) ?? null) {
      if (cursor === start) return true;
      if (seen.has(cursor)) return false;
      seen.add(cursor);
    }
    return false;
  };
  if (members.some((member) => inCycle(member.id))) issues.push("TREE_CYCLE");
  return issues;
}

/** PRJ-06: người còn cấp dưới thì phải chuyển cấp dưới sang người khác trước khi rời dự án. */
export const directReports = (members: readonly ProjectMember[], memberId: string) => members.filter((member) => member.parentId === memberId);

/** Các tổ (team) trong dự án, sắp theo tên. */
export function teamsOf(members: readonly ProjectMember[]): string[] {
  return [...new Set(members.map((member) => member.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
}

/** Thành viên còn trong dự án tại ngày đã cho. */
export const activeOn = (member: ProjectMember, date: string) => member.joinedOn <= date && (member.leftOn === null || member.leftOn >= date);
