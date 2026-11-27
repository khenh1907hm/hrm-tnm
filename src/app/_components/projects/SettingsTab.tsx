"use client";
import { useState } from "react";
import { HardHat, Pencil, Save, UserCog } from "lucide-react";
import { isLink } from "../../../lib/mapsLink";
import { MEMBER_ROLE_LABELS, PROJECT_STATUS_LABELS, type MemberRole, type ProjectMember } from "../../../modules/projects/types";
import type { TabProps } from "./ProjectDetail";
import { EmployeePicker, formatDateVn } from "./ProjectsPage";
import { errorMessage, type EmployeeOption } from "./projectShared";

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const active = (member: ProjectMember, today: string) => !member.leftOn || member.leftOn >= today;

/**
 * Cài đặt riêng của một dự án: nhân sự chủ chốt (PM, Chỉ huy trưởng) và thông tin chung.
 * PM lưu ở dự án (pmEmployeeId) và là thành viên vai trò PM; Chỉ huy trưởng là thành viên vai trò "commander".
 * Đổi người: người cũ chuyển về vai trò Thành viên (không xóa, giữ lịch sử chấm công).
 */
export function SettingsTab(props: TabProps & { onEditInfo: () => void }) {
  const { store, data, viewer, setNotice } = props;
  const { project, members, today } = data;
  const canEdit = viewer.canEditProject;
  const holder = (role: MemberRole) => members.find((member) => member.role === role && active(member, today)) ?? null;
  const pm = members.find((member) => member.employeeId === project.pmEmployeeId && active(member, today)) ?? holder("pm");
  const commander = holder("commander");
  const [editing, setEditing] = useState<MemberRole | null>(null);
  const [picked, setPicked] = useState<EmployeeOption | null>(null);
  const [busy, setBusy] = useState(false);

  /** Gán một người vào vai trò: người đang giữ vai trò về Thành viên; người được chọn là thành viên thì đổi vai trò, chưa thì thêm mới. */
  const assign = async (role: "pm" | "commander", option: EmployeeOption) => {
    setBusy(true);
    try {
      for (const member of members.filter((item) => item.role === role && active(item, today) && item.employeeId !== option.id)) {
        await store.saveMember({ ...member, role: "member" });
      }
      const existing = members.find((member) => member.employeeId === option.id && active(member, today));
      if (existing) {
        if (existing.role !== role) await store.saveMember({ ...existing, role });
      } else {
        await store.saveMember({ projectId: project.id, employeeId: option.id, displayName: option.name, employeeCode: option.code, role, parentId: role === "pm" ? null : pm?.id ?? null, team: "", subcontractId: null, joinedOn: today, leftOn: null });
      }
      if (role === "pm") {
        const input: Partial<typeof project> = { ...project, pmEmployeeId: option.id };
        delete input.updatedAt;
        await store.saveProject(input as Parameters<typeof store.saveProject>[0]);
      }
      setEditing(null); setPicked(null);
      await props.reload();
      setNotice(`Đã đặt ${MEMBER_ROLE_LABELS[role]}: ${option.name}.`, "success");
    } catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };

  const roleCard = (role: "pm" | "commander", label: string, person: ProjectMember | null, hint: string) => (
    <div className="ps-role">
      <div className="ps-role-head">
        <span className="ps-role-icon" aria-hidden="true">{role === "pm" ? <UserCog size={18} /> : <HardHat size={18} />}</span>
        <div>
          <b>{label}</b>
          <small className="muted">{hint}</small>
        </div>
      </div>
      {editing === role ? (
        <div className="ps-role-edit">
          <EmployeePicker label={`Chọn ${label.toLowerCase()}`} source={props.employees} onPick={setPicked} />
          <div className="button-row">
            <button type="button" className="button primary" disabled={!picked || busy} onClick={() => picked && void assign(role, picked)}><Save className="ico" size={15} aria-hidden="true" /> {busy ? "Đang lưu…" : "Lưu"}</button>
            <button type="button" className="button" disabled={busy} onClick={() => { setEditing(null); setPicked(null); }}>Hủy</button>
          </div>
        </div>
      ) : (
        <div className="ps-role-value">
          {person ? <span><b>{person.displayName}</b> <small className="muted">{person.employeeCode}</small></span> : <span className="warn-text">Chưa đặt</span>}
          {canEdit && <button type="button" className="button" onClick={() => { setEditing(role); setPicked(null); }}>{person ? "Đổi" : "Chọn người"}</button>}
        </div>
      )}
    </div>
  );

  const info: [string, string][] = [
    ["Mã dự án", project.code],
    ["Tên dự án", project.name],
    ["Trạng thái", PROJECT_STATUS_LABELS[project.status]],
    ["Khách hàng", project.customerName || "—"],
    ["Địa điểm công trường", project.site && !isLink(project.site) ? project.site : project.siteLat !== null ? "Đã ghim trên bản đồ" : "—"],
    ["Thời gian dự kiến", `${formatDateVn(project.plannedStart)} – ${formatDateVn(project.plannedEnd)}`],
    ["Giờ làm", `${project.workStart}–${project.workEnd} · nghỉ trưa ${project.lunchStart}–${project.lunchEnd}`],
    ["Ngày nghỉ trong tuần", project.weeklyOff.length ? project.weeklyOff.map((day) => WEEKDAYS[day]).join(", ") : "Không"],
    ["Chấm công GPS", project.siteLat !== null ? `Bán kính ${project.siteRadiusM} m` : "Chưa đặt vị trí"],
  ];

  return (
    <div className="pj-page">
      <section className="panel pj-section" aria-labelledby="ps-people-title">
        <div className="pj-section-head"><h2 id="ps-people-title">Nhân sự chủ chốt</h2></div>
        <p className="muted">Người phụ trách dự án. Đổi người thì người cũ về vai trò Thành viên, không mất lịch sử chấm công. Các vai trò khác đặt ở tab Org Chart &amp; Members.</p>
        <div className="ps-roles">
          {roleCard("pm", "Quản lý dự án (PM)", pm, "Lập, duyệt việc của dự án; nhận báo cáo")}
          {roleCard("commander", "Chỉ huy trưởng", commander, "Phụ trách công trường: chấm công, báo cáo ngày, nhận hàng")}
        </div>
      </section>

      <section className="panel pj-section" aria-labelledby="ps-info-title">
        <div className="pj-section-head">
          <h2 id="ps-info-title">Thông tin chung</h2>
          {canEdit && <button type="button" className="button" onClick={props.onEditInfo}><Pencil className="ico" size={15} aria-hidden="true" /> Sửa thông tin chung</button>}
        </div>
        <dl className="ps-info">
          {info.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {project.note && <p className="muted">Ghi chú: {project.note}</p>}
      </section>
    </div>
  );
}
