import { useState } from "react";
import { Building2, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { PARTNER_IMAGE_MAX_BYTES, PARTNER_NAME_MAX, type Partner } from "../../modules/partners/types";
import type { PartnerStore } from "./usePartners";

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });

/** Ảnh quá 2 MB thì thu nhỏ (cạnh dài tối đa 1600 px) thay vì bắt người dùng tự cắt. */
async function toPartnerImage(file: File): Promise<string> {
  if (file.size <= PARTNER_IMAGE_MAX_BYTES) return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) throw new Error("Không thu nhỏ được ảnh.");
  return readAsDataUrl(blob);
}

type Draft = { id?: string; name: string; image: string };

/** Quản lý đối tác (tên + ảnh) để chọn nhanh làm ảnh dự án trong mẫu hồ sơ. */
export function PartnersPanel(props: { store: PartnerStore; setNotice: (message: string) => void }) {
  const { partners, loaded, save, remove } = props.store;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const chooseImage = async (file: File | undefined) => {
    if (!file || !draft) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) { setError("Chỉ nhận ảnh PNG hoặc JPG."); return; }
    try { setError(""); setDraft({ ...draft, image: await toPartnerImage(file) }); }
    catch { setError("Không đọc được ảnh, hãy chọn ảnh khác."); }
  };

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    const problem = await save(draft);
    setBusy(false);
    if (problem) { setError(problem); return; }
    props.setNotice(draft.id ? "Đã lưu đối tác." : "Đã thêm đối tác.");
    setDraft(null);
  };

  const confirmRemove = async (partner: Partner) => {
    if (!window.confirm(`Xóa đối tác “${partner.name}”? Ảnh đã chèn vào các mẫu hồ sơ vẫn giữ nguyên.`)) return;
    const problem = await remove(partner.id);
    props.setNotice(problem ?? "Đã xóa đối tác.");
  };

  return (
    <section className="panel partners-panel" aria-labelledby="partners-title">
      <div className="partners-head">
        <div>
          <h2 id="partners-title"><Building2 className="ico" size={18} aria-hidden="true" /> Đối tác</h2>
          <p className="muted">Lưu tên và ảnh (logo, ảnh dự án) của từng đối tác. Khi sửa mẫu hồ sơ, ở trường ảnh chọn “Ảnh đối tác” để thay ảnh dự án ngay.</p>
        </div>
        {!draft && <button type="button" className="button primary" onClick={() => { setDraft({ name: "", image: "" }); setError(""); }}><Plus className="ico" size={16} aria-hidden="true" /> Thêm đối tác</button>}
      </div>

      {draft && (
        <div className="partner-form">
          <div className="partner-thumb checkerboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {draft.image ? <img src={draft.image} alt="Ảnh đối tác" /> : <span className="muted">Chưa có ảnh</span>}
          </div>
          <div className="partner-form-fields">
            <label className="field"><span>Tên đối tác *</span><input value={draft.name} maxLength={PARTNER_NAME_MAX} autoFocus placeholder="vd: Taikisha Việt Nam" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <div className="button-row">
              <label className="button"><ImagePlus className="ico" size={16} aria-hidden="true" /> {draft.image ? "Đổi ảnh" : "Chọn ảnh"}
                <input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { void chooseImage(event.target.files?.[0]); event.target.value = ""; }} />
              </label>
              {draft.image && <button type="button" className="button danger" onClick={() => setDraft({ ...draft, image: "" })}>Bỏ ảnh</button>}
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="button-row">
              <button type="button" className="button" onClick={() => { setDraft(null); setError(""); }}>Hủy</button>
              <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? "Đang lưu…" : draft.id ? "Lưu thay đổi" : "Lưu đối tác"}</button>
            </div>
          </div>
        </div>
      )}

      {!loaded ? <p className="muted">Đang tải…</p> : partners.length === 0 ? <p className="muted">Chưa có đối tác nào.</p> : (
        <ul className="partner-grid">
          {partners.map((partner) => (
            <li key={partner.id} className="partner-card">
              <div className="partner-thumb checkerboard">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {partner.image ? <img src={partner.image} alt={`Ảnh ${partner.name}`} /> : <span className="muted">Chưa có ảnh</span>}
              </div>
              <b>{partner.name}</b>
              <div className="partner-actions">
                <button type="button" className="button icon-button" aria-label={`Sửa ${partner.name}`} onClick={() => { setDraft({ id: partner.id, name: partner.name, image: partner.image }); setError(""); }}><Pencil size={14} aria-hidden="true" /></button>
                <button type="button" className="button danger icon-button" aria-label={`Xóa ${partner.name}`} onClick={() => void confirmRemove(partner)}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
