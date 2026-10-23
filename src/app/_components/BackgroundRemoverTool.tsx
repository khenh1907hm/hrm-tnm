import { Stamp } from "lucide-react";
import { BackgroundRemover } from "./BackgroundRemover";

/** Công cụ tách nền trên trang Công cụ: ảnh chụp chữ ký / con dấu → PNG nền trong suốt để tải về. */
export function BackgroundRemoverTool() {
  return (
    <article className="panel tool-card">
      <header className="tool-card-head">
        <Stamp size={20} aria-hidden="true" />
        <div><h2>Tách nền chữ ký &amp; con dấu</h2><p className="muted">Chụp chữ ký, mộc trên giấy (kể cả có bóng tay, giấy ngả vàng) → ảnh PNG nền trong suốt để chèn vào văn bản. Ảnh không gửi đi đâu, xử lý ngay trên máy.</p></div>
      </header>
      <BackgroundRemover maxWidth={1600} downloadable />
    </article>
  );
}
