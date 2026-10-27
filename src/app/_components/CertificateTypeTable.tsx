import { GripVertical } from "lucide-react";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import { POSITIONS } from "../../modules/employees/types";
import { useDragReorder } from "./useDragReorder";

/** "Bắt buộc cho": gọn thành Tất cả / — / N chức danh (rê chuột xem danh sách). */
function requiredLabel(type: CertificateTypeRecord): string {
  if (!type.requiredForPositions.length) return "—";
  if (type.requiredForPositions.length === POSITIONS.length) return "Tất cả";
  return type.requiredForPositions.length === 1 ? type.requiredForPositions[0]! : `${type.requiredForPositions.length} chức danh`;
}

/**
 * Bảng loại chứng chỉ, Admin kéo tay nắm ⋮⋮ để đổi thứ tự (chuột và cảm ứng), hoặc chọn tay nắm rồi bấm ↑/↓.
 * Thả xong mới lưu một lần (onReorder); loại đã ẩn luôn nằm cuối và không kéo được.
 */
export function CertificateTypeTable(props: { types: CertificateTypeRecord[]; isAdmin: boolean; onEdit: (type: CertificateTypeRecord) => void; onHide: (type: CertificateTypeRecord) => void; onReorder: (orderedIds: string[]) => Promise<void> }) {
  const active = props.types.filter((type) => !type.archived);
  const hidden = props.types.filter((type) => type.archived);
  const { order, draggingId, handleProps } = useDragReorder(active.map((type) => type.id), props.onReorder);
  const byId = new Map(active.map((type) => [type.id, type]));
  const rows = [...order.flatMap((id) => byId.get(id) ?? []), ...hidden];

  return (
    <div className="table-scroll">
      <table className="ctype-table">
        <thead><tr>{props.isAdmin && <th aria-label="Kéo để sắp xếp" />}<th>Loại chứng chỉ</th><th>Bắt buộc cho</th>{props.isAdmin && <th />}</tr></thead>
        <tbody>
          {rows.map((type) => (
            <tr key={type.id} {...(type.archived ? {} : { "data-reorder-id": type.id })} className={type.id === draggingId ? "ctype-row dragging" : "ctype-row"}>
              {props.isAdmin && <td className="ctype-handle-cell">{!type.archived && (
                <button type="button" className="drag-handle" aria-label={`Kéo để đổi thứ tự ${type.name} (hoặc bấm ↑/↓)`} title="Kéo để đổi thứ tự" {...handleProps(type.id)}>
                  <GripVertical className="ico" size={16} aria-hidden="true" />
                </button>
              )}</td>}
              <td>
                <b>{type.name}</b>
                {type.noExpiry && <span className="pill">Không thời hạn</span>}
                {type.archived && <span className="pill bad">Đã ẩn</span>}
                {type.englishName && <small className="muted ctype-english">{type.englishName}</small>}
              </td>
              <td title={type.requiredForPositions.join(", ") || undefined}>{requiredLabel(type)}</td>
              {props.isAdmin && <td className="ctype-actions">
                <button type="button" className="button" onClick={() => props.onEdit(type)}>Sửa</button>
                {!type.archived && !type.system && <button type="button" className="button danger" onClick={() => props.onHide(type)}>Ẩn</button>}
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
