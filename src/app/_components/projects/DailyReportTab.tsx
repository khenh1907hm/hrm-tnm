"use client";
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Camera, ClipboardList, Copy, Download, ImagePlus, Plus, ScanText, Send, Trash2, X } from "lucide-react";
import { getSupabaseClient } from "../../../lib/supabase/client";
import {
  DAILY_MAX_PHOTOS, DAILY_MAX_TASKS, draftFromReport, draftIssues, emptyDraft, manualName, needsCheck, telegramCaption, toInput,
  type DailyReport, type DailyReportDraft, type DailyTaskDraft, type NameRef,
} from "../../../modules/projects/dailyReport";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, projectText } from "./projectShared";
import "./dailyReport.css";

const dmy = (iso: string) => iso.split("-").reverse().join("/");
const CHIP_TONE: Record<NameRef["confidence"], string> = { exact: "", manual: "", accent: "warn", fuzzy: "warn", none: "bad" };

async function authHeader(): Promise<Record<string, string>> {
  const session = await getSupabaseClient()?.auth.getSession();
  const token = session?.data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Thu ảnh về cạnh dài 1600 px (JPEG) trước khi tải lên cho nhanh; ảnh không lưu lại ở đâu cả. */
async function shrink(file: File, side = 1600): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

/**
 * Tab Báo cáo ngày (mẫu "BC ngày"): chụp bảng phân công → máy đọc (Python) → chỉ huy trưởng kiểm tra, sửa →
 * thêm tối đa 4 ảnh thi công → lưu dữ liệu và gửi file Excel vào nhóm Telegram. Không lưu ảnh.
 */
export function DailyReportTab({ store, data, setNotice }: TabProps) {
  const { project, today, members } = data;
  const [reports, setReports] = useState<DailyReport[] | null>(null);
  const [draft, setDraft] = useState<DailyReportDraft | null>(null);
  const [board, setBoard] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState<"read" | "send" | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void store.listDailyReports(project.id).then((list) => { if (active) setReports(list); }, () => { if (active) setReports([]); });
    return () => { active = false; };
  }, [store, project.id, attempt]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);

  const roster = useMemo(() => members.filter((member) => !member.leftOn || member.leftOn >= today).map((member) => ({ name: member.displayName, employeeId: member.employeeId })), [members, today]);
  const suggestions = useMemo(() => [...new Set(roster.map((person) => person.name.trim().split(/\s+/).pop() ?? ""))].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi")), [roster]);
  const photoUrls = useMemo(() => photos.map((photo) => URL.createObjectURL(photo)), [photos]);
  useEffect(() => () => photoUrls.forEach((url) => URL.revokeObjectURL(url)), [photoUrls]);

  const read = async () => {
    if (!board) return;
    setBusy("read");
    try {
      const body = new FormData();
      body.set("project", project.id);
      body.set("image", await shrink(board));
      body.set("roster", JSON.stringify(roster));
      const response = await fetch("/api/daily-report/read", { method: "POST", body, headers: await authHeader() });
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string; data?: DailyReportDraft & { tasks: DailyTaskDraft[] } } | null;
      if (!response.ok || !result?.ok || !result.data) throw new Error(result?.message ?? "Không đọc được ảnh.");
      const read = result.data;
      setDraft({ ...read, date: read.date || today, otCount: 0, otHours: 0, model: read.model ?? "", tasks: read.tasks.length ? read.tasks : emptyDraft(today).tasks });
      setNotice(`Đã đọc bảng: ${read.tasks.length} công việc. Kiểm tra các tên tô màu trước khi gửi.`, "success");
    } catch (error) { setNotice(errorMessage(error), "error"); }
    finally { setBusy(null); }
  };

  const send = async () => {
    if (!draft) return;
    const blocking = draftIssues(draft).filter((issue) => issue.level === "error");
    if (blocking.length) { setNotice(blocking[0]!.text, "error"); return; }
    setBusy("send");
    try {
      const input = toInput(draft, photos.length);
      const saved = await store.saveDailyReport(project.id, input);
      const body = new FormData();
      body.set("project", project.id);
      body.set("data", JSON.stringify({
        ...input, projectCode: saved.projectCode, projectName: saved.projectName, cumulativeWorkdays: saved.cumulativeWorkdays, cumulativeOtHours: saved.cumulativeOtHours,
        caption: telegramCaption(input, { code: saved.projectCode, name: saved.projectName }, ""),
      }));
      for (const photo of photos) body.append("photos", await shrink(photo));
      const response = await fetch("/api/daily-report/send", { method: "POST", body, headers: await authHeader() });
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string; sent?: boolean; telegramError?: string; file?: string; fileName?: string } | null;
      if (!response.ok || !result?.ok) {
        await store.markDailyReportSent(saved.id, result?.message ?? "Không tạo được file báo cáo.").catch(() => undefined);
        throw new Error(result?.message ?? "Không tạo được file báo cáo.");
      }
      await store.markDailyReportSent(saved.id, result.sent ? "" : result.telegramError ?? "").catch(() => undefined);
      if (result.file && result.fileName) {
        const bytes = Uint8Array.from(atob(result.file), (char) => char.charCodeAt(0));
        setDownload({ url: URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })), name: result.fileName });
      }
      setNotice(result.sent ? "Đã lưu và gửi báo cáo ngày vào nhóm Telegram." : `Đã lưu báo cáo, nhưng chưa gửi Telegram: ${result.telegramError}`, result.sent ? "success" : "error");
      setDraft(null); setBoard(null); setPhotos([]); setAttempt((value) => value + 1);
    } catch (error) { setNotice(errorMessage(error), "error"); }
    finally { setBusy(null); }
  };

  const latest = reports?.[0] ?? null;
  return (
    <div className="pj-page">
      {!draft ? (
        <section className="panel pj-section dr-start">
          <h2><ClipboardList className="ico" size={18} aria-hidden="true" /> Báo cáo ngày <small className="muted">(mẫu BC ngày)</small></h2>
          <p className="muted">Chụp bảng phân công trong ngày, máy đọc ra số người, người vắng và công việc. Kiểm tra lại, thêm tối đa {DAILY_MAX_PHOTOS} ảnh thi công rồi gửi vào nhóm Telegram. Hệ thống chỉ lưu dữ liệu, không lưu ảnh.</p>
          <div className="dr-board">
            <label className="button dr-file"><Camera className="ico" size={16} aria-hidden="true" /> {board ? "Chụp lại" : "Chụp / chọn ảnh bảng"}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(event) => { setBoard(event.target.files?.[0] ?? null); event.target.value = ""; }} />
            </label>
            {board && <span className="pill">{board.name}</span>}
            <button type="button" className="button primary" disabled={!board || busy !== null} onClick={() => void read()}><ScanText className="ico" size={16} aria-hidden="true" /> {busy === "read" ? "Đang đọc bảng… (khoảng 10–20 giây)" : "Đọc bảng"}</button>
          </div>
          <div className="button-row">
            <button type="button" className="button" onClick={() => setDraft(emptyDraft(today))}>Nhập tay</button>
            {latest && <button type="button" className="button" onClick={() => setDraft(draftFromReport(latest, today))}><Copy className="ico" size={16} aria-hidden="true" /> Sao chép báo cáo {dmy(latest.date)}</button>}
          </div>
        </section>
      ) : (
        <DraftEditor draft={draft} onChange={setDraft} suggestions={suggestions} photos={photos} photoUrls={photoUrls} onPhotos={setPhotos} busy={busy === "send"}
          onCancel={() => setDraft(null)} onSend={() => void send()} />
      )}
      {download && <p className="dr-download"><a className="button" href={download.url} download={download.name}><Download className="ico" size={16} aria-hidden="true" /> Tải file {download.name}</a></p>}
      <ReportHistory reports={reports} onCopy={(report) => setDraft(draftFromReport(report, today))} />
    </div>
  );
}

