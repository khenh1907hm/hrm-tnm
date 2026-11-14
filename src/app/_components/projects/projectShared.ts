import { messagesVi } from "../../../messages.vi";
import type { Issue } from "../../../lib/result";
import type { Actor } from "../../../modules/auth/permissions";
import { hasAccess } from "../../../modules/auth/permissions";
import { errorCode } from "../../../modules/projects/store";
import type { Project, ProjectMember } from "../../../modules/projects/types";

/** Thông báo tiếng Việt cho mã lỗi, thay {name}, {hours}… bằng tham số. */
export function projectText(code: string, params: Record<string, string | number> = {}): string {
  const template = messagesVi[code] ?? "Thao tác không thành công.";
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? "" : typeof value === "number" ? value.toLocaleString("vi-VN") : value;
  });
}

export const issueMessage = (item: Issue) => projectText(item.code, item.params ?? {});

/** Lỗi do store ném ra → câu tiếng Việt ("TS_DAY_OVER_24:Nguyễn A" → "Nguyễn A bị chấm quá 24 giờ…"). */
export function errorMessage(error: unknown): string {
  const { code, detail } = errorCode(error);
  if (code === "PROJECT_SAVE_FAILED" && detail) return `${projectText(code)} (${detail})`;
  return projectText(code, { name: detail, days: detail });
}

/** Người đang xem là ai đối với dự án này (spec mục 2.2). */
export type ProjectViewer = {
  isAdmin: boolean;
  /** Admin hoặc PM: sửa thông tin dự án. */
  isPm: boolean;
  /** PM hoặc Chỉ huy trưởng: duyệt chấm công, xếp thành viên. */
  isLead: boolean;
  /** Các tổ mà người này là tổ trưởng. */
  leaderTeams: string[];
  canSeeMoney: boolean;
  canEditProject: boolean;
};

export function viewerFor(actor: Actor, myEmployeeId: string | null, project: Project, members: readonly ProjectMember[]): ProjectViewer {
  const isAdmin = actor.role === "admin";
  const mine = myEmployeeId ? members.filter((member) => member.projectId === project.id && member.employeeId === myEmployeeId) : [];
  const isPm = isAdmin || (myEmployeeId !== null && project.pmEmployeeId === myEmployeeId) || mine.some((member) => member.role === "pm");
  const isLead = isPm || mine.some((member) => member.role === "commander");
  const leaderTeams = mine.filter((member) => member.role === "leader" && member.team).map((member) => member.team);
  // Tiền (vốn, ngân sách, đơn giá, chi phí): Admin, PM và Chỉ huy trưởng của dự án
  return { isAdmin, isPm, isLead, leaderTeams, canSeeMoney: isLead || hasAccess(actor, "projects.finance"), canEditProject: isPm || hasAccess(actor, "projects.manage") };
}

export const canCreateProject = (actor: Actor) => actor.role === "admin" || hasAccess(actor, "projects.manage");

/** Nhân sự để chọn khi thêm thành viên; null khi người xem không đọc được danh sách nhân sự. */
export type EmployeeOption = { id: string; code: string; name: string; position: string; phone?: string; hasPhoto?: boolean };
export type EmployeeSource = {
  search(query: string): Promise<EmployeeOption[]>;
  /** Một nhân sự theo id (tên, số điện thoại) để điền sơ đồ tổ chức từ hồ sơ. */
  get?(employeeId: string): Promise<EmployeeOption | null>;
  /** Ảnh chân dung của nhân sự (để điền sơ đồ tổ chức); không có thì null. */
  photo?(employeeId: string): Promise<Blob | null>;
  /** Mở hộp xuất của Nhân sự cho các nhân sự này: kèm hồ sơ chung (mẫu hồ sơ) hoặc chỉ thư mục chứng chỉ (.zip). Không có = không được xuất. */
  exportPeople?(employeeIds: readonly string[], withProfile: boolean): Promise<number>;
} | null;

/** Nhập số tiền có dấu chấm ngăn cách: "1.250.000" → 1250000. */
export const parseMoney = (text: string) => Number(text.replace(/[^\d]/g, "")) || 0;
export const moneyInput = (value: number) => value ? value.toLocaleString("vi-VN") : "";
