"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, FilePlus2, Plus, Save, Send, ShoppingCart, Trash2, X } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { formatVnd } from "../../../modules/projects/cost";
import type { CostCode } from "../../../modules/purchases/budget";
import {
  MATERIAL_STATUS_LABELS, MIN_TWO_QUOTES_FROM, cheapestByItem, materialIssue, needsSecondQuote, quoteTotal, quotedCount,
  type MaterialItem, type MaterialQuote, type MaterialQuoteDraft, type MaterialRequest, type MaterialRequestDraft,
} from "../../../modules/purchases/materials";
import { ApprovalChain } from "../purchases/ApprovalChain";
import { FormExportButtons } from "../purchases/FormExport";
import { getPurchaseStore } from "../purchases/usePurchaseStore";
import { purchasePath } from "../routes";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const TONE: Record<MaterialRequest["status"], string> = { draft: "", submitted: "warn", approved: "ok", rejected: "bad", ordered: "ok", closed: "" };
const dmy = (iso: string | null) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
let tempSeq = 0;
const blankItem = (): MaterialItem => ({ id: `tmp-${++tempSeq}`, name: "", spec: "", maker: "", unit: "", quantity: 1, neededOn: null, note: "", budgetCode: null });
const blankQuote = (requestId: string): MaterialQuoteDraft => ({ requestId, supplier: "", supplierContact: "", quoteRef: "", quoteDate: null, deliveryDays: null, paymentTerms: "", note: "", prices: {} });

/**
 * Tab Yêu cầu vật tư của dự án (P-COST-08): công trường lập phiếu (điện thoại dùng được), ký Phòng Vật tư → P. Kỹ thuật → Lãnh đạo;
 * phiếu đã duyệt thì P. Vật tư / P. Kỹ thuật hỏi giá, nhập báo giá từng NCC, so sánh, chọn NCC và lên đơn đặt hàng nháp (P-CC-07).
 */
