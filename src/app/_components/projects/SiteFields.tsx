"use client";
import { useState } from "react";
import { Crosshair, ExternalLink, Link2, MapPin } from "lucide-react";
import { isShortMapsLink, mapsEmbedUrl, mapsOpenUrl, parseCoordinates, type LatLng } from "../../../lib/mapsLink";
import type { ProjectInput } from "../../../modules/projects/types";

const RADIUS_PRESETS = [
  { meters: 100, hint: "Văn phòng, kho nhỏ" },
  { meters: 200, hint: "Công trình nhà xưởng nhỏ" },
  { meters: 300, hint: "Nhà máy thông thường (mặc định)" },
  { meters: 500, hint: "Nhà máy lớn, nhiều khu" },
  { meters: 1000, hint: "Khu công nghiệp, tuyến dài" },
] as const;

type Props = { draft: ProjectInput; set: <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => void };

/**
 * Giờ làm và vị trí công trường cho tự chấm công GPS (PRJ-14, PRJ-15, MAPS-01).
 * Ba cách đặt vị trí, không cần hiểu vĩ độ / kinh độ: đứng tại công trường bấm "Lấy vị trí hiện tại",
 * hoặc dán link chia sẻ từ Google Maps (kể cả link rút gọn maps.app.goo.gl), hoặc dán 2 con số tọa độ.
 */
