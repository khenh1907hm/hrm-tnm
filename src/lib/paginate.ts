/**
 * Hợp đồng phân trang dùng chung (offset, không cursor) cho mọi danh sách:
 * pageSize mặc định 20, trần cứng 100 (vượt thì cắt, không báo lỗi);
 * page < 1 hoặc không phải số → 1; page vượt tổng số trang → trang cuối (không trả rỗng);
 * sắp xếp luôn có khóa phụ `id` để thứ tự ổn định giữa các trang.
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type PageInput = { page?: number | undefined; pageSize?: number | undefined };
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

export function normalizePageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

/** Chuẩn hóa số trang theo tổng số dòng đã lọc (`total`). */
export function normalizePage(value: number | undefined, total: number, pageSize: number): { page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requested = value === undefined || Number.isNaN(value) ? 1 : value === Number.POSITIVE_INFINITY ? totalPages : Math.floor(value);
  return { page: Math.min(totalPages, Math.max(1, requested)), totalPages };
}

export function paginate<T extends { id: string }>(rows: readonly T[], input: PageInput & { compare: (a: T, b: T) => number; direction?: "asc" | "desc" | undefined }): Page<T> {
  const pageSize = normalizePageSize(input.pageSize);
  const direction = input.direction === "desc" ? -1 : 1;
  const sorted = [...rows].sort((a, b) => (input.compare(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) * direction);
  const { page, totalPages } = normalizePage(input.page, sorted.length, pageSize);
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize, totalPages };
}