function DraftEditor(props: { draft: DailyReportDraft; onChange: (draft: DailyReportDraft) => void; suggestions: string[]; photos: File[]; photoUrls: string[]; onPhotos: (photos: File[]) => void; busy: boolean; onCancel: () => void; onSend: () => void }) {
  const { draft, onChange } = props;
  const set = (patch: Partial<DailyReportDraft>) => onChange({ ...draft, ...patch });
  const setTask = (index: number, patch: Partial<DailyTaskDraft>) => set({ tasks: draft.tasks.map((task, at) => at === index ? { ...task, ...patch } : task) });
  const num = (value: string) => value === "" ? null : Math.max(0, Number(value));
  const issues = draftIssues(draft);
  const errors = issues.filter((issue) => issue.level === "error");
  return (
    <>
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2><ClipboardList className="ico" size={18} aria-hidden="true" /> Kiểm tra báo cáo ngày</h2>
          {draft.model && <small className="muted">Đọc bằng {draft.model}</small>}
        </div>
        <div className="dr-head">
          <label className="field"><span>Ngày *</span><input type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} /></label>
          <label className="field"><span>Tổng số (TS)</span><input type="number" min={0} inputMode="numeric" value={draft.total ?? ""} onChange={(event) => set({ total: num(event.target.value) })} /></label>
          <label className="field"><span>Hiện diện (HD)</span><input type="number" min={0} inputMode="numeric" value={draft.present ?? ""} onChange={(event) => set({ present: num(event.target.value) })} /></label>
          <label className="field"><span>Vắng (V)</span><input type="number" min={0} inputMode="numeric" value={draft.absent ?? ""} onChange={(event) => set({ absent: num(event.target.value) })} /></label>
          <label className="field"><span>SL tăng ca</span><input type="number" min={0} inputMode="numeric" value={draft.otCount} onChange={(event) => set({ otCount: num(event.target.value) ?? 0 })} /></label>
          <label className="field"><span>Giờ TC</span><input type="number" min={0} step={0.5} inputMode="decimal" value={draft.otHours} onChange={(event) => set({ otHours: num(event.target.value) ?? 0 })} /></label>
        </div>
        <div className="field"><span>Người vắng</span><NameChips names={draft.absentNames} suggestions={props.suggestions} onChange={(absentNames) => set({ absentNames })} /></div>
        <div className="table-scroll">
          <table className="pj-table dr-tasks">
            <thead><tr><th>STT</th><th>Công việc</th><th>Nhóm trưởng</th><th>Thành viên</th><th /></tr></thead>
            <tbody>{draft.tasks.map((task, index) => (
              <tr key={index}>
                <td className="pj-num">{index + 1}</td>
                <td><input aria-label={`Công việc ${index + 1}`} value={task.task} onChange={(event) => setTask(index, { task: event.target.value })} /></td>
                <td><NameChips single names={task.leader ? [task.leader] : []} suggestions={props.suggestions} onChange={(names) => setTask(index, { leader: names[0] ?? null })} /></td>
                <td><NameChips names={task.members} suggestions={props.suggestions} onChange={(names) => setTask(index, { members: names })} /></td>
                <td><button type="button" className="button danger icon-button" aria-label={`Xóa công việc ${index + 1}`} onClick={() => set({ tasks: draft.tasks.filter((_, at) => at !== index) })}><Trash2 size={14} aria-hidden="true" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <button type="button" className="button" disabled={draft.tasks.length >= DAILY_MAX_TASKS} onClick={() => set({ tasks: [...draft.tasks, { no: draft.tasks.length + 1, task: "", leader: null, members: [] }] })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm công việc</button>
        <p className="dr-legend"><span className="pill warn">vàng</span> máy tự sửa theo danh sách công nhân, kiểm tra lại · <span className="pill bad">đỏ</span> không khớp ai trong dự án · bấm vào tên để sửa</p>
      </section>

      <section className="panel pj-section">
        <h2><ImagePlus className="ico" size={18} aria-hidden="true" /> Ảnh thi công <small className="muted">({props.photos.length}/{DAILY_MAX_PHOTOS}, chỉ đính kèm file gửi đi, không lưu)</small></h2>
        <div className="dr-photos">
          {props.photoUrls.map((url, index) => (
            <figure key={url}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước tạm thời */}
              <img src={url} alt={`Ảnh thi công ${index + 1}`} />
              <button type="button" className="dr-remove" aria-label={`Bỏ ảnh ${index + 1}`} onClick={() => props.onPhotos(props.photos.filter((_, at) => at !== index))}><X size={14} aria-hidden="true" /></button>
            </figure>
          ))}
          {props.photos.length < DAILY_MAX_PHOTOS && (
            <label className="dr-add"><Camera size={22} aria-hidden="true" /><span>Thêm ảnh</span>
              <input type="file" accept="image/*" multiple hidden onChange={(event) => { props.onPhotos([...props.photos, ...Array.from(event.target.files ?? [])].slice(0, DAILY_MAX_PHOTOS)); event.target.value = ""; }} />
            </label>
          )}
        </div>
        {issues.length > 0 && <ul className="dr-issues">{issues.map((issue) => <li key={issue.code} className={issue.level}>{issue.text}</li>)}</ul>}
        <div className="button-row">
          <button type="button" className="button" onClick={props.onCancel}>Hủy</button>
          <button type="button" className="button primary" disabled={props.busy || errors.length > 0} onClick={props.onSend}><Send className="ico" size={16} aria-hidden="true" /> {props.busy ? "Đang tạo file và gửi…" : "Lưu và gửi Telegram"}</button>
        </div>
      </section>
    </>
  );
}

/** Danh sách tên dạng thẻ: màu theo độ chắc chắn khi đọc, bấm để sửa, × để bỏ, gõ để thêm (gợi ý theo danh sách công nhân). */
function NameChips(props: { names: NameRef[]; suggestions: string[]; onChange: (names: NameRef[]) => void; single?: boolean }) {
  const [text, setText] = useState("");
  const listId = `dr-names-${useId()}`;
  const add = useCallback(() => {
    const value = text.trim().replace(/^\+/, "").trim();
    if (!value) return;
    props.onChange(props.single ? [manualName(value)] : [...props.names, manualName(value)]);
    setText("");
  }, [text, props]);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } };
  return (
    <div className="dr-chips">
      {props.names.map((ref, index) => (
        <span key={`${ref.name}-${index}`} className={`dr-chip ${CHIP_TONE[ref.confidence]}`} title={needsCheck(ref) ? `Đọc được “${ref.text}”${ref.matched ? ` → sửa thành “${ref.name}”${ref.fullName ? ` (${ref.fullName})` : ""}` : ", không khớp ai trong dự án"}` : ref.fullName ?? ""}>
          <button type="button" className="dr-chip-name" onClick={() => { const next = window.prompt("Sửa tên:", ref.name); if (next !== null && next.trim()) props.onChange(props.names.map((item, at) => at === index ? manualName(next) : item)); }}>{ref.name}</button>
          <button type="button" className="dr-chip-x" aria-label={`Bỏ ${ref.name}`} onClick={() => props.onChange(props.names.filter((_, at) => at !== index))}>×</button>
        </span>
      ))}
      {(!props.single || !props.names.length) && <input list={listId} className="dr-chip-input" value={text} placeholder={props.single ? "Nhóm trưởng" : "+ tên"} onChange={(event) => setText(event.target.value)} onKeyDown={onKey} onBlur={add} />}
      <datalist id={listId}>{props.suggestions.map((name) => <option key={name} value={name} />)}</datalist>
    </div>
  );
}