export function SiteFields({ draft, set }: Props) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const point: LatLng | null = draft.siteLat !== null && draft.siteLng !== null ? { lat: draft.siteLat, lng: draft.siteLng } : null;
  const apply = (found: LatLng, how: string) => { set("siteLat", found.lat); set("siteLng", found.lng); setStatus({ tone: "ok", text: `Đã đặt vị trí công trường ${how}. Kiểm tra lại điểm ghim trên bản đồ bên dưới.` }); };

  const readLink = async (value: string) => {
    const text = value.trim();
    if (!text) return;
    const direct = parseCoordinates(text);
    if (direct) { apply(direct, "từ link"); return; }
    if (isShortMapsLink(text)) {
      setStatus({ tone: "info", text: "Đang mở link rút gọn của Google Maps…" });
      try {
        const response = await fetch(`/api/maps-link?url=${encodeURIComponent(text)}`);
        const body = await response.json() as { ok: boolean; lat?: number; lng?: number; message?: string };
        if (body.ok && body.lat !== undefined && body.lng !== undefined) apply({ lat: body.lat, lng: body.lng }, "từ link chia sẻ");
        else setStatus({ tone: "bad", text: body.message ?? "Không đọc được link." });
      } catch { setStatus({ tone: "bad", text: "Không mở được link (mất mạng?). Thử dán 2 con số tọa độ." }); }
      return;
    }
    setStatus({ tone: "bad", text: "Link hoặc chữ này không có tọa độ. Làm theo hướng dẫn bên dưới: nhấn giữ đúng điểm công trường trên Google Maps rồi sao chép." });
  };

  const useHere = () => {
    if (!navigator.geolocation) { setStatus({ tone: "bad", text: "Trình duyệt không hỗ trợ định vị." }); return; }
    setStatus({ tone: "info", text: "Đang lấy vị trí của bạn…" });
    navigator.geolocation.getCurrentPosition(
      (position) => { apply({ lat: Number(position.coords.latitude.toFixed(6)), lng: Number(position.coords.longitude.toFixed(6)) }, `theo vị trí của bạn (sai số khoảng ${Math.round(position.coords.accuracy)} m)`); },
      () => setStatus({ tone: "bad", text: "Không lấy được vị trí: hãy bật định vị và cho phép trình duyệt truy cập vị trí." }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <fieldset className="site-fields" style={{ gridColumn: "1 / -1", marginBottom: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "grid", gap: 12 }}>
      <legend style={{ fontWeight: 600, padding: "0 6px" }}><MapPin className="ico" size={16} aria-hidden="true" /> Vị trí công trường và giờ làm (để nhân viên tự chấm công)</legend>

      <div className="form-grid" style={{ padding: 0 }}>
        <label className="field"><span>Giờ bắt đầu làm</span><input type="time" value={draft.workStart} onChange={(event) => set("workStart", event.target.value)} /></label>
        <label className="field"><span>Giờ kết thúc (sau giờ này tính tăng ca)</span><input type="time" value={draft.workEnd} onChange={(event) => set("workEnd", event.target.value)} /></label>
        <label className="field"><span>Nghỉ trưa từ</span><input type="time" value={draft.lunchStart} onChange={(event) => set("lunchStart", event.target.value)} /></label>
        <label className="field"><span>Nghỉ trưa đến</span><input type="time" value={draft.lunchEnd} onChange={(event) => set("lunchEnd", event.target.value)} /></label>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <b>Đặt vị trí công trường: chọn một trong hai cách</b>
        <div className="button-row">
          <button type="button" className="button" onClick={useHere}><Crosshair className="ico" size={16} aria-hidden="true" /> Cách 1: Lấy vị trí hiện tại (khi đang đứng ở công trường)</button>
        </div>
        <label className="field" style={{ margin: 0 }}>
          <span>Cách 2: Dán link Google Maps hoặc tọa độ</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ flex: 1 }} value={link} placeholder="vd: https://maps.app.goo.gl/… hoặc 11.104700, 106.692600" onChange={(event) => setLink(event.target.value)}
              onPaste={(event) => { const pasted = event.clipboardData.getData("text"); window.setTimeout(() => void readLink(pasted), 0); }} />
            <button type="button" className="button" onClick={() => void readLink(link)}><Link2 className="ico" size={16} aria-hidden="true" /> Đọc vị trí</button>
          </div>
        </label>
        {status && <p role="status" className={status.tone === "bad" ? "form-error" : status.tone === "ok" ? "ok-text" : "muted"} style={{ margin: 0 }}>{status.text}</p>}
        <details>
          <summary>Hướng dẫn lấy link Google Maps (bấm để xem)</summary>
          <ol style={{ margin: "8px 0", paddingLeft: 20, display: "grid", gap: 4 }}>
            <li>Mở Google Maps (trên điện thoại hoặc máy tính), tìm tới công trường.</li>
            <li><b>Nhấn giữ</b> (điện thoại) hoặc <b>bấm chuột phải</b> (máy tính) vào đúng chỗ cổng hoặc giữa công trường để thả ghim đỏ.</li>
            <li>Điện thoại: bấm <b>Chia sẻ</b> → <b>Sao chép đường liên kết</b>. Máy tính: bấm vào dòng 2 con số đầu tiên (vd 11.10470, 106.69260) để sao chép.</li>
            <li>Dán vào ô “Cách 2” ở trên. Hệ thống tự đọc ra vị trí và hiện bản đồ để bạn kiểm tra.</li>
          </ol>
          <small className="muted">Link Google Maps chứa sẵn 2 con số vĩ độ và kinh độ của điểm ghim, nên không cần tự gõ. Nếu dán link tên địa điểm (không có ghim) mà báo không đọc được, hãy thả ghim rồi sao chép lại.</small>
        </details>
      </div>

      {point ? (
        <div style={{ display: "grid", gap: 6 }}>
          <iframe title="Bản đồ vị trí công trường" src={mapsEmbedUrl(point, draft.siteRadiusM > 500 ? 15 : 16)} style={{ width: "100%", height: 220, border: "1px solid var(--line)", borderRadius: 8 }} />
          <small className="muted">Vị trí: {point.lat}, {point.lng} · <a href={mapsOpenUrl(point)} target="_blank" rel="noreferrer">Mở Google Maps <ExternalLink className="ico" size={12} aria-hidden="true" /></a> · <button type="button" className="link-button" onClick={() => { set("siteLat", null); set("siteLng", null); setStatus(null); }}>Xóa vị trí</button></small>
        </div>
      ) : <p className="warn-text" style={{ margin: 0 }}>Chưa đặt vị trí: nhân viên chưa tự chấm công GPS được ở dự án này.</p>}

      <div style={{ display: "grid", gap: 6 }}>
        <b>Bán kính được phép chấm công: {draft.siteRadiusM} m quanh điểm ghim</b>
        <div className="role-switch" role="group" aria-label="Bán kính" style={{ flexWrap: "wrap" }}>
          {RADIUS_PRESETS.map((preset) => <button key={preset.meters} type="button" aria-pressed={draft.siteRadiusM === preset.meters} title={preset.hint} onClick={() => set("siteRadiusM", preset.meters)}>{preset.meters >= 1000 ? `${preset.meters / 1000} km` : `${preset.meters} m`}</button>)}
        </div>
        <label className="field" style={{ margin: 0, maxWidth: 220 }}><span>Hoặc nhập số mét (50–5000)</span><input type="number" min={50} max={5000} step={50} value={draft.siteRadiusM} onChange={(event) => set("siteRadiusM", Math.min(5000, Math.max(50, Number(event.target.value) || 300)))} /></label>
        <small className="muted">
          Nhân viên đứng trong vòng <b>{draft.siteRadiusM} m</b> quanh điểm ghim mới bấm chấm công được; xa hơn thì bị chặn và báo cách bao nhiêu mét.
          GPS điện thoại thường lệch 10–50 m (trong nhà xưởng có thể lệch hơn), nên đặt tối thiểu 150–200 m. Công trường rộng (nhà máy, khu công nghiệp) đặt 300–500 m
          để người làm ở góc xa vẫn chấm được.{RADIUS_PRESETS.find((preset) => preset.meters === draft.siteRadiusM) ? ` Gợi ý: ${RADIUS_PRESETS.find((preset) => preset.meters === draft.siteRadiusM)!.hint.toLowerCase()}.` : ""}
        </small>
      </div>

      <details>
        <summary>Nhập tọa độ bằng tay (nâng cao)</summary>
        <div className="form-grid" style={{ padding: "8px 0 0" }}>
          <label className="field"><span>Vĩ độ (latitude)</span><input inputMode="decimal" placeholder="vd: 11.104700" value={draft.siteLat ?? ""} onChange={(event) => { const value = Number(event.target.value.replace(",", ".")); set("siteLat", event.target.value.trim() === "" || !Number.isFinite(value) ? null : value); }} /></label>
          <label className="field"><span>Kinh độ (longitude)</span><input inputMode="decimal" placeholder="vd: 106.692600" value={draft.siteLng ?? ""} onChange={(event) => { const value = Number(event.target.value.replace(",", ".")); set("siteLng", event.target.value.trim() === "" || !Number.isFinite(value) ? null : value); }} /></label>
        </div>
      </details>
    </fieldset>
  );
}
