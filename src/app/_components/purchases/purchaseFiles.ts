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
  /** Nội dung tệp (để gộp PDF, xem từng trang). */
  download(item: Attachment): Promise<Uint8Array>;
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
    async download(item) {
      const client = getSupabaseClient();
      if (!client) throw new Error("Không tải được tệp.");
      const { data, error } = await client.storage.from(bucket).download(item.path);
      if (error || !data) throw new Error(`Không tải được tệp ${item.fileName}.`);
      return new Uint8Array(await data.arrayBuffer());
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

/** Đơn hàng: báo giá NCC có ký (bắt buộc) và file so sánh giá. Loại cũ (báo giá TNM, tiến độ, bản vẽ) chỉ còn để xem tệp đã đính kèm trước đây. */
export type AttachmentKind = "signed_quote" | "price_comparison" | "tnm_quote" | "master_schedule" | "drawing"
  | "po_signed" | "tracking" | "delivery" | "stock" | "docs" | "payment_proof" | "other";
export const ATTACHMENT_KINDS: readonly AttachmentKindInfo[] = [
  { kind: "signed_quote", label: "Báo giá có ký xác nhận hoặc PO/Hợp đồng", required: true },
  { kind: "price_comparison", label: "File so sánh giá", required: false },
];
/**
 * Tệp lưu theo từng bước của đơn (ảnh chụp, PDF, bản scan): bấm vào bước trên thanh tiến trình để xem / thêm.
 * Khóa là bước của thanh tiến trình (PathKey trong modules/purchases/flow).
 */
export const STEP_FILE_KINDS: Readonly<Record<string, readonly AttachmentKindInfo[]>> = {
  draft: ATTACHMENT_KINDS, submitted: ATTACHMENT_KINDS, approved: ATTACHMENT_KINDS,
  po: [{ kind: "po_signed", label: "PO có chữ ký NCC (bản scan / ảnh)", required: false }],
  ordered: [{ kind: "tracking", label: "Ảnh đơn hàng, xác nhận giao hàng của NCC", required: false }],
  received: [{ kind: "delivery", label: "Biên bản giao nhận, ảnh hàng nhận, kiểm đếm", required: false }],
  stocked: [{ kind: "stock", label: "Phiếu nhập kho, ảnh hàng trong kho", required: false }],
  docs: [{ kind: "docs", label: "Hóa đơn GTGT, CO/CQ, chứng từ giao hàng", required: false }],
  advance_pay: [{ kind: "payment_proof", label: "Chứng từ chi (UNC, phiếu chi)", required: false }],
  prepayment_pay: [{ kind: "payment_proof", label: "Chứng từ chi (UNC, phiếu chi)", required: false }],
  final_pay: [{ kind: "payment_proof", label: "Chứng từ chi (UNC, phiếu chi)", required: false }],
  completed: [{ kind: "other", label: "Tài liệu khác", required: false }],
};
export const STEP_FILE_LABELS: Record<string, string> = { po_signed: "PO có NCC ký", tracking: "Theo dõi đơn hàng", delivery: "Nhận hàng, kiểm đếm", stock: "Nhập kho", docs: "Hóa đơn, chứng từ", payment_proof: "Chứng từ chi", other: "Tài liệu khác" };

/** Tên các loại tệp đã bỏ, để vẫn hiện (chỉ xem) tệp đính kèm trước đây. */
export const LEGACY_ATTACHMENT_LABELS: Record<string, string> = { tnm_quote: "Báo giá TNM gửi có ký đóng dấu", master_schedule: "Tiến độ tổng", drawing: "Bản vẽ", signed_quote: "Báo giá có ký xác nhận hoặc PO/Hợp đồng", price_comparison: "File so sánh giá", ...STEP_FILE_LABELS };
export const purchaseFiles = attachmentApi("purchase-files", "purchase_attachments", "order_id");
export type PurchaseAttachment = Attachment;
export const listAttachments = (orderId: string) => purchaseFiles.list(orderId);
export const uploadAttachment = (orderId: string, kind: string, file: File) => purchaseFiles.upload(orderId, kind, file);

/** Báo cáo giải thích (P-COST-05): tệp bằng chứng, lý do. */
export const explanatoryFiles = attachmentApi("project-files", "explanatory_attachments", "report_id");

/** Confirm Contract (P-COST-01). */
export const contractFiles = attachmentApi("project-files", "contract_attachments", "contract_id");

export const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
