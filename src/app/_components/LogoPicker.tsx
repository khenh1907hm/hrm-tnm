"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { getSupabaseClient } from "../../lib/supabase/client";

/**
 * Thư viện logo nhà thầu / khách hàng dùng chung cho các mẫu báo cáo (bảng company_logos, kho ảnh công khai company-logos).
 * Chọn logo đã lưu, hoặc tải logo mới (đặt tên) rồi dùng luôn; logo đã lưu dùng lại được ở mọi phiếu.
 */
export type CompanyLogo = { id: string; name: string; path: string; url: string; createdBy: string | null };
const BUCKET = "company-logos";
type Row = Record<string, unknown>;

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error("Thư viện logo cần đăng nhập (chế độ thật).");
  return value;
}
export const logoUrl = (path: string) => client().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

export async function listLogos(): Promise<CompanyLogo[]> {
  const { data, error } = await client().from("company_logos").select("id, name, path, created_by").order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name ?? ""), path: String(row.path ?? ""), url: logoUrl(String(row.path ?? "")), createdBy: row.created_by ? String(row.created_by) : null }));
}

export async function uploadLogo(name: string, file: File): Promise<CompanyLogo> {
  const supabase = client();
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Logo cần là ảnh PNG, JPG hoặc WEBP.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Logo tối đa 2 MB.");
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error: upload } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload) throw new Error(upload.message);
  const { data, error } = await supabase.from("company_logos").insert({ name: name.trim(), path }).select("id, name, path, created_by").single();
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
  const row = data as Row;
  return { id: String(row.id), name: String(row.name), path, url: logoUrl(path), createdBy: row.created_by ? String(row.created_by) : null };
}

export async function deleteLogo(logo: CompanyLogo) {
  const supabase = client();
  const { error } = await supabase.from("company_logos").delete().eq("id", logo.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([logo.path]);
}

/** Ảnh logo (PNG giữ nguyên, ảnh khác đổi sang PNG) kèm kích thước, để chèn vào file Excel. */
export async function logoImage(url: string): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Không đọc được logo."))), "image/png"));
  return { bytes: new Uint8Array(await png.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/** Chọn logo trong thư viện (bấm vào ô logo) hoặc tải logo mới. value null = không chèn logo. */
export function LogoPicker(props: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean; onError: (message: string) => void }) {
  const { onError } = props;
  const [logos, setLogos] = useState<CompanyLogo[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void listLogos().then((list) => { if (active) setLogos(list); }, (error: unknown) => { if (active) { setLogos([]); onError(error instanceof Error ? error.message : "Không tải được thư viện logo."); } });
    void getSupabaseClient()?.auth.getUser().then(({ data }) => { if (active) setMe(data.user?.id ?? null); });
    return () => { active = false; };
  }, [onError]);
  const upload = async (file: File) => {
    const label = name.trim() || file.name.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const logo = await uploadLogo(label, file);
      setLogos((list) => [...(list ?? []), logo].sort((a, b) => a.name.localeCompare(b.name, "vi")));
      setName("");
      props.onChange(logo.id);
    } catch (error) { onError(error instanceof Error ? error.message : "Không tải được logo."); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  return (
    <div className="logo-picker">
      <div className="logo-grid" role="radiogroup" aria-label="Chọn logo">
        <button type="button" role="radio" aria-checked={props.value === null} className="logo-tile logo-none" disabled={props.disabled} onClick={() => props.onChange(null)}>Không có logo</button>
        {(logos ?? []).map((logo) => (
          <span key={logo.id} className="logo-tile-wrap">
            <button type="button" role="radio" aria-checked={props.value === logo.id} className="logo-tile" disabled={props.disabled} title={logo.name} onClick={() => props.onChange(logo.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh logo từ kho công khai Supabase */}
              <img src={logo.url} alt={logo.name} />
              <small>{logo.name}</small>
            </button>
            {!props.disabled && logo.createdBy === me && props.value !== logo.id && <button type="button" className="icon-link logo-remove" aria-label={`Xóa logo ${logo.name}`} title="Xóa khỏi thư viện" onClick={() => {
              if (!window.confirm(`Xóa logo "${logo.name}" khỏi thư viện? Phiếu đang dùng logo này sẽ không còn logo.`)) return;
              void deleteLogo(logo).then(() => setLogos((list) => (list ?? []).filter((item) => item.id !== logo.id)), (error: unknown) => onError(error instanceof Error ? error.message : "Không xóa được."));
            }}><Trash2 size={13} aria-hidden="true" /></button>}
          </span>
        ))}
        {logos === null && <small className="muted">Đang tải thư viện logo…</small>}
      </div>
      {!props.disabled && <div className="logo-upload">
        <input value={name} placeholder="Tên nhà thầu, vd Taikisha Vietnam" aria-label="Tên logo mới" onChange={(event) => setName(event.target.value)} />
        <button type="button" className="button" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={15} aria-hidden="true" /> {busy ? "Đang tải lên…" : "Lưu logo mới"}</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      </div>}
    </div>
  );
}