function ReportHistory(props: { reports: DailyReport[] | null; onCopy: (report: DailyReport) => void }) {
  if (!props.reports) return <div className="loading">Đang tải báo cáo ngày…</div>;
  if (!props.reports.length) return null;
  return (
    <section className="panel pj-section">
      <h2>Báo cáo đã gửi</h2>
      <div className="table-scroll">
        <table className="pj-table">
          <thead><tr><th>Ngày</th><th className="pj-num">TS</th><th className="pj-num">HD</th><th className="pj-num">Vắng</th><th className="pj-num">TC (người / giờ)</th><th>Công việc</th><th>Telegram</th><th /></tr></thead>
          <tbody>{props.reports.map((report) => (
            <tr key={report.id}>
              <td>{dmy(report.date)}<br /><small className="muted">{report.createdByName}</small></td>
              <td className="pj-num">{report.total ?? "–"}</td>
              <td className="pj-num">{report.present ?? "–"}</td>
              <td className="pj-num">{report.absent ?? "–"}{report.absentNames.length ? <><br /><small className="muted">{report.absentNames.join(", ")}</small></> : null}</td>
              <td className="pj-num">{report.otCount} / {report.otHours}</td>
              <td>{report.tasks.map((task) => task.task).join(" · ")}</td>
              <td>{report.sentAt ? <span className="pill ok">Đã gửi</span> : <span className="pill bad" title={report.sentError}>{report.sentError ? "Lỗi gửi" : "Chưa gửi"}</span>}</td>
              <td><button type="button" className="button" onClick={() => props.onCopy(report)}>Sửa / gửi lại</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <small className="muted">{projectText("DR_PHOTOS_NOT_STORED")}</small>
    </section>
  );
}
