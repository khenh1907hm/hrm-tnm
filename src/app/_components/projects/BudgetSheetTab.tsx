"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, Save, Send, Trash2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import {
  BUDGET_SHEET_STATUS_LABELS, CONFIRMATION_LABELS, COST_GROUP_LABELS, COST_GROUPS, sheetIssue, sheetTotals,
  type BudgetLine, type BudgetSheet, type BudgetSheetHeader, type Confirmation, type CostCode,
} from "../../../modules/purchases/budget";
import { getPurchaseStore } from "../purchases/usePurchaseStore";
import { ApprovalChain } from "../purchases/ApprovalChain";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const TONE: Record<BudgetSheet["status"], string> = { draft: "", submitted: "warn", approved: "ok", rejected: "bad", superseded: "" };
const pctText = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

/**
 * Tab Ngân sách của dự án theo mẫu P-COST-03: các lần lập (số ngân sách -01, -02…), bảng mã #100–#400,
 * giá gốc, ngân sách, nhà cung cấp, dự phòng, lợi nhuận A / B; gửi ký Phụ trách → P. Kỹ thuật → Lãnh đạo.
 */
export function BudgetSheetTab({ store: projectStore, data, viewer, setNotice, reload }: TabProps) {
  const store = useMemo(() => getPurchaseStore(projectStore.mode), [projectStore.mode]);
  const [sheets, setSheets] = useState<BudgetSheet[] | null>(null);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; header: BudgetSheetHeader; lines: BudgetLine[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const projectId = data.project.id;
  const fetchAll = useCallback(() => Promise.all([store.listBudgetSheets(projectId), store.costCodes()]), [store, projectId]);
  useEffect(() => {
    let active = true;
    void fetchAll().then(([list, catalog]) => { if (active) { setSheets(list); setCodes(catalog); } }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setSheets([]); } });
    return () => { active = false; };
  }, [fetchAll, setNotice, attempt]);

  const current = sheets?.find((sheet) => sheet.id === selected) ?? sheets?.[0] ?? null;
  const canEdit = viewer.isLead || viewer.canEditProject;
  const editable = Boolean(current && canEdit && (current.status === "draft" || current.status === "rejected"));
  const working = current && draft?.id === current.id ? draft : current ? { id: current.id, header: { confirmation: current.confirmation, exchangeRate: current.exchangeRate, quoteNo: current.quoteNo, offerPrice: current.offerPrice, contractValue: current.contractValue, note: current.note }, lines: current.lines } : null;
  const totals = working ? sheetTotals({ ...working.header, lines: working.lines }) : null;
  const dirty = Boolean(draft && current && draft.id === current.id);
  const refresh = () => { setDraft(null); setAttempt((value) => value + 1); };

  if (!sheets) return <div className="loading">Đang tải ngân sách…</div>;

  const setHeader = (patch: Partial<BudgetSheetHeader>) => working && setDraft({ ...working, header: { ...working.header, ...patch } });
  const setLine = (code: string, patch: Partial<BudgetLine>) => {
    if (!working) return;
    const exists = working.lines.some((line) => line.code === code);
    const lines = exists ? working.lines.map((line) => line.code === code ? { ...line, ...patch } : line) : [...working.lines, { code, nett: 0, budget: 0, supplier: "", contingency: 0, remark: "", ...patch }];
    setDraft({ ...working, lines: lines.sort((a, b) => a.code.localeCompare(b.code)) });
  };
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); setNotice(done, "success"); refresh(); await reload(); } catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  const clean = (lines: readonly BudgetLine[]) => lines.filter((line) => line.nett || line.budget || line.contingency || line.supplier.trim() || line.remark.trim());
  const save = (then?: () => Promise<unknown>) => working && run(async () => {
    const issue = sheetIssue({ ...working.header, lines: clean(working.lines) }, Boolean(then), codes);
    if (issue) throw new Error(issue);
    await store.saveBudgetSheet(working.id, working.header, clean(working.lines));
    if (then) await then();
  }, then ? "Đã gửi ngân sách đi ký duyệt." : "Đã lưu ngân sách.");
  const open = sheets.some((sheet) => ["draft", "submitted", "rejected"].includes(sheet.status));
  const lineOf = (code: string) => working?.lines.find((line) => line.code === code);
  // Lần mới chưa có dòng nào thì hiện đủ mã để nhập
  // Đang sửa: hiện đủ mã để nhập (có thể chỉ xem mã đã nhập); đã khóa: chỉ mã có số (có thể xem đủ)
  const visible = (code: CostCode) => (editable ? !showAll : showAll) || Boolean(lineOf(code.code));

  return (
    <div className="pj-page">
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2>Ngân sách dự án theo mã <small className="muted">(P-COST-03)</small></h2>
          <div className="button-row">
            {canEdit && !open && <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { const id = await store.newBudgetSheet(projectId); setSelected(id); }, sheets.length ? "Đã lập lần ngân sách mới (chép từ lần trước)." : "Đã lập ngân sách nháp.")}><FilePlus2 className="ico" size={16} aria-hidden="true" /> {sheets.length ? "Lập lần ngân sách mới" : "Lập ngân sách"}</button>}
            {editable && <button type="button" className="button" disabled={busy || !dirty} onClick={() => void save()}><Save className="ico" size={16} aria-hidden="true" /> Lưu</button>}
            {editable && <button type="button" className="button primary" disabled={busy} onClick={() => void save(() => store.submitBudgetSheet(working!.id))}><Send className="ico" size={16} aria-hidden="true" /> Lưu và gửi ký</button>}
            {editable && <button type="button" className="button danger" disabled={busy} onClick={() => { if (window.confirm("Xóa lần ngân sách nháp này?")) void run(async () => { await store.deleteBudgetSheet(working!.id); setSelected(null); }, "Đã xóa nháp."); }}><Trash2 className="ico" size={16} aria-hidden="true" /> Xóa nháp</button>}
          </div>
        </div>
        {!sheets.length
          ? <p className="muted">Dự án chưa có ngân sách theo mã. {canEdit ? "Bấm Lập ngân sách để bắt đầu. Đơn đặt hàng của dự án chỉ gửi duyệt được khi đã có ngân sách được Lãnh đạo duyệt." : "PM, CHT hoặc P. Kỹ thuật lập ngân sách."}</p>
          : (
            <div className="pj-tabs" role="tablist" aria-label="Các lần lập ngân sách">
              {sheets.map((sheet) => <button key={sheet.id} type="button" role="tab" aria-selected={current?.id === sheet.id} onClick={() => { setSelected(sheet.id); setDraft(null); }}>{sheet.number} <span className={`pill ${TONE[sheet.status]}`}>{BUDGET_SHEET_STATUS_LABELS[sheet.status]}</span></button>)}
            </div>
          )}
        {current && working && totals && (
          <>
            <div className="bs-head">
              <label className="field"><span>Loại</span><select disabled={!editable} value={working.header.confirmation} onChange={(event) => setHeader({ confirmation: event.target.value as Confirmation })}>{(Object.keys(CONFIRMATION_LABELS) as Confirmation[]).map((key) => <option key={key} value={key}>{CONFIRMATION_LABELS[key]}</option>)}</select></label>
              <label className="field"><span>Số báo giá</span><input disabled={!editable} value={working.header.quoteNo} onChange={(event) => setHeader({ quoteNo: event.target.value })} /></label>
              <label className="field"><span>Giá báo khách (VNĐ)</span><input disabled={!editable} inputMode="numeric" value={moneyInput(working.header.offerPrice)} onChange={(event) => setHeader({ offerPrice: parseMoney(event.target.value) })} /></label>
              <label className="field"><span>Giá trị hợp đồng (VNĐ)</span><input disabled={!editable} inputMode="numeric" value={moneyInput(working.header.contractValue)} onChange={(event) => setHeader({ contractValue: parseMoney(event.target.value) })} /></label>
              <label className="field"><span>Tỷ giá VND/USD</span><input disabled={!editable} inputMode="numeric" value={moneyInput(working.header.exchangeRate)} onChange={(event) => setHeader({ exchangeRate: parseMoney(event.target.value) })} /></label>
            </div>
            <div className="pj-kpis">
              <div className="pj-kpi"><span>Tổng giá gốc (nett)</span><b>{formatVnd(totals.nett)}</b><small>Lợi nhuận báo giá {formatVnd(totals.quoteProfit)} ({pctText(totals.quoteProfitPct)})</small></div>
              <div className="pj-kpi"><span>Chi phí trực tiếp (#100~#300)</span><b>{formatVnd(totals.direct)}</b><small>Lợi nhuận A {formatVnd(totals.profitA)} ({pctText(totals.profitAPct)})</small></div>
              <div className="pj-kpi"><span>Tổng chi phí (#100~#400)</span><b>{formatVnd(totals.total)}</b><small>Lợi nhuận B {formatVnd(totals.profitB)} ({pctText(totals.profitBPct)})</small></div>
              <div className={`pj-kpi ${totals.profitB < 0 ? "over" : ""}`}><span>Lợi nhuận (HĐ − giá gốc)</span><b>{formatVnd(totals.profit)}</b><small>{pctText(totals.profitPct)} giá trị hợp đồng</small></div>
            </div>
            <label className="bs-toggle"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> {editable ? "Chỉ hiện mã đã nhập" : "Hiện tất cả mã chi phí"}</label>
            <div className="table-scroll">
              <table className="pj-table bs-table">
                <thead><tr><th>Mã</th><th>Hạng mục công việc</th><th className="pj-num">Giá gốc (nett)</th><th className="pj-num">Ngân sách (C)</th><th>Nhà cung cấp / thầu phụ</th><th className="pj-num">Dự phòng (D)</th><th className="pj-num">C / tổng</th></tr></thead>
                <tbody>
                  {COST_GROUPS.map((group) => {
                    const rows = codes.filter((code) => code.group === group && visible(code));
                    const sub = totals.byGroup[group];
                    if (!rows.length && !showAll) return null;
                    return (
                      <Fragment key={group}>
                        <tr className="bs-group"><td colSpan={7}>{COST_GROUP_LABELS[group]}</td></tr>
                        {rows.map((code) => {
                          const line = lineOf(code.code);
                          return (
                            <tr key={code.code}>
                              <td>{code.code}</td>
                              <td>{code.name}</td>
                              {editable ? <>
                                <td><input aria-label={`Giá gốc ${code.code}`} inputMode="numeric" value={moneyInput(line?.nett ?? 0)} onChange={(event) => setLine(code.code, { nett: parseMoney(event.target.value) })} /></td>
                                <td><input aria-label={`Ngân sách ${code.code}`} inputMode="numeric" value={moneyInput(line?.budget ?? 0)} onChange={(event) => setLine(code.code, { budget: parseMoney(event.target.value) })} /></td>
                                <td><input aria-label={`Nhà cung cấp ${code.code}`} value={line?.supplier ?? ""} onChange={(event) => setLine(code.code, { supplier: event.target.value })} /></td>
                                <td><input aria-label={`Dự phòng ${code.code}`} inputMode="numeric" value={moneyInput(line?.contingency ?? 0)} onChange={(event) => setLine(code.code, { contingency: parseMoney(event.target.value) })} /></td>
                              </> : <>
                                <td className="pj-num">{formatVnd(line?.nett ?? 0)}</td>
                                <td className="pj-num"><b>{formatVnd(line?.budget ?? 0)}</b></td>
                                <td>{line?.supplier ?? ""}</td>
                                <td className="pj-num">{line?.contingency ? formatVnd(line.contingency) : ""}</td>
                              </>}
                              <td className="pj-num">{pctText(totals.total && line?.budget ? line.budget / totals.total : null)}</td>
                            </tr>
                          );
                        })}
                        <tr className="bs-sub"><td colSpan={2}>Cộng #{group}</td><td className="pj-num">{formatVnd(sub.nett)}</td><td className="pj-num">{formatVnd(sub.budget)}</td><td /><td className="pj-num">{sub.contingency ? formatVnd(sub.contingency) : ""}</td><td className="pj-num">{pctText(totals.total ? sub.budget / totals.total : null)}</td></tr>
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot><tr><td colSpan={2}>Tổng (#100 ~ #400)</td><td className="pj-num">{formatVnd(totals.nett)}</td><td className="pj-num">{formatVnd(totals.total)}</td><td colSpan={3} /></tr></tfoot>
              </table>
            </div>
            {!current.lines.length && !editable && <p className="muted">Lần này chưa có dòng nào.</p>}
            {current.status === "approved" && <p className="muted">Ngân sách đã duyệt được dùng để kiểm tra đơn đặt hàng (A–E). 4 khoản ngân sách ở tab Tổng quan đã được tính lại từ các nhóm mã.</p>}
          </>
        )}
      </section>
      {current && current.status !== "draft" && <ApprovalChain store={store} docType="budget" docId={current.id} refreshKey={attempt} title={`Chuỗi ký ngân sách ${current.number}`} onChanged={() => { refresh(); void reload(); }} setNotice={setNotice} />}
      {current?.status === "rejected" && <p className="warn-text">Ngân sách bị trả về: sửa rồi bấm Lưu và gửi ký lại.</p>}
    </div>
  );
}
