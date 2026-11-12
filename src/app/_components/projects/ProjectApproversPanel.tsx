"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { ROLE_LABELS, type ApprovalRole } from "../../../modules/purchases/approval";
import { projectApprovers, setProjectApprovers, type ProjectApprover } from "../accountApi";
import type { Notify } from "../Toast";
import { EmployeePicker } from "./ProjectsPage";
import { errorMessage, type EmployeeSource } from "./projectShared";

/** Thứ tự vai trò ký theo chuỗi duyệt của công ty. */
export const APPROVER_ROLES: readonly ApprovalRole[] = ["pic", "technical", "material", "accounting", "leader", "admin_office"];
const ROLE_HINTS: Record<ApprovalRole, string> = {
  pic: "Ngoài PM của dự án",
  technical: "Ký ngân sách, đơn hàng, báo cáo giải thích",
  material: "Ký yêu cầu vật tư, đơn hàng",
  accounting: "Ký đơn hàng, xác nhận dự án",
  leader: "Bước quyết định: ký là phiếu được duyệt",
  admin_office: "Nhận đơn đã duyệt để phát hành PO",
};

export type ApproverDraft = { role: ApprovalRole; employeeId: string; code: string; name: string };

/** Ô chọn người duyệt cho từng vai trò (dùng khi tạo dự án và trong mục Phân quyền & duyệt). */
export function ApproverEditor(props: { value: ApproverDraft[]; onChange: (next: ApproverDraft[]) => void; employees: EmployeeSource; readOnly?: boolean }) {
  const [picker, setPicker] = useState(0);
  return (
    <div className="ap-editor">
      {APPROVER_ROLES.map((role) => {
        const list = props.value.filter((item) => item.role === role);
        const taken = new Set(list.map((item) => item.employeeId));
        return (
          <div key={role} className="ap-editor-row">
            <div className="ap-editor-role"><b>{ROLE_LABELS[role]}</b><small className="muted">{ROLE_HINTS[role]}</small></div>
            <div className="ap-editor-people">
              {list.length ? list.map((item) => (
                <span key={item.employeeId} className="pill ap-person">
                  {item.code ? `${item.code} · ` : ""}{item.name}
                  {!props.readOnly && <button type="button" aria-label={`Bỏ ${item.name} khỏi ${ROLE_LABELS[role]}`} onClick={() => props.onChange(props.value.filter((other) => !(other.role === role && other.employeeId === item.employeeId)))}><X size={12} aria-hidden="true" /></button>}
                </span>
              )) : <small className="muted">{role === "pic" ? "PM của dự án" : "Theo bộ phận chung của công ty"}</small>}
              {!props.readOnly && (
                <EmployeePicker key={`${role}-${picker}`} label="" source={props.employees} exclude={taken}
                  onPick={(option) => { if (!option) return; props.onChange([...props.value, { role, employeeId: option.id, code: option.code, name: option.name }]); setPicker((value) => value + 1); }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Mục "Phân quyền & duyệt" của dự án: ai ký từng bước của phiếu thuộc dự án này.
 * Vai trò có đặt người thì chỉ những người đó (cùng Admin, Giám đốc) ký; để trống thì theo bộ phận chung.
 */
export function ProjectApproversPanel(props: { projectId: string; canEdit: boolean; employees: EmployeeSource; setNotice: Notify }) {
  const [saved, setSaved] = useState<ProjectApprover[] | null>(null);
  const [draft, setDraft] = useState<ApproverDraft[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void projectApprovers(props.projectId).then((list) => { if (active) { setSaved(list); setDraft(list); } }, () => { if (active) { setSaved([]); setDraft([]); } });
    return () => { active = false; };
  }, [props.projectId]);
  if (!saved) return <div className="loading">Đang tải người duyệt…</div>;
  const dirty = JSON.stringify(saved.map((item) => [item.role, item.employeeId])) !== JSON.stringify(draft.map((item) => [item.role, item.employeeId]));
  const save = async () => {
    setBusy(true);
    try {
      await setProjectApprovers(props.projectId, draft.map(({ role, employeeId }) => ({ role, employeeId })));
      setSaved(draft);
      props.setNotice("Đã lưu người duyệt của dự án. Phiếu gửi từ bây giờ sẽ đi theo danh sách này.", "success");
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  return (
    <section className="panel pj-section">
      <h2><ShieldCheck className="ico" size={18} aria-hidden="true" /> Phân quyền & người duyệt</h2>
      <p className="muted">Ai ký từng bước của ngân sách, đơn hàng, yêu cầu vật tư, đề nghị thanh toán, xác nhận dự án thuộc dự án này. Người được đặt ở đây xem được dự án để ký,
        và nhận thông báo (chuông, email) khi đến lượt. Giám đốc luôn duyệt được ngay mà không cần các bước trước.</p>
      <ApproverEditor value={draft} onChange={setDraft} employees={props.employees} readOnly={!props.canEdit} />
      {props.canEdit && <div className="button-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        {dirty && <button type="button" className="button" disabled={busy} onClick={() => setDraft(saved)}>Hoàn tác</button>}
        <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu người duyệt"}</button>
      </div>}
      {!props.canEdit && <p className="muted"><small>Chỉ Admin, Giám đốc, người quản lý dự án hoặc PM sửa được danh sách này.</small></p>}
    </section>
  );
}
