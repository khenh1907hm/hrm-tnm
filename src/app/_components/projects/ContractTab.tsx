"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, Save, Send, Trash2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import { CONFIRMATION_LABELS, type Confirmation } from "../../../modules/purchases/budget";
import {
  CONTRACT_ATTACHMENT_LABELS, CONTRACT_STATUS_LABELS, REQUIRED_ATTACHMENTS, contractDraftOf, contractIssue, missingAttachments,
  type ContractDraft, type ProjectContract,
} from "../../../modules/purchases/contract";
import { ApprovalChain } from "../purchases/ApprovalChain";
import { FormExportButtons } from "../purchases/FormExport";
import { getPurchaseStore } from "../purchases/usePurchaseStore";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const TONE: Record<ProjectContract["status"], string> = { draft: "", submitted: "warn", approved: "ok", rejected: "bad", superseded: "" };

/**
 * Tab Hợp đồng của dự án theo mẫu P-COST-01 (Xác nhận dự án): giá trị báo giá, giá trị xác nhận (giá trị hợp đồng),
 * chứng từ khách, điều khoản thanh toán, hồ sơ kèm theo; ký Phụ trách → P. Kỹ thuật → VT-Kho → Lãnh đạo → Kế toán → Hành chánh.
 * Giá trị hợp đồng đã duyệt được gợi ý vào ngân sách P-COST-03.
 */
