"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, Camera, Check, CheckCircle2, Clock3, Coffee, FolderX, Loader2, LogIn, LogOut, MapPin, RefreshCw, ShieldCheck, X } from "lucide-react";
import "./checkin.css";
import { systemClock, todayVN } from "../../../lib/clock";
import { dayKind } from "../../../modules/projects/calendar";
import { distanceM, formatMinutes, hoursFromCheck, mapsLink, vnClock, withinSite, type AttendanceContext, type GpsFix } from "../../../modules/projects/attendance";
import { formatHours } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Holiday } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, projectText } from "./projectShared";

type Step = { kind: "in" | "out"; context: AttendanceContext; fix: GpsFix; distance: number };

/** Đồng hồ lớn và ngày hôm nay (giờ Việt Nam), tự chạy mỗi giây. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const time = now.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  return <div className="ci-clock" aria-live="off"><b suppressHydrationWarning>{time}</b><span suppressHydrationWarning>{date}</span></div>;
}

/** Đọc GPS độ chính xác cao một lần; lỗi trả câu tiếng Việt. */
function readGps(): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("CHECKIN_NO_GPS")); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy) }),
      () => reject(new Error("CHECKIN_NO_GPS")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** Ảnh từ video camera, thu nhỏ cạnh dài 640 px, JPEG ~60% (khoảng 40–80 KB). */
async function capture(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d")!;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Đóng dấu giờ lên ảnh để đối chiếu
  context.fillStyle = "rgba(0,0,0,.55)"; context.fillRect(0, canvas.height - 26, canvas.width, 26);
  context.fillStyle = "#fff"; context.font = "14px sans-serif";
  context.fillText(new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), 8, canvas.height - 8);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.6));
  if (!blob) throw new Error("CHECKIN_NO_PHOTO");
  return blob;
}

/**
 * Nhân viên tự chấm Vào / Ra (PRJ-14, PRJ-15): bắt buộc bật định vị và chụp ảnh bằng camera trước tại chỗ.
 * Ngoài bán kính công trường thì chặn và báo khoảng cách. Giờ chấm do máy chủ ghi, không lấy giờ điện thoại.
 */
export function SelfCheckIn(props: { store: ProjectStore; holidays: Holiday[]; setNotice: Notify }) {
  const { store, setNotice } = props;
  const [contexts, setContexts] = useState<AttendanceContext[] | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const today = todayVN(systemClock);

  const fetchAll = useCallback(() => store.myAttendance(), [store]);
  const reload = useCallback(async () => { try { setContexts(await fetchAll()); } catch (error) { setNotice(errorMessage(error), "error"); } }, [fetchAll, setNotice]);
  useEffect(() => {
    let active = true;
    void fetchAll().then((next) => { if (active) setContexts(next); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setContexts([]); } });
    return () => { active = false; };
  }, [fetchAll, setNotice]);

  const start = async (kind: "in" | "out", context: AttendanceContext) => {
    setProblem("");
    if (context.siteLat === null || context.siteLng === null) { setProblem(projectText("CHECKIN_NO_SITE")); return; }
    setBusy("Đang lấy vị trí GPS…");
    try {
      const fix = await readGps();
      const distance = distanceM(context.siteLat, context.siteLng, fix.lat, fix.lng);
      if (!withinSite(distance, context.siteRadiusM)) { setProblem(projectText("CHECKIN_OUT_OF_RANGE", { name: String(distance) })); return; }
      setStep({ kind, context, fix, distance });
    } catch (error) { setProblem(errorMessage(error)); }
    finally { setBusy(null); }
  };

  if (!contexts) return <div className="loading">Đang tải…</div>;

  return (
    <div className="ci-wrap">
      <LiveClock />
      {!contexts.length && (
        <section className="ci-card ci-empty">
          <span className="ci-empty-icon" aria-hidden="true"><FolderX size={28} /></span>
          <b>Bạn chưa được thêm vào dự án nào đang thi công</b>
          <p>Nhờ chỉ huy trưởng hoặc PM thêm bạn vào dự án. Sau đó mở lại trang này để bấm <b>Chấm Vào</b>.</p>
        </section>
      )}
      {problem && <p className="ci-alert" role="alert"><AlertTriangle size={18} aria-hidden="true" /> {problem}</p>}
      {busy && <p className="ci-busy" role="status"><Loader2 size={18} className="ci-spin" aria-hidden="true" /> {busy}</p>}
      {contexts.map((context) => {
        const kind = dayKind(today, context.weeklyOff, props.holidays);
        const done = context.today;
        const hours = done ? hoursFromCheck({ workDate: today, checkInAt: done.checkInAt, checkOutAt: done.checkOutAt }, context.schedule, kind) : null;
        const next: "in" | "out" | null = !done ? "in" : !done.checkOutAt ? "out" : null;
        return (
          <section key={context.projectId} className="ci-card" aria-label={`Chấm công ${context.code}`}>
            <header className="ci-project">
              <span className="ci-project-icon" aria-hidden="true"><Building2 size={20} /></span>
              <div>
                <b>{context.name}</b>
                <small>{context.code}{context.team ? ` · ${context.team}` : ""}</small>
              </div>
            </header>
            <div className="ci-chips">
              <span><Clock3 size={14} aria-hidden="true" /> {context.schedule.workStart}–{context.schedule.workEnd}</span>
              <span><Coffee size={14} aria-hidden="true" /> Nghỉ {context.schedule.lunchStart}–{context.schedule.lunchEnd}</span>
              <span><MapPin size={14} aria-hidden="true" /> Trong {context.siteRadiusM} m</span>
              {kind !== "workday" && <span className="warn">Ngày nghỉ: tính tăng ca</span>}
            </div>

            {next ? (
              <button type="button" className={`ci-punch ${next}`} disabled={busy !== null} onClick={() => void start(next, context)}>
                {next === "in" ? <LogIn size={34} aria-hidden="true" /> : <LogOut size={34} aria-hidden="true" />}
                <b>{next === "in" ? "Chấm Vào" : "Chấm Ra"}</b>
                <small>Bấm để chụp ảnh và ghi vị trí</small>
              </button>
            ) : (
              <div className="ci-done"><CheckCircle2 size={40} aria-hidden="true" /><b>Đã chấm đủ hôm nay</b><small>Hẹn gặp lại ngày mai</small></div>
            )}

            <ol className="ci-timeline">
              <li className={done ? "ok" : ""}>
                <span className="ci-dot" aria-hidden="true">{done ? <Check size={14} /> : null}</span>
                <span>Vào</span>
                <b>{done ? vnClock(done.checkInAt) : "--:--"}</b>
                <small>{done ? `cách ${done.inDistanceM} m${hours?.late ? ` · muộn ${formatMinutes(hours.late)}` : ""}` : "Chưa chấm"}</small>
              </li>
              <li className={done?.checkOutAt ? "ok" : ""}>
                <span className="ci-dot" aria-hidden="true">{done?.checkOutAt ? <Check size={14} /> : null}</span>
                <span>Ra</span>
                <b>{done?.checkOutAt ? vnClock(done.checkOutAt) : "--:--"}</b>
                <small>{done?.checkOutAt ? `cách ${done.outDistanceM} m` : "Chưa chấm"}</small>
              </li>
            </ol>

            {hours && (
              <div className="ci-stats">
                <div><b>{formatHours(hours.regularHours)}</b><small>giờ thường</small></div>
                <div><b>{formatHours(hours.otHours)}</b><small>giờ tăng ca</small></div>
                <div><b>{hours.incomplete ? "Tạm tính" : "Đủ"}</b><small>{hours.incomplete ? "chưa chấm Ra" : "Vào và Ra"}</small></div>
              </div>
            )}
            <small className="ci-note"><ShieldCheck size={13} aria-hidden="true" /> Cần bật định vị (GPS) và cho phép camera. Giờ do máy chủ ghi; chỉ huy trưởng duyệt mới tính tiền.</small>
          </section>
        );
      })}
      {step && <CameraDialog step={step} onClose={() => setStep(null)} onSubmit={async (photo) => {
        try {
          await (step.kind === "in" ? store.checkIn(step.context.projectId, step.fix, photo) : store.checkOut(step.context.projectId, step.fix, photo));
          setNotice(step.kind === "in" ? "Đã chấm Vào." : "Đã chấm Ra.", "success");
          setStep(null);
          await reload();
        } catch (error) { setStep(null); setProblem(errorMessage(error)); }
      }} />}
    </div>
  );
}

