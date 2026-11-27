"use client";
import { SkeletonTable } from "../Skeleton";
import { createPortal } from "react-dom";
import { AsideSlotContext } from "./asideSlot";
import { OrderMiniPath } from "../purchases/OrderProgress";
import { PURCHASE_STATUS_LABELS, type PurchaseOrder } from "../../../modules/purchases/types";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ClipboardList, FileSearch, FilePlus2, FileSpreadsheet, Plus, Save, Send, ShoppingCart, Trash2, Upload, X } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { formatVnd } from "../../../modules/projects/cost";
import type { CostCode } from "../../../modules/purchases/budget";
import {
  MATERIAL_STATUS_LABELS, MIN_TWO_QUOTES_FROM, materialCurrentLabel, materialProgress, type MaterialStage, cheapestByItem, materialIssue, matchQuoteItems, needsSecondQuote, quoteTotal, quotedCount,
  type MaterialItem, type MaterialQuote, type MaterialQuoteDraft, type MaterialRequest, type MaterialRequestDraft,
} from "../../../modules/purchases/materials";
import { ApprovalChain } from "../purchases/ApprovalChain";
import { readQuote } from "../purchases/quoteImport";
import { FormExportButtons } from "../purchases/FormExport";
import { getPurchaseStore } from "../purchases/usePurchaseStore";
import { projectOrderPath } from "../routes";
import type { TabProps } from "./ProjectDetail";
import type { PurchaseStore } from "../../../modules/purchases/store";
import type { Notify } from "../Toast";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const TONE: Record<MaterialRequest["status"], string> = { draft: "", submitted: "warn", approved: "ok", rejected: "bad", ordered: "ok", closed: "" };
const dmy = (iso: string | null) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
let tempSeq = 0;
const blankItem = (): MaterialItem => ({ id: `tmp-${++tempSeq}`, name: "", spec: "", maker: "", unit: "", quantity: 1, neededOn: null, note: "", budgetCode: null });
const blankQuote = (requestId: string, budgetCode: string | null): MaterialQuoteDraft => ({ requestId, budgetCode, supplier: "", supplierContact: "", quoteRef: "", quoteDate: null, deliveryDays: null, paymentTerms: "", note: "", prices: {} });

/**
 * Tab Yêu cầu vật tư của dự án (P-COST-08): công trường lập phiếu (điện thoại dùng được), ký Phòng Vật tư → P. Kỹ thuật → Lãnh đạo;
 * phiếu đã duyệt thì P. Vật tư / P. Kỹ thuật hỏi giá, nhập báo giá từng NCC, so sánh, chọn NCC và lên đơn đặt hàng nháp (P-CC-07).
 */
export function MaterialsTab({ store: projectStore, data, viewer, setNotice }: TabProps) {
  const store = useMemo(() => getPurchaseStore(projectStore.mode), [projectStore.mode]);
  return <MaterialRequestsPanel store={store} scope={{ projectId: data.project.id, code: data.project.code, name: data.project.name, site: data.project.site }}
    myEmployeeId={data.myEmployeeId} isAdmin={viewer.isAdmin} isLead={viewer.isLead} canSeeMoney={viewer.canSeeMoney}
    orderHref={(id) => projectOrderPath(data.project.id, id, "don-nhap")} setNotice={setNotice} />;
}

/** Phạm vi phiếu: một dự án, hoặc Văn phòng (projectId null: không chia mã ngân sách, báo giá chọn xong gộp một đơn). */
export type MaterialScope = { projectId: string | null; code: string; name: string; site: string };

