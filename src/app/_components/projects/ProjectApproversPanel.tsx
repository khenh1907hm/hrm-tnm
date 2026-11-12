"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Crown, GripVertical, ShieldCheck, X } from "lucide-react";
import { ROLE_LABELS, type ApprovalRole } from "../../../modules/purchases/approval";
import type { ProjectMember } from "../../../modules/projects/types";
import { directorPeople, projectApprovers, setProjectApprovers, type ApprovalMode } from "../accountApi";
import type { Notify } from "../Toast";
import { errorMessage } from "./projectShared";

/** Thứ tự vai trò ký theo chuỗi duyệt của công ty. */
export const APPROVER_ROLES: readonly ApprovalRole[] = ["pic", "technical", "material", "accounting", "leader", "admin_office"];
export const ROLE_HINTS: Record<ApprovalRole, string> = {
  pic: "Ngoài PM của dự án",
  technical: "Ký ngân sách, đơn hàng, báo cáo giải thích",
  material: "Ký yêu cầu vật tư, đơn hàng",
  accounting: "Ký đơn hàng, xác nhận dự án",
  leader: "Quyền cao nhất: xác nhận cả cây, ký là phiếu được duyệt",
  admin_office: "Sau khi duyệt: nhận đơn để phát hành PO",
};
export const MODE_LABELS: Record<ApprovalMode, string> = { any: "Một người trong khối duyệt là đủ", sequence: "Lần lượt từng người (theo cấp, từ trên xuống)" };
/** Tối đa người trong một khung (ngang quyền: một trong số họ duyệt là đủ). */
export const FRAME_MAX = 2;

export type ApproverDraft = { role: ApprovalRole; employeeId: string; code: string; name: string };
export type Participant = { id: string; code: string; name: string };

/** Chọn kiểu duyệt của một khối (dùng ở trang Quy trình duyệt chung). */
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

/** Danh sách người có thứ tự (cấp 1, 2…), đổi chỗ, bỏ người (trang Quy trình duyệt chung). */
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

/** Thành viên tham gia dự án (bỏ trùng, bỏ người đã rời dự án), cộng PM. */
export function participantsOf(members: readonly ProjectMember[], today: string): Participant[] {
  const seen = new Map<string, Participant>();
  for (const member of members) {
    if (!member.employeeId || (member.leftOn && member.leftOn < today)) continue;
    if (!seen.has(member.employeeId)) seen.set(member.employeeId, { id: member.employeeId, code: member.employeeCode, name: member.displayName });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

const DRAG_TYPE = "application/x-tnm-approver";

/**
 * Cây khung duyệt: khung trên cùng tới dưới theo thứ tự ký; mỗi khung tối đa 2 người ngang quyền (một người duyệt là đủ).
 * Khung dưới cùng (Lãnh đạo) quyền cao nhất, Giám đốc luôn có sẵn. Kéo người từ danh sách thành viên tham gia vào khung.
 */
export function ApproverFrames(props: { value: ApproverDraft[]; onChange: (next: ApproverDraft[]) => void; participants: readonly Participant[]; directors: readonly { employeeId: string; name: string }[]; readOnly?: boolean }) {
  const [over, setOver] = useState<ApprovalRole | null>(null);
  const directorIds = new Set(props.directors.map((item) => item.employeeId));
  const inFrame = (role: ApprovalRole) => props.value.filter((item) => item.role === role && !(role === "leader" && directorIds.has(item.employeeId)));
  const add = (role: ApprovalRole, person: Participant, fromRole?: ApprovalRole) => {
    if (props.readOnly) return;
    if (role === "leader" && directorIds.has(person.id)) return;
    let next = fromRole ? props.value.filter((item) => !(item.role === fromRole && item.employeeId === person.id)) : props.value;
    if (next.some((item) => item.role === role && item.employeeId === person.id)) { props.onChange(next); return; }
    if (next.filter((item) => item.role === role && !(role === "leader" && directorIds.has(item.employeeId))).length >= FRAME_MAX) return;
    next = [...next, { role, employeeId: person.id, code: person.code, name: person.name }];
    props.onChange(next);
  };
  const remove = (role: ApprovalRole, id: string) => props.onChange(props.value.filter((item) => !(item.role === role && item.employeeId === id)));
  const onDrop = (role: ApprovalRole, event: React.DragEvent) => {
    event.preventDefault();
    setOver(null);
    try {
      const data = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "null") as { person: Participant; from?: ApprovalRole } | null;
      if (data) add(role, data.person, data.from);
    } catch { /* kéo thứ khác vào */ }
  };
  const dragStart = (event: React.DragEvent, person: Participant, from?: ApprovalRole) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ person, from }));
  };

  const frame = (role: ApprovalRole, extraClass = "") => {
    const people = inFrame(role);
    const full = people.length >= FRAME_MAX;
    const choices = props.participants.filter((person) => !people.some((item) => item.employeeId === person.id) && !(role === "leader" && directorIds.has(person.id)));
    return (
      <div key={role} className={`ap-frame ${extraClass}${over === role && !full ? " over" : ""}`}
        onDragOver={(event) => { if (!props.readOnly && !full) { event.preventDefault(); setOver(role); } }}
        onDragLeave={() => setOver((current) => (current === role ? null : current))}
        onDrop={(event) => onDrop(role, event)}>
        <div className="ap-frame-head"><b>{ROLE_LABELS[role]}</b><small className="muted">{ROLE_HINTS[role]}</small></div>
        <div className="ap-frame-people">
          {role === "leader" && props.directors.map((item) => <span key={item.employeeId} className="ap-chip director" title="Giám đốc luôn có quyền duyệt cao nhất"><Crown size={12} aria-hidden="true" /> {item.name} · Giám đốc</span>)}
          {people.map((item) => (
            <span key={item.employeeId} className="ap-chip" draggable={!props.readOnly} onDragStart={(event) => dragStart(event, { id: item.employeeId, code: item.code, name: item.name }, role)}>
              {!props.readOnly && <GripVertical size={12} aria-hidden="true" />}{item.name}
              {!props.readOnly && <button type="button" aria-label={`Bỏ ${item.name} khỏi ${ROLE_LABELS[role]}`} onClick={() => remove(role, item.employeeId)}><X size={12} aria-hidden="true" /></button>}
            </span>
          ))}
          {!people.length && role !== "leader" && <small className="muted ap-frame-empty">{role === "pic" ? "PM của dự án" : "Trống: dùng người của khối chung công ty"}{props.readOnly ? "" : " · kéo người vào đây"}</small>}
          {!props.readOnly && !full && choices.length > 0 && (
            <select className="ap-frame-add" aria-label={`Thêm người vào ${ROLE_LABELS[role]}`} value="" onChange={(event) => { const person = props.participants.find((item) => item.id === event.target.value); if (person) add(role, person); }}>
              <option value="">+ Thêm</option>
              {choices.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          )}
        </div>
        {people.length === FRAME_MAX && <small className="muted">2 người ngang quyền: một người duyệt là đủ.</small>}
      </div>
    );
  };

  return (
    <div className="ap-tree">
      <div className="ap-pool">
        <b>Thành viên tham gia</b>
        <small className="muted">{props.readOnly ? "Người trong dự án." : "Kéo tên vào khung bên cạnh (điện thoại: dùng ô “+ Thêm” trong khung)."}</small>
        <div className="ap-pool-list">
          {props.participants.length ? props.participants.map((person) => (
            <span key={person.id} className="ap-chip" draggable={!props.readOnly} onDragStart={(event) => dragStart(event, person)}>
              {!props.readOnly && <GripVertical size={12} aria-hidden="true" />}{person.name}
            </span>
          )) : <small className="muted">Chưa có thành viên. Thêm người ở phần Thành viên tham gia trước.</small>}
        </div>
      </div>
      <div className="ap-frames">
        {(["pic", "technical", "material", "accounting"] as const).map((role) => frame(role))}
        {frame("leader", "top")}
        {frame("admin_office", "after")}
      </div>
    </div>
  );
}

