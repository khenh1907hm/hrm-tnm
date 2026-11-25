"use client";
import { SkeletonLines } from "../Skeleton";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Workflow } from "lucide-react";
import { ASSIGNABLE_STAGES, type AssignableStage, FLOW_STEPS, STAGE_DEPARTMENT_DEFAULTS, STAGE_DEPARTMENT_OPTIONS, stageDepartmentLabel, type StageDepartment, type StageDepartments } from "../../../modules/purchases/flow";
import { errorMessage } from "../projects/projectShared";
import type { Notify } from "../Toast";
import { STEP_ICONS } from "./FlowBar";

const LABEL = Object.fromEntries(FLOW_STEPS.map((step) => [step.key, step.label])) as Record<string, string>;

/**
 * Phòng ban phụ trách từng giai đoạn của quy trình mua hàng (Đơn hàng nháp → … → Nhập kho → … → Thành công / Thất bại).
 * Nhận hàng, Nhập kho, Thu thập chứng từ: chỉ phòng ban được giao (cùng người lập, sếp, Admin) bấm được; giai đoạn khác dùng để hiển thị ai làm.
 */
export function StageDepartmentsEditor(props: { load: () => Promise<StageDepartments>; save: (value: StageDepartments) => Promise<void>; setNotice: Notify; canEdit: boolean;
  /** Giai đoạn có cây duyệt: bấm vào để xem, sắp xếp người duyệt (trả về tên phiếu và nội dung khi mở). */
  tree?: (stage: AssignableStage) => { title: string; render: () => ReactNode } | null }) {
  const [value, setValue] = useState<StageDepartments | null>(null);
  const [open, setOpen] = useState<AssignableStage | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const { load, setNotice } = props;
  useEffect(() => {
    let active = true;
    void load().then((next) => { if (active) { setValue(next); setSaved(JSON.stringify(next)); } },
      (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setValue({ ...STAGE_DEPARTMENT_DEFAULTS }); setSaved(JSON.stringify(STAGE_DEPARTMENT_DEFAULTS)); } });
    return () => { active = false; };
  }, [load, setNotice]);
  if (!value) return <SkeletonLines label="Đang tải giai đoạn…" />;
  const dirty = JSON.stringify(value) !== saved;
  const submit = async () => {
    setBusy(true);
    try { await props.save(value); setSaved(JSON.stringify(value)); setNotice("Đã lưu phòng ban theo giai đoạn mua hàng.", "success"); }
    catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  return (
    <section className="panel pj-section" aria-labelledby="po-stage-dept-title">
      <h2 id="po-stage-dept-title"><Workflow className="ico" size={18} aria-hidden="true" /> Giai đoạn mua hàng &amp; phòng ban phụ trách</h2>
      <p className="muted">Mỗi giai đoạn của đơn hàng giao cho một phòng ban (người trong phòng ban lấy theo mục “Bộ phận ký duyệt”, dự án có đặt người riêng thì dùng người của dự án).
        <b> Nhận hàng, kiểm đếm</b>, <b>Nhập kho</b> và <b>Thu thập chứng từ</b>: chỉ phòng ban được giao (cùng Admin, Giám đốc) bấm được; các giai đoạn khác hiện tên phòng ban để biết ai đang phải làm.</p>
      <ol className="po-stage-editor">
        {ASSIGNABLE_STAGES.map((stage) => {
          const Icon = STEP_ICONS[stage];
          const tree = props.tree?.(stage) ?? null;
          const isOpen = open === stage && tree;
          return (
            <Fragment key={stage}>
            <li className={`${tree ? "has-tree" : ""}${isOpen ? " is-open" : ""}`}>
              <Icon size={15} aria-hidden="true" className="muted" />
              <span>{tree
                ? <button type="button" className="po-stage-toggle" aria-expanded={Boolean(isOpen)} onClick={() => setOpen(isOpen ? null : stage)}>
                    {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} {LABEL[stage]} <small className="pill">duyệt: {tree.title}</small></button>
                : LABEL[stage]}
                {(stage === "received" || stage === "stocked" || stage === "final") && <small className="pill warn" style={{ marginLeft: 6 }}>giới hạn quyền</small>}</span>
              <select aria-label={`Phòng ban phụ trách ${LABEL[stage]}`} value={value[stage]} disabled={!props.canEdit}
                onChange={(event) => setValue({ ...value, [stage]: event.target.value as StageDepartment })}>
                {STAGE_DEPARTMENT_OPTIONS.map((option) => <option key={option || "none"} value={option}>{stageDepartmentLabel(option)}</option>)}
              </select>
            </li>
            {isOpen && <li className="po-stage-tree">{tree.render()}</li>}
            </Fragment>
          );
        })}
        <li className="muted"><CircleDot /> <span>Thành công / Thất bại</span><small>Kết quả cuối của đơn</small></li>
      </ol>
      {props.canEdit && (
        <div className="button-row">
          {dirty && <button type="button" className="button" disabled={busy} onClick={() => setValue(JSON.parse(saved) as StageDepartments)}>Hoàn tác</button>}
          <button type="button" className="button" disabled={busy} onClick={() => setValue({ ...STAGE_DEPARTMENT_DEFAULTS })}>Về mặc định</button>
          <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void submit()}>{busy ? "Đang lưu…" : "Lưu phòng ban theo giai đoạn"}</button>
        </div>
      )}
    </section>
  );
}

function CircleDot() { return <span aria-hidden="true" style={{ display: "inline-block", width: 15 }}>•</span>; }
