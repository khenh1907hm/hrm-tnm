"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleDashed, Crown, ExternalLink, FileText, Paperclip, Undo2, X } from "lucide-react";
import { systemClock, todayVN } from "../../lib/clock";
import { getSupabaseClient } from "../../lib/supabase/client";
import { DOC_TYPE_LABELS, stepTitle, type ApprovalDocType, type ApprovalStep } from "../../modules/purchases/approval";
import { formatVnd } from "../../modules/projects/cost";
import { openAppLink, type BoardCard, type BoardColumn } from "./accountApi";
import { contractFiles, explanatoryFiles, formatSize, purchaseFiles, type Attachment, type AttachmentApi } from "./purchases/purchaseFiles";
import { getPurchaseStore } from "./purchases/usePurchaseStore";
import { errorMessage } from "./projects/projectShared";
import type { Notify } from "./Toast";
import "./approvalMobile.css";

type Action = "approve" | "return" | "director";
const TABS: readonly { key: BoardColumn; label: string }[] = [
  { key: "todo", label: "Chờ tôi ký" }, { key: "waiting", label: "Đang chờ" }, { key: "approved", label: "Đã duyệt" }, { key: "returned", label: "Trả về" },
];
const docLabel = (type: string) => DOC_TYPE_LABELS[type as ApprovalDocType] ?? type;
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Tên dự án theo id (thẻ duyệt chỉ có mã dự án). */
function useProjectNames(cards: readonly BoardCard[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const ids = useMemo(() => [...new Set(cards.map((card) => card.projectId).filter((id): id is string => Boolean(id)))].sort().join(","), [cards]);
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !ids) return;
    let active = true;
    void client.from("projects").select("id,name").in("id", ids.split(",")).then(({ data }) => {
      if (active && data) setNames(Object.fromEntries((data as { id: string; name: string }[]).map((row) => [row.id, row.name])));
    });
    return () => { active = false; };
  }, [ids]);
  return names;
}

/** Tệp đính kèm của một phiếu: đơn hàng và đề nghị thanh toán (tệp của đơn), báo cáo giải thích, Confirm Contract. */
async function loadAttachments(card: BoardCard): Promise<{ api: AttachmentApi; items: Attachment[] } | null> {
  if (card.docType === "purchase") return { api: purchaseFiles, items: await purchaseFiles.list(card.docId) };
  if (card.docType === "explanatory") return { api: explanatoryFiles, items: await explanatoryFiles.list(card.docId) };
  if (card.docType === "contract") return { api: contractFiles, items: await contractFiles.list(card.docId) };
  if (card.docType === "payment") {
    const client = getSupabaseClient();
    const { data } = client ? await client.from("purchase_payments").select("order_id").eq("id", card.docId).maybeSingle() : { data: null };
    const orderId = (data as { order_id?: string } | null)?.order_id;
    return orderId ? { api: purchaseFiles, items: await purchaseFiles.list(orderId) } : null;
  }
  return null;
}

/**
 * Ký duyệt trên điện thoại (màn hẹp): một danh sách thẻ gọn theo 4 nhóm, chạm thẻ mở trang chi tiết
 * (dự án, phiếu, giai đoạn ký, tệp đính kèm) với nút Ký / Trả về cố định ở đáy màn hình.
 */