export function MaterialsTab({ store: projectStore, data, viewer, setNotice }: TabProps) {
  const store = useMemo(() => getPurchaseStore(projectStore.mode), [projectStore.mode]);
  const [list, setList] = useState<MaterialRequest[] | null>(null);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [loadedQuotes, setQuotes] = useState<MaterialQuote[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaterialRequestDraft | null>(null);
  const [quoteDraft, setQuoteDraft] = useState<MaterialQuoteDraft | null>(null);
  const [codeDraft, setCodeDraft] = useState<Record<string, string | null> | null>(null);
  const [canQuote, setCanQuote] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const projectId = data.project.id;
  const load = useCallback(() => Promise.all([store.listMaterialRequests(projectId), store.costCodes(), store.departments().catch(() => [])]), [store, projectId]);
  useEffect(() => {
    let active = true;
    void load().then(([items, catalog, members]) => {
      if (!active) return;
      setList(items); setCodes(catalog);
      const me = data.myEmployeeId;
      setCanQuote(viewer.isAdmin || viewer.isLead || (store.mode === "demo") || members.some((member) => member.employeeId === me && (member.department === "material" || member.department === "technical")));
    }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setList([]); } });
    return () => { active = false; };
  }, [load, setNotice, attempt, data.myEmployeeId, viewer.isAdmin, viewer.isLead, store.mode]);
  const opened = list?.find((item) => item.id === openId) ?? null;
  const showQuotes = Boolean(opened && (opened.status === "approved" || opened.status === "ordered" || opened.status === "closed") && (viewer.canSeeMoney || canQuote));
  const openedId = opened?.id ?? null;
  useEffect(() => {
    let active = true;
    if (!openedId || !showQuotes) return;
    void store.listQuotes(openedId).then((items) => { if (active) setQuotes(items); }, () => { if (active) setQuotes([]); });
    return () => { active = false; };
  }, [store, openedId, showQuotes, attempt]);
  const quotes = showQuotes ? loadedQuotes.filter((quote) => quote.requestId === openedId) : [];

  if (!list) return <div className="loading">Đang tải phiếu yêu cầu vật tư…</div>;

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); setNotice(done, "success"); setAttempt((value) => value + 1); } catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(false); }
  };
  const saveRequest = (submit: boolean) => editing && run(async () => {
    const issue = materialIssue(editing, submit, codes);
    if (issue) throw new Error(issue);
    const id = await store.saveMaterialRequest(editing);
    if (submit) await store.submitMaterialRequest(id);
    setEditing(null); setOpenId(id);
  }, submit ? "Đã gửi phiếu yêu cầu vật tư đi ký." : "Đã lưu nháp phiếu.");
  const setItem = (index: number, patch: Partial<MaterialItem>) => editing && setEditing({ ...editing, items: editing.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const project = { code: data.project.code, name: data.project.name, site: data.project.site };

  return (
    <div className="pj-page">
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2><ClipboardList className="ico" size={18} aria-hidden="true" /> Yêu cầu vật tư <small className="muted">(P-COST-08)</small></h2>
          {!editing && <button type="button" className="button primary" onClick={() => { setEditing({ projectId, requestedOn: todayVN(systemClock), note: "", items: [blankItem()] }); setOpenId(null); }}><FilePlus2 className="ico" size={16} aria-hidden="true" /> Phiếu yêu cầu mới</button>}
        </div>
        <p className="muted">Công trường ghi vật tư / dụng cụ cần dùng. Phiếu được Phòng Vật tư, P. Kỹ thuật, Lãnh đạo ký; sau đó hỏi giá nhà cung cấp, so sánh và lên đơn đặt hàng nháp ngay tại đây.</p>

        {editing && (
          <div className="mr-form">
            <div className="bs-head">
              <label className="field"><span>Ngày yêu cầu</span><input type="date" value={editing.requestedOn} onChange={(event) => setEditing({ ...editing, requestedOn: event.target.value || editing.requestedOn })} /></label>
              <label className="field wide"><span>Ghi chú chung</span><input value={editing.note} placeholder="Ví dụ: cần gấp cho tầng 2" onChange={(event) => setEditing({ ...editing, note: event.target.value })} /></label>
            </div>
            <div className="mr-items">
              {editing.items.map((item, index) => (
                <fieldset key={item.id} className="mr-item">
                  <legend>Dòng {index + 1}</legend>
                  <label className="field wide"><span>Tên vật tư *</span><input value={item.name} onChange={(event) => setItem(index, { name: event.target.value })} /></label>
                  <label className="field"><span>Thông số kỹ thuật</span><input value={item.spec} onChange={(event) => setItem(index, { spec: event.target.value })} /></label>
                  <label className="field"><span>Nhà sản xuất</span><input value={item.maker} onChange={(event) => setItem(index, { maker: event.target.value })} /></label>
                  <label className="field"><span>Đơn vị *</span><input value={item.unit} placeholder="m, cái, bộ…" onChange={(event) => setItem(index, { unit: event.target.value })} /></label>
                  <label className="field"><span>Số lượng *</span><input inputMode="decimal" value={String(item.quantity)} onChange={(event) => setItem(index, { quantity: Number(event.target.value.replace(",", ".")) || 0 })} /></label>
                  <label className="field"><span>Ngày cần sử dụng</span><input type="date" value={item.neededOn ?? ""} onChange={(event) => setItem(index, { neededOn: event.target.value || null })} /></label>
                  <label className="field"><span>Mã ngân sách (nếu biết)</span><select value={item.budgetCode ?? ""} onChange={(event) => setItem(index, { budgetCode: event.target.value || null })}><option value="">— P. Vật tư điền —</option>{codes.map((code) => <option key={code.code} value={code.code}>{code.code} {code.name}</option>)}</select></label>
                  <label className="field wide"><span>Ghi chú</span><input value={item.note} onChange={(event) => setItem(index, { note: event.target.value })} /></label>
                  {editing.items.length > 1 && <button type="button" className="button danger" onClick={() => setEditing({ ...editing, items: editing.items.filter((_, i) => i !== index) })}><X className="ico" size={15} aria-hidden="true" /> Bỏ dòng</button>}
                </fieldset>
              ))}
            </div>
            <div className="button-row">
              <button type="button" className="button" onClick={() => setEditing({ ...editing, items: [...editing.items, blankItem()] })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm dòng</button>
              <button type="button" className="button" disabled={busy} onClick={() => void saveRequest(false)}><Save className="ico" size={16} aria-hidden="true" /> Lưu nháp</button>
              <button type="button" className="button primary" disabled={busy} onClick={() => void saveRequest(true)}><Send className="ico" size={16} aria-hidden="true" /> Lưu và gửi ký</button>
              <button type="button" className="button" onClick={() => setEditing(null)}>Đóng</button>
            </div>
          </div>
        )}

        {!list.length && !editing ? <p className="muted">Chưa có phiếu yêu cầu vật tư nào.</p> : list.length > 0 && (
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>Số phiếu</th><th>Ngày</th><th>Người yêu cầu</th><th>Vật tư</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>{list.map((request) => (
                <tr key={request.id} className={request.id === openId ? "row-selected" : undefined}>
                  <td><b>{request.number}</b></td>
                  <td>{dmy(request.requestedOn)}</td>
                  <td>{request.requesterName || "—"}</td>
                  <td>{request.items.slice(0, 2).map((item) => item.name).join(", ")}{request.items.length > 2 ? ` và ${request.items.length - 2} dòng khác` : ""}</td>
                  <td><span className={`pill ${TONE[request.status]}`}>{MATERIAL_STATUS_LABELS[request.status]}</span>{request.orderIds.length > 0 && <><br /><small className="muted">{request.orderIds.length} đơn hàng</small></>}</td>
                  <td className="button-row">
                    <button type="button" className="button" onClick={() => { setOpenId(openId === request.id ? null : request.id); setQuoteDraft(null); setCodeDraft(null); setCreated([]); }}>{openId === request.id ? "Thu gọn" : "Xem"}</button>
                    {(request.status === "draft" || request.status === "rejected") && <button type="button" className="button" onClick={() => { setEditing({ id: request.id, projectId, requestedOn: request.requestedOn, note: request.note, items: request.items }); setOpenId(null); }}>Sửa</button>}
                    {request.status === "draft" && <button type="button" className="button danger" aria-label="Xóa" onClick={() => { if (window.confirm(`Xóa ${request.number}?`)) void run(() => store.deleteMaterialRequest(request.id), "Đã xóa phiếu nháp."); }}><Trash2 className="ico" size={15} aria-hidden="true" /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {opened && (
        <section className="panel pj-section" aria-labelledby="mr-open-title">
          <div className="pj-section-head">
            <h2 id="mr-open-title">{opened.number} <span className={`pill ${TONE[opened.status]}`}>{MATERIAL_STATUS_LABELS[opened.status]}</span></h2>
            <div className="button-row">
              <FormExportButtons code="P-COST-08" fileBase={opened.number} setNotice={setNotice} build={async (forms) => forms.buildMaterialRequest({
                request: opened, project, codes, quotes, steps: opened.status === "draft" ? [] : await store.listSteps("material", opened.id),
              })} />
              {canQuote && (opened.status === "approved" || opened.status === "ordered") && <button type="button" className="button" onClick={() => { const why = window.prompt("Lý do đóng phiếu (đã đủ vật tư, hủy…):"); if (why) void run(() => store.closeMaterialRequest(opened.id, why), "Đã đóng phiếu."); }}>Đóng phiếu</button>}
            </div>
          </div>
          <p className="muted">Người yêu cầu {opened.requesterName || "—"} · ngày {dmy(opened.requestedOn)}{opened.note ? ` · ${opened.note}` : ""}</p>
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>STT</th><th>Tên vật tư</th><th>Thông số</th><th>NSX</th><th>ĐVT</th><th className="pj-num">SL</th><th>Cần ngày</th><th>Mã NS</th><th>Ghi chú</th></tr></thead>
              <tbody>{opened.items.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td><td>{item.name}</td><td>{item.spec}</td><td>{item.maker}</td><td>{item.unit}</td>
                  <td className="pj-num">{item.quantity.toLocaleString("vi-VN")}</td><td>{dmy(item.neededOn)}</td>
                  <td>{codeDraft && canQuote
                    ? <select aria-label={`Mã ngân sách dòng ${index + 1}`} value={codeDraft[item.id] ?? item.budgetCode ?? ""} onChange={(event) => setCodeDraft({ ...codeDraft, [item.id]: event.target.value || null })}><option value="">—</option>{codes.map((code) => <option key={code.code} value={code.code}>{code.code} {code.name}</option>)}</select>
                    : item.budgetCode ?? <span className="warn-text">chưa có</span>}</td>
                  <td>{item.note}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {canQuote && opened.status !== "submitted" && opened.status !== "closed" && (
            <div className="button-row">
              {!codeDraft ? <button type="button" className="button" onClick={() => setCodeDraft({})}>Điền mã ngân sách</button> : <>
                <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await store.setMaterialCodes(opened.id, codeDraft); setCodeDraft(null); }, "Đã lưu mã ngân sách.")}>Lưu mã</button>
                <button type="button" className="button" onClick={() => setCodeDraft(null)}>Hủy</button>
              </>}
            </div>
          )}
        </section>
      )}
      {opened && opened.status !== "draft" && <ApprovalChain store={store} docType="material" docId={opened.id} refreshKey={attempt} title={`Chuỗi ký ${opened.number}`} onChanged={() => setAttempt((value) => value + 1)} setNotice={setNotice} />}

      {opened && showQuotes && (
        <section className="panel pj-section" aria-labelledby="mr-quote-title">
          <div className="pj-section-head">
            <h2 id="mr-quote-title"><ShoppingCart className="ico" size={18} aria-hidden="true" /> Hỏi giá và bảng so sánh</h2>
            {canQuote && opened.status !== "closed" && !quoteDraft && <button type="button" className="button primary" onClick={() => setQuoteDraft(blankQuote(opened.id))}><Plus className="ico" size={16} aria-hidden="true" /> Nhập báo giá NCC</button>}
          </div>
          {needsSecondQuote(quotes, opened.items) && <p className="warn-text">Giá trị từ {formatVnd(MIN_TWO_QUOTES_FROM)} trở lên nên có ít nhất 2 báo giá để so sánh (hoặc ghi lý do chỉ có một NCC vào ghi chú báo giá).</p>}
          {quoteDraft && (
            <div className="mr-form">
              <div className="bs-head">
                <label className="field"><span>Nhà cung cấp *</span><input value={quoteDraft.supplier} onChange={(event) => setQuoteDraft({ ...quoteDraft, supplier: event.target.value })} /></label>
                <label className="field"><span>Người liên hệ / điện thoại</span><input value={quoteDraft.supplierContact} onChange={(event) => setQuoteDraft({ ...quoteDraft, supplierContact: event.target.value })} /></label>
                <label className="field"><span>Số báo giá</span><input value={quoteDraft.quoteRef} onChange={(event) => setQuoteDraft({ ...quoteDraft, quoteRef: event.target.value })} /></label>
                <label className="field"><span>Ngày báo giá</span><input type="date" value={quoteDraft.quoteDate ?? ""} onChange={(event) => setQuoteDraft({ ...quoteDraft, quoteDate: event.target.value || null })} /></label>
                <label className="field"><span>Giao trong (ngày)</span><input inputMode="numeric" value={quoteDraft.deliveryDays ?? ""} onChange={(event) => setQuoteDraft({ ...quoteDraft, deliveryDays: event.target.value ? Number(event.target.value) || 0 : null })} /></label>
                <label className="field"><span>Điều kiện thanh toán</span><input value={quoteDraft.paymentTerms} placeholder="Ví dụ: tạm ứng 30%, còn lại 30 ngày" onChange={(event) => setQuoteDraft({ ...quoteDraft, paymentTerms: event.target.value })} /></label>
              </div>
              <div className="table-scroll">
                <table className="pj-table">
                  <thead><tr><th>Vật tư</th><th className="pj-num">SL</th><th className="pj-num">Đơn giá (VNĐ, chưa VAT)</th><th className="pj-num">Thành tiền</th></tr></thead>
                  <tbody>{opened.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name} <small className="muted">{item.unit}</small></td>
                      <td className="pj-num">{item.quantity.toLocaleString("vi-VN")}</td>
                      <td><input aria-label={`Đơn giá ${item.name}`} inputMode="numeric" value={moneyInput(quoteDraft.prices[item.id] ?? 0)} onChange={(event) => setQuoteDraft({ ...quoteDraft, prices: { ...quoteDraft.prices, [item.id]: parseMoney(event.target.value) } })} /></td>
                      <td className="pj-num">{formatVnd(Math.round((quoteDraft.prices[item.id] ?? 0) * item.quantity))}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr><td colSpan={3}>Tổng</td><td className="pj-num">{formatVnd(quoteTotal(quoteDraft, opened.items))}</td></tr></tfoot>
                </table>
              </div>
              <label className="field"><span>Ghi chú</span><input value={quoteDraft.note} onChange={(event) => setQuoteDraft({ ...quoteDraft, note: event.target.value })} /></label>
              <div className="button-row">
                <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await store.saveQuote(quoteDraft); setQuoteDraft(null); }, "Đã lưu báo giá.")}><Save className="ico" size={16} aria-hidden="true" /> Lưu báo giá</button>
                <button type="button" className="button" onClick={() => setQuoteDraft(null)}>Đóng</button>
              </div>
            </div>
          )}
          {!quotes.length ? <p className="muted">Chưa có báo giá nào.</p> : <QuoteCompare request={opened} quotes={quotes} canQuote={canQuote && opened.status !== "closed"} busy={busy}
            onEdit={(quote) => setQuoteDraft({ id: quote.id, requestId: quote.requestId, supplier: quote.supplier, supplierContact: quote.supplierContact, quoteRef: quote.quoteRef, quoteDate: quote.quoteDate, deliveryDays: quote.deliveryDays, paymentTerms: quote.paymentTerms, note: quote.note, prices: quote.prices })}
            onDelete={(quote) => { if (window.confirm(`Xóa báo giá của ${quote.supplier}?`)) void run(() => store.deleteQuote(quote.id), "Đã xóa báo giá."); }}
            onOrder={(quote) => { if (window.confirm(`Chọn ${quote.supplier} và lập đơn đặt hàng nháp (mỗi mã ngân sách một đơn)?`)) void run(async () => { setCreated(await store.ordersFromQuote(opened.id, quote.id)); }, "Đã lập đơn đặt hàng nháp. Mở đơn để kiểm tra rồi gửi duyệt."); }} />}
          {created.length > 0 && <p className="po-terms-line">Đơn vừa lập: {created.map((id, index) => <a key={id} className="link-button" href={purchasePath(id)}>Mở đơn {index + 1}</a>)}</p>}
        </section>
      )}
    </div>
  );
}

function QuoteCompare(props: { request: MaterialRequest; quotes: MaterialQuote[]; canQuote: boolean; busy: boolean; onEdit: (quote: MaterialQuote) => void; onDelete: (quote: MaterialQuote) => void; onOrder: (quote: MaterialQuote) => void }) {
  const { request, quotes } = props;
  const cheapest = cheapestByItem(quotes, request.items);
  const totals = quotes.map((quote) => quoteTotal(quote, request.items));
  const best = Math.min(...totals.filter((total) => total > 0));
  return (
    <div className="table-scroll">
      <table className="pj-table mr-compare">
        <thead>
          <tr><th>Vật tư</th><th className="pj-num">SL</th>{quotes.map((quote) => <th key={quote.id} className="pj-num">{quote.supplier}{quote.selected && <><br /><span className="pill ok">Đã chọn</span></>}</th>)}</tr>
        </thead>
        <tbody>
          {request.items.map((item) => (
            <tr key={item.id}>
              <td>{item.name} <small className="muted">{item.unit}</small></td>
              <td className="pj-num">{item.quantity.toLocaleString("vi-VN")}</td>
              {quotes.map((quote) => {
                const price = quote.prices[item.id] ?? 0;
                return <td key={quote.id} className={`pj-num ${cheapest[item.id] === quote.id ? "mr-best" : ""}`}>{price > 0 ? <>{formatVnd(price)}<br /><small className="muted">{formatVnd(Math.round(price * item.quantity))}</small></> : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Tổng (chưa VAT)</td>{quotes.map((quote, index) => <td key={quote.id} className={`pj-num ${totals[index] === best ? "mr-best" : ""}`}><b>{formatVnd(totals[index]!)}</b><br /><small className="muted">{quotedCount(quote, request.items)}/{request.items.length} dòng</small></td>)}</tr>
          <tr><td colSpan={2}>Giao / thanh toán</td>{quotes.map((quote) => <td key={quote.id} className="pj-num"><small>{quote.deliveryDays !== null ? `${quote.deliveryDays} ngày` : "—"}<br />{quote.paymentTerms || "—"}{quote.quoteRef ? <><br />{quote.quoteRef}</> : null}</small></td>)}</tr>
          {props.canQuote && <tr><td colSpan={2} />{quotes.map((quote) => (
            <td key={quote.id} className="pj-num">{!quote.selected && <span className="button-row">
              <button type="button" className="button primary" disabled={props.busy} onClick={() => props.onOrder(quote)}>Chọn, lên đơn</button>
              <button type="button" className="button" onClick={() => props.onEdit(quote)}>Sửa</button>
              <button type="button" className="button danger" aria-label="Xóa báo giá" onClick={() => props.onDelete(quote)}><Trash2 className="ico" size={14} aria-hidden="true" /></button>
            </span>}</td>
          ))}</tr>}
        </tfoot>
      </table>
    </div>
  );
}
