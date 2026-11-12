import { ExternalLink } from "lucide-react";

/**
 * Nội dung thẻ "Ảnh Trước / Sau công trình" trên trang Công cụ (tên và mô tả ngắn nằm ở thẻ thu gọn ToolFold).
 * Công cụ là trang tĩnh public/before-after.html (chạy toàn bộ trên điện thoại: camera, canh góc,
 * bảng Before/After, xuất Word/Excel). Mở trang riêng để camera chiếm trọn màn hình điện thoại.
 */
export function BeforeAfterTool() {
  return (
    <div className="tool-fold-content">
      <p className="muted">Chụp ảnh hiện trạng và sau thi công theo từng hạng mục, đối chiếu ảnh cũ khi chụp (chồng mờ bật/tắt được), xem hai ảnh cạnh nhau, lập bảng Before / After kèm ghi chú địa chỉ rồi xuất Word hoặc Excel. Ảnh lưu lên hệ thống, cả đội cùng xem.</p>
      <div>
        <a className="button primary" href="/before-after.html">
          <ExternalLink className="ico" size={16} aria-hidden="true" /> Mở công cụ
        </a>
      </div>
    </div>
  );
}