/** Danh sách + soạn + ký + hỏi giá YCVT, dùng chung cho tab dự án và trang Văn phòng. */
export function MaterialRequestsPanel({ store, scope, myEmployeeId, isAdmin, isLead, canSeeMoney, orderHref, setNotice, fixedRequestId, openOnly, newSignal, onOpenChange }: {
  store: PurchaseStore; scope: MaterialScope; myEmployeeId: string | null; isAdmin: boolean; isLead: boolean; canSeeMoney: boolean;
  orderHref: (orderId: string) => string; setNotice: Notify;
  /** Chỉ hiện một phiếu (bước "Yêu cầu vật tư" trên thanh của PO): không có danh sách, không có nút quay lại. */
  fixedRequestId?: string;
  /** Danh sách chỉ phiếu đang xử lý (chưa lên PO, chưa đóng) — dùng ở màn Đơn hàng. */
  openOnly?: boolean;
  /** Tăng số này để mở form phiếu mới (nút "Phiếu YCVT mới" đặt ở màn Đơn hàng). */
  newSignal?: number;
  /** Báo cho màn cha khi đang mở / soạn một phiếu (để ẩn danh sách đơn bên dưới). */
  onOpenChange?: (open: boolean) => void;
}) {
  const office = scope.projectId === null;
  const [list, setList] = useState<MaterialRequest[] | null>(null);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [loadedQuotes, setQuotes] = useState<MaterialQuote[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaterialRequestDraft | null>(null);
  const [quoteDraft, setQuoteDraft] = useState<MaterialQuoteDraft | null>(null);
  // Đọc file báo giá NCC (PDF / ảnh) điền sẵn vào form báo giá: ô nào điền tự động thì nhắc kiểm tra
  const [quoteReading, setQuoteReading] = useState(false);
  const [quoteNotes, setQuoteNotes] = useState<string[]>([]);
  const [codeDraft, setCodeDraft] = useState<Record<string, string | null> | null>(null);
  const [canQuote, setCanQuote] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  // Đơn hàng lập từ các phiếu và số báo giá của từng phiếu (để hiện tiến độ ở danh sách)
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [quoteCounts, setQuoteCounts] = useState<Record<string, number>>({});
  const asideSlot = useContext(AsideSlotContext);
  const projectId = scope.projectId;
  const load = useCallback(async () => {
    const [items, catalog, members, allOrders] = await Promise.all([store.listMaterialRequests(projectId), store.costCodes(), store.departments().catch(() => []), store.listOrders().catch(() => [] as PurchaseOrder[])]);
    const quoted = items.filter((item) => item.status === "approved" || item.status === "ordered" || item.status === "closed");
    const counts: Record<string, number> = Object.fromEntries(await Promise.all(quoted.map(async (item) => [item.id, (await store.listQuotes(item.id).catch(() => [])).length] as const)));
    const ids = new Set(items.flatMap((item) => item.orderIds));
    return { items, catalog, members, linked: allOrders.filter((order) => ids.has(order.id)), counts };
  }, [store, projectId]);
  useEffect(() => {
    let active = true;
    void load().then(({ items, catalog, members, linked, counts }) => {
      if (!active) return;
      setList(items); setCodes(catalog); setOrders(linked); setQuoteCounts(counts);
      const me = myEmployeeId;
      setCanQuote(isAdmin || isLead || (store.mode === "demo") || members.some((member) => member.employeeId === me && (member.department === "material" || member.department === "technical")));
    }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setList([]); } });
    return () => { active = false; };
  }, [load, setNotice, attempt, myEmployeeId, isAdmin, isLead, store.mode]);
  const opened = list?.find((item) => item.id === (fixedRequestId ?? openId)) ?? null;
  // Nút "Phiếu YCVT mới" ở màn cha
  const [seenSignal, setSeenSignal] = useState(newSignal ?? 0);
  if ((newSignal ?? 0) !== seenSignal) {
    setSeenSignal(newSignal ?? 0);
    if (newSignal) { setEditing({ projectId, requestedOn: todayVN(systemClock), note: "", items: [blankItem()] }); setOpenId(null); setImportNotes([]); }
  }
  const busyView = Boolean(opened || editing);
  const shownList = (list ?? []).filter((request) => !openOnly || ["draft", "submitted", "approved", "rejected"].includes(request.status));
  useEffect(() => { onOpenChange?.(busyView); }, [busyView, onOpenChange]);
  // Không còn hỏi giá ở phiếu: đơn giá, NCC điền thẳng trong PO nháp. Phiếu cũ đã có báo giá vẫn xem được bảng so sánh.
  const showQuotes = Boolean(opened && (opened.status === "approved" || opened.status === "ordered" || opened.status === "closed") && (canSeeMoney || canQuote));
  const openedId = opened?.id ?? null;
  useEffect(() => {
    let active = true;
    if (!openedId || !showQuotes) return;
    void store.listQuotes(openedId).then((items) => { if (active) setQuotes(items); }, () => { if (active) setQuotes([]); });
    return () => { active = false; };
  }, [store, openedId, showQuotes, attempt]);
  const quotes = showQuotes ? loadedQuotes.filter((quote) => quote.requestId === openedId) : [];

  if (!list) return <SkeletonTable rows={4} label="Đang tải phiếu yêu cầu vật tư…" />;

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
  }, submit ? "Đã gửi phiếu đi ký (P. Vật tư → P. Kỹ thuật → Lãnh đạo)." : "Đã lưu nháp phiếu.");
  /** Nhập phiếu từ file Excel theo mẫu P-COST-08: điền sẵn vào phiếu mới (hoặc thêm vào phiếu đang soạn) để kiểm tra rồi lưu. */
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const { readMaterialFile } = await import("./materialFile");
      const result = await readMaterialFile(file);
      const notes = [...result.warnings];
      const norm = (code: string) => code.replace(/\s/g, "").toLowerCase();
      if (result.projectCode && !office && norm(result.projectCode) !== norm(scope.code)) notes.unshift(`File ghi số dự án “${result.projectCode}”, khác dự án đang mở (${scope.code}): kiểm tra lại trước khi lưu.`);
      const imported = result.items.map((item) => ({ ...item, id: `tmp-${++tempSeq}` }));
      setEditing((current) => current
        ? { ...current, items: [...current.items.filter((item) => item.name.trim()), ...imported] }
        : { projectId, requestedOn: result.requestedOn ?? todayVN(systemClock), note: "", items: imported.length ? imported : [blankItem()] });
      setOpenId(null);
      setImportNotes(notes);
      setNotice(`Đã đọc ${imported.length} dòng vật tư từ ${file.name}. Kiểm tra rồi bấm Lưu nháp hoặc Lưu và gửi ký.`, "success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không đọc được file.", "error");
    } finally { setImporting(false); }
  };
  const setItem = (index: number, patch: Partial<MaterialItem>) => editing && setEditing({ ...editing, items: editing.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const project = { code: scope.code, name: scope.name, site: scope.site };
  const ordersOf = (request: MaterialRequest) => orders.filter((order) => request.orderIds.includes(order.id));
  const progressOf = (request: MaterialRequest) => materialProgress(request, request.id === openedId && showQuotes ? quotes.length : quoteCounts[request.id] ?? 0, ordersOf(request));
  const codeName = (code: string | null) => code ? `${code} ${codes.find((item) => item.code === code)?.name ?? ""}`.trim() : "Chưa có hạng mục";
  /** Vật tư theo hạng mục (mã ngân sách); văn phòng không chia hạng mục. */
  const groupsOf = (request: MaterialRequest) => office ? [{ code: null as string | null, items: request.items }]
    : [...new Set(request.items.map((item) => item.budgetCode))].sort((a, b) => a === null ? 1 : b === null ? -1 : a.localeCompare(b, "vi", { numeric: true }))
      .map((code) => ({ code, items: request.items.filter((item) => item.budgetCode === code) }));
  /** Các PO (chưa hủy) của một hạng mục trong phiếu (mỗi báo giá chọn ra một PO); văn phòng: cả phiếu. */
  const groupOrders = (request: MaterialRequest, code: string | null) => ordersOf(request).filter((order) => order.status !== "cancelled" && (office || order.budgetCode === code));
  const poLink = (order: PurchaseOrder) => <a key={order.id} className="mr-po-link" href={orderHref(order.id)} onClick={(event) => event.stopPropagation()}><ShoppingCart size={13} aria-hidden="true" /> {order.code}{order.supplier ? ` · ${order.supplier}` : ""} <span className={`pill ${order.status === "draft" ? "" : "ok"}`}>{PURCHASE_STATUS_LABELS[order.status]}</span></a>;
  const groupOrderCell = (request: MaterialRequest, code: string | null) => {
    const list = groupOrders(request, code);
    return list.length ? <span className="mr-po-list-inline">{list.map(poLink)}</span> : <small className="muted">{request.status === "approved" || request.status === "ordered" ? "Chưa có PO: nhập báo giá rồi chọn để lập PO" : "Chưa có PO"}</small>;
  };
  /** Đọc báo giá NCC từ file: điền thông tin NCC và đơn giá các dòng khớp tên; chưa chọn hạng mục thì lấy hạng mục khớp nhiều dòng nhất. */
  const readQuoteFile = async (file: File) => {
    if (!opened || !quoteDraft) return;
    setQuoteReading(true); setQuoteNotes([]);
    try {
      const { data, problems } = await readQuote(file);
      const all = matchQuoteItems(opened.items, data.items);
      const codeOf = (id: string) => opened.items.find((item) => item.id === id)?.budgetCode ?? null;
      let code = quoteDraft.budgetCode;
      if (!office) {
        const counts = new Map<string, number>();
        for (const id of Object.keys(all.prices)) { const c = codeOf(id); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); }
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (best && !Object.keys(all.prices).some((id) => codeOf(id) === code)) code = best;
      }
      const prices = Object.fromEntries(Object.entries(all.prices).filter(([id]) => office || codeOf(id) === code));
      const groupItems = opened.items.filter((item) => office || item.budgetCode === code);
      const notes = [...problems];
      const missing = groupItems.filter((item) => !(item.id in prices)).map((item) => item.name);
      if (missing.length) notes.push(`Chưa tìm thấy giá cho: ${missing.join(", ")}. Nhập tay nếu NCC có báo.`);
      if (all.unmatched.length) notes.push(`Dòng trong báo giá không khớp vật tư của phiếu: ${all.unmatched.slice(0, 6).join(", ")}${all.unmatched.length > 6 ? "…" : ""}.`);
      if (data.vat) notes.push("Đơn giá điền là giá chưa VAT theo báo giá.");
      setQuoteDraft({
        ...quoteDraft, budgetCode: code,
        supplier: data.supplier || quoteDraft.supplier, supplierContact: [data.contact, data.phone].filter(Boolean).join(" · ") || quoteDraft.supplierContact,
        quoteRef: data.quoteNo || quoteDraft.quoteRef, quoteDate: data.quoteDate ?? quoteDraft.quoteDate,
        paymentTerms: data.paymentTerms || quoteDraft.paymentTerms, prices: { ...quoteDraft.prices, ...prices },
      });
      setQuoteNotes(notes);
      setNotice(`Đã đọc báo giá${data.supplier ? ` ${data.supplier}` : ""}: điền ${Object.keys(prices).length}/${groupItems.length} dòng. Kiểm tra rồi bấm Lưu báo giá.`, "success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Chưa đọc được báo giá.", "error");
    } finally { setQuoteReading(false); }
  };
  const openRequest = (id: string | null) => { setOpenId(id); setQuoteDraft(null); setCodeDraft(null); setCreated([]); };
  // Chuỗi ký của phiếu đang mở: ở tab dự án nằm khung bên phải, trên Người duyệt
  const chain = opened && opened.status !== "draft"
    ? <ApprovalChain store={store} docType="material" docId={opened.id} refreshKey={attempt} title={`Chuỗi ký ${opened.number}`} compact={Boolean(asideSlot)} onChanged={() => setAttempt((value) => value + 1)} setNotice={setNotice} />
    : null;

  return (
    <div className="pj-page">
      {!opened && !fixedRequestId && (!openOnly || editing || shownList.length > 0) && <section className="panel pj-section">
        <div className="pj-section-head">
          <h2><ClipboardList className="ico" size={18} aria-hidden="true" /> {openOnly ? "Yêu cầu vật tư đang xử lý" : "Yêu cầu vật tư"} <small className="muted">(P-COST-08)</small></h2>
          {!editing && <div className="button-row">
            <a className="button" href="/templates/quy-trinh/P-COST-08.xlsx" download="P-COST-08 Phieu yeu cau vat tu (mau).xlsx"><FileSpreadsheet className="ico" size={16} aria-hidden="true" /> Tải file mẫu</a>
            <label className="button"><Upload className="ico" size={16} aria-hidden="true" /> {importing ? "Đang đọc file…" : "Nhập từ file Excel"}
              <input type="file" hidden accept=".xls,.xlsx" disabled={importing} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
            {!openOnly && <button type="button" className="button primary" onClick={() => { setEditing({ projectId, requestedOn: todayVN(systemClock), note: "", items: [blankItem()] }); setOpenId(null); setImportNotes([]); }}><FilePlus2 className="ico" size={16} aria-hidden="true" /> Phiếu yêu cầu mới</button>}
          </div>}
        </div>
        <p className="muted">Công trường ghi vật tư / dụng cụ cần dùng (gõ trực tiếp hoặc nhập từ file Excel theo mẫu P-COST-08). Phiếu ký P. Vật tư → P. Kỹ thuật → Lãnh đạo; duyệt xong P. Vật tư nhập báo giá (mỗi báo giá một hạng mục), chọn báo giá nào là ra một PO nháp. Trên thanh của PO, YCVT là bước đầu tiên.</p>

        {editing && (
          <div className="mr-form mr-paper">
            <h3 className="mr-paper-title">PHIẾU YÊU CẦU VẬT TƯ</h3>
            <div className="mr-paper-head">
              <span><b>{office ? "Bộ phận:" : "Tên dự án:"}</b> {scope.name}</span>
              <label><b>Ngày yêu cầu:</b> <input type="date" value={editing.requestedOn} onChange={(event) => setEditing({ ...editing, requestedOn: event.target.value || editing.requestedOn })} /></label>
              <span><b>{office ? "Mã:" : "Số dự án:"}</b> {scope.code}</span>
              <label className="mr-paper-note"><b>Ghi chú chung:</b> <input value={editing.note} placeholder="Ví dụ: cần gấp cho tầng 2" onChange={(event) => setEditing({ ...editing, note: event.target.value })} /></label>
            </div>
            {importNotes.length > 0 && <ul className="list-notice is-warn mr-import-notes">{importNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
            <div className="table-scroll">
              <table className="pj-table mr-grid">
                <thead><tr><th>STT</th><th>Tên vật tư *</th><th>Thông số kỹ thuật</th><th>Nhà sản xuất</th><th>Đơn vị *</th><th className="pj-num">Số lượng *</th><th>Ngày cần sử dụng</th><th>Ghi chú</th>{!office && <th>Mã NS</th>}<th /></tr></thead>
                <tbody>{editing.items.map((item, index) => (
                  <tr key={item.id}>
                    <td className="mr-stt">{index + 1}</td>
                    <td><input aria-label={`Tên vật tư dòng ${index + 1}`} value={item.name} onChange={(event) => setItem(index, { name: event.target.value })} /></td>
                    <td><input aria-label={`Thông số dòng ${index + 1}`} value={item.spec} onChange={(event) => setItem(index, { spec: event.target.value })} /></td>
                    <td><input aria-label={`Nhà sản xuất dòng ${index + 1}`} value={item.maker} onChange={(event) => setItem(index, { maker: event.target.value })} /></td>
                    <td><input aria-label={`Đơn vị dòng ${index + 1}`} className="mr-unit" value={item.unit} placeholder="m, cái…" onChange={(event) => setItem(index, { unit: event.target.value })} /></td>
                    <td><input aria-label={`Số lượng dòng ${index + 1}`} className="mr-qty" inputMode="decimal" value={String(item.quantity)} onChange={(event) => setItem(index, { quantity: Number(event.target.value.replace(",", ".")) || 0 })} /></td>
                    <td><input aria-label={`Ngày cần dòng ${index + 1}`} type="date" value={item.neededOn ?? ""} onChange={(event) => setItem(index, { neededOn: event.target.value || null })} /></td>
                    <td><input aria-label={`Ghi chú dòng ${index + 1}`} value={item.note} onChange={(event) => setItem(index, { note: event.target.value })} /></td>
                    {!office && <td><select aria-label={`Mã ngân sách dòng ${index + 1}`} value={item.budgetCode ?? ""} onChange={(event) => setItem(index, { budgetCode: event.target.value || null })}><option value="">— P. Vật tư điền —</option>{codes.map((code) => <option key={code.code} value={code.code}>{code.code} {code.name}</option>)}</select></td>}
                    <td>{editing.items.length > 1 && <button type="button" className="icon-link" aria-label={`Bỏ dòng ${index + 1}`} onClick={() => setEditing({ ...editing, items: editing.items.filter((_, i) => i !== index) })}><X size={15} aria-hidden="true" /></button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mr-paper-signs" aria-hidden="true"><span>Lãnh Đạo</span><span>P. Kỹ Thuật</span><span>Phòng Vật Tư, Kho</span><span>Người Yêu Cầu</span></div>
            <div className="button-row">
              <button type="button" className="button" onClick={() => setEditing({ ...editing, items: [...editing.items, blankItem()] })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm dòng</button>
              <label className="button"><Upload className="ico" size={16} aria-hidden="true" /> {importing ? "Đang đọc file…" : "Thêm từ file Excel"}
                <input type="file" hidden accept=".xls,.xlsx" disabled={importing} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
              <button type="button" className="button" disabled={busy} onClick={() => void saveRequest(false)}><Save className="ico" size={16} aria-hidden="true" /> Lưu nháp</button>
              <button type="button" className="button primary" disabled={busy} onClick={() => void saveRequest(true)}><Send className="ico" size={16} aria-hidden="true" /> Lưu và gửi ký</button>
              <button type="button" className="button" onClick={() => { setEditing(null); setImportNotes([]); }}>Đóng</button>
            </div>
          </div>
        )}

        {!shownList.length && !editing ? <p className="muted">Chưa có phiếu yêu cầu vật tư nào.</p> : shownList.length > 0 && (
          <div className="table-scroll">
            <table className="pj-table mr-list">
              <thead><tr><th>Số phiếu</th><th>Người yêu cầu</th><th>Vật tư</th><th className="pj-num">Báo giá</th><th>PO</th><th>Tiến độ</th><th /></tr></thead>
              <tbody>{shownList.map((request) => {
                const groups = office ? 0 : new Set(request.items.map((item) => item.budgetCode ?? "")).size;
                return (
                  <tr key={request.id} className="mr-row" onClick={() => openRequest(request.id)}>
                    <td><button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); openRequest(request.id); }}><b>{request.number}</b></button><br /><small className="muted">{dmy(request.requestedOn)}</small></td>
                    <td>{request.requesterName || "—"}</td>
                    <td>{request.items.slice(0, 2).map((item) => item.name).join(", ")}{request.items.length > 2 ? ` và ${request.items.length - 2} dòng khác` : ""}<br />
                      <small className="muted">{request.items.length} dòng{groups ? ` · ${groups} hạng mục` : ""}</small></td>
                    <td className="pj-num">{quoteCounts[request.id] ?? 0}</td>
                    <td>{(() => {
                      const linked = ordersOf(request).filter((order) => order.status !== "cancelled");
                      return linked.length ? <div className="mr-po-list">{linked.map((order) => <a key={order.id} className="mr-po-link" href={orderHref(order.id)} onClick={(event) => event.stopPropagation()}>{order.code}{!office && order.budgetCode ? <small> · {order.budgetCode}</small> : null}</a>)}</div> : <small className="muted">—</small>;
                    })()}</td>
                    <td><MaterialMiniPath stages={progressOf(request)} /></td>
                    <td className="button-row" onClick={(event) => event.stopPropagation()}>
                      {(request.status === "draft" || request.status === "rejected") && <button type="button" className="button" onClick={() => { setEditing({ id: request.id, projectId, requestedOn: request.requestedOn, note: request.note, items: request.items }); setOpenId(null); }}>Sửa</button>}
                      {request.status === "draft" && <button type="button" className="button danger" aria-label="Xóa" onClick={() => { if (window.confirm(`Xóa ${request.number}?`)) void run(() => store.deleteMaterialRequest(request.id), "Đã xóa phiếu nháp."); }}><Trash2 className="ico" size={15} aria-hidden="true" /></button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>}

      {opened && <>
        {!fixedRequestId && <button type="button" className="back-button" onClick={() => openRequest(null)}><ArrowLeft className="ico" size={16} aria-hidden="true" /> {openOnly ? "Danh sách đơn hàng" : "Danh sách yêu cầu vật tư"}</button>}
        <section className="panel pj-section" aria-label="Tiến độ phiếu">
          <MaterialProgressBar stages={progressOf(opened)} />
        </section>
      </>}
      {opened && (
        <section className="panel pj-section" aria-labelledby="mr-open-title" id="mr-sec-items">
          <div className="pj-section-head">
            <h2 id="mr-open-title">{opened.number} <span className={`pill ${TONE[opened.status]}`}>{MATERIAL_STATUS_LABELS[opened.status]}</span></h2>
            <div className="button-row">
              <FormExportButtons code="P-COST-08" fileBase={opened.number} setNotice={setNotice} build={async (forms, template) => {
                const input = { request: opened, project, codes, quotes, steps: opened.status === "draft" ? [] : await store.listSteps("material", opened.id) };
                return template ? forms.fillMaterialRequest(template, input) : forms.buildMaterialRequest(input);
              }} />
              {canQuote && (opened.status === "approved" || opened.status === "ordered") && <button type="button" className="button" onClick={() => { const why = window.prompt("Lý do đóng phiếu (đã đủ vật tư, hủy…):"); if (why) void run(() => store.closeMaterialRequest(opened.id, why), "Đã đóng phiếu."); }}>Đóng phiếu</button>}
            </div>
          </div>
          <p className="muted">Người yêu cầu {opened.requesterName || "—"} · ngày {dmy(opened.requestedOn)}{opened.note ? ` · ${opened.note}` : ""}</p>
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>STT</th><th>Tên vật tư</th><th>Thông số</th><th>NSX</th><th>ĐVT</th><th className="pj-num">SL</th><th>Cần ngày</th>{!office && <th>Mã NS</th>}<th>Ghi chú</th></tr></thead>
              {groupsOf(opened).map((group) => <tbody key={group.code ?? "-"}>
                <tr className="mr-group"><td colSpan={office ? 8 : 9}><div className="mr-group-row"><span><b>{office ? "Cả phiếu (văn phòng)" : group.code ? codeName(group.code) : "Chưa có mã ngân sách (chọn mã trong PO)"}</b> <small className="muted">· {group.items.length} dòng</small></span>{groupOrderCell(opened, group.code)}</div></td></tr>
                {group.items.map((item) => { const index = opened.items.indexOf(item); return (
                <tr key={item.id}>
                  <td>{index + 1}</td><td>{item.name}</td><td>{item.spec}</td><td>{item.maker}</td><td>{item.unit}</td>
                  <td className="pj-num">{item.quantity.toLocaleString("vi-VN")}</td><td>{dmy(item.neededOn)}</td>
                  {!office && <td>{codeDraft && canQuote
                    ? <select aria-label={`Mã ngân sách dòng ${index + 1}`} value={codeDraft[item.id] ?? item.budgetCode ?? ""} onChange={(event) => setCodeDraft({ ...codeDraft, [item.id]: event.target.value || null })}><option value="">—</option>{codes.map((code) => <option key={code.code} value={code.code}>{code.code} {code.name}</option>)}</select>
                    : item.budgetCode ?? <span className="warn-text">chưa có</span>}</td>}
                  <td>{item.note}</td>
                </tr>
              ); })}</tbody>)}
            </table>
          </div>
          {!office && canQuote && opened.status !== "submitted" && opened.status !== "closed" && !ordersOf(opened).length && (
            <div className="button-row">
              {!codeDraft ? <button type="button" className="button" onClick={() => setCodeDraft({})}>Điền mã ngân sách</button> : <>
                <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await store.setMaterialCodes(opened.id, codeDraft); setCodeDraft(null); }, "Đã lưu mã ngân sách.")}>Lưu mã</button>
                <button type="button" className="button" onClick={() => setCodeDraft(null)}>Hủy</button>
              </>}
            </div>
          )}
        </section>
      )}
      {chain && (asideSlot ? createPortal(chain, asideSlot) : chain)}

      {opened && showQuotes && (
        <section className="panel pj-section" aria-labelledby="mr-quote-title" id="mr-sec-quotes">
          <div className="pj-section-head">
            <h2 id="mr-quote-title"><ShoppingCart className="ico" size={18} aria-hidden="true" /> Hỏi giá và bảng so sánh</h2>
            {canQuote && opened.status !== "closed" && !quoteDraft && <button type="button" className="button primary" onClick={() => setQuoteDraft(blankQuote(opened.id, office ? null : groupsOf(opened).find((group) => group.code)?.code ?? null))}><Plus className="ico" size={16} aria-hidden="true" /> Nhập báo giá NCC</button>}
          </div>
          {needsSecondQuote(quotes, opened.items) && <p className="warn-text">Giá trị từ {formatVnd(MIN_TWO_QUOTES_FROM)} trở lên nên có ít nhất 2 báo giá để so sánh (hoặc ghi lý do chỉ có một NCC vào ghi chú báo giá).</p>}
          {quoteDraft && (
            <div className="mr-form">
              <div className="mr-quote-import">
                <label className="button"><FileSearch className="ico" size={16} aria-hidden="true" /> {quoteReading ? "Đang đọc báo giá…" : "Đọc file báo giá (PDF / ảnh)"}
                  <input type="file" hidden accept=".pdf,image/*" disabled={quoteReading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file && opened) void readQuoteFile(file); }} /></label>
                <small className="muted">Tự điền NCC, số / ngày báo giá, điều kiện thanh toán và đơn giá từng dòng khớp tên vật tư. Kiểm tra lại trước khi lưu.</small>
              </div>
              {quoteNotes.length > 0 && <ul className="list-notice is-warn">{quoteNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
              <div className="bs-head">
                {!office && <label className="field"><span>Hạng mục (mỗi báo giá một PO) *</span><select value={quoteDraft.budgetCode ?? ""} onChange={(event) => {
                  const code = event.target.value || null;
                  // Đổi hạng mục: bỏ giá của các dòng không thuộc hạng mục mới
                  const keep = new Set(opened.items.filter((item) => item.budgetCode === code).map((item) => item.id));
                  setQuoteDraft({ ...quoteDraft, budgetCode: code, prices: Object.fromEntries(Object.entries(quoteDraft.prices).filter(([id]) => keep.has(id))) });
                }}>{groupsOf(opened).filter((group) => group.code).map((group) => <option key={group.code} value={group.code!}>{codeName(group.code)}</option>)}</select></label>}
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
                  <tbody>{opened.items.filter((item) => office || item.budgetCode === quoteDraft.budgetCode).map((item) => (
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
                <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await store.saveQuote(quoteDraft); setQuoteDraft(null); setQuoteNotes([]); }, "Đã lưu báo giá.")}><Save className="ico" size={16} aria-hidden="true" /> Lưu báo giá</button>
                <button type="button" className="button" onClick={() => { setQuoteDraft(null); setQuoteNotes([]); }}>Đóng</button>
              </div>
            </div>
          )}
          {!quotes.length ? <p className="muted">Chưa có báo giá nào.</p> : <QuoteCompare request={opened} quotes={quotes} canQuote={canQuote && opened.status !== "closed"} busy={busy}
            onEdit={(quote) => setQuoteDraft({ id: quote.id, requestId: quote.requestId, budgetCode: quote.budgetCode, supplier: quote.supplier, supplierContact: quote.supplierContact, quoteRef: quote.quoteRef, quoteDate: quote.quoteDate, deliveryDays: quote.deliveryDays, paymentTerms: quote.paymentTerms, note: quote.note, prices: quote.prices })}
            onDelete={(quote) => { if (window.confirm(`Xóa báo giá của ${quote.supplier}?`)) void run(() => store.deleteQuote(quote.id), "Đã xóa báo giá."); }}
            onOrder={(quote) => { if (window.confirm(`Lập PO nháp từ báo giá ${quote.supplier}${quote.budgetCode ? ` (hạng mục ${quote.budgetCode})` : ""}?`)) void run(async () => { setCreated(await store.ordersFromQuote(opened.id, quote.id)); }, "Đã lập PO nháp từ báo giá. Mở PO để kiểm tra rồi gửi duyệt."); }} codeName={codeName} />}
          {created.length > 0 && <p className="po-terms-line">Đơn vừa lập: {created.map((id) => <a key={id} className="link-button" href={orderHref(id)}>Mở PO nháp</a>)}</p>}
        </section>
      )}

      {opened && ordersOf(opened).length > 0 && (
        <section className="panel pj-section" aria-labelledby="mr-orders-title" id="mr-sec-orders">
          <h2 id="mr-orders-title">Đơn hàng lập từ {opened.number}</h2>
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>Đơn</th><th>Nhà cung cấp</th>{!office && <th>Hạng mục</th>}<th className="pj-num">Giá trị</th><th>Tiến độ</th></tr></thead>
              <tbody>{ordersOf(opened).map((order) => (
                <tr key={order.id} className="mr-row" onClick={() => { window.location.href = orderHref(order.id); }}>
                  <td><a className="link-button" href={orderHref(order.id)} onClick={(event) => event.stopPropagation()}><b>{order.code}</b></a><br /><small className="muted">{order.title}</small></td>
                  <td>{order.supplier || "—"}</td>
                  {!office && <td>{codeName(order.budgetCode)}</td>}
                  <td className="pj-num">{formatVnd(order.totalActual ?? order.totalEstimate)}</td>
                  <td><OrderMiniPath order={order} payments={[]} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/** Dải nhỏ ở danh sách: mỗi giai đoạn một vạch + bước hiện tại. */
function MaterialMiniPath({ stages }: { stages: readonly MaterialStage[] }) {
  const label = materialCurrentLabel(stages);
  return (
    <div className="op-mini">
      <div className="op-mini-bar" role="img" aria-label={`${label}: ${stages.filter((stage) => stage.state === "done").length}/${stages.length} giai đoạn`}>
        {stages.map((stage) => <span key={stage.key} className={`is-${stage.state === "bad" ? "current" : stage.state}`} />)}
      </div>
      <small className={stages.some((stage) => stage.state === "bad") ? "warn-text" : undefined}>{label}</small>
    </div>
  );
}

/** Thanh tiến độ ở trang chi tiết phiếu; bấm một giai đoạn để cuộn tới phần tương ứng. */
function MaterialProgressBar({ stages }: { stages: readonly MaterialStage[] }) {
  const target: Record<MaterialStage["key"], string> = { draft: "mr-sec-items", signing: "mr-sec-items", quoting: "mr-sec-quotes", po: "mr-sec-quotes", orders: "mr-sec-orders", done: "mr-sec-orders" };
  return (
    <ol className="op-track op-pickable mr-progress" aria-label="Tiến độ phiếu yêu cầu vật tư">
      {stages.map((stage, index) => (
        <li key={stage.key} className={`op-step is-${stage.state === "bad" ? "current" : stage.state}${stage.state === "bad" ? " is-bad" : ""}`} aria-current={stage.state === "current" ? "step" : undefined}>
          <button type="button" className="op-nav-btn" onClick={() => document.getElementById(target[stage.key])?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span className="op-num" aria-hidden="true">{stage.state === "done" ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
            <span className="op-text"><span className="op-label">{stage.label}</span>{stage.note && <small className="op-dept">{stage.note}</small>}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function QuoteCompare(props: { request: MaterialRequest; quotes: MaterialQuote[]; canQuote: boolean; busy: boolean; onEdit: (quote: MaterialQuote) => void; onDelete: (quote: MaterialQuote) => void; onOrder: (quote: MaterialQuote) => void; codeName: (code: string | null) => string }) {
  const { request, quotes } = props;
  const cheapest = cheapestByItem(quotes, request.items);
  const totals = quotes.map((quote) => quoteTotal(quote, request.items));
  const best = Math.min(...totals.filter((total) => total > 0));
  return (
    <div className="table-scroll">
      <table className="pj-table mr-compare">
        <thead>
          <tr><th>Vật tư</th><th className="pj-num">SL</th>{quotes.map((quote) => <th key={quote.id} className="pj-num">{quote.supplier}{quote.budgetCode && <><br /><small className="muted">{props.codeName(quote.budgetCode)}</small></>}{quote.selected && <><br /><span className="pill ok">Đã lập PO</span></>}</th>)}</tr>
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
              <button type="button" className="button primary" disabled={props.busy} onClick={() => props.onOrder(quote)}>Lập PO nháp</button>
              <button type="button" className="button" onClick={() => props.onEdit(quote)}>Sửa</button>
              <button type="button" className="button danger" aria-label="Xóa báo giá" onClick={() => props.onDelete(quote)}><Trash2 className="ico" size={14} aria-hidden="true" /></button>
            </span>}</td>
          ))}</tr>}
        </tfoot>
      </table>
    </div>
  );
}
