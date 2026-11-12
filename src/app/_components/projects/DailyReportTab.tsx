"use client";
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Camera, ClipboardList, Copy, Download, ImagePlus, PenLine, Plus, ScanText, Send, Trash2, X } from "lucide-react";
import { getSupabaseClient } from "../../../lib/supabase/client";
import {
  DAILY_MAX_PHOTOS, DAILY_MAX_TASKS, draftFromReport, draftIssues, emptyDraft, manualName, needsCheck, telegramCaption, toInput,
  type DailyReport, type DailyReportDraft, type DailyTaskDraft, type NameRef,
} from "../../../modules/projects/dailyReport";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, projectText } from "./projectShared";
import { DailySummary } from "./DailySummary";
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
 * thêm ảnh thi công nếu có (tối đa 12) → lưu dữ liệu và gửi file Excel vào nhóm Telegram. Không lưu ảnh.
 */
export function DailyReportTab({ store, data, viewer, setNotice }: TabProps) {
  const { project, today, members } = data;
  const [reports, setReports] = useState<DailyReport[] | null>(null);
  const [draft, setDraft] = useState<DailyReportDraft | null>(null);
  const [board, setBoard] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState<"read" | "send" | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"photo" | "manual">("photo");
  const boardUrl = useMemo(() => board ? URL.createObjectURL(board) : null, [board]);
  useEffect(() => () => { if (boardUrl) URL.revokeObjectURL(boardUrl); }, [boardUrl]);

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
      for (const photo of photos) body.append("photos", await shrink(photo, 1280));
      const response = await fetch("/api/daily-report/send", { method: "POST", body, headers: await authHeader() });
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string; sent?: boolean; telegramError?: string; file?: string; fileName?: string } | null;
      if (!response.ok || !result?.ok) {
        await store.markDailyReportSent(saved.id, result?.message ?? "Không tạo được file báo cáo.").catch(() => undefined);
        throw new Error(result?.message ?? "Không tạo được file báo cáo.");
      }
      await store.markDailyReportSent(saved.id, result.sent ? "" : result.telegramError ?? "").catch(() => undefined);
      if (result.file && result.fileName) {
        const bytes = Uint8Array.from(atob(result.file), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        setDownload({ url, name: result.fileName });
        // Chưa gửi được Telegram thì tải file Excel về máy luôn để không mất báo cáo
        if (!result.sent) {
          const link = document.createElement("a");
          link.href = url; link.download = result.fileName;
          document.body.appendChild(link); link.click(); link.remove();
        }
      }
      const totals = `${input.present ?? 0} người hiện diện, ${input.otCount} người tăng ca ${input.otHours} giờ (lũy kế ${saved.cumulativeWorkdays} công, ${saved.cumulativeOtHours} giờ TC)`;
      setNotice(result.sent
        ? `Đã gửi báo cáo: ${totals}. File Excel đã gửi vào nhóm Telegram.`
        : `Đã gửi báo cáo: ${totals}. Chưa gửi được Telegram (${result.telegramError}), file Excel đã tải về máy.`, result.sent ? "success" : "error");
      setDraft(null); setBoard(null); setPhotos([]); setAttempt((value) => value + 1);
    } catch (error) { setNotice(errorMessage(error), "error"); }
    finally { setBusy(null); }
  };

  const latest = reports?.[0] ?? null;
  const issues = draft ? draftIssues(draft) : [];
  const errors = issues.filter((issue) => issue.level === "error");
  const manual = () => { setMode("manual"); if (!draft) setDraft(emptyDraft(today)); };
  const copy = (report: DailyReport) => { setMode("manual"); setDraft(draftFromReport(report, today)); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const cancel = () => {
    if ((draft || photos.length) && !window.confirm("Bỏ bảng và ảnh đang nhập?")) return;
    setDraft(null); setBoard(null); setPhotos([]);
  };
  return (
    <div className="pj-page dr-page">
      <section className="panel pj-section">
        <div className="pj-section-head">
          <h2><ClipboardList className="ico" size={18} aria-hidden="true" /> Báo cáo ngày</h2>
          {draft?.model && <small className="muted">Đọc bằng {draft.model}</small>}
        </div>
        <div className="role-switch dr-mode" role="group" aria-label="Cách lập bảng">
          <button type="button" aria-pressed={mode === "photo"} onClick={() => setMode("photo")}><Camera size={16} aria-hidden="true" /> Tạo bằng ảnh</button>
          <button type="button" aria-pressed={mode === "manual"} onClick={manual}><PenLine size={16} aria-hidden="true" /> Tự nhập bảng</button>
        </div>
        {mode === "photo" && (
          <div className="dr-board">
            <label className={`dr-board-pick ${boardUrl ? "has-image" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước tạm thời */}
              {boardUrl ? <img src={boardUrl} alt="Ảnh bảng phân công" /> : <><Camera size={28} aria-hidden="true" /><span>Chụp hoặc chọn ảnh bảng phân công</span></>}
              {boardUrl && <span className="dr-board-change">Đổi ảnh</span>}
              <input type="file" accept="image/*" hidden onChange={(event) => { setBoard(event.target.files?.[0] ?? null); event.target.value = ""; }} />
            </label>
            <button type="button" className="button primary dr-wide" disabled={!board || busy !== null} onClick={() => void read()}>
              <ScanText className="ico" size={16} aria-hidden="true" /> {busy === "read" ? "Đang đọc bảng… (10–20 giây)" : draft?.model ? "Đọc lại bảng" : "Đọc bảng"}
            </button>
          </div>
        )}
        {!draft && latest && <button type="button" className="button dr-wide" onClick={() => copy(latest)}><Copy className="ico" size={16} aria-hidden="true" /> Sao chép báo cáo {dmy(latest.date)}</button>}
        {draft && <DraftEditor draft={draft} onChange={setDraft} suggestions={suggestions} />}
      </section>

      <PhotoPicker photos={photos} photoUrls={photoUrls} onPhotos={setPhotos} />

      <div className="dr-actions">
        {issues.length > 0 && <ul className="dr-issues">{issues.map((issue) => <li key={issue.code} className={issue.level}>{issue.text}</li>)}</ul>}
        {!draft && <p className="muted dr-hint">Đọc bảng từ ảnh hoặc tự nhập bảng trước khi gửi.</p>}
        <div className="dr-action-buttons">
          {(draft || photos.length > 0) && <button type="button" className="button" disabled={busy !== null} onClick={cancel}>Hủy</button>}
          <button type="button" className="button primary" disabled={!draft || busy !== null || errors.length > 0} onClick={() => void send()}><Send className="ico" size={16} aria-hidden="true" /> {busy === "send" ? "Đang gửi báo cáo…" : "Gửi báo cáo"}</button>
        </div>
      </div>

      {download && <p className="dr-download"><a className="button dr-wide" href={download.url} download={download.name}><Download className="ico" size={16} aria-hidden="true" /> Tải file {download.name}</a></p>}
      <DailySummary store={store} data={data} viewer={viewer} setNotice={setNotice} refreshKey={attempt} />
      <ReportHistory reports={reports} onCopy={copy} />
    </div>
  );
}

/** Ảnh thi công: luôn hiện, chọn lúc nào cũng được (trước hay sau khi đọc bảng). Không bắt buộc. */
function PhotoPicker(props: { photos: File[]; photoUrls: string[]; onPhotos: (photos: File[]) => void }) {
  return (
    <section className="panel pj-section">
      <h2><ImagePlus className="ico" size={18} aria-hidden="true" /> Ảnh thi công <small className="muted">{props.photos.length}/{DAILY_MAX_PHOTOS} · không bắt buộc</small></h2>
      <div className="dr-photos">
        {props.photoUrls.map((url, index) => (
          <figure key={url}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước tạm thời */}
            <img src={url} alt={`Ảnh thi công ${index + 1}`} />
            <button type="button" className="dr-remove" aria-label={`Bỏ ảnh ${index + 1}`} onClick={() => props.onPhotos(props.photos.filter((_, at) => at !== index))}><X size={16} aria-hidden="true" /></button>
          </figure>
        ))}
        {props.photos.length < DAILY_MAX_PHOTOS && (
          <label className="dr-add"><Camera size={24} aria-hidden="true" /><span>Thêm ảnh</span>
            <input type="file" accept="image/*" multiple hidden onChange={(event) => { props.onPhotos([...props.photos, ...Array.from(event.target.files ?? [])].slice(0, DAILY_MAX_PHOTOS)); event.target.value = ""; }} />
          </label>
        )}
      </div>
      <small className="muted">Ảnh nằm ở khung phía dưới file Excel gửi Telegram, 2 ảnh mỗi hàng; hệ thống không lưu ảnh.</small>
    </section>
  );
}

function DraftEditor(props: { draft: DailyReportDraft; onChange: (draft: DailyReportDraft) => void; suggestions: string[] }) {
  const { draft, onChange } = props;
  const set = (patch: Partial<DailyReportDraft>) => onChange({ ...draft, ...patch });
  const setTask = (index: number, patch: Partial<DailyTaskDraft>) => set({ tasks: draft.tasks.map((task, at) => at === index ? { ...task, ...patch } : task) });
  const num = (value: string) => value === "" ? null : Math.max(0, Number(value));
  return (
    <div className="dr-editor">
        <div className="dr-head">
          <label className="field"><span>Ngày *</span><input type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} /></label>
          <label className="field"><span>Tổng số (TS)</span><input type="number" min={0} inputMode="numeric" value={draft.total ?? ""} onChange={(event) => set({ total: num(event.target.value) })} /></label>
          <label className="field"><span>Hiện diện (HD)</span><input type="number" min={0} inputMode="numeric" value={draft.present ?? ""} onChange={(event) => set({ present: num(event.target.value) })} /></label>
          <label className="field"><span>Vắng (V)</span><input type="number" min={0} inputMode="numeric" value={draft.absent ?? ""} onChange={(event) => set({ absent: num(event.target.value) })} /></label>
          <label className="field"><span>SL tăng ca</span><input type="number" min={0} inputMode="numeric" value={draft.otCount} onChange={(event) => set({ otCount: num(event.target.value) ?? 0 })} /></label>
          <label className="field"><span>Giờ TC</span><input type="number" min={0} step={0.5} inputMode="decimal" value={draft.otHours} onChange={(event) => set({ otHours: num(event.target.value) ?? 0 })} /></label>
        </div>
        <div className="dr-tasks">
          {draft.tasks.map((task, index) => (
            <div className="dr-task" key={index}>
              <span className="dr-task-no">{index + 1}</span>
              <input className="dr-task-name" aria-label={`Công việc ${index + 1}`} placeholder="Tên công việc" value={task.task} onChange={(event) => setTask(index, { task: event.target.value })} />
              <button type="button" className="dr-task-del" aria-label={`Xóa công việc ${index + 1}`} onClick={() => set({ tasks: draft.tasks.filter((_, at) => at !== index) })}><Trash2 size={16} aria-hidden="true" /></button>
              <div className="dr-task-leader"><small>Nhóm trưởng</small><NameChips single names={task.leader ? [task.leader] : []} suggestions={props.suggestions} onChange={(names) => setTask(index, { leader: names[0] ?? null })} /></div>
              <div className="dr-task-members"><small>Thành viên</small><NameChips names={task.members} suggestions={props.suggestions} onChange={(names) => setTask(index, { members: names })} /></div>
            </div>
          ))}
        </div>
        <button type="button" className="button dr-wide" disabled={draft.tasks.length >= DAILY_MAX_TASKS} onClick={() => set({ tasks: [...draft.tasks, { no: draft.tasks.length + 1, task: "", leader: null, members: [] }] })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm công việc</button>
        <p className="dr-legend"><span className="pill warn">vàng</span> máy tự sửa theo danh sách công nhân · <span className="pill bad">đỏ</span> không khớp ai trong dự án · bấm vào tên để sửa</p>
    </div>
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
      <ul className="dr-history">
        {props.reports.map((report) => (
          <li key={report.id}>
            <div className="dr-history-top">
              <b>{dmy(report.date)}</b>
              {report.sentAt ? <span className="pill ok">Đã gửi</span> : <span className="pill bad" title={report.sentError}>{report.sentError ? "Lỗi gửi" : "Chưa gửi"}</span>}
              <small className="muted">{report.createdByName}</small>
            </div>
            <div className="dr-history-stats">
              <span>TS <b>{report.total ?? "–"}</b></span><span>HD <b>{report.present ?? "–"}</b></span><span>Vắng <b>{report.absent ?? "–"}</b></span>
              <span>TC <b>{report.otCount}</b> người · <b>{report.otHours}</b> giờ</span>
            </div>
            <p className="muted dr-history-tasks">{report.tasks.map((task) => task.task).join(" · ")}</p>
            <button type="button" className="button" onClick={() => props.onCopy(report)}>Sửa / gửi lại</button>
          </li>
        ))}
      </ul>
      <small className="muted">{projectText("DR_PHOTOS_NOT_STORED")}</small>
    </section>
  );
}
