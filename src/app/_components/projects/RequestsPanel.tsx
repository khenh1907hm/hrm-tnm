"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, FileText, X } from "lucide-react";
import { canReview, REQUEST_KIND_LABELS, REQUEST_STATUS_LABELS, type AttendanceRequest, type RequestStatus } from "../../../modules/projects/attendanceRequests";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Notify } from "../Toast";
import { errorMessage } from "./projectShared";

const TONE: Record<RequestStatus, string> = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "" };
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Phiếu giải trình chấm công cho PM, chỉ huy trưởng và sếp (ATT-03): ai gửi, ngày nào, giờ đề nghị, lý do, ai duyệt.
 * Nút Duyệt / Từ chối chỉ hiện với PM của dự án (hoặc Admin); máy chủ kiểm tra lại.
 */
export function RequestsPanel(props: { store: ProjectStore; projectId?: string; projectLabel: (projectId: string) => string; isPmOf: (projectId: string) => boolean; onChanged?: () => void; setNotice: Notify }) {
  const { store, setNotice } = props;
  const [requests, setRequests] = useState<AttendanceRequest[] | null>(null);
  const [filter, setFilter] = useState<RequestStatus | "*">("pending");
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const fetchAll = useCallback(() => store.listRequests(props.projectId), [store, props.projectId]);
  useEffect(() => {
    let active = true;
    void fetchAll().then((next) => { if (active) setRequests(next); }, () => { if (active) { setRequests([]); setUnavailable(true); } });
    return () => { active = false; };
  }, [fetchAll, attempt]);
  const review = async (request: AttendanceRequest, approve: boolean) => {
    const note = approve ? window.prompt("Ghi chú khi duyệt (có thể để trống):") ?? "" : window.prompt("Lý do từ chối (ít nhất 3 ký tự):") ?? "";
    if (!approve && note.trim().length < 3) return;
    try { await store.reviewRequest(request.id, approve, note); setNotice(approve ? "Đã duyệt giải trình, giờ đề nghị đã ghi bù vào chấm công." : "Đã từ chối giải trình.", "success"); setAttempt((value) => value + 1); props.onChanged?.(); }
    catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const shown = (requests ?? []).filter((request) => filter === "*" || request.status === filter);
  const pending = (requests ?? []).filter((request) => request.status === "pending").length;

  if (unavailable) return null;
  return (
    <section className="panel pj-section" aria-labelledby="rq-panel-title">
      <div className="pj-section-head">
        <h2 id="rq-panel-title"><FileText className="ico" size={18} aria-hidden="true" /> Phiếu giải trình chấm công {pending ? <span className="pill warn">{pending} chờ duyệt</span> : null}</h2>
        <select aria-label="Lọc trạng thái" value={filter} onChange={(event) => setFilter(event.target.value as RequestStatus | "*")}>
          <option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Bị từ chối</option><option value="*">Tất cả</option>
        </select>
      </div>
      {!requests ? <div className="loading">Đang tải…</div> : !shown.length ? <p className="muted">Không có phiếu nào.</p> : (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Người gửi</th>{!props.projectId && <th>Dự án</th>}<th>Ngày</th><th>Nội dung</th><th>Giờ đề nghị</th><th>Trạng thái · người duyệt</th><th /></tr></thead>
            <tbody>{shown.map((request) => (
              <tr key={request.id}>
                <td><b>{request.employeeName || request.employeeId}</b><br /><small className="muted">gửi {when(request.createdAt)}</small></td>
                {!props.projectId && <td>{props.projectLabel(request.projectId)}</td>}
                <td>{request.workDate.split("-").reverse().join("/")}</td>
                <td><b>{REQUEST_KIND_LABELS[request.kind]}</b><br /><small>{request.reason}</small></td>
                <td>{[request.requestedIn && `Vào ${request.requestedIn}`, request.requestedOut && `Ra ${request.requestedOut}`].filter(Boolean).join(" · ") || "—"}</td>
                <td><span className={`pill ${TONE[request.status]}`}>{REQUEST_STATUS_LABELS[request.status]}</span>{request.reviewerName && <><br /><small>bởi <b>{request.reviewerName}</b> {when(request.reviewedAt)}</small></>}{request.reviewNote && <><br /><small className="muted">“{request.reviewNote}”</small></>}</td>
                <td className="po-actions">{canReview(request, { isPm: props.isPmOf(request.projectId) }) && <>
                  <button type="button" className="button primary" onClick={() => void review(request, true)}><Check className="ico" size={15} aria-hidden="true" /> Duyệt</button>
                  <button type="button" className="button danger" onClick={() => void review(request, false)}><X className="ico" size={15} aria-hidden="true" /> Từ chối</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
