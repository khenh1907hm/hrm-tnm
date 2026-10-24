import { Camera, ExternalLink } from "lucide-react";

/**
 * Thẻ công cụ "Ảnh Trước / Sau công trình" trên trang Công cụ.
 * Công cụ là trang tĩnh public/before-after.html (chạy toàn bộ trên điện thoại: camera, canh góc,
 * bảng Before/After, xuất Word/Excel). Mở trang riêng để camera chiếm trọn màn hình điện thoại.
 */
export function BeforeAfterTool() {
  return (
    <article className="panel tool-card">
      <header className="tool-card-head">
        <Camera size={20} aria-hidden="true" />
        <div>
          <h2>Ảnh Trước / Sau công trình</h2>
          <p className="muted">Chụp ảnh hiện trạng và sau thi công theo từng hạng mục, canh đúng góc cũ (bật/tắt được), xem hai ảnh cạnh nhau, lập bảng Before / After kèm ghi chú địa chỉ rồi xuất Word hoặc Excel. Ảnh lưu lên hệ thống, cả đội cùng xem.</p>
        </div>
      </header>
      <div>
        <a className="button primary" href="/before-after.html">
          <ExternalLink className="ico" size={16} aria-hidden="true" /> Mở công cụ
        </a>
      </div>
    </article>
  );
}
