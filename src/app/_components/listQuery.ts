import { normalizePageSize } from "../../lib/paginate";
import type { CertificateHealth, EmployeeSort } from "../../app-core/createHrApp";
import type { EmploymentStatus } from "../../modules/employees/types";
import { DEFAULT_EMPLOYEE_FILTERS, type EmployeeFilters } from "./EmployeeListView";

const STATUSES: readonly EmploymentStatus[] = ["active", "on_leave", "resigned"];
const HEALTH: readonly CertificateHealth[] = ["ok", "missing", "expiring", "expired"];
const SORTS: readonly EmployeeSort[] = ["code", "name", "startDate"];

/**
 * Bộ lọc danh sách nhân sự ↔ query trên URL (/nhan-su?page=3&q=nguyen), để Back, F5 và chia sẻ link
 * đều về đúng chỗ. Chỉ ghi các giá trị khác mặc định; giá trị lạ trên URL thì bỏ qua.
 */
export function filtersToSearch(filters: EmployeeFilters): string {
  const params = new URLSearchParams();
  const d = DEFAULT_EMPLOYEE_FILTERS;
  if (filters.query.trim()) params.set("q", filters.query);
  for (const value of filters.positions) params.append("pos", value);
  for (const value of filters.statuses) params.append("st", value);
  for (const value of filters.certificateHealth) params.append("cert", value);
  for (const value of filters.certificateTypes) params.append("type", value);
  if (filters.certificateTypeMode !== d.certificateTypeMode) params.set("mode", filters.certificateTypeMode);
  if (filters.includeArchived) params.set("archived", "1");
  if (filters.sort !== d.sort) params.set("sort", filters.sort);
  if (filters.sortDir !== d.sortDir) params.set("dir", filters.sortDir);
  if (filters.pageSize !== d.pageSize) params.set("size", String(filters.pageSize));
  if (filters.page > 1) params.set("page", String(filters.page));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function filtersFromSearch(search: string): EmployeeFilters {
  const params = new URLSearchParams(search);
  const d = DEFAULT_EMPLOYEE_FILTERS;
  const pick = <T extends string>(allowed: readonly T[], values: string[]) => values.filter((value): value is T => (allowed as readonly string[]).includes(value));
  const page = Math.floor(Number(params.get("page") ?? "1"));
  const size = params.get("size");
  const sort = params.get("sort");
  return {
    query: params.get("q") ?? "",
    positions: params.getAll("pos"),
    statuses: pick(STATUSES, params.getAll("st")),
    certificateHealth: pick(HEALTH, params.getAll("cert")),
    certificateTypes: params.getAll("type"),
    certificateTypeMode: params.get("mode") === "all" ? "all" : "any",
    includeArchived: params.get("archived") === "1",
    sort: sort && (SORTS as readonly string[]).includes(sort) ? sort as EmployeeSort : d.sort,
    sortDir: params.get("dir") === "desc" ? "desc" : "asc",
    pageSize: size === null ? d.pageSize : normalizePageSize(Number(size)),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}
