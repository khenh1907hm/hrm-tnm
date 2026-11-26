"use client";
import { useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { PurchaseStore } from "../../../modules/purchases/store";
import type { PurchaseOrder } from "../../../modules/purchases/types";
import { myAccount } from "../accountApi";
import type { Notify } from "../Toast";
import { errorMessage, moneyInput, parseMoney } from "../projects/projectShared";

/** Đơn văn phòng trừ vào quỹ: đã duyệt trở đi (đã dùng) và đang chờ duyệt; tính theo năm lập đơn. */
const USED = new Set<PurchaseOrder["status"]>(["approved", "ordered", "received", "completed"]);
export function officeFundUsage(orders: readonly PurchaseOrder[], year: number) {
  const mine = orders.filter((order) => order.kind === "office" && order.createdAt.slice(0, 4) === String(year));
  const sum = (list: readonly PurchaseOrder[]) => list.reduce((total, order) => total + (order.totalActual ?? order.totalEstimate), 0);
  return { used: sum(mine.filter((order) => USED.has(order.status))), pending: sum(mine.filter((order) => order.status === "submitted")) };
}

/**
 * Quỹ Văn phòng theo năm (không chia hạng mục): Admin / Giám đốc đặt số tiền,
 * mỗi đơn văn phòng của năm trừ dần; vượt quỹ thì báo đỏ.
 */
export function OfficeFundCard(props: { store: PurchaseStore; orders: readonly PurchaseOrder[]; year: number; isAdmin: boolean; setNotice: Notify }) {
  const { store, year, setNotice } = props;
  const [fund, setFund] = useState<{ amount: number; note: string } | null | undefined>(undefined);
  const [canEdit, setCanEdit] = useState(props.isAdmin);
  const [editing, setEditing] = useState<{ amount: number; note: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void store.officeFund(year).then((value) => { if (active) setFund(value); }, () => { if (active) setFund(null); });
    return () => { active = false; };
  }, [store, year, attempt]);
  useEffect(() => {
    if (props.isAdmin || store.mode !== "live") return;
    let active = true;
    void myAccount().then((account) => { if (active && account?.isDirector) setCanEdit(true); });
    return () => { active = false; };
  }, [props.isAdmin, store.mode]);

  const { used, pending } = officeFundUsage(props.orders, year);
  const amount = fund?.amount ?? 0;
  const remaining = amount - used;
  const pct = amount > 0 ? Math.min(100, Math.round((used / amount) * 100)) : 0;
  const save = async () => {
    if (!editing) return;
    try { await store.setOfficeFund(year, editing.amount, editing.note); setEditing(null); setAttempt((value) => value + 1); setNotice(`Đã lưu quỹ văn phòng năm ${year}.`, "success"); }
    catch (error) { setNotice(errorMessage(error), "error"); }
  };

  return (
    <section className="panel pj-section of-fund" aria-labelledby="of-fund-title">
      <div className="pj-section-head">
        <h2 id="of-fund-title"><PiggyBank className="ico" size={18} aria-hidden="true" /> Quỹ văn phòng năm {year}</h2>
        {canEdit && !editing && <button type="button" className="button" onClick={() => setEditing({ amount, note: fund?.note ?? "" })}>{fund ? "Sửa quỹ" : "Đặt quỹ"}</button>}
      </div>
      {editing ? (
        <div className="po-inline">
          <label className="field"><span>Số tiền quỹ năm {year} (VNĐ)</span><input inputMode="numeric" autoFocus value={moneyInput(editing.amount)} onChange={(event) => setEditing({ ...editing, amount: parseMoney(event.target.value) })} /></label>
          <label className="field"><span>Ghi chú</span><input value={editing.note} placeholder="vd: Văn phòng phẩm, thiết bị, sửa chữa" onChange={(event) => setEditing({ ...editing, note: event.target.value })} /></label>
          <div className="button-row"><button type="button" className="button" onClick={() => setEditing(null)}>Hủy</button><button type="button" className="button primary" onClick={() => void save()}>Lưu quỹ</button></div>
        </div>
      ) : fund === undefined ? <p className="muted">Đang tải quỹ…</p> : (
        <>
          <div className="pj-kpis">
            <div className="pj-kpi"><span>Quỹ năm</span><b>{fund ? formatVnd(amount) : "Chưa đặt"}</b>{fund?.note ? <small>{fund.note}</small> : null}</div>
            <div className="pj-kpi"><span>Đã dùng</span><b>{formatVnd(used)}</b><small>Đơn đã duyệt trở đi</small></div>
            <div className={`pj-kpi ${pending ? "warn" : ""}`}><span>Đang chờ duyệt</span><b>{formatVnd(pending)}</b></div>
            <div className={`pj-kpi ${fund && remaining - pending < 0 ? "over" : ""}`}><span>Còn lại</span><b>{fund ? formatVnd(remaining) : "—"}</b>{fund && pending > 0 ? <small>Sau khi duyệt đơn chờ: {formatVnd(remaining - pending)}</small> : null}</div>
          </div>
          {fund && amount > 0 && <div className={`of-bar${remaining < 0 ? " is-over" : ""}`} role="img" aria-label={`Đã dùng ${pct}% quỹ`}><span style={{ width: `${pct}%` }} /></div>}
          {!fund && <p className="muted">{canEdit ? "Bấm Đặt quỹ để nhập số tiền cho năm nay." : "Admin hoặc Giám đốc chưa đặt quỹ cho năm nay."}</p>}
          {fund && remaining < 0 && <p className="warn-text">Đã vượt quỹ {formatVnd(-remaining)}.</p>}
        </>
      )}
    </section>
  );
}
