"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Send, X } from "lucide-react";
import { addDays } from "../../../lib/dates";
import type { Issue } from "../../../lib/result";
import { dayKind, defaultLine, otTypeOf, weekdayShort } from "../../../modules/projects/calendar";
import { formatHours } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import { canEditTimesheet, checkTimesheet, type OtherHours } from "../../../modules/projects/timesheetRules";
import { activeOn } from "../../../modules/projects/tree";
import {
  ATTENDANCE_LABELS, OT_TYPE_LABELS, TIMESHEET_STATUS_LABELS, type Attendance, type Holiday, type LaborSettings, type PeriodLock, type Project,
  type ProjectMember, type Timesheet, type TimesheetLine,
} from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, issueMessage } from "./projectShared";

export type TimesheetEntryProps = {
  store: ProjectStore;
  project: Project;
  members: readonly ProjectMember[];
  timesheets: readonly Timesheet[];
  settings: LaborSettings;
  holidays: readonly Holiday[];
  locks: readonly PeriodLock[];
  today: string;
  team: string;
  date: string;
  onDateChange: (date: string) => void;
  /** PM, CHT hoặc Admin: sửa phiếu chờ duyệt, duyệt, từ chối, nhập lùi quá hạn. */
  isLead: boolean;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
  setNotice: Notify;
};

export const teamLabel = (team: string) => team || "Ban chỉ huy (không thuộc tổ)";
const STATUS_TONE = { draft: "", submitted: "warn", approved: "ok", rejected: "bad" } as const;
const ATTENDANCE_ORDER: Attendance[] = ["present", "leave", "absent", "holiday"];

/**
 * Phiếu công một tổ, một ngày (spec 5.1). Mặc định mọi người có mặt đủ giờ chuẩn; chạm để đổi vắng, +/- để chỉnh giờ.
 * Tổ trưởng không thấy tiền. Kiểm tra (PRJ-08) chạy ngay trên máy; máy chủ kiểm tra lại khi gửi.
 */