/**
 * Mục "Phân quyền & duyệt" của dự án: kéo thành viên vào khung duyệt.
 * Khung có đặt người thì chỉ những người đó (cùng Admin, Giám đốc) ký; để trống thì theo khối chung của công ty.
 */
export function ProjectApproversPanel(props: { projectId: string; canEdit: boolean; members: readonly ProjectMember[]; today: string; setNotice: Notify }) {
  const [saved, setSaved] = useState<ApproverDraft[] | null>(null);
  const [draft, setDraft] = useState<ApproverDraft[]>([]);
  const [directors, setDirectors] = useState<{ employeeId: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([projectApprovers(props.projectId), directorPeople().catch(() => [])]).then(([list, boss]) => {
      if (active) { setSaved(list); setDraft(list); setDirectors(boss); }
    }, () => { if (active) { setSaved([]); setDraft([]); } });
    return () => { active = false; };
  }, [props.projectId]);
  if (!saved) return <div className="loading">Đang tải người duyệt…</div>;
  const key = (list: ApproverDraft[]) => JSON.stringify(list.map((item) => [item.role, item.employeeId]).sort());
  const dirty = key(saved) !== key(draft);
  const participants = participantsOf(props.members, props.today);
  // Người đã đặt trước đây nhưng không còn trong danh sách thành viên: vẫn hiện để bỏ ra được
  for (const item of draft) if (!participants.some((person) => person.id === item.employeeId)) participants.push({ id: item.employeeId, code: item.code, name: item.name });
  const save = async () => {
    setBusy(true);
    try {
      await setProjectApprovers(props.projectId, draft.map(({ role, employeeId }) => ({ role, employeeId })), {});
      setSaved(draft);
      props.setNotice("Đã lưu khung duyệt của dự án. Phiếu gửi từ bây giờ sẽ đi theo khung này.", "success");
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  return (
    <section className="panel pj-section">
      <h2><ShieldCheck className="ico" size={18} aria-hidden="true" /> Phân quyền & người duyệt</h2>
      <p className="muted">Phiếu của dự án ký từ khung trên xuống. Mỗi khung tối đa 2 người ngang quyền: một trong hai duyệt là đủ. Khung <b>Lãnh đạo</b> ở dưới cùng là quyền cao nhất,
        xác nhận cả cây; Giám đốc luôn có sẵn ở đó và duyệt ngay được không cần các khung trên. Người được kéo vào khung xem được dự án và nhận thông báo khi đến lượt.</p>
      <ApproverFrames value={draft} onChange={setDraft} participants={participants} directors={directors} readOnly={!props.canEdit} />
      {props.canEdit && <div className="button-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        {dirty && <button type="button" className="button" disabled={busy} onClick={() => setDraft(saved)}>Hoàn tác</button>}
        <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu khung duyệt"}</button>
      </div>}
      {!props.canEdit && <p className="muted"><small>Chỉ Admin, Giám đốc, người quản lý dự án hoặc PM sửa được khung này.</small></p>}
    </section>
  );
}
