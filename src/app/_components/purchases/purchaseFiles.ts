"use client";
import { getSupabaseClient } from "../../../lib/supabase/client";

/**
 * Tệp đính kèm lưu ở kho riêng tư của Supabase, đường dẫn `<id phiếu>/<loại>-<thời điểm>-<tên>`.
 * Dùng chung cho đơn hàng (bucket purchase-files, bảng purchase_attachments) và Confirm Contract (project-files, contract_attachments).
 */
export type Attachment = { id: string; parentId: string; kind: string; path: string; fileName: string; sizeBytes: number; uploadedByName: string; createdAt: string };
export type AttachmentKindInfo = { kind: string; label: string; required: boolean };
export type AttachmentApi = {
  list(parentId: string): Promise<Attachment[]>;
  upload(parentId: string, kind: string, file: File): Promise<void>;
  remove(item: Attachment): Promise<void>;
  open(item: Attachment): Promise<void>;
};

type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** Tên tệp an toàn cho kho lưu trữ (bỏ dấu, ký tự lạ). */
export function storageName(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (base || "tep").slice(-80);
}

export const filesAvailable = () => getSupabaseClient() !== null;

export function attachmentApi(bucket: string, table: string, parentColumn: string): AttachmentApi {
  return {
    async list(parentId) {
      const client = getSupabaseClient();
      if (!client) return [];
      const { data, error } = await client.from(table).select("*").eq(parentColumn, parentId).order("created_at");
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map((row) => ({
        id: str(row.id), parentId: str(row[parentColumn]), kind: str(row.kind), path: str(row.path), fileName: str(row.file_name),
        sizeBytes: Number(row.size_bytes ?? 0), uploadedByName: str(row.uploaded_by_name), createdAt: str(row.created_at),
      }));
    },
    async upload(parentId, kind, file) {
      const client = getSupabaseClient();
      if (!client) return;
      if (file.size > 25 * 1024 * 1024) throw new Error(`Tệp ${file.name} lớn hơn 25 MB.`);
      const path = `${parentId}/${kind}-${Date.now()}-${storageName(file.name)}`;
      const { error: upload } = await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (upload) throw new Error(`Không tải được tệp ${file.name}: ${upload.message}`);
      const { data: user } = await client.auth.getUser();
      const name = str(user.user?.user_metadata?.full_name) || str(user.user?.email);
      const { error } = await client.from(table).insert({ [parentColumn]: parentId, kind, path, file_name: file.name, size_bytes: file.size, uploaded_by: user.user?.id, uploaded_by_name: name });
      if (error) {
        await client.storage.from(bucket).remove([path]);
        throw new Error(`Không lưu được tệp ${file.name}: ${error.message}`);
      }
    },
    async remove(item) {
      const client = getSupabaseClient();
      if (!client) return;
      const { error } = await client.from(table).delete().eq("id", item.id);
      if (error) throw new Error(error.message);
      await client.storage.from(bucket).remove([item.path]);
    },
    async open(item) {
      const client = getSupabaseClient();
      if (!client) return;
      const { data, error } = await client.storage.from(bucket).createSignedUrl(item.path, 600);
      if (error || !data) throw new Error("Không mở được tệp.");
      window.open(data.signedUrl, "_blank", "noopener");
    },
  };
}

/** Đơn hàng: 4 loại tệp (giống mục đính kèm trên biểu mẫu công ty). */
export type AttachmentKind = "signed_quote" | "tnm_quote" | "master_schedule" | "drawing";
export const ATTACHMENT_KINDS: readonly AttachmentKindInfo[] = [
  { kind: "signed_quote", label: "Báo giá có ký xác nhận hoặc PO/Hợp đồng", required: true },
  { kind: "tnm_quote", label: "Báo giá TNM gửi có ký đóng dấu", required: false },
  { kind: "master_schedule", label: "Tiến độ tổng", required: false },
  { kind: "drawing", label: "Bản vẽ", required: false },
];
export const purchaseFiles = attachmentApi("purchase-files", "purchase_attachments", "order_id");
export type PurchaseAttachment = Attachment;
export const listAttachments = (orderId: string) => purchaseFiles.list(orderId);
export const uploadAttachment = (orderId: string, kind: string, file: File) => purchaseFiles.upload(orderId, kind, file);

/** Báo cáo giải thích (P-COST-05): tệp bằng chứng, lý do. */
export const explanatoryFiles = attachmentApi("project-files", "explanatory_attachments", "report_id");

/** Confirm Contract (P-COST-01). */
export const contractFiles = attachmentApi("project-files", "contract_attachments", "contract_id");

export const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
