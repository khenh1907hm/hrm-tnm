"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardSignature, Crown, ExternalLink, GripVertical, RefreshCw, Undo2 } from "lucide-react";
import { systemClock, todayVN } from "../../lib/clock";
import { normalizeText } from "../../lib/text";
import { DOC_TYPE_LABELS, ROLE_LABELS, type ApprovalDocType } from "../../modules/purchases/approval";
import { formatVnd } from "../../modules/projects/cost";
import { approvalBoard, directorApprove, myAccount, openAppLink, signStep, type BoardCard, type BoardColumn } from "./accountApi";
import { errorMessage } from "./projects/projectShared";
import type { Notify } from "./Toast";
import "./approvalBoard.css";

const COLUMNS: readonly { key: BoardColumn; title: string; hint: string }[] = [
  { key: "todo", title: "Chờ tôi duyệt", hint: "Đến lượt bạn ký. Kéo sang “Đã duyệt” để ký, sang “Bị trả về” để trả lại người lập." },
  { key: "waiting", title: "Đang chờ người khác", hint: "Phiếu bạn lập, đã ký, hoặc sắp tới lượt bạn." },
  { key: "approved", title: "Đã duyệt", hint: "Lãnh đạo đã ký (120 ngày gần nhất)." },
  { key: "returned", title: "Bị trả về", hint: "Có người trả về, người lập sửa rồi gửi lại." },
];
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const docLabel = (type: string) => DOC_TYPE_LABELS[type as ApprovalDocType] ?? type;

type Pending = { card: BoardCard; action: "approve" | "return" | "director" };

/**
 * Trang "Đơn phiếu cần duyệt của tôi": bảng 4 cột kiểu kéo thả (Chờ tôi duyệt → Đã duyệt / Bị trả về).
 * Kéo thả trên máy tính; điện thoại dùng nút Ký / Trả về trên từng thẻ.
 */
