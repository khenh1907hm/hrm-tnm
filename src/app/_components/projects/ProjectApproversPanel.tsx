"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ShieldCheck, X } from "lucide-react";
import { ROLE_LABELS, type ApprovalRole } from "../../../modules/purchases/approval";
import { projectApprovalModes, projectApprovers, setProjectApprovers, type ApprovalMode, type ApprovalModes } from "../accountApi";
import type { Notify } from "../Toast";
import { EmployeePicker } from "./ProjectsPage";
import { errorMessage, type EmployeeSource } from "./projectShared";

/** Thứ tự vai trò ký theo chuỗi duyệt của công ty. */
export const APPROVER_ROLES: readonly ApprovalRole[] = ["pic", "technical", "material", "accounting", "leader", "admin_office"];
export const ROLE_HINTS: Record<ApprovalRole, string> = {
  pic: "Ngoài PM của dự án",
  technical: "Ký ngân sách, đơn hàng, báo cáo giải thích",
  material: "Ký yêu cầu vật tư, đơn hàng",
  accounting: "Ký đơn hàng, xác nhận dự án",
  leader: "Bước quyết định: ký là phiếu được duyệt",
  admin_office: "Nhận đơn đã duyệt để phát hành PO",
};
export const MODE_LABELS: Record<ApprovalMode, string> = { any: "Một người trong khối duyệt là đủ", sequence: "Lần lượt từng người (theo cấp, từ trên xuống)" };

export type ApproverDraft = { role: ApprovalRole; employeeId: string; code: string; name: string };

/** Chọn kiểu duyệt của một khối (chỉ có ý nghĩa khi khối có từ 2 người). */
export function ModePicker(props: { value: ApprovalMode; onChange: (mode: ApprovalMode) => void; disabled?: boolean; name: string }) {
  return (
    <div className="ap-mode" role="radiogroup" aria-label="Kiểu duyệt">
      {(Object.keys(MODE_LABELS) as ApprovalMode[]).map((mode) => (
        <label key={mode} className={props.value === mode ? "on" : undefined}>
          <input type="radio" name={props.name} checked={props.value === mode} disabled={props.disabled} onChange={() => props.onChange(mode)} /> {MODE_LABELS[mode]}
        </label>
      ))}
    </div>
  );
}

/** Danh sách người có thứ tự (cấp 1, 2…), đổi chỗ, bỏ người. */
export function OrderedPeople(props: { people: { id: string; label: string }[]; sequence: boolean; readOnly?: boolean; onMove: (index: number, delta: -1 | 1) => void; onRemove: (index: number) => void; roleLabel: string }) {
  return (
    <ol className={`ap-people${props.sequence ? " seq" : ""}`}>
      {props.people.map((person, index) => (
        <li key={person.id} className="ap-person">
          {props.sequence && props.people.length > 1 && <span className="ap-level">Cấp {index + 1}</span>}
          <span>{person.label}</span>
          {!props.readOnly && <>
            {props.people.length > 1 && <>
              <button type="button" aria-label={`Đưa ${person.label} lên`} disabled={index === 0} onClick={() => props.onMove(index, -1)}><ArrowUp size={12} aria-hidden="true" /></button>
              <button type="button" aria-label={`Đưa ${person.label} xuống`} disabled={index === props.people.length - 1} onClick={() => props.onMove(index, 1)}><ArrowDown size={12} aria-hidden="true" /></button>
            </>}
            <button type="button" aria-label={`Bỏ ${person.label} khỏi ${props.roleLabel}`} onClick={() => props.onRemove(index)}><X size={12} aria-hidden="true" /></button>
          </>}
        </li>
      ))}
    </ol>
  );
}

