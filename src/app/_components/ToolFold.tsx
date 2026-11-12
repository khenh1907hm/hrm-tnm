import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";

/**
 * Thẻ công cụ thu gọn: chỉ hiện biểu tượng, tên, mô tả ngắn; bấm để mở / đóng.
 * Nội dung chỉ dựng khi mở lần đầu (công cụ nặng như Sơ đồ tổ chức không tải dữ liệu khi chưa cần).
 */
export function ToolFold(props: { icon: ReactNode; title: string; summary: string; children: ReactNode; defaultOpen?: boolean; id?: string }) {
  const [opened, setOpened] = useState(props.defaultOpen ?? false);
  const ref = useRef<HTMLDetailsElement>(null);
  // Liên kết tới #id (vd từ tab hướng dẫn) thì tự mở thẻ
  useEffect(() => {
    if (!props.id) return;
    const openIfTarget = () => { if (window.location.hash === `#${props.id}` && ref.current) { ref.current.open = true; ref.current.scrollIntoView({ behavior: "smooth", block: "start" }); } };
    openIfTarget();
    window.addEventListener("hashchange", openIfTarget);
    return () => window.removeEventListener("hashchange", openIfTarget);
  }, [props.id]);
  return (
    <details ref={ref} className="panel tool-fold" id={props.id} open={props.defaultOpen} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary>
        <span className="tool-fold-icon" aria-hidden="true">{props.icon}</span>
        <span className="tool-fold-text"><b>{props.title}</b><small>{props.summary}</small></span>
        <ChevronDown className="tool-fold-chevron" size={20} aria-hidden="true" />
      </summary>
      <div className="tool-fold-body">{opened ? props.children : null}</div>
    </details>
  );
}

/** Một dòng lệnh kèm nút chép. */
export function CopyCmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };
  return (
    <div className="mcp-cmd">
      <code>{text}</code>
      <button type="button" className="button" onClick={copy} aria-label="Chép lệnh">
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? "Đã chép" : "Chép"}
      </button>
    </div>
  );
}
