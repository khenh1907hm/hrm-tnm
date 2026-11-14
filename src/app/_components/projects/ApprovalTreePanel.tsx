"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Crown, GripVertical, Plus, Send, ShieldCheck, Trash2, X } from "lucide-react";
import type { ProjectMember } from "../../../modules/projects/types";
import { approvalTrees, directorPeople, saveApprovalTree, TREE_FALLBACK, type ApprovalBlock, type ApprovalMode, type TreeDocType } from "../accountApi";
import type { Notify } from "../Toast";
import { participantsOf, type Participant } from "./ProjectApproversPanel";
import { errorMessage } from "./projectShared";

const DRAG_TYPE = "application/x-tnm-block-person";
const LEADER_NAME = "Lãnh đạo";
const MODE_TEXT: Record<ApprovalMode, string> = { any: "Một trong các người duyệt là đủ", sequence: "Lần lượt từng người (trên xuống)" };
export const DOC_TEXT: Record<TreeDocType, string> = {
  contract: "Confirm Contract", budget: "ngân sách (và báo cáo giải thích chưa cài riêng)", explanatory: "báo cáo giải thích",
  material: "yêu cầu vật tư", purchase: "đơn hàng (và RFP, yêu cầu vật tư chưa cài riêng)", payment: "yêu cầu thanh toán (RFP)",
};

const blankLeader = (): ApprovalBlock => ({ name: LEADER_NAME, mode: "any", people: [] });

/**
 * Cây khối duyệt của dự án cho một loại phiếu (cột phải các tab Confirm Contract, Ngân sách, Đặt hàng):
 * Người gửi (tự ký khi gửi) → các khối tự đặt tên (một trong các người, hoặc lần lượt) → Lãnh đạo (cuối cùng, quyền cao nhất).
 * Chỉ Admin, Giám đốc sửa; người khác xem. Chưa cài thì phiếu đi theo quy trình chung của công ty.
 */