export function ContractTab({ store: projectStore, data, viewer, setNotice }: TabProps) {
  const store = useMemo(() => getPurchaseStore(projectStore.mode), [projectStore.mode]);
  const [list, setList] = useState<ProjectContract[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; body: ContractDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const projectId = data.project.id;
  const load = useCallback(() => store.listContracts(projectId), [store, projectId]);
  useEffect(() => {
    let active = true;
    void load().then((items) => { if (active) setList(items); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setList([]); } });
    return () => { active = false; };
  }, [load, setNotice, attempt]);
  if (!list) return <div className="loading">Đang tải xác nhận dự án…</div>;

  const current = list.find((item) => item.id === selected) ?? list[0] ?? null;
  const canEdit = viewer.isLead || viewer.canEditProject;
  const editable = Boolean(current && canEdit && (current.status === "draft" || current.status === "rejected"));
  const body = current ? (draft?.id === current.id ? draft.body : contractDraftOf(current)) : null;
  const set = (patch: Partial<ContractDraft>) => current && body && setDraft({ id: current.id, body: { ...body, ...patch } });
  const open = list.some((item) => ["draft", "submitted", "rejected"].includes(item.status));
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); setNotice(done, "success"); setDraft(null); setAttempt((value) => value + 1); } catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  const save = (submit: boolean) => current && body && run(async () => {
    const issue = contractIssue(body, submit);
    if (issue) throw new Error(issue);
    await store.saveContract(current.id, body);
    if (submit) await store.submitContract(current.id);
  }, submit ? "Đã gửi xác nhận dự án đi ký duyệt." : "Đã lưu xác nhận dự án.");
  const text = (label: string, key: "description" | "quoteNo" | "customerDocNo" | "customerName" | "ownerName", wide = false) => (
    <label className={`field${wide ? " wide" : ""}`}><span>{label}</span><input disabled={!editable} value={body![key]} onChange={(event) => set({ [key]: event.target.value })} /></label>
  );
  const date = (label: string, key: "issuedOn" | "quoteDate" | "customerDocDate" | "startOn" | "endOn") => (
    <label className="field"><span>{label}</span><input type="date" disabled={!editable} value={body![key] ?? ""} onChange={(event) => set({ [key]: event.target.value || (key === "issuedOn" ? body!.issuedOn : null) })} /></label>
  );
  const missing = body ? missingAttachments(body) : [];

  return (
    <div className="pj-page">
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2>Xác nhận dự án <small className="muted">(P-COST-01)</small></h2>
          <div className="button-row">
            {canEdit && !open && <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { setSelected(await store.newContract(projectId)); }, list.length ? "Đã lập lần sửa mới (chép từ lần trước)." : "Đã lập xác nhận dự án nháp.")}><FilePlus2 className="ico" size={16} aria-hidden="true" /> {list.length ? "Lập lần sửa hợp đồng" : "Lập xác nhận dự án"}</button>}
            {editable && <button type="button" className="button" disabled={busy || draft?.id !== current?.id} onClick={() => void save(false)}><Save className="ico" size={16} aria-hidden="true" /> Lưu</button>}
            {editable && <button type="button" className="button primary" disabled={busy} onClick={() => void save(true)}><Send className="ico" size={16} aria-hidden="true" /> Lưu và gửi ký</button>}
            {editable && <button type="button" className="button danger" disabled={busy} onClick={() => { if (window.confirm("Xóa lần xác nhận nháp này?")) void run(async () => { await store.deleteContract(current!.id); setSelected(null); }, "Đã xóa nháp."); }}><Trash2 className="ico" size={16} aria-hidden="true" /> Xóa nháp</button>}
            {current && body && <FormExportButtons code="P-COST-01" fileBase={`${data.project.code} lan ${current.revision}`} setNotice={setNotice} build={async (forms, template) => forms.fillContract(template!, {
              contract: { ...current, ...body }, project: { code: data.project.code, name: data.project.name },
              steps: current.status === "draft" ? [] : await store.listSteps("contract", current.id),
            })} />}
          </div>
        </div>
        {!list.length
          ? <p className="muted">Chưa có xác nhận dự án. {canEdit ? "Bấm Lập xác nhận dự án khi trúng thầu (nhận PO / email thông báo) để ghi giá trị hợp đồng, điều khoản thanh toán của khách và đi ký." : "PM, CHT hoặc P. Kỹ thuật lập."}</p>
          : (
            <div className="pj-tabs" role="tablist" aria-label="Các lần xác nhận">
              {list.map((item) => <button key={item.id} type="button" role="tab" aria-selected={current?.id === item.id} onClick={() => { setSelected(item.id); setDraft(null); }}>Lần {item.revision} <span className={`pill ${TONE[item.status]}`}>{CONTRACT_STATUS_LABELS[item.status]}</span></button>)}
            </div>
          )}
        {current && body && (
          <>
            <div className="bs-head">
              <label className="field"><span>Trường hợp</span><select disabled={!editable} value={body.confirmation} onChange={(event) => set({ confirmation: event.target.value as Confirmation })}>{(Object.keys(CONFIRMATION_LABELS) as Confirmation[]).map((key) => <option key={key} value={key}>{CONFIRMATION_LABELS[key]}</option>)}</select></label>
              {date("Ngày ban hành", "issuedOn")}
              {text("Miêu tả công việc", "description", true)}
            </div>
            <h3 className="ct-sub">Báo giá và giá trị</h3>
            <div className="bs-head">
              {text("Báo giá số", "quoteNo")}
              {date("Ngày báo giá", "quoteDate")}
              <label className="field"><span>Giá trị báo giá (VNĐ)</span><input disabled={!editable} inputMode="numeric" value={moneyInput(body.quoteValue)} onChange={(event) => set({ quoteValue: parseMoney(event.target.value) })} /></label>
              <label className="field"><span>Giá trị xác nhận = giá trị HĐ (VNĐ)</span><input disabled={!editable} inputMode="numeric" value={moneyInput(body.confirmedValue)} onChange={(event) => set({ confirmedValue: parseMoney(event.target.value) })} /></label>
            </div>
            <h3 className="ct-sub">Khách hàng</h3>
            <div className="bs-head">
              {text("Tên khách hàng", "customerName")}
              {text("Chủ đầu tư", "ownerName")}
              {text("Số chứng từ khách (PO / HĐ)", "customerDocNo")}
              {date("Ngày chứng từ", "customerDocDate")}
              {date("Ngày bắt đầu dự án", "startOn")}
              {date("Ngày hoàn thành", "endOn")}
            </div>
            <label className="field"><span>Điều khoản thanh toán của khách</span><textarea rows={3} disabled={!editable} value={body.paymentTerms} placeholder="Ví dụ: Tạm ứng 15%, thanh toán theo tiến độ tháng đến 95% sau 45 ngày ký nghiệm thu khối lượng, 5% còn lại sau 2 tháng khi phát hành bảo lãnh bảo hành" onChange={(event) => set({ paymentTerms: event.target.value })} /></label>
            <fieldset className="exp-attach"><legend>Tài liệu đính kèm ({CONFIRMATION_LABELS[body.confirmation]})</legend>
              {REQUIRED_ATTACHMENTS[body.confirmation].map((key) => (
                <label key={key}><input type="checkbox" disabled={!editable} checked={body.attachments[key]} onChange={(event) => set({ attachments: { ...body.attachments, [key]: event.target.checked } })} /> {CONTRACT_ATTACHMENT_LABELS[key]}</label>
              ))}
            </fieldset>
            {missing.length > 0 && <p className="warn-text">Còn thiếu hồ sơ: {missing.map((key) => CONTRACT_ATTACHMENT_LABELS[key]).join("; ")}. Vẫn gửi ký được, người ký sẽ thấy.</p>}
            <label className="field"><span>Lưu ý</span><input disabled={!editable} value={body.note} onChange={(event) => set({ note: event.target.value })} /></label>
            {current.status === "approved" && <p className="muted">Đã duyệt: giá trị hợp đồng {formatVnd(current.confirmedValue)} được gợi ý khi lập ngân sách P-COST-03 (tab Ngân sách).</p>}
          </>
        )}
      </section>
      {current && current.status !== "draft" && <ApprovalChain store={store} docType="contract" docId={current.id} refreshKey={attempt} title={`Chuỗi ký xác nhận dự án lần ${current.revision}`} onChanged={() => setAttempt((value) => value + 1)} setNotice={setNotice} />}
      {current?.status === "rejected" && <p className="warn-text">Xác nhận bị trả về: sửa rồi bấm Lưu và gửi ký lại.</p>}
    </div>
  );
}
