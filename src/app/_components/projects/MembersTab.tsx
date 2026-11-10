"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, UserPlus } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import { buildMemberTree, directReports, teamsOf, treeIssues, wouldCreateCycle, type MemberNode } from "../../../modules/projects/tree";
import { MEMBER_ROLE_LABELS, MEMBER_ROLES, type MemberRole, type ProjectMember } from "../../../modules/projects/types";
import type { TabProps } from "./ProjectDetail";
import { EmployeePicker } from "./ProjectsPage";
import { errorMessage, moneyInput, parseMoney, projectText, type EmployeeOption } from "./projectShared";

const initials = (name: string) => name.trim().split(/\s+/).slice(-2).map((part) => part[0] ?? "").join("").toUpperCase();

/** Sơ đồ dự án dạng cây (spec 3.3): thêm người, đổi quản lý (kéo thả hoặc sửa), đơn giá riêng (chỉ PM). */
export function MembersTab({ store, data, viewer, employees, reload, setNotice }: TabProps) {
  const [form, setForm] = useState<ProjectMember | "new" | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tree = useMemo(() => buildMemberTree(data.members), [data.members]);
  const issues = treeIssues(data.members);
  const canEdit = viewer.isLead;

  const move = async (memberId: string, parentId: string | null) => {
    const member = data.members.find((item) => item.id === memberId);
    if (!member || member.parentId === parentId) return;
    if (wouldCreateCycle(data.members, memberId, parentId)) { setNotice(projectText("TREE_CYCLE"), "error"); return; }
    try { await store.saveMember({ ...member, parentId }); setNotice(`Đã chuyển ${member.displayName} sang quản lý mới.`, "success"); await reload(); }
    catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const remove = async (member: ProjectMember) => {
    if (directReports(data.members, member.id).length) { setNotice(projectText("TREE_HAS_CHILDREN"), "error"); return; }
    if (!window.confirm(`Xóa ${member.displayName} khỏi dự án? Nếu người này đã có chấm công, hãy nhập ngày rời dự án thay vì xóa.`)) return;
    try { await store.removeMember(member.id); setNotice("Đã xóa khỏi dự án.", "success"); await reload(); }
    catch (error) { setNotice(errorMessage(error), "error"); }
  };

  const renderNode = (node: MemberNode) => {
    const { member } = node;
    const open = !collapsed.has(member.id);
    const left = member.leftOn !== null && member.leftOn < data.today;
    return (
      <li key={member.id}>
        <div className="pj-node" data-drop={dropTarget === member.id} draggable={canEdit}
          onDragStart={(event) => { setDragging(member.id); event.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { setDragging(null); setDropTarget(null); }}
          onDragOver={(event) => { if (dragging && dragging !== member.id) { event.preventDefault(); setDropTarget(member.id); } }}
          onDragLeave={() => setDropTarget((current) => current === member.id ? null : current)}
          onDrop={(event) => { event.preventDefault(); if (dragging) void move(dragging, member.id); setDragging(null); setDropTarget(null); }}>
          <button type="button" className="pj-toggle" aria-label={open ? "Thu gọn" : "Mở rộng"} disabled={!node.children.length} onClick={() => setCollapsed((current) => { const next = new Set(current); if (open) next.add(member.id); else next.delete(member.id); return next; })}>
            {node.children.length ? open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" /> : null}
          </button>
          <span className="pj-avatar" aria-hidden="true">{initials(member.displayName)}</span>
          <span className="pj-who">
            <b>{member.displayName}{left && <span className="pill" style={{ marginLeft: 6 }}>Đã rời</span>}</b>
            <small>{MEMBER_ROLE_LABELS[member.role]}{member.team ? ` · ${member.team}` : ""}{member.subcontractId ? ` · ${data.subcontracts.find((item) => item.id === member.subcontractId)?.name ?? "Thầu phụ"}` : ""} · {member.employeeCode}</small>
          </span>
          {canEdit && <span className="pj-actions">
            <button type="button" className="button icon-button" aria-label={`Sửa ${member.displayName}`} onClick={() => setForm(member)}><Pencil size={14} aria-hidden="true" /></button>
            <button type="button" className="button danger icon-button" aria-label={`Xóa ${member.displayName}`} onClick={() => void remove(member)}><Trash2 size={14} aria-hidden="true" /></button>
          </span>}
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <section className="panel pj-section" aria-labelledby="pj-members-title">
      <div className="pj-section-head">
        <h2 id="pj-members-title">Sơ đồ dự án ({data.members.length} người)</h2>
        {canEdit && <button type="button" className="button primary" onClick={() => setForm("new")}><UserPlus className="ico" size={16} aria-hidden="true" /> Thêm thành viên</button>}
      </div>
      {issues.length > 0 && <p className="warn-text" role="status">{issues.map((code) => projectText(code)).join(" ")}</p>}
      {canEdit && data.members.length > 1 && <small className="muted">Kéo một người thả vào người khác để đổi quản lý trực tiếp.</small>}
      {!data.members.length ? <p className="muted">Chưa có thành viên. Bắt đầu bằng PM, rồi chỉ huy trưởng, tổ trưởng và tổ viên.</p> : <ul className="pj-tree">{tree.map(renderNode)}</ul>}
      {form && <MemberFormModal tab={{ store, data, viewer, employees, reload, setNotice }} editing={form === "new" ? null : form} onClose={() => setForm(null)} />}
    </section>
  );
}

function MemberFormModal(props: { tab: Pick<TabProps, "store" | "data" | "viewer" | "employees" | "reload" | "setNotice">; editing: ProjectMember | null; onClose: () => void }) {
  const { store, data, viewer, employees, reload, setNotice } = props.tab;
  const editing = props.editing;
  const ownRate = editing ? data.memberRates.find((rate) => rate.memberId === editing.id)?.hourlyRate ?? null : null;
  const [person, setPerson] = useState<EmployeeOption | null>(null);
  const [role, setRole] = useState<MemberRole>(editing?.role ?? (data.members.length ? "worker" : "pm"));
  const [parentId, setParentId] = useState<string | null>(editing?.parentId ?? data.members.find((member) => member.role === "pm")?.id ?? null);
  const [team, setTeam] = useState(editing?.team ?? "");
  const [subcontractId, setSubcontractId] = useState<string | null>(editing?.subcontractId ?? null);
  const [joinedOn, setJoinedOn] = useState(editing?.joinedOn ?? (data.today > data.project.plannedStart ? data.today : data.project.plannedStart));
  const [leftOn, setLeftOn] = useState<string | null>(editing?.leftOn ?? null);
  const [rate, setRate] = useState(ownRate);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const exclude = useMemo(() => new Set(data.members.map((member) => member.employeeId)), [data.members]);
  const teams = teamsOf(data.members);
  const parents = data.members.filter((member) => member.id !== editing?.id && !(editing && wouldCreateCycle(data.members, editing.id, member.id)));

  const submit = async () => {
    if (!editing && !person) { setError("Chọn nhân sự."); return; }
    if ((role === "leader" || role === "worker") && !team.trim()) { setError("Tổ trưởng và tổ viên phải thuộc một tổ."); return; }
    if (leftOn && leftOn < joinedOn) { setError("Ngày rời phải sau ngày vào dự án."); return; }
    if (editing && leftOn && data.members.some((member) => member.parentId === editing.id && (member.leftOn === null || member.leftOn > leftOn))) { setError(projectText("TREE_HAS_CHILDREN")); return; }
    setBusy(true); setError("");
    try {
      const saved = await store.saveMember({
        ...(editing ? { id: editing.id } : {}), projectId: data.project.id, employeeId: editing?.employeeId ?? person!.id, displayName: editing?.displayName ?? person!.name, employeeCode: editing?.employeeCode ?? person!.code,
        role, parentId, team: team.trim(), subcontractId, joinedOn, leftOn,
      });
      if (viewer.canSeeMoney && rate !== ownRate) await store.setMemberRate(saved.id, rate);
      setNotice(editing ? "Đã lưu thành viên." : `Đã thêm ${saved.displayName} vào dự án.`, "success");
      props.onClose();
      await reload();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="pj-member-title" style={{ maxWidth: 620 }}>
        <header><h2 id="pj-member-title">{editing ? `Sửa ${editing.displayName}` : "Thêm thành viên"}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid">
          {!editing && <div style={{ gridColumn: "1 / -1" }}><EmployeePicker label="Nhân sự *" source={employees} exclude={exclude} onPick={setPerson} /></div>}
          <label className="field"><span>Vai trò trong dự án</span><select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>{MEMBER_ROLES.map((key) => <option key={key} value={key}>{MEMBER_ROLE_LABELS[key]}</option>)}</select></label>
          <label className="field"><span>Quản lý trực tiếp</span><select value={parentId ?? ""} onChange={(event) => setParentId(event.target.value || null)}>
            <option value="">— Không có (đứng đầu sơ đồ) —</option>
            {parents.map((member) => <option key={member.id} value={member.id}>{member.displayName} ({MEMBER_ROLE_LABELS[member.role]}{member.team ? `, ${member.team}` : ""})</option>)}
          </select></label>
          <label className="field"><span>Tổ / đội</span><input list="pj-teams" value={team} placeholder="vd: Tổ điện 1" onChange={(event) => setTeam(event.target.value)} /><datalist id="pj-teams">{teams.map((item) => <option key={item} value={item} />)}</datalist></label>
          <label className="field"><span>Thuộc thầu phụ</span><select value={subcontractId ?? ""} onChange={(event) => setSubcontractId(event.target.value || null)}>
            <option value="">Nhân viên công ty</option>
            {data.subcontracts.filter((item) => item.mode === "timesheet").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>{viewer.canSeeMoney && !data.subcontracts.some((item) => item.mode === "timesheet") && <small className="field-hint">Thêm thầu phụ “chấm công theo người” ở tab Chi phí.</small>}</label>
          <label className="field"><span>Ngày vào dự án</span><input type="date" value={joinedOn} onChange={(event) => setJoinedOn(event.target.value)} /></label>
          <label className="field"><span>Ngày rời dự án</span><input type="date" value={leftOn ?? ""} onChange={(event) => setLeftOn(event.target.value || null)} /></label>
          {viewer.canSeeMoney && <label className="field" style={{ gridColumn: "1 / -1" }}><span>Đơn giá riêng trong dự án (VNĐ/giờ)</span><input inputMode="numeric" placeholder="Để trống: dùng đơn giá chung của người này" value={rate === null ? "" : moneyInput(rate)} onChange={(event) => setRate(event.target.value.trim() ? parseMoney(event.target.value) : null)} />{rate !== null && <small className="field-hint">{formatVnd(rate)}/giờ</small>}</label>}
          {error && <p className="form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}
        </div>
        <footer><button type="button" className="button" onClick={props.onClose}>Hủy</button><button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? "Đang lưu…" : "Lưu"}</button></footer>
      </section>
    </div>
  );
}
