"use client";
import { useCallback, useEffect, useState } from "react";
import { FilePlus2, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { Project } from "../../../modules/projects/types";
import { costCodeLabel, type CostCode } from "../../../modules/purchases/budget";
import {
  ATTACHMENT_LABELS, EXPLANATORY_KIND_LABELS, EXPLANATORY_STATUS_LABELS, explanatoryIssue, explanatoryTotals, lineD, lineE, noAttachments,
  type ExplanatoryDraft, type ExplanatoryKind, type ExplanatoryLine, type ExplanatoryReport,
} from "../../../modules/purchases/explanatory";
import type { PurchaseStore } from "../../../modules/purchases/store";
import type { PurchaseOrder } from "../../../modules/purchases/types";
import type { Notify } from "../Toast";
import { ApprovalChain } from "../purchases/ApprovalChain";
import { FormExportButtons } from "../purchases/FormExport";
import { AttachmentsField, SavedAttachments, type PendingFile } from "../purchases/AttachmentsField";
import { explanatoryFiles, filesAvailable, type Attachment } from "../purchases/purchaseFiles";

const EXP_KINDS = (Object.keys(ATTACHMENT_LABELS) as (keyof typeof ATTACHMENT_LABELS)[]).map((key) => ({ kind: key, label: ATTACHMENT_LABELS[key], required: false }));
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const TONE: Record<ExplanatoryReport["status"], string> = { draft: "", submitted: "warn", approved: "ok", rejected: "bad" };
const dmy = (iso: string | null) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";

/**
 * Báo cáo giải thích (P-COST-05) trong tab Ngân sách: khi đơn hàng vượt ngân sách của một mã, đổi mã, công việc bảo hành.
 * A, B lấy tự động từ ngân sách đang dùng; C là số cần đặt thêm (lấy từ đơn nháp bị chặn hoặc nhập tay).
 * Lãnh đạo ký xong thì mã có E > 0 được cộng thêm E vào ngân sách, đơn nháp gửi duyệt lại được.
 */
export function ExplanatoryPanel(props: { store: PurchaseStore; project: Project; codes: readonly CostCode[]; canEdit: boolean; setNotice: Notify; onApproved: () => void; refreshKey?: unknown }) {
  const { store, project, setNotice } = props;
  const [reports, setReports] = useState<ExplanatoryReport[] | null>(null);
  const [drafts, setDrafts] = useState<PurchaseOrder[]>([]);
  const [editing, setEditing] = useState<ExplanatoryDraft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [newCode, setNewCode] = useState("");
  // Attach file: tệp đã lưu của báo cáo đang sửa và tệp chờ tải lên sau khi lưu
  const live = filesAvailable();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [savedFiles, setSavedFiles] = useState<Attachment[]>([]);
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (!live || !editingId) return;
    let active = true;
    void explanatoryFiles.list(editingId).then((list) => { if (active) setSavedFiles(list); }, () => undefined);
    return () => { active = false; };
  }, [live, editingId]);
  const load = useCallback(async () => {
    const [list, orders] = await Promise.all([store.listExplanatory(project.id), store.listOrders().catch(() => [])]);
    const open = orders.filter((order) => order.projectId === project.id && order.budgetCode && (order.status === "draft" || order.status === "rejected"));
    // Chỉ các đơn nháp đang vượt ngân sách còn lại của mã (E < 0)
    const over = await Promise.all(open.map(async (order) => {
      const check = await store.checkBudget(project.id, order.budgetCode!, order.id).catch(() => null);
      return check && check.a - (check.b + order.totalEstimate) < 0 ? order : null;
    }));
    return [list, over.filter((order): order is PurchaseOrder => order !== null)] as const;
  }, [store, project.id]);
  useEffect(() => {
    let active = true;
    void load().then(([list, overOrders]) => {
      if (!active) return;
      setReports(list);
      setDrafts(overOrders);
    }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setReports([]); } });
    return () => { active = false; };
  }, [load, setNotice, attempt, props.refreshKey]);

  if (!reports) return null;
  const opened = reports.find((report) => report.id === openId) ?? null;

  /** Dòng mới cho một mã: A, B theo ngân sách đang dùng; C = tổng các đơn nháp của mã đó. */
  const lineFor = async (code: string): Promise<ExplanatoryLine> => {
    const check = await store.checkBudget(project.id, code, null);
    const neededC = drafts.filter((order) => order.budgetCode === code).reduce((sum, order) => sum + order.totalEstimate, 0);
    return { code, budgetA: check?.a ?? 0, orderedB: check?.b ?? 0, neededC };
  };
  const refreshAB = async () => {
    if (!editing) return;
    const lines = await Promise.all(editing.lines.map(async (line) => { const check = await store.checkBudget(project.id, line.code, null); return { ...line, budgetA: check?.a ?? 0, orderedB: check?.b ?? 0 }; }));
    setEditing({ ...editing, lines });
  };
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); setNotice(done, "success"); setAttempt((value) => value + 1); } catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  const save = (submit: boolean) => editing && run(async () => {
    const issue = explanatoryIssue(editing, submit, props.codes);
    if (issue) throw new Error(issue);
    // Cờ hồ sơ theo tệp thật (máy chủ cũng tự cập nhật khi tải tệp)
    const kinds = new Set([...savedFiles.filter((item) => item.parentId === editing.id).map((item) => item.kind), ...pendingFiles.map((item) => item.kind)]);
    const body = live ? { ...editing, attachments: { customerRequest: kinds.has("customerRequest"), overQuote: kinds.has("overQuote"), incident: kinds.has("incident"), drawing: kinds.has("drawing") } } : editing;
    const id = await store.saveExplanatory(body);
    for (const item of pendingFiles) await explanatoryFiles.upload(id, item.kind, item.file);
    setPendingFiles([]);
    setSavedFiles([]);
    if (submit) await store.submitExplanatory(id);
    setEditing(null);
    setOpenId(id);
  }, submit ? "Đã gửi báo cáo giải thích đi ký duyệt." : "Đã lưu nháp báo cáo giải thích.");
  const startNew = async (order?: PurchaseOrder) => {
    const lines = order?.budgetCode ? [await lineFor(order.budgetCode)] : [];
    setEditing({ projectId: project.id, kind: "budget_change", warrantyDoneOn: null, explanation: order ? `Đơn ${order.code} (${order.title}) vượt ngân sách mã ${order.budgetCode}. ` : "", attachments: noAttachments(), orderId: order?.id ?? null, lines });
    setOpenId(null);
  };
  const totals = editing ? explanatoryTotals(editing.lines) : null;
  const blocked = drafts.filter((order) => !reports.some((report) => report.orderId === order.id && report.status !== "rejected"));

  return (
    <section className="panel pj-section" aria-labelledby="exp-title">
      <div className="pj-section-head">
        <h2 id="exp-title">Báo cáo giải thích <small className="muted">(P-COST-05)</small></h2>
        {props.canEdit && !editing && <button type="button" className="button" disabled={busy} onClick={() => void startNew()}><FilePlus2 className="ico" size={16} aria-hidden="true" /> Lập báo cáo giải thích</button>}
      </div>
      <p className="muted">Dùng khi đơn hàng vượt ngân sách còn lại của mã, đổi mã số hoặc công việc bảo hành. Lãnh đạo duyệt xong, ngân sách các mã có E &gt; 0 được cộng thêm E và đơn bị chặn gửi duyệt lại được.</p>
      {props.canEdit && !editing && blocked.length > 0 && (
        <div className="exp-blocked">
          <b>Đơn nháp đang vượt ngân sách còn lại của mã:</b>
          {blocked.map((order) => <button key={order.id} type="button" className="link-button" onClick={() => void startNew(order)}>{order.code} · mã {order.budgetCode} · {formatVnd(order.totalEstimate)} → lập giải thích</button>)}
        </div>
      )}

      {editing && totals && (
        <div className="exp-form">
          <div className="bs-head">
            <label className="field"><span>Loại báo cáo</span>
              <select value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as ExplanatoryKind })}>
                {(Object.keys(EXPLANATORY_KIND_LABELS) as ExplanatoryKind[]).map((key) => <option key={key} value={key}>{EXPLANATORY_KIND_LABELS[key]}</option>)}
              </select>
            </label>
            {editing.kind === "warranty" && <label className="field"><span>Ngày hoàn thành (dự án bảo hành)</span><input type="date" value={editing.warrantyDoneOn ?? ""} onChange={(event) => setEditing({ ...editing, warrantyDoneOn: event.target.value || null })} /></label>}
          </div>
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>Mã số</th><th className="pj-num">A · Ngân sách gốc</th><th className="pj-num">B · Đã đặt hàng</th><th className="pj-num">C · Cần đặt hàng</th><th className="pj-num">D = B + C</th><th className="pj-num">E = D − A</th><th /></tr></thead>
              <tbody>
                {editing.lines.map((line, index) => (
                  <tr key={line.code}>
                    <td>{costCodeLabel(line.code, props.codes)}</td>
                    <td className="pj-num">{formatVnd(line.budgetA)}</td>
                    <td className="pj-num">{formatVnd(line.orderedB)}</td>
                    <td><input aria-label={`Cần đặt hàng ${line.code}`} inputMode="numeric" value={moneyInput(line.neededC)} onChange={(event) => setEditing({ ...editing, lines: editing.lines.map((item, i) => i === index ? { ...item, neededC: parseMoney(event.target.value) } : item) })} /></td>
                    <td className="pj-num">{formatVnd(lineD(line))}</td>
                    <td className={`pj-num ${lineE(line) > 0 ? "warn-text" : ""}`}><b>{formatVnd(lineE(line))}</b></td>
                    <td><button type="button" className="link-button" onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, i) => i !== index) })}>Bỏ</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Tổng</td><td className="pj-num">{formatVnd(totals.a)}</td><td className="pj-num">{formatVnd(totals.b)}</td><td className="pj-num">{formatVnd(totals.c)}</td><td className="pj-num">{formatVnd(totals.d)}</td><td className="pj-num"><b>{formatVnd(totals.e)}</b></td><td /></tr></tfoot>
            </table>
          </div>
          <div className="button-row">
            <select aria-label="Thêm mã" value={newCode} onChange={(event) => setNewCode(event.target.value)}>
              <option value="">+ Thêm mã ngân sách…</option>
              {props.codes.filter((code) => !editing.lines.some((line) => line.code === code.code)).map((code) => <option key={code.code} value={code.code}>{code.code} {code.name}</option>)}
            </select>
            <button type="button" className="button" disabled={!newCode} onClick={() => void lineFor(newCode).then((line) => { setEditing({ ...editing, lines: [...editing.lines, line].sort((a, b) => a.code.localeCompare(b.code)) }); setNewCode(""); })}>Thêm</button>
            <button type="button" className="button" onClick={() => void refreshAB()}><RefreshCw className="ico" size={15} aria-hidden="true" /> Tính lại A, B</button>
          </div>
          <label className="field"><span>Diễn giải (lý do, nguyên nhân, cách khắc phục và kết quả)</span><textarea rows={4} value={editing.explanation} onChange={(event) => setEditing({ ...editing, explanation: event.target.value })} /></label>
          <fieldset className="exp-attach po-terms"><legend>Attach file (bằng chứng, lý do)</legend>
            {live ? (
              <AttachmentsField existing={savedFiles.filter((item) => item.parentId === editingId)} pending={pendingFiles} onPendingChange={setPendingFiles} api={explanatoryFiles} kinds={EXP_KINDS} editable requireSigned={false}
                onChanged={() => { if (editingId) void explanatoryFiles.list(editingId).then(setSavedFiles, () => undefined); }} setNotice={setNotice} />
            ) : (Object.keys(ATTACHMENT_LABELS) as (keyof typeof ATTACHMENT_LABELS)[]).map((key) => (
              <label key={key}><input type="checkbox" checked={editing.attachments[key]} onChange={(event) => setEditing({ ...editing, attachments: { ...editing.attachments, [key]: event.target.checked } })} /> {ATTACHMENT_LABELS[key]}</label>
            ))}
          </fieldset>
          <div className="button-row">
            <button type="button" className="button" disabled={busy} onClick={() => void save(false)}><Save className="ico" size={16} aria-hidden="true" /> Lưu nháp</button>
            <button type="button" className="button primary" disabled={busy} onClick={() => void save(true)}><Send className="ico" size={16} aria-hidden="true" /> Lưu và gửi ký</button>
            <button type="button" className="button" onClick={() => setEditing(null)}>Đóng</button>
          </div>
        </div>
      )}

      {reports.length > 0 && (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Số</th><th>Loại</th><th>Mã</th><th className="pj-num">Tăng (E)</th><th>Người lập</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{reports.map((report) => (
              <tr key={report.id} className={report.id === openId ? "row-selected" : undefined}>
                <td>{report.number}<br /><small className="muted">{dmy(report.createdAt)}</small></td>
                <td>{EXPLANATORY_KIND_LABELS[report.kind].split(" (")[0]}</td>
                <td>{report.lines.map((line) => line.code).join(", ")}</td>
                <td className="pj-num">{formatVnd(Math.max(0, report.lines.reduce((sum, line) => sum + Math.max(0, lineE(line)), 0)))}</td>
                <td>{report.createdByName || "—"}</td>
                <td><span className={`pill ${TONE[report.status]}`}>{EXPLANATORY_STATUS_LABELS[report.status]}</span></td>
                <td className="button-row">
                  <button type="button" className="button" onClick={() => setOpenId(openId === report.id ? null : report.id)}>{openId === report.id ? "Thu gọn" : "Xem"}</button>
                  {props.canEdit && (report.status === "draft" || report.status === "rejected") && <button type="button" className="button" onClick={() => { const { id, projectId, kind, warrantyDoneOn, explanation, attachments, orderId, lines } = report; setEditing({ id, projectId, kind, warrantyDoneOn, explanation, attachments, orderId, lines }); setOpenId(null); }}>Sửa</button>}
                  {props.canEdit && (report.status === "draft" || report.status === "rejected") && <button type="button" className="button danger" aria-label="Xóa" onClick={() => { if (window.confirm(`Xóa ${report.number}?`)) void run(() => store.deleteExplanatory(report.id), "Đã xóa báo cáo nháp."); }}><Trash2 className="ico" size={15} aria-hidden="true" /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {opened && (
        <div className="exp-open">
          <p><b>{opened.number}</b> · {EXPLANATORY_KIND_LABELS[opened.kind]}{opened.warrantyDoneOn ? ` · hoàn thành ${dmy(opened.warrantyDoneOn)}` : ""}</p>
          <p className="exp-text">{opened.explanation}</p>
          {live && <fieldset className="exp-attach po-terms"><legend>Attach file</legend>
            <SavedAttachments key={opened.id} parentId={opened.id} api={explanatoryFiles} kinds={EXP_KINDS} editable={props.canEdit} requireSigned={false} setNotice={setNotice} />
          </fieldset>}
          <FormExportButtons code="P-COST-05" fileBase={opened.number} setNotice={setNotice} build={async (forms, template) => forms.fillExplanatory(template!, {
            report: opened, project: { code: project.code, name: project.name }, steps: opened.status === "draft" ? [] : await store.listSteps("explanatory", opened.id),
          })} />
          {opened.status !== "draft" && <ApprovalChain store={store} docType="explanatory" docId={opened.id} refreshKey={attempt} title={`Chuỗi ký ${opened.number}`} onChanged={() => { setAttempt((value) => value + 1); props.onApproved(); }} setNotice={setNotice} />}
          {opened.status === "approved" && <p className="muted">Đã cộng phần tăng vào ngân sách đang dùng. Mở lại đơn nháp và bấm Lập đơn, gửi duyệt.</p>}
        </div>
      )}
    </section>
  );
}
