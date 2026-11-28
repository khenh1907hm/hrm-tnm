/**
 * Báo cáo công trình (QHSE PHOTO REPORT): Sếp kiểm tra công trường chụp lỗi, PM khắc phục, chụp ảnh sau.
 * Dùng chung kiểu với app điện thoại (mobile/src/lib/inspection.ts giữ bản sao cùng cấu trúc).
 */
export type MarkShape = "circle" | "rect";
/** Một nét khoanh trên ảnh, tọa độ theo tỉ lệ 0..1 của chiều rộng / cao ảnh. */
export type PhotoMark = { shape: MarkShape; x: number; y: number; w: number; h: number; color?: string };
export const MARK_COLOR = "#ef2b2b";

export type InspectionStatus = "draft" | "open" | "fixed" | "closed";
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  draft: "Nháp", open: "Chờ khắc phục", fixed: "Đã khắc phục, chờ kiểm tra", closed: "Đã đóng",
};

export type InspectionItem = {
  id: string; seq: number; location: string; foundTime: string; problem: string; countermeasure: string; targetDate: string | null;
  beforePhoto: string | null; beforeMarks: PhotoMark[]; afterPhoto: string | null; afterMarks: PhotoMark[];
  comment: string; finishDate: string | null; fixedByName: string; fixedAt: string | null;
};
export type Inspection = {
  id: string; projectId: string; number: string; checkDate: string; reporterId: string; reporterName: string;
  attentionEmployeeId: string | null; attentionName: string; cc: string; status: InspectionStatus; note: string;
  submittedAt: string | null; fixedAt: string | null; closedAt: string | null; createdAt: string;
  /** Logo trái trên file Excel (thư viện logo nhà thầu); logo phải = chứng nhận ISO của TNM, bật / tắt. */
  leftLogoId: string | null; showCertLogo: boolean;
  items: InspectionItem[];
};
/** assignee: người nhận báo cáo (Sếp lập → PM; PM lập → chỉ huy trưởng). canCreate: người đang xem lập được báo cáo cho dự án này. */
export type InspectionProject = {
  projectId: string; code: string; name: string; site: string; status: string; pmEmployeeId: string | null; pmName: string;
  canCreate: boolean; assigneeEmployeeId: string | null; assigneeName: string; assigneeIsCommander: boolean;
};

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
/** Đọc nét khoanh từ JSON (bỏ giá trị lạ, giới hạn 0..1, tối đa 30 nét). */
export function parseMarks(raw: unknown): PhotoMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).flatMap((item) => {
    const mark = (item ?? {}) as Record<string, unknown>;
    if (mark.shape !== "circle" && mark.shape !== "rect") return [];
    const x = clamp(Number(mark.x)), y = clamp(Number(mark.y));
    const w = Math.min(clamp(Number(mark.w)), 1 - x), h = Math.min(clamp(Number(mark.h)), 1 - y);
    if (w < 0.005 || h < 0.005) return [];
    return [{ shape: mark.shape, x, y, w, h, ...(typeof mark.color === "string" && /^#[0-9a-f]{6}$/i.test(mark.color) ? { color: mark.color } : {}) }];
  });
}

/** Nét từ hai điểm kéo (tỉ lệ 0..1), không phụ thuộc chiều kéo. */
export function markFromDrag(shape: MarkShape, from: { x: number; y: number }, to: { x: number; y: number }): PhotoMark | null {
  const x = clamp(Math.min(from.x, to.x)), y = clamp(Math.min(from.y, to.y));
  const w = clamp(Math.abs(to.x - from.x)), h = clamp(Math.abs(to.y - from.y));
  if (w < 0.01 && h < 0.01) return null;
  return { shape, x, y, w: Math.max(w, 0.02), h: Math.max(h, 0.02) };
}

/** Lỗi chặn khi gửi phiếu / báo đã sửa, null nếu được. */
export function submitIssue(inspection: Pick<Inspection, "items" | "attentionEmployeeId">): string | null {
  if (!inspection.items.length) return "Chưa có lỗi nào: thêm ít nhất một lỗi (ảnh + vấn đề).";
  if (!inspection.attentionEmployeeId) return "Chưa có người nhận (trưởng dự án). Chọn người khắc phục.";
  const missing = inspection.items.findIndex((item) => !item.beforePhoto || item.problem.trim().length < 2);
  return missing >= 0 ? `Lỗi ${missing + 1}: cần ảnh và nội dung Vấn đề.` : null;
}
export function fixIssue(items: readonly Pick<InspectionItem, "afterPhoto" | "finishDate">[]): string | null {
  const missing = items.findIndex((item) => !item.afterPhoto || !item.finishDate);
  return missing >= 0 ? `Lỗi ${missing + 1}: cần ảnh sau khi sửa và ngày hoàn thành.` : null;
}

/** Tiêu đề báo cáo theo tên dự án. */
export const inspectionTitle = (project: { code: string; name: string } | null | undefined) => `Báo cáo công trình · ${project ? `${project.code} ${project.name}` : ""}`.trim();
