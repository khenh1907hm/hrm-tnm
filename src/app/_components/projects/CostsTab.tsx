"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import { PAYMENT_STATUS_LABELS, type ExpenseCategory, type PaymentStatus, type ProjectExpense, type Subcontract, type SubcontractMode } from "../../../modules/projects/types";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const MODE_LABELS: Record<SubcontractMode, string> = { timesheet: "Chấm công theo người", lump_sum: "Khoán gọn" };

/** Tab Chi phí (chỉ Admin, PM): thầu phụ (2 hình thức, spec 3.6) và phiếu chi vật tư, chi phí khác (spec 3.7). */
export function CostsTab({ store, data, viewer, reload, setNotice }: TabProps) {
  const act = async (action: () => Promise<unknown>, done: string) => {
    try { await action(); setNotice(done, "success"); await reload(); } catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const canApprove = viewer.isAdmin;
  return (
    <div className="pj-page">
      <SubcontractsSection data={data} act={act} store={store} />
      <ExpensesSection data={data} act={act} store={store} canApprove={canApprove} />
    </div>
  );
}

type SectionProps = { data: TabProps["data"]; store: TabProps["store"]; act: (action: () => Promise<unknown>, done: string) => Promise<void> };

function SubcontractsSection({ data, store, act }: SectionProps) {
  const [draft, setDraft] = useState<Omit<Subcontract, "id"> | null>(null);
  const [payment, setPayment] = useState<{ subcontractId: string; payDate: string; amount: number; status: PaymentStatus; note: string } | null>(null);
  const paidOf = (id: string) => data.payments.filter((item) => item.subcontractId === id && item.status !== "requested").reduce((sum, item) => sum + item.amount, 0);
  const timesheetCost = (id: string) => {
    const employees = new Set(data.members.filter((member) => member.subcontractId === id).map((member) => member.employeeId));
    return data.costs.filter((cost) => cost.category === "subcontract" && employees.has(cost.employeeId)).reduce((sum, cost) => sum + cost.amount, 0);
  };
  return (
    <section className="panel pj-section" aria-labelledby="pj-sub-title">
      <div className="pj-section-head">
        <h2 id="pj-sub-title">Thầu phụ</h2>
        {!draft && <button type="button" className="button" onClick={() => setDraft({ projectId: data.project.id, partnerId: null, name: "", mode: "lump_sum", contractNo: "", contractValue: 0, signedOn: data.today, note: "" })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm thầu phụ</button>}
      </div>
      {draft && (
        <div className="form-grid" style={{ padding: 0 }}>
          <label className="field"><span>Tên thầu phụ *</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus /></label>
          <label className="field"><span>Hình thức</span><select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value as SubcontractMode })}>{(Object.keys(MODE_LABELS) as SubcontractMode[]).map((key) => <option key={key} value={key}>{MODE_LABELS[key]}</option>)}</select></label>
          {draft.mode === "lump_sum" && <>
            <label className="field"><span>Số hợp đồng</span><input value={draft.contractNo} onChange={(event) => setDraft({ ...draft, contractNo: event.target.value })} /></label>
            <label className="field"><span>Giá trị hợp đồng (VNĐ)</span><input inputMode="numeric" value={moneyInput(draft.contractValue)} onChange={(event) => setDraft({ ...draft, contractValue: parseMoney(event.target.value) })} /></label>
          </>}
          {draft.mode === "timesheet" && <p className="muted" style={{ gridColumn: "1 / -1" }}>Sau khi lưu, ở tab Sơ đồ chọn “Thuộc thầu phụ” cho từng người của thầu phụ. Tiền công của họ được tính vào khoản thầu phụ theo đơn giá riêng.</p>}
          <div className="button-row" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="button" onClick={() => setDraft(null)}>Hủy</button>
            <button type="button" className="button primary" disabled={!draft.name.trim()} onClick={() => void act(() => store.saveSubcontract(draft), "Đã thêm thầu phụ.").then(() => setDraft(null))}>Lưu thầu phụ</button>
          </div>
        </div>
      )}
      {!data.subcontracts.length ? <p className="muted">Chưa có thầu phụ.</p> : (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Thầu phụ</th><th>Hình thức</th><th className="pj-num">Giá trị HĐ</th><th className="pj-num">Đã dùng</th><th className="pj-num">Còn cam kết</th><th /></tr></thead>
            <tbody>
              {data.subcontracts.map((item) => {
                const used = item.mode === "lump_sum" ? paidOf(item.id) : timesheetCost(item.id);
                return (
                  <tr key={item.id}>
                    <td><b>{item.name}</b>{item.contractNo && <><br /><small className="muted">HĐ {item.contractNo}</small></>}</td>
                    <td>{MODE_LABELS[item.mode]}</td>
                    <td className="pj-num">{item.mode === "lump_sum" ? formatVnd(item.contractValue) : "—"}</td>
                    <td className="pj-num">{formatVnd(used)}</td>
                    <td className="pj-num">{item.mode === "lump_sum" ? formatVnd(Math.max(0, item.contractValue - used)) : "—"}</td>
                    <td className="button-row">
                      {item.mode === "lump_sum" && <button type="button" className="link-button" onClick={() => setPayment({ subcontractId: item.id, payDate: data.today, amount: 0, status: "requested", note: "" })}>+ Đợt thanh toán</button>}
                      <button type="button" className="button danger icon-button" aria-label={`Xóa ${item.name}`} onClick={() => { if (window.confirm(`Xóa thầu phụ ${item.name} và các đợt thanh toán?`)) void act(() => store.deleteSubcontract(item.id), "Đã xóa thầu phụ."); }}><Trash2 size={14} aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {payment && (
        <div className="form-grid" style={{ padding: 0 }}>
          <label className="field"><span>Ngày</span><input type="date" value={payment.payDate} onChange={(event) => setPayment({ ...payment, payDate: event.target.value })} /></label>
          <label className="field"><span>Số tiền (VNĐ)</span><input inputMode="numeric" value={moneyInput(payment.amount)} onChange={(event) => setPayment({ ...payment, amount: parseMoney(event.target.value) })} autoFocus /></label>
          <label className="field"><span>Trạng thái</span><select value={payment.status} onChange={(event) => setPayment({ ...payment, status: event.target.value as PaymentStatus })}>{(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((key) => <option key={key} value={key}>{PAYMENT_STATUS_LABELS[key]}</option>)}</select></label>
          <label className="field"><span>Nội dung</span><input value={payment.note} onChange={(event) => setPayment({ ...payment, note: event.target.value })} placeholder="vd: Tạm ứng đợt 2" /></label>
          <div className="button-row" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="button" onClick={() => setPayment(null)}>Hủy</button>
            <button type="button" className="button primary" disabled={payment.amount <= 0} onClick={() => void act(() => store.savePayment(payment), "Đã lưu đợt thanh toán.").then(() => setPayment(null))}>Lưu đợt thanh toán</button>
          </div>
        </div>
      )}
      {data.payments.length > 0 && (
        <details>
          <summary>Các đợt thanh toán khoán gọn ({data.payments.length})</summary>
          <table className="pj-table">
            <thead><tr><th>Ngày</th><th>Thầu phụ</th><th>Nội dung</th><th className="pj-num">Số tiền</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{data.payments.map((item) => (
              <tr key={item.id}>
                <td>{item.payDate.split("-").reverse().join("/")}</td>
                <td>{data.subcontracts.find((sub) => sub.id === item.subcontractId)?.name}</td>
                <td>{item.note}</td>
                <td className="pj-num">{formatVnd(item.amount)}</td>
                <td><select aria-label="Trạng thái đợt thanh toán" value={item.status} onChange={(event) => void act(() => store.savePayment({ ...item, status: event.target.value as PaymentStatus }), "Đã cập nhật đợt thanh toán.")}>{(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((key) => <option key={key} value={key}>{PAYMENT_STATUS_LABELS[key]}</option>)}</select></td>
                <td><button type="button" className="button danger icon-button" aria-label="Xóa đợt thanh toán" onClick={() => void act(() => store.deletePayment(item.id), "Đã xóa đợt thanh toán.")}><Trash2 size={14} aria-hidden="true" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function ExpensesSection({ data, store, act, canApprove }: SectionProps & { canApprove: boolean }) {
  const [draft, setDraft] = useState<Omit<ProjectExpense, "id"> | null>(null);
  const sorted = [...data.expenses].sort((a, b) => b.spentOn.localeCompare(a.spentOn));
  return (
    <section className="panel pj-section" aria-labelledby="pj-exp-title">
      <div className="pj-section-head">
        <h2 id="pj-exp-title">Phiếu chi vật tư và chi phí khác</h2>
        {!draft && <button type="button" className="button" onClick={() => setDraft({ projectId: data.project.id, spentOn: data.today, category: "material", description: "", supplier: "", amount: 0, status: canApprove ? "approved" : "draft" })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm phiếu chi</button>}
      </div>
      {draft && (
        <div className="form-grid" style={{ padding: 0 }}>
          <label className="field"><span>Ngày chi</span><input type="date" value={draft.spentOn} onChange={(event) => setDraft({ ...draft, spentOn: event.target.value })} /></label>
          <label className="field"><span>Khoản</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ExpenseCategory })}><option value="material">Vật tư</option><option value="other">Chi phí khác</option></select></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Nội dung *</span><input value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} autoFocus /></label>
          <label className="field"><span>Nhà cung cấp</span><input value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} /></label>
          <label className="field"><span>Số tiền (VNĐ) *</span><input inputMode="numeric" value={moneyInput(draft.amount)} onChange={(event) => setDraft({ ...draft, amount: parseMoney(event.target.value) })} /></label>
          <div className="button-row" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="button" onClick={() => setDraft(null)}>Hủy</button>
            <button type="button" className="button primary" disabled={!draft.description.trim() || draft.amount <= 0} onClick={() => void act(() => store.saveExpense(draft), canApprove ? "Đã lưu phiếu chi." : "Đã lưu phiếu chi, chờ Admin duyệt.").then(() => setDraft(null))}>Lưu phiếu chi</button>
          </div>
        </div>
      )}
      {!sorted.length ? <p className="muted">Chưa có phiếu chi.</p> : (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Ngày</th><th>Khoản</th><th>Nội dung</th><th>Nhà cung cấp</th><th className="pj-num">Số tiền</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{sorted.map((item) => (
              <tr key={item.id}>
                <td>{item.spentOn.split("-").reverse().join("/")}</td>
                <td>{item.category === "material" ? "Vật tư" : "Chi phí khác"}</td>
                <td>{item.description}</td>
                <td>{item.supplier}</td>
                <td className="pj-num">{formatVnd(item.amount)}</td>
                <td>{item.status === "approved" ? <span className="pill ok">Đã duyệt</span> : canApprove
                  ? <button type="button" className="link-button" onClick={() => void act(() => store.saveExpense({ ...item, status: "approved" }), "Đã duyệt phiếu chi.")}>Duyệt</button>
                  : <span className="pill warn">Chờ duyệt</span>}</td>
                <td><button type="button" className="button danger icon-button" aria-label="Xóa phiếu chi" onClick={() => { if (window.confirm("Xóa phiếu chi này?")) void act(() => store.deleteExpense(item.id), "Đã xóa phiếu chi."); }}><Trash2 size={14} aria-hidden="true" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