/** Ô chọn người duyệt cho từng vai trò (dùng khi tạo dự án và trong mục Phân quyền & duyệt). */
export function ApproverEditor(props: { value: ApproverDraft[]; onChange: (next: ApproverDraft[]) => void; modes: ApprovalModes; onModesChange: (next: ApprovalModes) => void; employees: EmployeeSource; readOnly?: boolean }) {
  const [picker, setPicker] = useState(0);
  return (
    <div className="ap-editor">
      {APPROVER_ROLES.map((role) => {
        const list = props.value.filter((item) => item.role === role);
        const taken = new Set(list.map((item) => item.employeeId));
        const mode = props.modes[role] ?? "any";
        const replace = (next: ApproverDraft[]) => props.onChange([...props.value.filter((item) => item.role !== role), ...next]);
        return (
          <div key={role} className="ap-editor-row">
            <div className="ap-editor-role"><b>{ROLE_LABELS[role]}</b><small className="muted">{ROLE_HINTS[role]}</small></div>
            <div className="ap-editor-people">
              {list.length ? (
                <OrderedPeople roleLabel={ROLE_LABELS[role]} readOnly={Boolean(props.readOnly)} sequence={mode === "sequence" && role !== "pic"}
                  people={list.map((item) => ({ id: item.employeeId, label: `${item.code ? `${item.code} · ` : ""}${item.name}` }))}
                  onMove={(index, delta) => { const next = [...list]; const [moved] = next.splice(index, 1); next.splice(index + delta, 0, moved!); replace(next); }}
                  onRemove={(index) => replace(list.filter((_, i) => i !== index))} />
              ) : <small className="muted">{role === "pic" ? "PM của dự án" : "Theo bộ phận chung của công ty"}</small>}
              {list.length > 1 && role !== "pic" && <ModePicker name={`mode-${role}`} value={mode} disabled={Boolean(props.readOnly)} onChange={(next) => props.onModesChange({ ...props.modes, [role]: next })} />}
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
  const [saved, setSaved] = useState<{ list: ApproverDraft[]; modes: ApprovalModes } | null>(null);
  const [draft, setDraft] = useState<ApproverDraft[]>([]);
  const [modes, setModes] = useState<ApprovalModes>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([projectApprovers(props.projectId), projectApprovalModes(props.projectId)]).then(([list, loadedModes]) => {
      if (active) { setSaved({ list, modes: loadedModes }); setDraft(list); setModes(loadedModes); }
    }, () => { if (active) { setSaved({ list: [], modes: {} }); setDraft([]); setModes({}); } });
    return () => { active = false; };
  }, [props.projectId]);
  if (!saved) return <div className="loading">Đang tải người duyệt…</div>;
  const key = (list: ApproverDraft[], m: ApprovalModes) => JSON.stringify([list.map((item) => [item.role, item.employeeId]), APPROVER_ROLES.map((role) => m[role] ?? "any")]);
  const dirty = key(saved.list, saved.modes) !== key(draft, modes);
  const save = async () => {
    setBusy(true);
    try {
      await setProjectApprovers(props.projectId, draft.map(({ role, employeeId }) => ({ role, employeeId })), modes);
      setSaved({ list: draft, modes });
      props.setNotice("Đã lưu người duyệt của dự án. Phiếu gửi từ bây giờ sẽ đi theo danh sách này.", "success");
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  return (
    <section className="panel pj-section">
      <h2><ShieldCheck className="ico" size={18} aria-hidden="true" /> Phân quyền & người duyệt</h2>
      <p className="muted">Ai ký từng bước của ngân sách, đơn hàng, yêu cầu vật tư, đề nghị thanh toán, xác nhận dự án thuộc dự án này. Khối có từ 2 người thì chọn
        <b> một người duyệt là đủ</b> hoặc <b>lần lượt từng cấp</b> (sắp thứ tự bằng mũi tên). Người được đặt ở đây xem được dự án để ký và nhận thông báo khi đến lượt.
        Giám đốc luôn duyệt được ngay mà không cần các bước trước.</p>
      <ApproverEditor value={draft} onChange={setDraft} modes={modes} onModesChange={setModes} employees={props.employees} readOnly={!props.canEdit} />
      {props.canEdit && <div className="button-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        {dirty && <button type="button" className="button" disabled={busy} onClick={() => { setDraft(saved.list); setModes(saved.modes); }}>Hoàn tác</button>}
        <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu người duyệt"}</button>
      </div>}
      {!props.canEdit && <p className="muted"><small>Chỉ Admin, Giám đốc, người quản lý dự án hoặc PM sửa được danh sách này.</small></p>}
    </section>
  );
}
