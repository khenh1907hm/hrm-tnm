"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Crown, Plus, Send, Trash2, Users } from "lucide-react";
import { COMPANY_ROLES, COMPANY_ROLE_LABELS, roleToken, tokenRole } from "../../modules/purchases/companyRoles";
import { saveCompanyTree, type ApprovalBlock, type TreeDocType } from "./accountApi";
import { EmployeePicker } from "./projects/ProjectsPage";
import { ModePicker, OrderedPeople } from "./projects/ProjectApproversPanel";
import { errorMessage, type EmployeeSource } from "./projects/projectShared";
import type { Notify } from "./Toast";

const LEADER = "Lãnh đạo";
const blankLeader = (): ApprovalBlock => ({ name: LEADER, mode: "any", people: [roleToken("leader")] });

/**
 * Cây duyệt mặc định của công ty cho một loại phiếu: Người gửi (tự ký) → các khối → Lãnh đạo (cuối, ký là duyệt).
 * Mỗi khối gồm chức danh (lấy người đang giữ chức danh lúc gửi phiếu) và/hoặc người cụ thể. Áp cho mọi dự án chưa có cây riêng.
 */
export function CompanyTreeEditor(props: { docType: TreeDocType; title: string; initial: ApprovalBlock[]; names: Record<string, string>; departments: Record<string, string[]>;
  employees: EmployeeSource; canEdit: boolean; setNotice: Notify; onSaved: (blocks: ApprovalBlock[]) => void }) {
  const start = props.initial.length ? props.initial : [blankLeader()];
  const [blocks, setBlocks] = useState<ApprovalBlock[]>(() => start.map((block) => ({ ...block, people: [...block.people] })));
  const [names, setNames] = useState(props.names);
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const saved = JSON.stringify(start);
  const dirty = JSON.stringify(blocks) !== saved;
  const leaderAt = blocks.length - 1;
  const readOnly = !props.canEdit;

  const label = (token: string) => {
    const role = tokenRole(token);
    if (!role) return names[token] ?? "Người đã xóa";
    const people = (props.departments[role] ?? []).map((id) => names[id] ?? "?");
    return `${COMPANY_ROLE_LABELS[role]}${people.length ? ` (${people.join(", ")})` : " (chưa có người)"}`;
  };
  const update = (index: number, patch: Partial<ApprovalBlock>) => setBlocks((list) => list.map((block, at) => at === index ? { ...block, ...patch } : block));
  const move = <T,>(list: readonly T[], index: number, delta: number) => { const next = [...list]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item!); return next; };
  const add = (index: number, token: string) => update(index, { people: blocks[index]!.people.includes(token) ? blocks[index]!.people : [...blocks[index]!.people, token] });
  const save = async (next: ApprovalBlock[]) => {
    setBusy(true);
    try {
      const cleaned = next.map((block, index) => ({ ...block, name: index === next.length - 1 ? LEADER : block.name.trim() || `Khối ${index + 1}` }));
      await saveCompanyTree(props.docType, cleaned);
      setBlocks(cleaned.length ? cleaned : [blankLeader()]);
      props.onSaved(cleaned);
      props.setNotice(`Đã lưu quy trình duyệt ${props.title}. Mọi dự án chưa có cây riêng đi theo cây này từ phiếu gửi tiếp theo.`, "success");
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };

  return (
    <div className="ct-editor">
      <div className="ap-frame top"><div className="ap-frame-head"><Send size={14} aria-hidden="true" /><b>Người gửi</b><small className="muted">tự ký khi gửi phiếu</small></div></div>
      {blocks.map((block, index) => {
        const isLeader = index === leaderAt;
        const roleTokens = new Set(block.people.filter((token) => tokenRole(token)));
        return (
          <div key={index} className={`ap-frame${isLeader ? " leader" : ""}`}>
            <div className="ap-frame-head ct-head">
              {isLeader ? <><Crown size={14} aria-hidden="true" /><b>{LEADER}</b><small className="muted">khối cuối, ký là duyệt; Giám đốc luôn duyệt được</small></>
                : <input className="ct-name" aria-label="Tên khối" value={block.name} placeholder={`Khối ${index + 1}`} disabled={readOnly} onChange={(event) => update(index, { name: event.target.value })} />}
              {!readOnly && !isLeader && <span className="ct-tools">
                <button type="button" className="link-button" aria-label="Đưa khối lên" disabled={index === 0} onClick={() => setBlocks(move(blocks, index, -1))}><ArrowUp size={14} aria-hidden="true" /></button>
                <button type="button" className="link-button" aria-label="Đưa khối xuống" disabled={index >= leaderAt - 1} onClick={() => setBlocks(move(blocks, index, 1))}><ArrowDown size={14} aria-hidden="true" /></button>
                <button type="button" className="link-button" aria-label="Xóa khối" onClick={() => setBlocks(blocks.filter((_, at) => at !== index))}><Trash2 size={14} aria-hidden="true" /></button>
              </span>}
            </div>
            {block.people.length ? (
              <OrderedPeople roleLabel={block.name || LEADER} readOnly={readOnly} sequence={block.mode === "sequence"} people={block.people.map((token) => ({ id: token, label: label(token) }))}
                onMove={(at, delta) => update(index, { people: move(block.people, at, delta) })} onRemove={(at) => update(index, { people: block.people.filter((_, i) => i !== at) })} />
            ) : <small className="muted ap-frame-empty">{isLeader ? "Chưa chọn: Giám đốc duyệt" : "Chưa có ai: khối này được bỏ qua"}</small>}
            {(block.people.length > 1 || roleTokens.size > 0) && <ModePicker name={`ct-${props.docType}-${index}`} value={block.mode} disabled={readOnly} onChange={(mode) => update(index, { mode })} />}
            {!readOnly && <div className="ct-add">
              <select aria-label="Thêm chức danh" value="" onChange={(event) => { if (event.target.value) add(index, event.target.value); }}>
                <option value="">+ Thêm chức danh…</option>
                {COMPANY_ROLES.filter((role) => !roleTokens.has(roleToken(role.key))).map((role) => <option key={role.key} value={roleToken(role.key)}>{role.label}</option>)}
              </select>
              <EmployeePicker key={`${index}-${pickerKey}`} label="" source={props.employees} exclude={new Set(block.people)} onPick={(option) => {
                if (!option) return;
                setNames((current) => ({ ...current, [option.id]: option.name }));
                add(index, option.id);
                setPickerKey((value) => value + 1);
              }} />
            </div>}
          </div>
        );
      })}
      {!readOnly && <button type="button" className="button" onClick={() => setBlocks([...blocks.slice(0, leaderAt), { name: "", mode: "any", people: [] }, blocks[leaderAt]!])}><Plus className="ico" size={15} aria-hidden="true" /> Thêm khối trước Lãnh đạo</button>}
      <p className="muted ct-note"><Users size={13} aria-hidden="true" /> Chức danh lấy người đang giữ chức danh lúc gửi phiếu, đổi người ở mục Chức danh là cây tự theo. Dự án nào cài cây riêng (tab Quy trình duyệt của dự án) thì dùng cây riêng.</p>
      {!readOnly && <div className="button-row">
        {dirty && <button type="button" className="button" disabled={busy} onClick={() => setBlocks(JSON.parse(saved) as ApprovalBlock[])}>Hoàn tác</button>}
        {props.initial.length > 0 && <button type="button" className="button danger" disabled={busy} onClick={() => { if (window.confirm("Bỏ cây mặc định này? Phiếu sẽ đi theo quy trình chung theo chức danh.")) void save([]); }}>Bỏ cây</button>}
        <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save(blocks)}>{busy ? "Đang lưu…" : "Lưu quy trình duyệt"}</button>
      </div>}
    </div>
  );
}