function CameraDialog(props: { step: Step; onClose: () => void; onSubmit: (photo: Blob) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) { queueMicrotask(() => setError(projectText("CHECKIN_NO_CAMERA"))); return; }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false }).then((media) => {
      if (!active) { media.getTracks().forEach((track) => track.stop()); return; }
      stream = media;
      if (video.current) { video.current.srcObject = media; void video.current.play(); }
    }, () => { if (active) setError(projectText("CHECKIN_NO_CAMERA")); });
    return () => { active = false; stream?.getTracks().forEach((track) => track.stop()); };
  }, [attempt]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const shoot = async () => {
    if (!video.current || !video.current.videoWidth) return;
    const blob = await capture(video.current);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="cam-title" style={{ maxWidth: 480 }}>
        <header><h2 id="cam-title"><Camera className="ico" size={18} aria-hidden="true" /> Chụp ảnh chấm {props.step.kind === "in" ? "Vào" : "Ra"}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button></header>
        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          <small className="muted">Vị trí hợp lệ: cách công trường {props.step.distance} m{props.step.fix.accuracy ? ` (sai số GPS ~${props.step.fix.accuracy} m)` : ""} · <a href={mapsLink(props.step.fix.lat, props.step.fix.lng)} target="_blank" rel="noreferrer">xem bản đồ</a></small>
          {error && <p className="form-error" role="alert">{error} <button type="button" className="link-button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Thử lại</button></p>}
          {/* Video luôn gắn để chụp lại không phải mở camera lần nữa */}
          <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 8, background: "#000", transform: "scaleX(-1)", display: photo || error ? "none" : "block" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo.url} alt="Ảnh vừa chụp" style={{ width: "100%", borderRadius: 8 }} />}
        </div>
        <footer>
          {photo ? <>
            <button type="button" className="button" disabled={sending} onClick={() => setPhoto(null)}><RefreshCw className="ico" size={16} aria-hidden="true" /> Chụp lại</button>
            <button type="button" className="button primary" disabled={sending} onClick={() => { setSending(true); void props.onSubmit(photo.blob).finally(() => setSending(false)); }}>{sending ? "Đang gửi…" : `Gửi chấm ${props.step.kind === "in" ? "Vào" : "Ra"}`}</button>
          </> : <button type="button" className="button primary" disabled={!!error} onClick={() => void shoot()}><Camera className="ico" size={16} aria-hidden="true" /> Chụp</button>}
        </footer>
      </section>
    </div>
  );
}