export function ApprovalMobile(props: { cards: readonly BoardCard[]; isDirector: boolean; onAction: (card: BoardCard, action: Action) => void; setNotice: Notify }) {
  const [tab, setTab] = useState<BoardColumn>("todo");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const names = useProjectNames(props.cards);
  const keyOf = (card: BoardCard) => `${card.docType}:${card.docId}`;
  const opened = props.cards.find((card) => keyOf(card) === openKey) ?? null;
  const list = props.cards.filter((card) => card.column === tab);
  const today = todayVN(systemClock);
  const projectLine = (card: BoardCard) => [card.projectCode, card.projectId ? names[card.projectId] : ""].filter(Boolean).join(" · ") || "Văn phòng";

  if (opened) return <ApprovalDetail card={opened} projectLine={projectLine(opened)} isDirector={props.isDirector} onBack={() => setOpenKey(null)} onAction={(action) => props.onAction(opened, action)} setNotice={props.setNotice} />;

  return (
    <div className="am">
      <nav className="am-tabs" aria-label="Nhóm phiếu">
        {TABS.map((item) => {
          const count = props.cards.filter((card) => card.column === item.key).length;
          return <button key={item.key} type="button" aria-pressed={tab === item.key} className={tab === item.key ? "is-on" : undefined} onClick={() => setTab(item.key)}>
            {item.label}{count > 0 && <b className={item.key === "todo" ? "am-badge hot" : "am-badge"}>{count}</b>}
          </button>;
        })}
      </nav>
      {!list.length ? <p className="am-empty">{tab === "todo" ? "Không có phiếu nào chờ bạn ký." : "Không có phiếu."}</p> : (
        <ul className="am-list">
          {list.map((card) => {
            const late = card.column !== "approved" && card.column !== "returned" && card.targetDate !== null && card.targetDate < today;
            return (
              <li key={keyOf(card)}>
                <button type="button" className={`am-card${late ? " is-late" : ""}`} onClick={() => setOpenKey(keyOf(card))}>
                  <span className="am-project">{projectLine(card)}</span>
                  <span className="am-doc"><span className="am-type">{docLabel(card.docType)}</span> {card.title || "—"}</span>
                  <span className="am-meta">
                    {card.amount > 0 && <b className="am-amount">{formatVnd(card.amount)}</b>}
                    <span className="am-stage">{card.column === "approved" ? "Đã duyệt xong" : card.column === "returned" ? "Bị trả về" : `Bước ${Math.min(card.signed + 1, card.total)}/${card.total}: ${stepTitle(card.role, card.assignee) || "—"}`}</span>
                    {late && <span className="am-late">Quá hạn {dmy(card.targetDate)}</span>}
                  </span>
                  <span className="am-bar" aria-hidden="true"><span style={{ width: `${card.total ? (card.signed / card.total) * 100 : 0}%` }} /></span>
                  <ChevronRight className="am-chevron" size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ApprovalDetail(props: { card: BoardCard; projectLine: string; isDirector: boolean; onBack: () => void; onAction: (action: Action) => void; setNotice: Notify }) {
  const { card, setNotice } = props;
  const [steps, setSteps] = useState<ApprovalStep[] | null>(null);
  const [files, setFiles] = useState<{ api: AttachmentApi; items: Attachment[] } | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const store = getPurchaseStore("live");
    void store.listSteps(card.docType as ApprovalDocType, card.docId).then((list) => { if (active) setSteps(list); }, () => { if (active) setSteps([]); });
    void loadAttachments(card).then((value) => { if (active) setFiles(value); }, () => { if (active) setFiles(null); });
    return () => { active = false; };
  }, [card]);
  const currentId = card.stepId;

  return (
    <div className="am am-detail">
      <header className="am-head">
        <button type="button" className="am-back" onClick={props.onBack} aria-label="Quay lại danh sách"><ArrowLeft size={20} aria-hidden="true" /></button>
        <div>
          <span className="am-project">{props.projectLine}</span>
          <h2>{docLabel(card.docType)}</h2>
        </div>
      </header>

      <section className="am-box">
        <b className="am-title">{card.title || "—"}</b>
        {card.amount > 0 && <span className="am-amount big">{formatVnd(card.amount)}</span>}
        <small className="muted">{card.creatorName ? `Người lập: ${card.creatorName}` : ""}{card.updatedAt ? ` · cập nhật ${dmy(card.updatedAt)}` : ""}</small>
      </section>

      <section className="am-box">
        <h3>Giai đoạn ký ({card.signed}/{card.total})</h3>
        {!steps ? <p className="muted">Đang tải…</p> : (
          <ol className="am-steps">
            {steps.map((step) => {
              const state = step.result === "signed" ? "done" : step.result === "returned" ? "bad" : step.result === "skipped" ? "skip" : step.id === currentId ? "now" : "todo";
              return (
                <li key={step.id} className={`is-${state}`}>
                  <span className="am-dot" aria-hidden="true">{state === "done" ? <Check size={12} strokeWidth={3} /> : state === "bad" ? <X size={12} strokeWidth={3} /> : <CircleDashed size={12} />}</span>
                  <span className="am-step-text">
                    <b>{stepTitle(step.role, step.assigneeName)}</b>
                    <small>{step.result === "signed" ? `${step.signerName} · ${dmy(step.actedAt)}` : step.result === "returned" ? `Trả về: ${step.note}` : step.result === "skipped" ? "Bỏ qua" : step.id === currentId ? `Đang chờ ký · hạn ${dmy(step.targetDate)}` : `Hạn ${dmy(step.targetDate)}`}</small>
                    {step.note && step.result === "signed" && <small className="am-note">“{step.note}”</small>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="am-box">
        <h3><Paperclip size={15} aria-hidden="true" /> File đính kèm</h3>
        {files === undefined ? <p className="muted">Đang tải…</p> : !files?.items.length ? <p className="muted">Không có file đính kèm.</p> : (
          <ul className="am-files">
            {files.items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => void files.api.open(item).catch((error: unknown) => setNotice(errorMessage(error), "error"))}>
                  <FileText size={18} aria-hidden="true" />
                  <span><b>{item.fileName}</b><small>{formatSize(item.sizeBytes)}{item.uploadedByName ? ` · ${item.uploadedByName}` : ""}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {card.link && <button type="button" className="am-link" onClick={() => openAppLink(card.link)}><ExternalLink size={15} aria-hidden="true" /> Mở phiếu đầy đủ</button>}
      </section>

      {(card.canSign && card.column === "todo") || (props.isDirector && card.column === "waiting") ? (
        <footer className="am-actions">
          {card.canSign && card.column === "todo" ? <>
            <button type="button" className="button danger" onClick={() => props.onAction("return")}><Undo2 size={18} aria-hidden="true" /> Trả về</button>
            <button type="button" className="button primary" onClick={() => props.onAction("approve")}><Check size={18} aria-hidden="true" /> Ký duyệt</button>
          </> : <button type="button" className="button primary" onClick={() => props.onAction("director")}><Crown size={18} aria-hidden="true" /> Duyệt ngay</button>}
        </footer>
      ) : null}
    </div>
  );
}
