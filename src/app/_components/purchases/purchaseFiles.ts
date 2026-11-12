"use client";
import { getSupabaseClient } from "../../../lib/supabase/client";

/** 4 loại tệp của đơn hàng (giống mục đính kèm trên biểu mẫu công ty). */
export type AttachmentKind = "signed_quote" | "tnm_quote" | "master_schedule" | "drawing";
export const ATTACHMENT_KINDS: readonly { kind: AttachmentKind; label: string; required: boolean }[] = [
  { kind: "signed_quote", label: "Báo giá có ký xác nhận hoặc PO/Hợp đồng", required: true },
  { kind: "tnm_quote", label: "Báo giá TNM gửi có ký đóng dấu", required: false },
  { kind: "master_schedule", label: "Tiến độ tổng", required: false },
  { kind: "drawing", label: "Bản vẽ", required: false },
];
export type PurchaseAttachment = { id: string; orderId: string; kind: AttachmentKind; path: string; fileName: string; sizeBytes: number; uploadedByName: string; createdAt: string };

const BUCKET = "purchase-files";
type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** Tên tệp an toàn cho kho lưu trữ (bỏ dấu, ký tự lạ). */
export function storageName(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (base || "tep").slice(-80);
}

export const filesAvailable = () => getSupabaseClient() !== null;

export async function listAttachments(orderId: string): Promise<PurchaseAttachment[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.from("purchase_attachments").select("*").eq("order_id", orderId).order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id), orderId: str(row.order_id), kind: str(row.kind) as AttachmentKind, path: str(row.path), fileName: str(row.file_name),
    sizeBytes: Number(row.size_bytes ?? 0), uploadedByName: str(row.uploaded_by_name), createdAt: str(row.created_at),
  }));
}

export async function uploadAttachment(orderId: string, kind: AttachmentKind, file: File): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  if (file.size > 25 * 1024 * 1024) throw new Error(`Tệp ${file.name} lớn hơn 25 MB.`);
  const path = `${orderId}/${kind}-${Date.now()}-${storageName(file.name)}`;
  const { error: upload } = await client.storage.from(BUCKET).upload(path, file, { upsert: false, ...(file.type ? { contentType: file.type } : {}) });
  if (upload) throw new Error(`Không tải được tệp ${file.name}: ${upload.message}`);
  const { data: user } = await client.auth.getUser();
  const name = str(user.user?.user_metadata?.full_name) || str(user.user?.email);
  const { error } = await client.from("purchase_attachments").insert({ order_id: orderId, kind, path, file_name: file.name, size_bytes: file.size, uploaded_by: user.user?.id, uploaded_by_name: name });
  if (error) {
    await client.storage.from(BUCKET).remove([path]);
    throw new Error(`Không lưu được tệp ${file.name}: ${error.message}`);
  }
}

export async function removeAttachment(item: PurchaseAttachment): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const { error } = await client.from("purchase_attachments").delete().eq("id", item.id);
  if (error) throw new Error(error.message);
  await client.storage.from(BUCKET).remove([item.path]);
}

/** Mở tệp (liên kết tạm 10 phút). */
export async function openAttachment(item: PurchaseAttachment): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(item.path, 600);
  if (error || !data) throw new Error("Không mở được tệp.");
  window.open(data.signedUrl, "_blank", "noopener");
}

export const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
