"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, MapPin } from "lucide-react";
import { addDays } from "../../../lib/dates";
import { formatMinutes, hoursFromCheck, mapsLink, vnClock, type AttendanceCheck } from "../../../modules/projects/attendance";
import { dayKind, weekdayShort } from "../../../modules/projects/calendar";
import { formatHours } from "../../../modules/projects/cost";
import { activeOn } from "../../../modules/projects/tree";
import type { ProjectStore } from "../../../modules/projects/store";
import type { TabProps } from "./ProjectDetail";
import { teamLabel } from "./TimesheetEntry";

export const scheduleOf = (project: TabProps["data"]["project"]) => ({ workStart: project.workStart, workEnd: project.workEnd, lunchStart: project.lunchStart, lunchEnd: project.lunchEnd, stdHours: project.stdHours });

/**
 * Quản lý chấm công GPS của dự án: theo ngày, mỗi người giờ Vào / Ra, khoảng cách tới công trường, ảnh chụp,
 * giờ thường và tăng ca tính theo giờ làm (PRJ-15). Ai chưa chấm cũng được liệt kê để tổ trưởng, CHT biết.
 */
export function ChecksTab({ store, data, viewer }: TabProps) {
  const { project } = data;
  const [date, setDate] = useState(data.today);
  const [team, setTeam] = useState("*");
  const kind = dayKind(date, project.weeklyOff, data.holidays);
  const visibleTeams = viewer.isLead ? null : new Set(viewer.leaderTeams);
  const members = data.members.filter((member) => activeOn(member, date) && (!visibleTeams || visibleTeams.has(member.team)) && (team === "*" || member.team === team));
  const checks = data.checks.filter((check) => check.workDate === date);
  const teams = [...new Set(data.members.map((member) => member.team))].filter((item) => !visibleTeams || visibleTeams.has(item)).sort((a, b) => a.localeCompare(b, "vi"));
  const done = members.filter((member) => checks.some((check) => check.employeeId === member.employeeId)).length;

  return (
    <section className="panel pj-section" aria-labelledby="pj-checks-title">
      <div className="pj-section-head">
        <h2 id="pj-checks-title"><MapPin className="ico" size={18} aria-hidden="true" /> Chấm công GPS ({done}/{members.length} người đã chấm Vào)</h2>
        <div className="pj-toolbar">
          <button type="button" className="button icon-button" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
          <label className="sr-only" htmlFor="ck-date">Ngày</label>
          <input id="ck-date" type="date" value={date} max={data.today} onChange={(event) => event.target.value && setDate(event.target.value)} />
          <button type="button" className="button icon-button" aria-label="Ngày sau" disabled={date >= data.today} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
          <span className="muted">{weekdayShort(date)}{kind !== "workday" ? kind === "holiday" ? " · Ngày lễ" : " · Ngày nghỉ tuần" : ""}</span>
          {teams.length > 1 && <select aria-label="Tổ" value={team} onChange={(event) => setTeam(event.target.value)}><option value="*">Tất cả tổ</option>{teams.map((item) => <option key={item} value={item}>{teamLabel(item)}</option>)}</select>}
        </div>
      </div>
      {project.siteLat === null
        ? <p className="warn-text">Dự án chưa đặt vị trí công trường nên nhân viên chưa tự chấm công được. Bấm “Sửa dự án” để nhập tọa độ và giờ làm.</p>
        : <small className="muted">Công trường: <a href={mapsLink(project.siteLat, project.siteLng!)} target="_blank" rel="noreferrer">{project.siteLat}, {project.siteLng}</a> · bán kính {project.siteRadiusM} m · giờ làm {project.workStart}–{project.workEnd}, nghỉ trưa {project.lunchStart}–{project.lunchEnd}. Giờ dưới đây tự điền vào phiếu công của tổ; CHT duyệt phiếu thì mới tính tiền.</small>}
      <div className="table-scroll">
        <table className="pj-table">
          <thead><tr><th>Người</th><th>Tổ</th><th>Vào</th><th>Ra</th><th className="pj-num">Giờ thường</th><th className="pj-num">Tăng ca</th><th>Ghi chú</th></tr></thead>
          <tbody>{members.sort((a, b) => a.team.localeCompare(b.team, "vi") || a.displayName.localeCompare(b.displayName, "vi")).map((member) => {
            const check = checks.find((item) => item.employeeId === member.employeeId);
            const hours = check ? hoursFromCheck(check, scheduleOf(project), kind) : null;
            return (
              <tr key={member.id}>
                <td>{member.displayName}<br /><small className="muted">{member.employeeCode}</small></td>
                <td>{teamLabel(member.team)}</td>
                <td>{check ? <Punch store={store} at={check.checkInAt} distance={check.inDistanceM} lat={check.inLat} lng={check.inLng} photo={check.inPhoto} /> : <span className="pill bad">Chưa chấm</span>}</td>
                <td>{check?.checkOutAt ? <Punch store={store} at={check.checkOutAt} distance={check.outDistanceM ?? 0} lat={check.outLat!} lng={check.outLng!} photo={check.outPhoto} /> : check ? <span className="pill warn">Chưa chấm Ra</span> : ""}</td>
                <td className="pj-num">{hours ? formatHours(hours.regularHours) : "—"}</td>
                <td className="pj-num">{hours?.otHours ? formatHours(hours.otHours) : "—"}</td>
                <td>{hours ? [hours.late ? `Đi muộn ${formatMinutes(hours.late)}` : "", hours.incomplete ? "Tạm tính tới giờ kết thúc" : ""].filter(Boolean).join(" · ") : ""}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function Punch(props: { store: ProjectStore; at: string; distance: number; lat: number; lng: number; photo: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !props.photo || url) return;
    let active = true;
    void props.store.photoUrl(props.photo).then((found) => { if (active) setUrl(found); });
    return () => { active = false; };
  }, [open, props.photo, props.store, url]);
  return (
    <span>
      <b>{vnClock(props.at)}</b> <small className="muted">· {props.distance} m · <a href={mapsLink(props.lat, props.lng)} target="_blank" rel="noreferrer">bản đồ</a></small>
      {props.photo && <> · <button type="button" className="link-button" onClick={() => setOpen((value) => !value)}><ImageIcon className="ico" size={13} aria-hidden="true" /> {open ? "Ẩn ảnh" : "Ảnh"}</button></>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {open && (url ? <img src={url} alt={`Ảnh chấm lúc ${vnClock(props.at)}`} style={{ display: "block", width: 160, borderRadius: 6, marginTop: 4 }} /> : <small className="muted"> Đang tải ảnh…</small>)}
    </span>
  );
}

/** Dòng công gợi ý từ lượt chấm GPS (dùng cho phiếu công của tổ). */
export function lineFromCheck(check: AttendanceCheck | undefined, schedule: ReturnType<typeof scheduleOf>, kind: ReturnType<typeof dayKind>) {
  if (!check) return null;
  const hours = hoursFromCheck(check, schedule, kind);
  return { attendance: "present" as const, regularHours: hours.regularHours, otHours: hours.otHours, otType: kind === "workday" ? "weekday" as const : kind, note: `GPS ${vnClock(check.checkInAt)}–${check.checkOutAt ? vnClock(check.checkOutAt) : "?"}` };
}
