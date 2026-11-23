"use client";
import { useEffect, useState } from "react";
import { FileSearch, Plus, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { Project } from "../../../modules/projects/types";
import { draftIssue, estimateTotal, lineTotal } from "../../../modules/purchases/flow";
import type { PurchaseStore } from "../../../modules/purchases/store";
import { PURCHASE_KIND_LABELS, type PurchaseDraft, type PurchaseKind, type PurchaseOrder } from "../../../modules/purchases/types";
import { errorMessage, moneyInput, parseMoney, projectText } from "../projects/projectShared";
import { activeSheet, budgetCheck, costCodeLabel, type BudgetSheet, type CostCode } from "../../../modules/purchases/budget";
import { BudgetCheckBox } from "./BudgetCheckBox";
import { AttachmentsField, type PendingFile } from "./AttachmentsField";
import { filesAvailable, listAttachments, uploadAttachment, type PurchaseAttachment } from "./purchaseFiles";
import { readQuote } from "./quoteImport";
import { DELIVERY_LABELS, deliveryAddressFor, deliveryKindOf, type DeliveryKind } from "../../../modules/purchases/delivery";

type ItemDraft = PurchaseDraft["items"][number];
const blankItem = (): ItemDraft => ({ id: "", name: "", spec: "", unit: "", quantity: 1, unitPrice: 0 });

/** Soạn đơn nháp (PUR-02): dự án hoặc văn phòng, danh sách hàng cần mua. Lưu nháp hoặc Lập đơn (gửi sếp duyệt). */
export function PurchaseFormModal(props: { store: PurchaseStore; projects: readonly Project[]; initial: PurchaseOrder | null; defaultProjectId?: string | null; lockProject?: boolean; /** Trang Đặt hàng dự án / Văn phòng: cố định loại đơn, ẩn ô "Mua cho". */ fixedKind?: PurchaseKind; onClose: () => void; onSaved: (order: PurchaseOrder, submitted: boolean) => void }) {
  const start = props.initial;
  const [draft, setDraft] = useState<Omit<PurchaseDraft, "items">>(() => start
    ? { kind: start.kind, projectId: start.projectId, title: start.title, department: start.department, neededBy: start.neededBy, deliveryAddress: start.deliveryAddress, supplier: start.supplier, supplierContact: start.supplierContact, supplierAddress: start.supplierAddress, supplierPhone: start.supplierPhone, supplierEmail: start.supplierEmail, note: start.note, budgetCode: start.budgetCode,
      advanceRequired: start.advanceRequired, advancePct: start.advancePct, prepayRequired: start.prepayRequired }
    : { kind: props.fixedKind ?? (props.defaultProjectId ? "project" : "office"), projectId: props.defaultProjectId ?? null, title: "", department: "", neededBy: null,
      deliveryAddress: deliveryAddressFor(props.fixedKind ?? (props.defaultProjectId ? "project" : "office"), props.projects.find((project) => project.id === props.defaultProjectId) ?? null), supplier: "", supplierContact: "", supplierAddress: "", supplierPhone: "", supplierEmail: "", note: "", budgetCode: null, advanceRequired: false, advancePct: null, prepayRequired: false });
  const [items, setItems] = useState<ItemDraft[]>(() => start?.items.map((item) => ({ id: item.id, name: item.name, spec: item.spec, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice })) ?? [blankItem()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Tệp đính kèm: tệp đã lưu (khi sửa đơn) và tệp chờ tải lên sau khi lưu đơn
  const live = filesAvailable();
  const [existing, setExisting] = useState<PurchaseAttachment[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  useEffect(() => {
    if (!start || !live) return;
    let active = true;
    void listAttachments(start.id).then((list) => { if (active) setExisting(list); }, () => undefined);
    return () => { active = false; };
  }, [start, live]);
  // Nhập từ báo giá NCC: ô nào được điền tự động thì tô vàng để kiểm tra
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ source: "text" | "ai"; fields: Set<string>; warnings: string[] } | null>(null);
  const ai = (field: string) => (imported?.fields.has(field) ? "po-ai" : undefined);
  const importQuote = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true); setError("");
    try {
      const { data, source, problems } = await readQuote(file);
      const fields = new Set<string>();
      const warnings = [...problems];
      setDraft((current) => {
        const next = { ...current };
        if (data.supplier) { next.supplier = data.supplier; fields.add("supplier"); }
        if (data.contact) { next.supplierContact = data.contact; fields.add("supplierContact"); }
        if (data.address) { next.supplierAddress = data.address; fields.add("supplierAddress"); }
        if (data.phone) { next.supplierPhone = data.phone; fields.add("supplierPhone"); }
        if (data.email) { next.supplierEmail = data.email; fields.add("supplierEmail"); }
        if (!current.title.trim()) { next.title = `Mua theo báo giá ${data.quoteNo || ""}${data.supplier ? ` – ${data.supplier}` : ""}`.replace(/\s+/g, " ").trim(); fields.add("title"); }
        // Ghi chú, lý do mua: người lập tự nhập, không lấy từ báo giá
        if (data.advancePct) { next.advanceRequired = true; next.advancePct = data.advancePct; fields.add("terms"); }
        if (data.prepay) { next.prepayRequired = true; fields.add("terms"); }
        return next;
      });
      if (data.items.length) {
        const blank = items.every((item) => !item.name.trim() && item.unitPrice === 0);
        if (blank || window.confirm(`Thay ${items.length} dòng hàng đang có bằng ${data.items.length} dòng trong báo giá?`)) {
          setItems(data.items.map((item) => ({ id: "", name: item.name, spec: item.spec, unit: item.unit, quantity: item.quantity, unitPrice: Math.round(item.unitPrice) })));
          fields.add("items");
        }
        const sum = data.items.reduce((acc, item) => acc + Math.round(item.quantity * item.unitPrice), 0);
        if (data.total !== null && Math.abs(sum - data.total) > Math.max(2, data.total * 0.01) && !(data.vat !== null && Math.abs(sum + data.vat - data.total) <= Math.max(2, data.total * 0.01))) {
          warnings.push(`Cộng các dòng ${formatVnd(sum)} khác tổng trên báo giá ${formatVnd(data.total)}: kiểm tra lại số lượng, đơn giá.`);
        }
      } else warnings.push("Không đọc được dòng hàng: nhập tay bảng hàng.");
      if (data.vatIncluded === false && data.vat) warnings.push(`Báo giá chưa gồm VAT (thuế ${formatVnd(data.vat)}): đơn giá điền là giá trước thuế.`);
      // Báo giá NCC chính là tệp "Báo giá có ký xác nhận hoặc PO/Hợp đồng"
      if (live) setPending((current) => [...current, { key: `signed_quote-${file.name}-${file.size}-${Date.now()}`, kind: "signed_quote", file }]);
      setImported({ source, fields, warnings });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa đọc được báo giá.");
    } finally { setImporting(false); }
  };
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  // Giao tới: Văn phòng / Dự án / Khác; đổi dự án thì địa chỉ giao theo dự án mới
  const [delivery, setDelivery] = useState<DeliveryKind>(() => deliveryKindOf(start?.deliveryAddress ?? "", props.fixedKind ?? (props.defaultProjectId ? "project" : "office")));
  const projectById = (id: string | null) => props.projects.find((project) => project.id === id) ?? null;
  const chooseDelivery = (kind: DeliveryKind) => {
    setDelivery(kind);
    set("deliveryAddress", deliveryAddressFor(kind, projectById(draft.projectId), draft.deliveryAddress));
  };
  const chooseProject = (id: string | null) => {
    set("projectId", id);
    if (delivery === "project") set("deliveryAddress", deliveryAddressFor("project", projectById(id)));
  };
  const setItem = (index: number, patch: Partial<ItemDraft>) => setItems((current) => current.map((item, at) => at === index ? { ...item, ...patch } : item));
  const usable = props.projects.filter((project) => project.status !== "archived" && project.status !== "done");
  const lockedProject = props.lockProject ? props.projects.find((project) => project.id === draft.projectId) ?? null : null;
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
    if (draft.advanceRequired && !(draft.advancePct !== null && draft.advancePct > 0 && draft.advancePct <= 100)) { setError(projectText("PO_ADVANCE_PCT")); return; }
    if (submit && draft.kind === "project" && draft.supplier.trim().length < 2) { setError(projectText("PO_SUPPLIER_REQUIRED")); return; }
    if (submit && draft.kind === "project" && live && ![...existing, ...pending].some((item) => item.kind === "signed_quote")) { setError(projectText("PO_ATTACH_REQUIRED")); return; }
    setBusy(true); setError("");
    try {
      const saved = await props.store.saveDraft({ ...draft, items: cleaned, ...(start ? { id: start.id } : {}) });
      // Tải tệp chờ lên trước khi gửi duyệt (máy chủ kiểm tra có báo giá có ký)
      for (const item of pending) await uploadAttachment(saved.id, item.kind, item.file);
      setPending([]);
      if (submit) await props.store.submit(saved.id);
      props.onSaved(saved, submit);
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="po-form-title" style={{ maxWidth: 960 }}>
        <header><h2 id="po-form-title"><ShoppingCart className="ico" size={18} aria-hidden="true" /> {start ? `Sửa đơn ${start.code}` : "Đơn hàng mới"}{props.lockProject && lockedProject ? ` · ${lockedProject.code}` : ""}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid">
          <div className="po-import">
            <label className="button primary"><FileSearch size={16} aria-hidden="true" /> {importing ? "Đang đọc báo giá…" : "Nhập từ báo giá NCC (PDF / ảnh)"}
              <input type="file" hidden accept="application/pdf,.pdf,image/*" disabled={importing} onChange={(event) => { void importQuote(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            <small className="muted">Tự điền nhà cung cấp, dòng hàng, đơn giá, điều khoản; tệp báo giá tự đính kèm. Ô tô vàng là ô được điền tự động: kiểm tra lại trước khi gửi.</small>
            {imported && <div style={{ flexBasis: "100%" }}>
              <small><Sparkles size={13} aria-hidden="true" /> Đã đọc bằng {imported.source === "text" ? "chữ trong PDF (không dùng AI)" : "AI Gemini"}.</small>
              {imported.warnings.map((warning) => <p key={warning} className="warn-text" style={{ margin: "2px 0" }}><small>⚠ {warning}</small></p>)}
            </div>}
          </div>
          {props.lockProject ? null : <>{!props.fixedKind && <label className="field"><span>Mua cho</span><select value={draft.kind} onChange={(event) => { const kind = event.target.value as PurchaseKind; set("kind", kind); if (kind === "office") { chooseProject(null); if (delivery === "project") chooseDelivery("office"); } }}>
            {(Object.keys(PURCHASE_KIND_LABELS) as PurchaseKind[]).map((key) => <option key={key} value={key}>{PURCHASE_KIND_LABELS[key]}</option>)}
          </select></label>}
          {draft.kind === "project"
            ? <label className="field"><span>Dự án *</span><select value={draft.projectId ?? ""} onChange={(event) => chooseProject(event.target.value || null)}>
              <option value="">— Chọn dự án —</option>
              {usable.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
            </select>{!usable.length && <small className="field-hint">Bạn chưa thuộc dự án nào đang mở.</small>}</label>
            : null}</>}
          {draft.kind === "project"
            ? <label className="field"><span>Mã ngân sách *</span><select value={draft.budgetCode ?? ""} disabled={!projectId} onChange={(event) => set("budgetCode", event.target.value || null)}>
              <option value="">— Chọn mã chi phí —</option>
              {codeOptions.map((line) => <option key={line.code} value={line.code}>{costCodeLabel(line.code, codes)}</option>)}
            </select>{projectId && sheets?.projectId === projectId && !sheet && <small className="field-hint">Dự án chưa có ngân sách theo mã được duyệt (tab Ngân sách trong dự án).</small>}</label>
            : <label className="field"><span>Bộ phận</span><input value={draft.department} placeholder="vd: Hành chính – Nhân sự" onChange={(event) => set("department", event.target.value)} /></label>}
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Nội dung đơn *</span><input className={ai("title")} value={draft.title} maxLength={300} autoFocus placeholder="vd: Mua ống đồng đợt 2 / Mua giấy in, mực máy in tháng 11" onChange={(event) => set("title", event.target.value)} /></label>
          <label className="field"><span>Cần hàng trước ngày</span><input type="date" value={draft.neededBy ?? ""} onChange={(event) => set("neededBy", event.target.value || null)} /></label>
          <label className="field"><span>Giao tới</span>
            <select value={delivery} onChange={(event) => chooseDelivery(event.target.value as DeliveryKind)}>
              {(Object.keys(DELIVERY_LABELS) as DeliveryKind[]).map((key) => <option key={key} value={key}>{DELIVERY_LABELS[key]}</option>)}
            </select>
            {delivery === "other"
              ? <input value={draft.deliveryAddress} placeholder="Địa chỉ nhận hàng" style={{ marginTop: 4 }} onChange={(event) => set("deliveryAddress", event.target.value)} />
              : <small className="field-hint">{draft.deliveryAddress || "Chọn dự án để lấy địa chỉ công trình"}</small>}
          </label>
          <label className="field"><span>Nhà cung cấp{draft.kind === "project" ? " *" : ""}</span><input className={ai("supplier")} value={draft.supplier} placeholder="Tên công ty nhà cung cấp" onChange={(event) => set("supplier", event.target.value)} /></label>
          <label className="field"><span>Người liên hệ (Tới)</span><input className={ai("supplierContact")} value={draft.supplierContact} placeholder="vd: Phòng kinh doanh / Ông Nguyễn Văn A" onChange={(event) => set("supplierContact", event.target.value)} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Địa chỉ nhà cung cấp</span><input className={ai("supplierAddress")} value={draft.supplierAddress} placeholder="Số nhà, đường, phường, tỉnh / thành" onChange={(event) => set("supplierAddress", event.target.value)} /></label>
          <label className="field"><span>Điện thoại NCC</span><input className={ai("supplierPhone")} value={draft.supplierPhone} inputMode="tel" placeholder="Số điện thoại liên hệ" onChange={(event) => set("supplierPhone", event.target.value)} /></label>
          <label className="field"><span>Email NCC</span><input className={ai("supplierEmail")} value={draft.supplierEmail} type="email" placeholder="email@nhacungcap.vn" onChange={(event) => set("supplierEmail", event.target.value)} /></label>

          <div style={{ gridColumn: "1 / -1" }}>
            <div className="table-scroll">
              <table className={`pj-table po-items${imported?.fields.has("items") ? " po-ai" : ""}`}>
                <thead><tr><th>Tên hàng *</th><th>Quy cách</th><th>ĐVT</th><th className="pj-num">Số lượng</th><th className="pj-num">Đơn giá</th><th className="pj-num">Thành tiền</th><th /></tr></thead>
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
                <tfoot><tr><td colSpan={5}>Tổng</td><td className="pj-num">{formatVnd(estimateTotal(items))}</td><td /></tr></tfoot>
              </table>
            </div>
            <button type="button" className="button" onClick={() => setItems((current) => [...current, blankItem()])}><Plus className="ico" size={16} aria-hidden="true" /> Thêm dòng</button>
          </div>
          {check && <div style={{ gridColumn: "1 / -1" }}><BudgetCheckBox check={check} /></div>}
          <fieldset className={`po-terms${imported?.fields.has("terms") ? " po-ai-box" : ""}`} style={{ gridColumn: "1 / -1" }}>
            <legend>Điều kiện thanh toán của nhà cung cấp</legend>
            {/* Trước khi nhận hàng (kèm tạm ứng có / không) hoặc sau khi nhận hàng: quyết định các bước của đơn trên thanh tiến trình */}
            <label className="po-term"><input type="radio" name="po-pay-when" checked={draft.prepayRequired || draft.advanceRequired} onChange={() => setDraft((current) => ({ ...current, prepayRequired: true }))} />
              <span><b>Thanh toán trước khi nhận hàng</b><small>Lập đề nghị thanh toán, ký duyệt và kế toán chi trước khi NCC giao hàng.</small></span></label>
            {(draft.prepayRequired || draft.advanceRequired) && <div className="po-term-sub" role="radiogroup" aria-label="Tạm ứng">
              <span className="po-term-sub-label">Tạm ứng:</span>
              <label className="po-term-chip"><input type="radio" name="po-advance" checked={draft.advanceRequired} onChange={() => setDraft((current) => ({ ...current, advanceRequired: true, advancePct: current.advancePct ?? 30 }))} /> Có</label>
              <label className="po-term-chip"><input type="radio" name="po-advance" checked={!draft.advanceRequired} onChange={() => setDraft((current) => ({ ...current, advanceRequired: false, advancePct: null }))} /> Không</label>
              {draft.advanceRequired && <label className="field po-term-pct"><span>Tạm ứng (%)</span><input type="number" min={1} max={100} step="any" value={draft.advancePct ?? ""} onChange={(event) => set("advancePct", event.target.value ? Number(event.target.value) : null)} /><small className="field-hint">≈ {formatVnd(Math.round(estimateTotal(items) * (draft.advancePct ?? 0) / 100))}. Chi tạm ứng xong mới được đặt hàng.</small></label>}
            </div>}
            <label className="po-term"><input type="radio" name="po-pay-when" checked={!draft.prepayRequired && !draft.advanceRequired} onChange={() => setDraft((current) => ({ ...current, prepayRequired: false, advanceRequired: false, advancePct: null }))} />
              <span><b>Thanh toán sau khi nhận hàng</b><small>Nhận hàng, kiểm đếm, nhập kho, thu thập hóa đơn chứng từ rồi mới đề nghị thanh toán.</small></span></label>
          </fieldset>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Ghi chú, lý do mua</span><input value={draft.note} placeholder="Người lập tự nhập: lý do mua, ghi chú cho người duyệt" onChange={(event) => set("note", event.target.value)} /></label>
          {live && <fieldset className="po-terms" style={{ gridColumn: "1 / -1" }}>
            <legend>Attach file</legend>
            <AttachmentsField existing={existing} pending={pending} onPendingChange={setPending} editable requireSigned={draft.kind === "project"} setNotice={(message) => setError(message)} />
          </fieldset>}
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
