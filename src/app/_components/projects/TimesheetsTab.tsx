"use client";
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { formatHours } from "../../../modules/projects/cost";
import { teamsOf } from "../../../modules/projects/tree";
import { TIMESHEET_STATUS_LABELS } from "../../../modules/projects/types";
import type { TabProps } from "./ProjectDetail";
import { errorMessage } from "./projectShared";
import { teamLabel, TimesheetEntry } from "./TimesheetEntry";

/** Tab Chấm công: danh sách phiếu chờ duyệt (duyệt nhiều phiếu một lần) và phiếu công theo tổ, theo ngày. */
export function TimesheetsTab({ store, data, viewer, reload, setNotice }: TabProps) {
  const allTeams = teamsOf(data.members);
  const hasManagement = data.members.some((member) => !member.team);
  const teams = viewer.isLead ? [...allTeams, ...(hasManagement ? [""] : [])] : allTeams.filter((team) => viewer.leaderTeams.includes(team));
  const [team, setTeam] = useState(teams[0] ?? "");
  const [date, setDate] = useState(data.today < data.project.plannedEnd ? data.today : data.project.plannedEnd);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const pending = data.timesheets.filter((sheet) => sheet.status === "submitted").sort((a, b) => a.workDate.localeCompare(b.workDate) || a.team.localeCompare(b.team, "vi"));

  const approveSelected = async () => {
    setBusy(true);
    let done = 0;
    for (const id of selected) {
      try { await store.approveTimesheet(id); done++; }
      catch (error) { setNotice(errorMessage(error), "error"); break; }
    }
    setBusy(false);
    setSelected(new Set());
    if (done) setNotice(`Đã duyệt ${done} phiếu công.`, "success");
    await reload();
  };

  return (
    <div className="pj-page">
      {viewer.isLead && (
        <section className="panel pj-section" aria-labelledby="pj-pending-title">
          <div className="pj-section-head">
            <h2 id="pj-pending-title">Chờ duyệt ({pending.length})</h2>
            {pending.length > 0 && <button type="button" className="button primary" disabled={busy || !selected.size} onClick={() => void approveSelected()}><CheckCheck className="ico" size={16} aria-hidden="true" /> Duyệt {selected.size || ""} phiếu đã chọn</button>}
          </div>
          {!pending.length ? <p className="muted">Không có phiếu nào chờ duyệt.</p> : (
            <div className="table-scroll">
              <table className="pj-table">
                <thead><tr><th><input type="checkbox" aria-label="Chọn tất cả" checked={selected.size === pending.length} onChange={(event) => setSelected(event.target.checked ? new Set(pending.map((sheet) => sheet.id)) : new Set())} /></th><th>Ngày</th><th>Tổ</th><th className="pj-num">Có mặt</th><th className="pj-num">Giờ thường</th><th className="pj-num">Tăng ca</th><th /></tr></thead>
                <tbody>
                  {pending.map((sheet) => (
                    <tr key={sheet.id}>
                      <td><input type="checkbox" aria-label={`Chọn phiếu ${sheet.team} ngày ${sheet.workDate}`} checked={selected.has(sheet.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(sheet.id); else next.delete(sheet.id); return next; })} /></td>
                      <td>{sheet.workDate.split("-").reverse().join("/")}</td>
                      <td>{teamLabel(sheet.team)}</td>
                      <td className="pj-num">{sheet.lines.filter((line) => line.attendance === "present").length}/{sheet.lines.length}</td>
                      <td className="pj-num">{formatHours(sheet.lines.reduce((sum, line) => sum + line.regularHours, 0))}</td>
                      <td className="pj-num">{formatHours(sheet.lines.reduce((sum, line) => sum + line.otHours, 0))}</td>
                      <td><button type="button" className="link-button" onClick={() => { setTeam(sheet.team); setDate(sheet.workDate); }}>Xem phiếu</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="pj-page" aria-labelledby="pj-entry-title">
        <div className="pj-section-head">
          <h2 id="pj-entry-title" style={{ fontSize: 16, margin: 0 }}>Phiếu công theo tổ</h2>
          {teams.length > 1 && <div className="pj-toolbar">
            <label className="sr-only" htmlFor="pj-team">Tổ</label>
            <select id="pj-team" value={team} onChange={(event) => setTeam(event.target.value)}>{teams.map((item) => <option key={item} value={item}>{teamLabel(item)}</option>)}</select>
          </div>}
        </div>
        {!teams.length ? <p className="muted">Bạn chưa phụ trách tổ nào trong dự án này.</p> : (
          <TimesheetEntry store={store} project={data.project} members={data.members} timesheets={data.timesheets} settings={data.settings} holidays={data.holidays} locks={data.locks}
            today={data.today} team={team} date={date} onDateChange={setDate} isLead={viewer.isLead} isAdmin={viewer.isAdmin} onChanged={reload} setNotice={setNotice} checks={data.checks} />
        )}
        <small className="muted">Trạng thái phiếu: {TIMESHEET_STATUS_LABELS.draft} → {TIMESHEET_STATUS_LABELS.submitted} → {TIMESHEET_STATUS_LABELS.approved} (hoặc {TIMESHEET_STATUS_LABELS.rejected.toLowerCase()}: tổ trưởng sửa rồi gửi lại). Chỉ phiếu đã duyệt mới được tính tiền.</small>
      </section>
    </div>
  );
}