export function ApprovalTreePanel(props: { projectId: string; docType: TreeDocType; canEdit: boolean; members: readonly ProjectMember[]; today: string; setNotice: Notify; embedded?: boolean; onSaved?: () => void }) {
  const [saved, setSaved] = useState<ApprovalBlock[] | null>(null);
  const [blocks, setBlocks] = useState<ApprovalBlock[]>([blankLeader()]);
  const [inherited, setInherited] = useState<TreeDocType | null>(null);
  const [directors, setDirectors] = useState<{ employeeId: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<number | null>(null);
  const { projectId, docType } = props;
  useEffect(() => {
    let active = true;
    void Promise.all([approvalTrees(projectId), directorPeople().catch(() => [])]).then(([trees, boss]) => {
      if (!active) return;
      const tree = trees[docType] ?? [];
      // Mục chưa cài riêng: mở sẵn bản sao cây nhóm đang áp dụng để sửa tiếp
      const group = TREE_FALLBACK[docType];
      const fallback = !tree.length && group ? trees[group] ?? [] : [];
      setSaved(tree);
      setInherited(fallback.length ? group! : null);
      const start = tree.length ? tree : fallback;
      setBlocks(start.length ? start.map((block) => ({ ...block, people: [...block.people] })) : [blankLeader()]);
      setDirectors(boss);
    }, () => { if (active) setSaved([]); });
    return () => { active = false; };
  }, [projectId, docType]);
  const shell = `panel pj-section${props.embedded ? " ap-embedded" : " ap-aside"}`;
  if (!saved) return <section className={shell}><div className="loading">Đang tải người duyệt…</div></section>;

  const participants = participantsOf(props.members, props.today);
  const nameOf = (id: string) => participants.find((person) => person.id === id)?.name ?? directors.find((item) => item.employeeId === id)?.name ?? "Người ngoài dự án";
  const directorIds = new Set(directors.map((item) => item.employeeId));
  const readOnly = !props.canEdit;
  const leaderAt = blocks.length - 1;
  const update = (index: number, patch: Partial<ApprovalBlock>) => setBlocks((list) => list.map((block, at) => at === index ? { ...block, ...patch } : block));
  const addPerson = (index: number, person: Participant | string, from?: number) => {
    const id = typeof person === "string" ? person : person.id;
    setBlocks((list) => list.map((block, at) => {
      if (at === from && from !== index) return { ...block, people: block.people.filter((item) => item !== id) };
      if (at !== index || block.people.includes(id) || (at === leaderAt && directorIds.has(id))) return block;
      return { ...block, people: [...block.people, id] };
    }));
  };
  const move = <T,>(list: T[], index: number, delta: number) => { const next = [...list]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item!); return next; };
  const dirty = JSON.stringify(saved.length ? saved : [blankLeader()]) !== JSON.stringify(blocks);
  const save = async (next: ApprovalBlock[]) => {
    setBusy(true);
    try {
      const cleaned = next.map((block, index) => ({ ...block, name: index === next.length - 1 ? LEADER_NAME : block.name.trim() || `Khối ${index + 1}` }));
      await saveApprovalTree(projectId, docType, cleaned);
      setSaved(cleaned);
      setInherited(null);
      setBlocks(cleaned.length ? cleaned : [blankLeader()]);
      props.setNotice(`Đã lưu cây duyệt ${DOC_TEXT[docType]}. Phiếu gửi từ bây giờ đi theo cây này.`, "success");
      props.onSaved?.();
    } catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  const reset = async () => {
    const group = TREE_FALLBACK[docType];
    if (!window.confirm(group ? `Bỏ cây duyệt riêng của mục này? Phiếu sẽ đi theo cây ${DOC_TEXT[group].split(" (")[0]} (nếu có) hoặc quy trình chung của công ty.` : "Bỏ cây duyệt riêng của dự án, dùng quy trình chung của công ty?")) return;
    setBusy(true);
    try { await saveApprovalTree(projectId, docType, []); setSaved([]); setBlocks([blankLeader()]); props.setNotice(group ? "Đã bỏ cây riêng của mục." : "Đã chuyển về quy trình chung.", "success"); props.onSaved?.(); }
    catch (error) { props.setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };

  const onDrop = (index: number, event: React.DragEvent) => {
    event.preventDefault(); setOver(null);
    try {
      const data = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "null") as { id: string; from?: number } | null;
      if (data) addPerson(index, data.id, data.from);
    } catch { /* thả thứ khác */ }
  };
  const drag = (event: React.DragEvent, id: string, from?: number) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id, from })); };

  const blockCard = (block: ApprovalBlock, index: number) => {
    const isLeader = index === leaderAt;
    const choices = participants.filter((person) => !block.people.includes(person.id) && !(isLeader && directorIds.has(person.id)));
    return (
      <div key={index} className={`tb-block${isLeader ? " leader" : ""}${over === index ? " over" : ""}`}
        onDragOver={(event) => { if (!readOnly) { event.preventDefault(); setOver(index); } }}
        onDragLeave={() => setOver((current) => (current === index ? null : current))} onDrop={(event) => onDrop(index, event)}>
        <div className="tb-head">
          <span className="tb-no">{index + 2}</span>
          {isLeader || readOnly
            ? <b>{isLeader ? `${LEADER_NAME} (duyệt cuối)` : block.name || `Khối ${index + 1}`}</b>
            : <input className="tb-name" value={block.name} placeholder={`Khối ${index + 1}`} aria-label="Tên khối" maxLength={60} onChange={(event) => update(index, { name: event.target.value })} />}
          {!readOnly && !isLeader && <span className="tb-tools">
            <button type="button" aria-label="Đưa khối lên" disabled={index === 0} onClick={() => setBlocks((list) => move(list, index, -1))}><ArrowUp size={13} aria-hidden="true" /></button>
            <button type="button" aria-label="Đưa khối xuống" disabled={index >= leaderAt - 1} onClick={() => setBlocks((list) => move(list, index, 1))}><ArrowDown size={13} aria-hidden="true" /></button>
            <button type="button" aria-label="Xóa khối" onClick={() => setBlocks((list) => list.filter((_, at) => at !== index))}><Trash2 size={13} aria-hidden="true" /></button>
          </span>}
        </div>
        {readOnly
          ? (block.people.length > 1 && <small className="muted">{MODE_TEXT[block.mode]}</small>)
          : <select className="tb-mode" value={block.mode} aria-label="Kiểu duyệt của khối" onChange={(event) => update(index, { mode: event.target.value as ApprovalMode })}>
            {(Object.keys(MODE_TEXT) as ApprovalMode[]).map((mode) => <option key={mode} value={mode}>{MODE_TEXT[mode]}</option>)}
          </select>}
        <ol className={`tb-people${block.mode === "sequence" && block.people.length > 1 ? " seq" : ""}`}>
          {isLeader && directors.map((item) => <li key={item.employeeId} className="ap-chip director"><Crown size={12} aria-hidden="true" /> {item.name} · Giám đốc</li>)}
          {block.people.map((id, at) => (
            <li key={id} className="ap-chip" draggable={!readOnly} onDragStart={(event) => drag(event, id, index)}>
              {!readOnly && <GripVertical size={12} aria-hidden="true" />}
              {block.mode === "sequence" && block.people.length > 1 && <span className="ap-level">{at + 1}</span>}
              {nameOf(id)}
              {!readOnly && <>
                {block.mode === "sequence" && block.people.length > 1 && <button type="button" aria-label="Lên" disabled={at === 0} onClick={() => update(index, { people: move(block.people, at, -1) })}><ArrowUp size={11} aria-hidden="true" /></button>}
                <button type="button" aria-label={`Bỏ ${nameOf(id)}`} onClick={() => update(index, { people: block.people.filter((item) => item !== id) })}><X size={12} aria-hidden="true" /></button>
              </>}
            </li>
          ))}
          {!block.people.length && !isLeader && <li className="muted tb-empty">{readOnly ? "Chưa có người (bỏ qua khối này)" : "Kéo người vào đây"}</li>}
        </ol>
        {!readOnly && choices.length > 0 && (
          <select className="ap-frame-add" aria-label="Thêm người vào khối" value="" onChange={(event) => { if (event.target.value) addPerson(index, event.target.value); }}>
            <option value="">+ Thêm người</option>
            {choices.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <section className={shell} aria-label="Người duyệt">
      {!props.embedded && <h2><ShieldCheck className="ico" size={18} aria-hidden="true" /> Người duyệt</h2>}
      <small className="muted">Cây duyệt {DOC_TEXT[docType]}: ký từ trên xuống, Lãnh đạo là khối cuối cùng. {saved.length ? "" : inherited
        ? `Mục này chưa cài riêng: đang đi theo cây ${DOC_TEXT[inherited].split(" (")[0]} (hiện bên dưới, sửa rồi lưu để thành cây riêng).`
        : "Dự án chưa cài cây riêng: đang dùng quy trình chung của công ty."}</small>
      {!readOnly && <div className="ap-pool tb-pool">
        <b>Thành viên tham gia</b>
        <div className="ap-pool-list">
          {participants.length ? participants.map((person) => (
            <span key={person.id} className="ap-chip" draggable onDragStart={(event) => drag(event, person.id)}><GripVertical size={12} aria-hidden="true" />{person.name}</span>
          )) : <small className="muted">Chưa có thành viên: thêm ở mục Sơ đồ & thành viên.</small>}
        </div>
      </div>}
      <div className="tb-tree">
        <div className="tb-block sender"><div className="tb-head"><span className="tb-no"><Send size={11} aria-hidden="true" /></span><b>1. Người gửi phiếu</b></div><small className="muted">Tự ký khi bấm gửi, tên in sẵn vào ô ký khi xuất.</small></div>
        {blocks.map((block, index) => blockCard(block, index))}
        {!readOnly && <button type="button" className="button tb-add" onClick={() => setBlocks((list) => [...list.slice(0, -1), { name: `Khối ${list.length}`, mode: "any", people: [] }, list[list.length - 1]!])}><Plus size={14} aria-hidden="true" /> Thêm khối</button>}
      </div>
      {!readOnly && <div className="button-row" style={{ justifyContent: "flex-end" }}>
        {saved.length > 0 && <button type="button" className="link-button" disabled={busy} onClick={() => void reset()}>Dùng quy trình chung</button>}
        {dirty && <button type="button" className="button" disabled={busy} onClick={() => setBlocks(saved.length ? saved : [blankLeader()])}>Hoàn tác</button>}
        <button type="button" className="button primary" disabled={busy || (!dirty && saved.length > 0)} onClick={() => void save(blocks)}>{busy ? "Đang lưu…" : "Lưu cây duyệt"}</button>
      </div>}
    </section>
  );
}
