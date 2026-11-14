"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { approvalTrees, directorPeople, TREE_FALLBACK, type ApprovalBlock, type TreeDocType } from "../accountApi";
import type { ProjectMember } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { ApprovalTreePanel } from "./ApprovalTreePanel";
import { participantsOf } from "./ProjectApproversPanel";

/** Các mục cần ký duyệt của dự án, theo đúng thứ tự trên quy trình công ty. */
const ITEMS: readonly { type: TreeDocType; prefix: string; form: string; name: string }[] = [
  { type: "contract", prefix: "ConfirmContract", form: "P-COST-01", name: "Xác nhận dự án (Confirm Contract)" },
  { type: "budget", prefix: "BUDGET", form: "P-COST-03", name: "Ngân sách dự án" },
  { type: "explanatory", prefix: "GIAITRINH", form: "P-COST-05", name: "Báo cáo giải thích" },
  { type: "material", prefix: "YCVT", form: "P-COST-08", name: "Yêu cầu vật tư" },
  { type: "purchase", prefix: "PO", form: "P-CC-07 / P-CC-08", name: "Đơn hàng" },
  { type: "payment", prefix: "RFP-", form: "P-CF-03", name: "Yêu cầu thanh toán (Request for Payment)" },
];

const initials = (name: string) => name.trim().split(/\s+/).slice(-1)[0]?.[0]?.toUpperCase() ?? "?";

/**
 * Tab "Quy trình duyệt" của dự án: bảng các loại phiếu (như danh sách Loại đề xuất), mỗi dòng một cây duyệt riêng.
 * Bấm dòng để mở cây và chỉnh (Admin, Giám đốc). Mục chưa cài riêng đi theo cây nhóm hoặc quy trình chung.
 */
export function ApprovalsTab(props: { projectId: string; canEdit: boolean; members: readonly ProjectMember[]; today: string; setNotice: Notify }) {
  const [trees, setTrees] = useState<Partial<Record<TreeDocType, ApprovalBlock[]>> | null>(null);
  const [directors, setDirectors] = useState<{ employeeId: string; name: string }[]>([]);
  const [open, setOpen] = useState<TreeDocType | null>(null);
  const { projectId, setNotice } = props;
  const load = useCallback(() => Promise.all([approvalTrees(projectId), directorPeople().catch(() => [])]), [projectId]);
  useEffect(() => {
    let active = true;
    void load().then(([list, boss]) => { if (active) { setTrees(list); setDirectors(boss); } }, () => { if (active) setTrees({}); });
    return () => { active = false; };
  }, [load]);
  const refresh = () => void load().then(([list]) => setTrees(list), () => setNotice("Không tải lại được cây duyệt.", "error"));
  if (!trees) return <section className="panel pj-section"><div className="loading">Đang tải quy trình duyệt…</div></section>;

  const participants = participantsOf(props.members, props.today);
  const nameOf = (id: string) => participants.find((person) => person.id === id)?.name ?? "Người ngoài dự án";
  const effective = (type: TreeDocType): { blocks: ApprovalBlock[]; source: "own" | TreeDocType | "company" } => {
    const own = trees[type] ?? [];
    if (own.length) return { blocks: own, source: "own" };
    const group = TREE_FALLBACK[type];
    const inherited = group ? trees[group] ?? [] : [];
    return inherited.length ? { blocks: inherited, source: group! } : { blocks: [], source: "company" };
  };
  const groupName = (type: TreeDocType) => ITEMS.find((item) => item.type === type)?.name ?? type;

  return (
    <section className="panel pj-section" aria-label="Quy trình duyệt theo từng mục">
      <h2><ShieldCheck className="ico" size={18} aria-hidden="true" /> Loại đề xuất ({ITEMS.length})</h2>
      <small className="muted">Mỗi loại phiếu của dự án có cây duyệt riêng: người gửi tự ký, rồi các khối theo thứ tự, Lãnh đạo duyệt cuối. {props.canEdit ? "Bấm một dòng để chỉnh." : "Chỉ Admin, Giám đốc chỉnh được."}</small>
      <div className="table-scroll">
        <table className="pj-table ad-table">
          <thead><tr><th aria-label="Mở" /><th>Tiền tố</th><th>Tên loại đề xuất</th><th>Quy trình xét duyệt</th><th>Người xét duyệt</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {ITEMS.map((item) => {
              const { blocks, source } = effective(item.type);
              const people = Array.from(new Set(blocks.flatMap((block) => block.people)));
              const isOpen = open === item.type;
              const flow = blocks.length ? ["Người gửi", ...blocks.map((block, index) => index === blocks.length - 1 ? "Lãnh đạo" : block.name)].join(" → ") : "Quy trình chung của công ty";
              return (
                <Fragment key={item.type}>
                  <tr className={`ad-row${isOpen ? " open" : ""}`} onClick={() => setOpen(isOpen ? null : item.type)}>
                    <td>{isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</td>
                    <td><b>{item.prefix}</b><br /><small className="muted">{item.form}</small></td>
                    <td><button type="button" className="link-button" aria-expanded={isOpen} onClick={(event) => { event.stopPropagation(); setOpen(isOpen ? null : item.type); }}>{item.name}</button></td>
                    <td>{blocks.length ? "Duyệt theo trình tự" : "Theo phòng ban"}<br /><small className="muted">{flow}</small></td>
                    <td>
                      <span className="ad-people">
                        {people.slice(0, 8).map((id) => <span key={id} className="ad-avatar" title={nameOf(id)}>{initials(nameOf(id))}</span>)}
                        {people.length > 8 && <span className="ad-avatar more">+{people.length - 8}</span>}
                        {directors.length > 0 && blocks.length > 0 && <span className="ad-avatar boss" title={`Giám đốc: ${directors.map((boss) => boss.name).join(", ")}`}>GĐ</span>}
                        {!people.length && !blocks.length && <small className="muted">Theo phòng ban công ty</small>}
                      </span>
                    </td>
                    <td>
                      {source === "own" ? <span className="pill ok">Cài riêng</span>
                        : source === "company" ? <span className="pill">Quy trình chung</span>
                          : <span className="pill warn" title={`Đi theo cây ${groupName(source)}`}>Theo {groupName(source)}</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="ad-editor"><td colSpan={6}>
                      <ApprovalTreePanel key={item.type} embedded projectId={projectId} docType={item.type} canEdit={props.canEdit} members={props.members} today={props.today} setNotice={setNotice} onSaved={refresh} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