export function ApprovalBoardPage(props: { live: boolean; setNotice: Notify }) {
  const { setNotice } = props;
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [isDirector, setIsDirector] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("*");
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    try { setCards(await approvalBoard()); } catch (error) { setNotice(errorMessage(error), "error"); setCards([]); }
  }, [setNotice]);

  useEffect(() => {
    if (!props.live) return;
    let active = true;
    void myAccount().then((account) => { if (active) setIsDirector(Boolean(account?.isDirector)); });
    const tick = () => { if (active && document.visibilityState === "visible") void approvalBoard().then((list) => { if (active) setCards(list); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setCards((current) => current ?? []); } }); };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [props.live, setNotice]);

  const shown = useMemo(() => {
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
    return (cards ?? []).filter((card) => (type === "*" || card.docType === type)
      && tokens.every((token) => normalizeText(`${card.title} ${card.projectCode} ${card.creatorName} ${docLabel(card.docType)}`).includes(token)));
  }, [cards, query, type]);

  if (!props.live) return <section className="pj-page"><div className="panel empty-state"><p>Bảng duyệt chỉ có ở chế độ thật (đã đăng nhập).</p></div></section>;

  /** Thả thẻ vào cột: chỉ các bước hợp lệ mới chạy. */
  const drop = (card: BoardCard, target: BoardColumn) => {
    if (card.column === target) return;
    if (target === "approved") {
      if (isDirector && card.column !== "approved" && card.column !== "returned") { setPending({ card, action: card.column === "todo" && card.canSign ? "approve" : "director" }); return; }
      if (card.canSign && card.stepId) { setPending({ card, action: "approve" }); return; }
    }
    if (target === "returned" && card.canSign && card.stepId) { setPending({ card, action: "return" }); return; }
    setNotice(target === "approved" || target === "returned" ? "Phiếu này chưa tới lượt bạn ký." : "Chỉ kéo được phiếu đến lượt bạn sang “Đã duyệt” hoặc “Bị trả về”.", "error");
  };

  return (
    <section className="pj-page ab-page">
      <div className="page-head">
        <div>
          <h1><ClipboardSignature className="ico" size={22} aria-hidden="true" /> Đơn phiếu cần duyệt của tôi</h1>
          <p>Ngân sách, đơn đặt hàng, đề nghị thanh toán, yêu cầu vật tư, báo cáo giải thích, xác nhận dự án bạn liên quan. Kéo thẻ sang cột “Đã duyệt” để ký.</p>
        </div>
        <button type="button" className="button" onClick={() => { setCards(null); void load(); }}><RefreshCw className="ico" size={16} aria-hidden="true" /> Tải lại</button>
      </div>
      <div className="pj-toolbar">
        <input type="search" aria-label="Tìm phiếu" placeholder="Tìm theo số phiếu, dự án, người lập" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Loại phiếu" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="*">Mọi loại phiếu</option>
          {Object.entries(DOC_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {!cards ? <div className="loading">Đang tải phiếu…</div> : (
        <div className="ab-board">
          {COLUMNS.map((column) => {
            const list = shown.filter((card) => card.column === column.key);
            const droppable = dragging !== null && dragging.column !== column.key && (column.key === "approved" || column.key === "returned")
              && (dragging.canSign || (isDirector && column.key === "approved"));
            return (
              <div key={column.key} className={`ab-col ab-${column.key}${over === column.key && droppable ? " over" : ""}${droppable ? " can-drop" : ""}`}
                onDragOver={(event) => { if (droppable) { event.preventDefault(); setOver(column.key); } }}
                onDragLeave={() => setOver((current) => (current === column.key ? null : current))}
                onDrop={(event) => { event.preventDefault(); setOver(null); if (dragging) drop(dragging, column.key); setDragging(null); }}>
                <header><b>{column.title}</b><span className="ab-count">{list.length}</span></header>
                <small className="muted ab-hint">{column.hint}</small>
                <div className="ab-cards">
                  {!list.length && <p className="muted ab-empty">Không có phiếu.</p>}
                  {list.map((card) => (
                    <BoardCardView key={`${card.docType}:${card.docId}`} card={card} isDirector={isDirector}
                      onDragStart={() => setDragging(card)} onDragEnd={() => { setDragging(null); setOver(null); }}
                      onAction={(action) => setPending({ card, action })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pending && <SignDialog pending={pending} onClose={() => setPending(null)} onDone={(message) => { setPending(null); setNotice(message, "success"); void load(); }} setNotice={setNotice} />}
    </section>
  );
}

function BoardCardView(props: { card: BoardCard; isDirector: boolean; onDragStart: () => void; onDragEnd: () => void; onAction: (action: Pending["action"]) => void }) {
  const { card } = props;
  const today = todayVN(systemClock);
  const late = card.column !== "approved" && card.column !== "returned" && card.targetDate !== null && card.targetDate < today;
  const draggable = card.canSign || (props.isDirector && (card.column === "todo" || card.column === "waiting"));
  return (
    <article className={`ab-card${draggable ? " draggable" : ""}${late ? " late" : ""}`} draggable={draggable}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.docId); props.onDragStart(); }} onDragEnd={props.onDragEnd}>
      <div className="ab-card-top">
        {draggable && <GripVertical className="ab-grip" size={14} aria-hidden="true" />}
        <span className="ab-type">{docLabel(card.docType)}</span>
        {card.projectCode && <span className="pill">{card.projectCode}</span>}
      </div>
      <b className="ab-title">{card.title || "—"}</b>
      {card.amount > 0 && <span className="ab-amount">{formatVnd(card.amount)}</span>}
      {card.role && card.column !== "approved" && card.column !== "returned" && (
        <small>Đang chờ: <b>{ROLE_LABELS[card.role]}</b>{card.assignee ? ` · ${card.assignee}` : ""}{card.targetDate ? <span className={late ? "warn-text" : "muted"}> · hạn {dmy(card.targetDate)}{late ? " (quá hạn)" : ""}</span> : null}</small>
      )}
      <div className="ab-progress" role="img" aria-label={`Đã ký ${card.signed}/${card.total} bước`}><span style={{ width: `${card.total ? (card.signed / card.total) * 100 : 0}%` }} /></div>
      <small className="muted">Đã ký {card.signed}/{card.total}{card.creatorName ? ` · Người lập: ${card.creatorName}` : ""}</small>
      <div className="ab-actions">
        {card.link && <button type="button" className="link-button" onClick={() => openAppLink(card.link)}><ExternalLink size={13} aria-hidden="true" /> Mở phiếu</button>}
        {card.canSign && card.column === "todo" && <>
          <button type="button" className="button primary ab-small" onClick={() => props.onAction("approve")}><Check size={14} aria-hidden="true" /> Ký</button>
          <button type="button" className="button danger ab-small" onClick={() => props.onAction("return")}><Undo2 size={14} aria-hidden="true" /> Trả về</button>
        </>}
        {props.isDirector && card.column === "waiting" && <button type="button" className="button ab-small" onClick={() => props.onAction("director")}><Crown size={14} aria-hidden="true" /> Duyệt ngay</button>}
      </div>
    </article>
  );
}

function SignDialog(props: { pending: Pending; onClose: () => void; onDone: (message: string) => void; setNotice: Notify }) {
  const { card, action } = props.pending;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const needsReason = action === "return";
  const title = action === "approve" ? "Ký duyệt phiếu" : action === "return" ? "Trả về người lập" : "Giám đốc duyệt ngay";
  const submit = async () => {
    if (needsReason && note.trim().length < 3) { props.setNotice("Nhập lý do trả về (ít nhất 3 ký tự).", "error"); return; }
    setBusy(true);
    try {
      if (action === "director") await directorApprove(card.docType, card.docId, note.trim());
      else await signStep(card.stepId!, action === "approve", note.trim());
      props.onDone(action === "return" ? "Đã trả về người lập." : action === "director" ? "Giám đốc đã duyệt phiếu." : "Đã ký. Người kế tiếp đã nhận thông báo.");
    } catch (error) { props.setNotice(errorMessage(error), "error"); setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="ab-dialog-title" style={{ maxWidth: 520 }}>
        <header><h2 id="ab-dialog-title">{title}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
          <p style={{ margin: "0 0 10px" }}><b>{docLabel(card.docType)}</b><br />{[card.projectCode, card.title].filter(Boolean).join(" · ")}{card.amount > 0 ? ` · ${formatVnd(card.amount)}` : ""}</p>
          {action === "approve" && card.role && <p className="muted" style={{ margin: "0 0 10px" }}>Bạn ký bước <b>{ROLE_LABELS[card.role]}</b>{card.assignee ? ` (${card.assignee})` : ""}. Tên và giờ ký sẽ in vào ô ký của biểu mẫu Excel.</p>}
          {action === "director" && <p className="muted" style={{ margin: "0 0 10px" }}>Các bước trước chưa ký sẽ được bỏ qua (ghi “Giám đốc duyệt vượt cấp”), phiếu được duyệt ngay.</p>}
          <label className="field"><span>{needsReason ? "Lý do trả về *" : "Ghi chú (có thể để trống)"}</span>
            <input value={note} autoFocus maxLength={500} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} />
          </label>
        </div>
        <footer>
          <button type="button" className="button" onClick={props.onClose}>Hủy</button>
          <button type="button" className={`button ${needsReason ? "danger" : "primary"}`} disabled={busy} onClick={() => void submit()}>{busy ? "Đang lưu…" : action === "return" ? "Trả về" : action === "director" ? "Duyệt ngay" : "Ký duyệt"}</button>
        </footer>
      </section>
    </div>
  );
}