export function TimesheetEntry(props: TimesheetEntryProps) {
  const { project, team, date, settings } = props;
  const kind = dayKind(date, project.weeklyOff, props.holidays);
  const existing = props.timesheets.find((sheet) => sheet.workDate === date && sheet.team === team) ?? null;
  const people = useMemo(() => props.members.filter((member) => member.team === team && activeOn(member, date)).sort((a, b) => (a.role === "leader" ? -1 : 0) - (b.role === "leader" ? -1 : 0) || a.displayName.localeCompare(b.displayName, "vi")), [props.members, team, date]);
  const freshLines = (): TimesheetLine[] => people.map((member) => existing?.lines.find((line) => line.employeeId === member.employeeId) ?? defaultLine(member.employeeId, kind, project.stdHours, crypto.randomUUID()));
  const [lines, setLines] = useState<TimesheetLine[]>(freshLines);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<OtherHours[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const key = `${existing?.id ?? "new"}|${existing?.status ?? ""}|${date}|${team}|${people.length}`;
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) { setLoadedKey(key); setLines(freshLines()); setDirty(false); setRejecting(false); }

  const status = existing?.status ?? "draft";
  const locked = props.locks.some((lock) => lock.month === date.slice(0, 7));
  const editable = canEditTimesheet(status, props.isLead ? "lead" : "leader", locked);

  useEffect(() => {
    let active = true;
    void props.store.otherHours(lines.map((line) => line.employeeId), `${date.slice(0, 4)}-01-01`, date, existing?.id ?? "").then((found) => { if (active) setOthers(found); }, () => undefined);
    return () => { active = false; };
    // Chỉ tải lại khi đổi ngày, tổ hoặc phiếu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, team, existing?.id, people.length]);

  const sheet: Timesheet = { id: existing?.id ?? crypto.randomUUID(), projectId: project.id, workDate: date, team, status, submittedAt: existing?.submittedAt ?? null, approvedAt: existing?.approvedAt ?? null, rejectReason: existing?.rejectReason ?? "", lines };
  const issues: Issue[] = checkTimesheet({ project, timesheet: sheet, members: props.members, settings, today: props.today, isLead: props.isLead, lockedMonths: props.locks.map((lock) => lock.month), otherHours: others });
  const errors = issues.filter((item) => item.severity === "error");

  const update = (employeeId: string, patch: Partial<TimesheetLine>) => { setDirty(true); setLines((current) => current.map((line) => line.employeeId === employeeId ? { ...line, ...patch } : line)); };
  const setAttendance = (line: TimesheetLine, attendance: Attendance) => update(line.employeeId, attendance === "present"
    ? { attendance, ...(line.regularHours + line.otHours === 0 ? defaultLine(line.employeeId, kind, project.stdHours, line.id) : {}), id: line.id }
    : { attendance, regularHours: 0, otHours: 0, nightHours: 0 });
  const step = (line: TimesheetLine, field: "regularHours" | "otHours", delta: number) => {
    const next = Math.min(24, Math.max(0, line[field] + delta));
    update(line.employeeId, { [field]: next, ...(field === "otHours" && next > 0 && line.otType === "weekday" && kind !== "workday" ? { otType: otTypeOf(kind) } : {}) });
  };
  const bulkOt = (hours: number) => { setDirty(true); setLines((current) => current.map((line) => line.attendance === "present" ? { ...line, otHours: hours } : line)); };

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await action(); props.setNotice(done, "success"); setDirty(false); await props.onChanged(); }
    catch (error) { props.setNotice(errorMessage(error), "error"); }
    finally { setBusy(false); }
  };
  const save = () => props.store.saveTimesheet(sheet);
  const submit = () => run(async () => { const saved = await save(); await props.store.submitTimesheet(saved.id); }, "Đã gửi phiếu công cho chỉ huy trưởng duyệt.");
  const approve = () => run(async () => { const id = dirty ? (await save()).id : sheet.id; await props.store.approveTimesheet(id); }, "Đã duyệt phiếu công.");

  const totals = lines.reduce((sum, line) => ({ regular: sum.regular + line.regularHours, ot: sum.ot + line.otHours, present: sum.present + (line.attendance === "present" ? 1 : 0) }), { regular: 0, ot: 0, present: 0 });

  return (
    <div className="ts-sheet">
      <div className="panel ts-head">
        <div className="ts-date">
          <button type="button" className="button icon-button" aria-label="Ngày trước" onClick={() => props.onDateChange(addDays(date, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
          <label className="sr-only" htmlFor="ts-date">Ngày làm việc</label>
          <input id="ts-date" type="date" value={date} max={props.today} onChange={(event) => event.target.value && props.onDateChange(event.target.value)} />
          <button type="button" className="button icon-button" aria-label="Ngày sau" disabled={date >= props.today} onClick={() => props.onDateChange(addDays(date, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
        <div className="ts-status">
          <b>{weekdayShort(date)}</b>
          <span className={`pill ${kind === "workday" ? "" : "warn"}`}>{kind === "workday" ? "Ngày làm việc" : kind === "holiday" ? `Ngày lễ${props.holidays.find((item) => item.day === date)?.name ? `: ${props.holidays.find((item) => item.day === date)!.name}` : ""}` : "Ngày nghỉ tuần"}</span>
          <span className={`pill ${STATUS_TONE[status]}`}>{existing ? TIMESHEET_STATUS_LABELS[status] : "Chưa chấm"}</span>
          {locked && <span className="pill bad">Đã khóa sổ</span>}
        </div>
        <span className="muted">{project.code} · {teamLabel(team)} · {totals.present}/{lines.length} có mặt · {formatHours(totals.regular)} giờ thường · {formatHours(totals.ot)} giờ tăng ca</span>
        {status === "rejected" && existing?.rejectReason && <p className="warn-text" role="status">Bị từ chối: {existing.rejectReason}</p>}
      </div>

      <div className="panel">
        {editable && lines.length > 0 && (
          <div className="ts-bulk">
            <span className="muted">Cả tổ tăng ca:</span>
            {[0, 1, 2, 3, 4].map((hours) => <button key={hours} type="button" className="button" onClick={() => bulkOt(hours)}>{hours === 0 ? "Không" : `${hours} giờ`}</button>)}
          </div>
        )}
        {!lines.length && <p className="muted" style={{ padding: 14 }}>Tổ này chưa có ai còn trong dự án vào ngày {date.split("-").reverse().join("/")}.</p>}
        {lines.map((line) => {
          const member = people.find((item) => item.employeeId === line.employeeId);
          const present = line.attendance === "present";
          return (
            <div key={line.employeeId} className={present ? "ts-row" : "ts-row absent"}>
              <button type="button" className="ts-name" disabled={!editable} onClick={() => setAttendance(line, present ? "leave" : "present")} aria-label={`${member?.displayName ?? line.employeeId}: ${ATTENDANCE_LABELS[line.attendance]}. Chạm để đổi`}>
                <span className="pj-avatar" aria-hidden="true">{(member?.displayName ?? "?").split(/\s+/).at(-1)?.[0] ?? "?"}</span>
                <span><b>{member?.displayName ?? line.employeeId}</b><br /><small className="muted">{member?.role === "leader" ? "Tổ trưởng · " : ""}{ATTENDANCE_LABELS[line.attendance]}{line.otHours > 0 ? ` · Tăng ca ${OT_TYPE_LABELS[line.otType].toLowerCase()}` : ""}</small></span>
              </button>
              {present && (
                <div className="ts-steppers">
                  <Stepper label="Giờ thường" value={line.regularHours} disabled={!editable} onStep={(delta) => step(line, "regularHours", delta)} />
                  <Stepper label="Tăng ca" value={line.otHours} disabled={!editable} onStep={(delta) => step(line, "otHours", delta)} />
                </div>
              )}
              {editable && !present && (
                <div className="ts-attendance" role="group" aria-label="Điểm danh">
                  {ATTENDANCE_ORDER.map((item) => <button key={item} type="button" aria-pressed={line.attendance === item} onClick={() => setAttendance(line, item)}>{ATTENDANCE_LABELS[item]}</button>)}
                </div>
              )}
            </div>
          );
        })}
        {issues.length > 0 && <ul className="ts-issues" aria-label="Kiểm tra phiếu công">{issues.map((item, index) => <li key={`${item.code}-${item.field ?? ""}-${index}`} className={item.severity}>{issueMessage(item)}</li>)}</ul>}
        <div className="ts-footer">
          <span className="muted">{dirty ? "Có thay đổi chưa lưu" : existing ? `Phiếu ${TIMESHEET_STATUS_LABELS[status].toLowerCase()}` : "Chưa lưu"}</span>
          <div className="button-row">
            {editable && <button type="button" className="button" disabled={busy || !lines.length} onClick={() => void run(save, "Đã lưu nháp.")}>Lưu nháp</button>}
            {editable && (status === "draft" || status === "rejected") && <button type="button" className="button primary" disabled={busy || errors.length > 0 || !lines.length} onClick={() => void submit()}><Send className="ico" size={16} aria-hidden="true" /> Gửi duyệt</button>}
            {props.isLead && status === "submitted" && !locked && <>
              <button type="button" className="button danger" disabled={busy} onClick={() => setRejecting(true)}><X className="ico" size={16} aria-hidden="true" /> Từ chối</button>
              <button type="button" className="button primary" disabled={busy || errors.length > 0} onClick={() => void approve()}><Check className="ico" size={16} aria-hidden="true" /> Duyệt</button>
            </>}
            {props.isAdmin && status === "approved" && !locked && <button type="button" className="button" disabled={busy} onClick={() => {
              const why = window.prompt("Lý do mở lại phiếu đã duyệt (ít nhất 5 ký tự):") ?? "";
              if (why) void run(() => props.store.reopenTimesheet(sheet.id, why), "Đã mở lại phiếu. Tiền công của phiếu được gỡ cho tới khi duyệt lại.");
            }}>Mở lại phiếu</button>}
          </div>
        </div>
        {rejecting && (
          <div className="ts-bulk">
            <label className="field" style={{ flex: 1, margin: 0 }}><span>Lý do từ chối</span><input value={reason} autoFocus onChange={(event) => setReason(event.target.value)} placeholder="vd: Anh B nghỉ buổi chiều" /></label>
            <button type="button" className="button" onClick={() => setRejecting(false)}>Hủy</button>
            <button type="button" className="button danger" disabled={busy} onClick={() => void run(() => props.store.rejectTimesheet(sheet.id, reason), "Đã trả phiếu về cho tổ trưởng.")}>Xác nhận từ chối</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper(props: { label: string; value: number; disabled: boolean; onStep: (delta: number) => void }) {
  return (
    <div className="ts-stepper">
      <small>{props.label}</small>
      <div>
        <button type="button" disabled={props.disabled || props.value <= 0} aria-label={`Giảm ${props.label.toLowerCase()} 0,5 giờ`} onClick={() => props.onStep(-0.5)}>−</button>
        <output aria-live="polite">{formatHours(props.value)}</output>
        <button type="button" disabled={props.disabled || props.value >= 24} aria-label={`Tăng ${props.label.toLowerCase()} 0,5 giờ`} onClick={() => props.onStep(0.5)}>+</button>
      </div>
    </div>
  );
}
