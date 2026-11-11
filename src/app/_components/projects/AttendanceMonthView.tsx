"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Send, X } from "lucide-react";
import { addMonths } from "../../../lib/dates";
import { buildMonthCalendar, type CalendarDay, type DayState, type MonthRecord } from "../../../modules/projects/attendanceMonth";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_LABELS, requestIssue, type AttendanceRequest, type RequestKind } from "../../../modules/projects/attendanceRequests";
import { formatHours } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Holiday } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, projectText } from "./projectShared";

const STATE_TEXT: Record<DayState, string> = { approved: "Đã duyệt", pending: "Chờ duyệt", checked: "Đã chấm", absent: "Vắng", none: "" };
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const REQUEST_TONE: Record<AttendanceRequest["status"], string> = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "" };
type ProjectOption = { id: string; label: string };

/**
 * Lịch chấm công tháng của nhân viên (ATT-01) và phiếu giải trình (ATT-02): bấm một ngày để xem chi tiết và gửi giải trình cho PM.
 */
export function AttendanceMonthView(props: { store: ProjectStore; holidays: Holiday[]; today: string; projects: ProjectOption[]; setNotice: Notify; refreshKey?: number }) {
  const { store, today, setNotice } = props;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [records, setRecords] = useState<MonthRecord[] | null>(null);
  const [requests, setRequests] = useState<AttendanceRequest[]>([]);
  const [picked, setPicked] = useState<CalendarDay | null>(null);
  const [form, setForm] = useState<{ date: string; projectId: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  const fetchAll = useCallback(() => Promise.all([store.myMonth(month), store.listRequests()]), [store, month]);
  useEffect(() => {
    let active = true;
    // Máy chủ chưa có chức năng (migration chưa chạy): hiện lời nhắc nhẹ thay vì báo lỗi
    void fetchAll().then(([nextRecords, nextRequests]) => { if (active) { setRecords(nextRecords); setRequests(nextRequests); setUnavailable(false); } }, () => { if (active) { setUnavailable(true); setRecords([]); } });
    return () => { active = false; };
  }, [fetchAll, attempt, props.refreshKey]);
  const calendar = useMemo(() => buildMonthCalendar(month, records ?? [], props.holidays, today), [month, records, props.holidays, today]);
  const projectOptions = useMemo(() => {
    const options = new Map(props.projects.map((item) => [item.id, item.label]));
    for (const record of records ?? []) options.set(record.projectId, `${record.code} · ${record.projectName}`);
    return [...options].map(([id, label]) => ({ id, label }));
  }, [props.projects, records]);
  const [year, monthNumber] = month.split("-");
  if (unavailable) return <section className="ci-card"><p className="muted" style={{ margin: 0 }}><CalendarDays className="ico" size={16} aria-hidden="true" /> Lịch chấm công tháng và phiếu giải trình đang được bật, vui lòng quay lại sau.</p></section>;

  return (
    <section className="ci-card" aria-labelledby="mv-title">
      <div className="mv-head">
        <h2 id="mv-title"><CalendarDays size={18} aria-hidden="true" /> Lịch chấm công</h2>
        <div className="mv-nav">
          <button type="button" aria-label="Tháng trước" onClick={() => { setMonth(addMonths(`${month}-01`, -1).slice(0, 7)); setPicked(null); }}><ChevronLeft size={18} aria-hidden="true" /></button>
          <b>Tháng {Number(monthNumber)}/{year}</b>
          <button type="button" aria-label="Tháng sau" disabled={month >= today.slice(0, 7)} onClick={() => { setMonth(addMonths(`${month}-01`, 1).slice(0, 7)); setPicked(null); }}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="ci-stats">
        <div><b>{calendar.summary.daysWorked}</b><small>ngày công</small></div>
        <div><b>{formatHours(calendar.summary.regular)}</b><small>giờ thường</small></div>
        <div><b>{formatHours(calendar.summary.ot)}</b><small>giờ tăng ca</small></div>
      </div>
      {!records ? <div className="loading">Đang tải…</div> : (
        <div className="mv-grid" role="grid" aria-label={`Lịch tháng ${monthNumber}/${year}`}>
          {WEEKDAYS.map((label) => <span key={label} className="mv-weekday" role="columnheader">{label}</span>)}
          {calendar.days.map((day) => {
            const hours = day.records.reduce((sum, record) => sum + record.regular + record.ot, 0);
            return (
              <button key={day.date} type="button" role="gridcell" className={`mv-day ${day.state}${day.inMonth ? "" : " out"}${day.isToday ? " today" : ""}${picked?.date === day.date ? " picked" : ""}`}
                disabled={!day.inMonth || day.isFuture} onClick={() => setPicked(day)} aria-label={`Ngày ${day.date.slice(8)}: ${STATE_TEXT[day.state] || "chưa chấm"}`}>
                <span>{Number(day.date.slice(8))}</span>
                {day.state !== "none" && <small>{day.state === "absent" ? "Vắng" : `${formatHours(hours)}h`}</small>}
              </button>
            );
          })}
        </div>
      )}
      <div className="mv-legend">
        <span className="approved">Đã duyệt</span><span className="pending">Chờ duyệt</span><span className="checked">Đã chấm</span><span className="absent">Vắng</span>
      </div>

      {picked && (
        <div className="mv-detail">
          <div className="mv-detail-head"><b>Ngày {picked.date.split("-").reverse().join("/")}</b><button type="button" className="link-button" aria-label="Đóng" onClick={() => setPicked(null)}><X size={16} aria-hidden="true" /></button></div>
          {!picked.records.length ? <p className="muted">Không có lượt chấm công nào ngày này.</p> : picked.records.map((record) => (
            <div key={record.projectId} className="mv-record">
              <b>{record.code}</b>
              <span>Vào {record.inText} · Ra {record.outText}{record.source === "explanation" ? " (ghi bù theo giải trình)" : ""}</span>
              <span>{formatHours(record.regular)} giờ thường{record.ot ? ` · ${formatHours(record.ot)} giờ tăng ca` : ""} · {record.sheetStatus === "approved" ? "Đã duyệt" : record.sheetStatus === "submitted" ? "Chờ chỉ huy trưởng duyệt" : "Chưa lên phiếu công"}</span>
            </div>
          ))}
          {projectOptions.length > 0 && <button type="button" className="button primary" style={{ minHeight: 44 }} onClick={() => setForm({ date: picked.date, projectId: picked.records[0]?.projectId ?? projectOptions[0]!.id })}><FileText className="ico" size={16} aria-hidden="true" /> Gửi giải trình cho ngày này</button>}
        </div>
      )}

      {form && <RequestForm store={store} today={today} date={form.date} projectId={form.projectId} projects={projectOptions} onClose={() => setForm(null)} onSent={() => { setForm(null); setPicked(null); setNotice("Đã gửi giải trình cho PM của dự án.", "success"); setAttempt((value) => value + 1); }} />}

      <div className="mv-requests">
        <h3><FileText size={16} aria-hidden="true" /> Phiếu giải trình của tôi</h3>
        {!requests.length ? <p className="muted">Chưa gửi phiếu nào. Quên chấm hoặc chấm sai? Bấm vào ngày trên lịch để gửi giải trình.</p> : (
          <ul>{requests.slice(0, 20).map((request) => (
            <li key={request.id}>
              <div><b>{request.workDate.split("-").reverse().join("/")}</b> · {REQUEST_KIND_LABELS[request.kind]}<span className={`pill ${REQUEST_TONE[request.status]}`}>{REQUEST_STATUS_LABELS[request.status]}</span></div>
              <small>{[request.requestedIn && `Vào ${request.requestedIn}`, request.requestedOut && `Ra ${request.requestedOut}`].filter(Boolean).join(" · ")}{request.requestedIn || request.requestedOut ? " · " : ""}{request.reason}</small>
              {request.reviewerName && <small>Người duyệt: <b>{request.reviewerName}</b>{request.reviewNote ? ` · “${request.reviewNote}”` : ""}</small>}
              {request.status === "pending" && <button type="button" className="link-button" onClick={() => void store.cancelRequest(request.id).then(() => { setNotice("Đã hủy phiếu giải trình.", "success"); setAttempt((value) => value + 1); }, (error: unknown) => setNotice(errorMessage(error), "error"))}>Hủy phiếu</button>}
            </li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}

function RequestForm(props: { store: ProjectStore; today: string; date: string; projectId: string; projects: ProjectOption[]; onClose: () => void; onSent: () => void }) {
  const [projectId, setProjectId] = useState(props.projectId);
  const [kind, setKind] = useState<RequestKind>("missing_in");
  const [requestedIn, setRequestedIn] = useState("08:00");
  const [requestedOut, setRequestedOut] = useState("17:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needIn = kind === "missing_in" || kind === "wrong_time" || kind === "out_of_range";
  const needOut = kind === "missing_out" || kind === "wrong_time" || kind === "out_of_range";
  const submit = async () => {
    const input = { projectId, workDate: props.date, kind, requestedIn: needIn ? requestedIn || null : null, requestedOut: needOut ? requestedOut || null : null, reason };
    const issue = requestIssue(input, props.today);
    if (issue) { setError(projectText(issue)); return; }
    setBusy(true); setError("");
    try { await props.store.submitRequest(input); props.onSent(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="rq-title" style={{ maxWidth: 480 }}>
        <header><h2 id="rq-title">Giải trình ngày {props.date.split("-").reverse().join("/")}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          {props.projects.length > 1 && <label className="field"><span>Dự án</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{props.projects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          <label className="field"><span>Lý do giải trình</span><select value={kind} onChange={(event) => setKind(event.target.value as RequestKind)}>{(Object.keys(REQUEST_KIND_LABELS) as RequestKind[]).map((key) => <option key={key} value={key}>{REQUEST_KIND_LABELS[key]}</option>)}</select></label>
          <div className="form-grid" style={{ padding: 0 }}>
            {needIn && <label className="field"><span>Giờ Vào đề nghị</span><input type="time" value={requestedIn} onChange={(event) => setRequestedIn(event.target.value)} /></label>}
            {needOut && <label className="field"><span>Giờ Ra đề nghị</span><input type="time" value={requestedOut} onChange={(event) => setRequestedOut(event.target.value)} /></label>}
          </div>
          <label className="field"><span>Nội dung giải trình *</span><textarea rows={3} value={reason} placeholder="vd: Sáng nay điện thoại hết pin nên không chấm Vào được, tổ trưởng Bình xác nhận có mặt lúc 7h50." onChange={(event) => setReason(event.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8, font: "inherit" }} /></label>
          <small className="muted">Phiếu gửi tới PM của dự án. PM duyệt thì giờ đề nghị được ghi bù vào chấm công.</small>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="button" onClick={props.onClose}>Hủy</button><button type="button" className="button primary" disabled={busy} onClick={() => void submit()}><Send className="ico" size={16} aria-hidden="true" /> {busy ? "Đang gửi…" : "Gửi PM duyệt"}</button></footer>
      </section>
    </div>
  );
}
