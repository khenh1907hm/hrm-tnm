import type { CertificateExportConfig, CertificateExportGroup } from "./types";

/**
 * Nhóm mặc định khi mẫu chưa cài: ba chứng chỉ an toàn gộp chung một tệp
 * (Sức khỏe làm việc trên cao, An toàn điện, An toàn lao động).
 */
export const DEFAULT_CERTIFICATE_GROUPS: readonly CertificateExportGroup[] = [
  { id: "an-toan", name: "An toàn", types: ["custom-ctype-height-health", "elec", "atld"] },
];

/** Nhóm đang dùng: mẫu đã cài (kể cả danh sách rỗng = không gộp) thì theo mẫu, chưa cài thì nhóm mặc định. */
export function certificateGroups(config: CertificateExportConfig | undefined): readonly CertificateExportGroup[] {
  return (config?.groups ?? DEFAULT_CERTIFICATE_GROUPS).filter((group) => group.types.length > 0);
}

/** Một loại chỉ thuộc nhóm đầu tiên có nó (nếu cài trùng). */
export function groupOfType(groups: readonly CertificateExportGroup[], type: string): CertificateExportGroup | undefined {
  return groups.find((group) => group.types.includes(type));
}

export type CertificateUnit<T> = { id: string; items: T[]; group?: CertificateExportGroup };

/**
 * Gom danh sách (đã sắp) thành các "đơn vị" xuất: chứng chỉ lẻ là một đơn vị; các chứng chỉ cùng nhóm thành một đơn vị
 * đứng ở vị trí chứng chỉ đầu tiên của nhóm, giữ thứ tự tương đối bên trong nhóm.
 */
export function certificateUnits<T>(items: readonly T[], typeOf: (item: T) => string, idOf: (item: T) => string, groups: readonly CertificateExportGroup[]): CertificateUnit<T>[] {
  const units: CertificateUnit<T>[] = [];
  const byGroup = new Map<string, CertificateUnit<T>>();
  for (const item of items) {
    const group = groupOfType(groups, typeOf(item));
    if (!group) { units.push({ id: idOf(item), items: [item] }); continue; }
    const existing = byGroup.get(group.id);
    if (existing) { existing.items.push(item); continue; }
    const unit: CertificateUnit<T> = { id: `group:${group.id}`, items: [item], group };
    byGroup.set(group.id, unit);
    units.push(unit);
  }
  return units;
}

/** Thứ tự đơn vị sau khi kéo/chọn số → thứ tự từng chứng chỉ. */
export function expandUnitOrder<T>(unitIds: readonly string[], units: readonly CertificateUnit<T>[], idOf: (item: T) => string): string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  return unitIds.flatMap((id) => byId.get(id)?.items.map(idOf) ?? []);
}
