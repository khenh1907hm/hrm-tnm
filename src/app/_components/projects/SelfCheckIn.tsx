"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, LogIn, LogOut, MapPin, RefreshCw, X } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { dayKind } from "../../../modules/projects/calendar";
import { distanceM, formatMinutes, hoursFromCheck, mapsLink, vnClock, withinSite, type AttendanceContext, type GpsFix } from "../../../modules/projects/attendance";
import { formatHours } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Holiday } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, projectText } from "./projectShared";

type Step = { kind: "in" | "out"; context: AttendanceContext; fix: GpsFix; distance: number };

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
  if (!contexts.length) return <div className="panel empty-state"><p><b>Bạn chưa được thêm vào dự án nào đang thi công.</b></p><small className="muted">Muốn chấm công, nhờ chỉ huy trưởng hoặc PM thêm bạn vào dự án (tab Sơ đồ &amp; thành viên của dự án). Sau đó mở lại trang này để bấm Chấm Vào.</small></div>;

  return (
    <div className="ts-sheet">
      {problem && <p className="form-error panel" role="alert" style={{ padding: 12 }}>{problem}</p>}
      {busy && <p className="muted" role="status">{busy}</p>}
      {contexts.map((context) => {
        const kind = dayKind(today, context.weeklyOff, props.holidays);
        const done = context.today;
        const hours = done ? hoursFromCheck({ workDate: today, checkInAt: done.checkInAt, checkOutAt: done.checkOutAt }, context.schedule, kind) : null;
        return (
          <section key={context.projectId} className="panel ts-head" aria-label={`Chấm công ${context.code}`}>
            <b>{context.code} · {context.name}</b>
            <span className="muted">{context.team ? `${context.team} · ` : ""}Giờ làm {context.schedule.workStart}–{context.schedule.workEnd}, nghỉ trưa {context.schedule.lunchStart}–{context.schedule.lunchEnd}{kind !== "workday" ? " · Hôm nay là ngày nghỉ: giờ làm tính tăng ca" : ""}</span>
            {done ? (
              <p style={{ margin: 0 }}>
                Vào <b>{vnClock(done.checkInAt)}</b> (cách {done.inDistanceM} m)
                {done.checkOutAt ? <> · Ra <b>{vnClock(done.checkOutAt)}</b> (cách {done.outDistanceM} m)</> : " · chưa chấm Ra"}
                {hours && <><br /><span className="muted">Tạm tính: {formatHours(hours.regularHours)} giờ thường{hours.otHours ? `, ${formatHours(hours.otHours)} giờ tăng ca` : ""}{hours.late ? ` · đi muộn ${formatMinutes(hours.late)}` : ""}{hours.incomplete ? " (chưa chấm Ra)" : ""}. Chỉ huy trưởng duyệt mới tính tiền.</span></>}
              </p>
            ) : <p className="muted" style={{ margin: 0 }}>Hôm nay bạn chưa chấm công.</p>}
            <div className="button-row">
              {!done && <button type="button" className="button primary" style={{ minHeight: 48, flex: 1 }} disabled={busy !== null} onClick={() => void start("in", context)}><LogIn className="ico" size={18} aria-hidden="true" /> Chấm Vào</button>}
              {done && !done.checkOutAt && <button type="button" className="button primary" style={{ minHeight: 48, flex: 1 }} disabled={busy !== null} onClick={() => void start("out", context)}><LogOut className="ico" size={18} aria-hidden="true" /> Chấm Ra</button>}
              {done?.checkOutAt && <span className="pill ok">Đã chấm đủ Vào và Ra hôm nay</span>}
            </div>
            <small className="muted"><MapPin className="ico" size={13} aria-hidden="true" /> Phải bật định vị (GPS), đứng trong {context.siteRadiusM} m quanh công trường và chụp ảnh khuôn mặt tại chỗ.</small>
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
