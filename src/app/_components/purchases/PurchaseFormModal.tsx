"use client";
import { useEffect, useState } from "react";
import { Plus, ShoppingCart, Trash2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { Project } from "../../../modules/projects/types";
import { draftIssue, estimateTotal, lineTotal } from "../../../modules/purchases/flow";
import type { PurchaseStore } from "../../../modules/purchases/store";
import { PURCHASE_KIND_LABELS, type PurchaseDraft, type PurchaseKind, type PurchaseOrder } from "../../../modules/purchases/types";
import { errorMessage, moneyInput, parseMoney, projectText } from "../projects/projectShared";
import { activeSheet, budgetCheck, costCodeLabel, type BudgetSheet, type CostCode } from "../../../modules/purchases/budget";
import { BudgetCheckBox } from "./BudgetCheckBox";

type ItemDraft = PurchaseDraft["items"][number];
const blankItem = (): ItemDraft => ({ id: "", name: "", spec: "", unit: "", quantity: 1, unitPrice: 0 });

/** Soạn đơn nháp (PUR-02): dự án hoặc văn phòng, danh sách hàng cần mua. Lưu nháp hoặc Lập đơn (gửi sếp duyệt). */
export function PurchaseFormModal(props: { store: PurchaseStore; projects: readonly Project[]; initial: PurchaseOrder | null; defaultProjectId?: string | null; onClose: () => void; onSaved: (order: PurchaseOrder, submitted: boolean) => void }) {
  const start = props.initial;
  const [draft, setDraft] = useState<Omit<PurchaseDraft, "items">>(() => start
    ? { kind: start.kind, projectId: start.projectId, title: start.title, department: start.department, neededBy: start.neededBy, deliveryAddress: start.deliveryAddress, supplier: start.supplier, supplierContact: start.supplierContact, note: start.note, budgetCode: start.budgetCode }
    : { kind: props.defaultProjectId ? "project" : "office", projectId: props.defaultProjectId ?? null, title: "", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", budgetCode: null });
  const [items, setItems] = useState<ItemDraft[]>(() => start?.items.map((item) => ({ id: item.id, name: item.name, spec: item.spec, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice })) ?? [blankItem()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setItem = (index: number, patch: Partial<ItemDraft>) => setItems((current) => current.map((item, at) => at === index ? { ...item, ...patch } : item));
  const usable = props.projects.filter((project) => project.status !== "archived" && project.status !== "done");
  // Đơn dự án: chọn mã ngân sách trong lần ngân sách đã duyệt, xem ngay A–E (PRC-01..03)
  const [sheets, setSheets] = useState<{ projectId: string; list: BudgetSheet[] } | null>(null);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [ordered, setOrdered] = useState<{ key: string; b: number } | null>(null);
  const projectId = draft.kind === "project" ? draft.projectId : null;
  useEffect(() => {
    let active = true;
    void props.store.costCodes().then((list) => { if (active) setCodes(list); }, () => undefined);
    return () => { active = false; };
  }, [props.store]);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void props.store.listBudgetSheets(projectId).then((list) => { if (active) setSheets({ projectId, list }); }, () => { if (active) setSheets({ projectId, list: [] }); });
    return () => { active = false; };
  }, [props.store, projectId]);
  const sheet = sheets && sheets.projectId === projectId ? activeSheet(sheets.list) : null;
  const codeOptions = sheet?.lines.filter((line) => line.budget > 0) ?? [];
  const checkKey = projectId && draft.budgetCode ? `${projectId}:${draft.budgetCode}` : null;
  useEffect(() => {
    if (!projectId || !draft.budgetCode) return;
    let active = true;
    const key = `${projectId}:${draft.budgetCode}`;
    void props.store.checkBudget(projectId, draft.budgetCode, start?.id ?? null).then((found) => { if (active) setOrdered({ key, b: found?.b ?? 0 }); }, () => undefined);
    return () => { active = false; };
  }, [props.store, projectId, draft.budgetCode, start?.id]);
  const check = sheet && draft.budgetCode && checkKey && ordered?.key === checkKey
    ? budgetCheck(draft.budgetCode, sheet.number, sheet.lines.find((line) => line.code === draft.budgetCode)?.budget ?? 0, ordered.b, estimateTotal(items))
    : null;

  const save = async (submit: boolean) => {
    const cleaned = items.filter((item) => item.name.trim() || item.unitPrice > 0);
    const problem = draftIssue({ ...draft, items: cleaned }, submit);
    if (problem) { setError(projectText(problem)); return; }
    if (submit && draft.kind === "project" && !draft.budgetCode) { setError(projectText("PO_BUDGET_CODE_REQUIRED")); return; }
    if (submit && check?.over) { setError(projectText("PO_OVER_BUDGET")); return; }
    setBusy(true); setError("");
    try {
      const saved = await props.store.saveDraft({ ...draft, items: cleaned, ...(start ? { id: start.id } : {}) });
      if (submit) await props.store.submit(saved.id);
      props.onSaved(saved, submit);
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="po-form-title" style={{ maxWidth: 960 }}>
        <header><h2 id="po-form-title"><ShoppingCart className="ico" size={18} aria-hidden="true" /> {start ? `Sửa đơn ${start.code}` : "Đơn hàng mới"}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid">
          <label className="field"><span>Mua cho</span><select value={draft.kind} onChange={(event) => { const kind = event.target.value as PurchaseKind; set("kind", kind); if (kind === "office") set("projectId", null); }}>
            {(Object.keys(PURCHASE_KIND_LABELS) as PurchaseKind[]).map((key) => <option key={key} value={key}>{PURCHASE_KIND_LABELS[key]}</option>)}
          </select></label>
          {draft.kind === "project"
            ? <label className="field"><span>Dự án *</span><select value={draft.projectId ?? ""} onChange={(event) => set("projectId", event.target.value || null)}>
              <option value="">— Chọn dự án —</option>
              {usable.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
            </select>{!usable.length && <small className="field-hint">Bạn chưa thuộc dự án nào đang mở.</small>}</label>
            : null}
          {draft.kind === "project"
            ? <label className="field"><span>Mã ngân sách *</span><select value={draft.budgetCode ?? ""} disabled={!projectId} onChange={(event) => set("budgetCode", event.target.value || null)}>
              <option value="">— Chọn mã chi phí —</option>
              {codeOptions.map((line) => <option key={line.code} value={line.code}>{costCodeLabel(line.code, codes)}</option>)}
            </select>{projectId && sheets?.projectId === projectId && !sheet && <small className="field-hint">Dự án chưa có ngân sách theo mã được duyệt (tab Ngân sách trong dự án).</small>}</label>
            : <label className="field"><span>Bộ phận</span><input value={draft.department} placeholder="vd: Hành chính – Nhân sự" onChange={(event) => set("department", event.target.value)} /></label>}
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Nội dung đơn *</span><input value={draft.title} maxLength={300} autoFocus placeholder="vd: Mua ống đồng đợt 2 / Mua giấy in, mực máy in tháng 11" onChange={(event) => set("title", event.target.value)} /></label>
          <label className="field"><span>Cần hàng trước ngày</span><input type="date" value={draft.neededBy ?? ""} onChange={(event) => set("neededBy", event.target.value || null)} /></label>
          <label className="field"><span>Giao tới</span><input value={draft.deliveryAddress} placeholder="Địa chỉ nhận hàng" onChange={(event) => set("deliveryAddress", event.target.value)} /></label>
          <label className="field"><span>Nhà cung cấp dự kiến</span><input value={draft.supplier} onChange={(event) => set("supplier", event.target.value)} /></label>
          <label className="field"><span>Liên hệ nhà cung cấp</span><input value={draft.supplierContact} placeholder="Tên, số điện thoại" onChange={(event) => set("supplierContact", event.target.value)} /></label>

          <div style={{ gridColumn: "1 / -1" }}>
            <div className="table-scroll">
              <table className="pj-table po-items">
                <thead><tr><th>Tên hàng *</th><th>Quy cách</th><th>ĐVT</th><th className="pj-num">Số lượng</th><th className="pj-num">Đơn giá dự kiến</th><th className="pj-num">Thành tiền</th><th /></tr></thead>
                <tbody>{items.map((item, index) => (
                  <tr key={index}>
                    <td><input aria-label="Tên hàng" value={item.name} onChange={(event) => setItem(index, { name: event.target.value })} /></td>
                    <td><input aria-label="Quy cách" value={item.spec} onChange={(event) => setItem(index, { spec: event.target.value })} /></td>
                    <td style={{ width: 80 }}><input aria-label="Đơn vị tính" value={item.unit} placeholder="cái" onChange={(event) => setItem(index, { unit: event.target.value })} /></td>
                    <td style={{ width: 100 }}><input aria-label="Số lượng" type="number" min={0} step="any" value={item.quantity} onChange={(event) => setItem(index, { quantity: Number(event.target.value) })} /></td>
                    <td style={{ width: 150 }}><input aria-label="Đơn giá" inputMode="numeric" value={moneyInput(item.unitPrice)} onChange={(event) => setItem(index, { unitPrice: parseMoney(event.target.value) })} /></td>
                    <td className="pj-num">{formatVnd(lineTotal(item))}</td>
                    <td><button type="button" className="button danger icon-button" aria-label="Xóa dòng" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} aria-hidden="true" /></button></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={5}>Tổng dự kiến</td><td className="pj-num">{formatVnd(estimateTotal(items))}</td><td /></tr></tfoot>
              </table>
            </div>
            <button type="button" className="button" onClick={() => setItems((current) => [...current, blankItem()])}><Plus className="ico" size={16} aria-hidden="true" /> Thêm dòng</button>
          </div>
          {check && <div style={{ gridColumn: "1 / -1" }}><BudgetCheckBox check={check} /></div>}
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Ghi chú, lý do mua</span><input value={draft.note} onChange={(event) => set("note", event.target.value)} /></label>
          {error && <p className="form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}
        </div>
        <footer>
          <button type="button" className="button" onClick={props.onClose}>Hủy</button>
          <button type="button" className="button" disabled={busy} onClick={() => void save(false)}>Lưu nháp</button>
          <button type="button" className="button primary" disabled={busy || Boolean(check?.over)} onClick={() => void save(true)}>{busy ? "Đang gửi…" : draft.kind === "project" ? "Lập đơn, gửi ký duyệt" : "Lập đơn, gửi sếp duyệt"}</button>
        </footer>
      </section>
    </div>
  );
}
