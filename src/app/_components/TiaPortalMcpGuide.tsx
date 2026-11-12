import { useState } from "react";
import { Check, Copy, Cpu, ExternalLink } from "lucide-react";

const REPO = "https://github.com/bulaofen0036-coder/TIA_Portal_Openness_MCP";

/** Một dòng lệnh kèm nút chép. */
function Cmd({ text }: { text: string }) {
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

/**
 * Thẻ "TIA Portal MCP cho Claude" trên trang Công cụ: hướng dẫn tải và cài bộ MCP mã nguồn mở
 * bulaofen0036-coder/TIA_Portal_Openness_MCP để Claude điều khiển Siemens TIA Portal V20/V21 (lập trình PLC, HMI).
 */
export function TiaPortalMcpGuide() {
  return (
    <article className="panel tool-card mcp-guide">
      <header className="tool-card-head">
        <Cpu size={20} aria-hidden="true" />
        <div>
          <h2>TIA Portal MCP cho Claude (lập trình PLC Siemens)</h2>
          <p className="muted">Bộ MCP mã nguồn mở (MIT) giúp Claude Desktop / Claude Code điều khiển trực tiếp Siemens TIA Portal V20, V21 qua Openness: tạo project, viết khối PLC, sinh HMI, compile và đọc lỗi. Không liên kết với Siemens; nên thử trên bản sao project trước.</p>
        </div>
      </header>

      <details>
        <summary>Xem hướng dẫn tải và cài đặt</summary>
        <ol className="mcp-steps">
          <li>
            <b>Chuẩn bị máy</b>
            <ul>
              <li>Windows đã cài <b>TIA Portal V20 hoặc V21</b> (kèm TIA Openness, chọn khi cài TIA).</li>
              <li><b>.NET Framework 4.8</b> (Windows 10/11 thường có sẵn).</li>
              <li><b>Claude Desktop</b> hoặc <b>Claude Code</b> đã đăng nhập.</li>
            </ul>
          </li>
          <li>
            <b>Thêm tài khoản Windows vào nhóm “Siemens TIA Openness”</b>
            <p>Mở Command Prompt bằng <i>Run as administrator</i> rồi chạy lệnh dưới. Xong phải <b>Sign out rồi đăng nhập lại Windows</b> thì mới có hiệu lực.</p>
            <Cmd text={'net localgroup "Siemens TIA Openness" %USERNAME% /add'} />
          </li>
          <li>
            <b>Tải bộ cài</b>
            <p>Vào trang <a href={`${REPO}/releases`} target="_blank" rel="noreferrer">Releases</a> trên GitHub, tải file <b>.zip</b> bản mới nhất (người dùng V20 bắt buộc tải zip vì bản V20 không có trong mã nguồn). Giải nén vào thư mục không dấu, không khoảng trắng, ví dụ:</p>
            <Cmd text="C:\TIA_MCP" />
          </li>
          <li>
            <b>Kiểm tra máy</b>
            <p>Mở Command Prompt tại thư mục vừa giải nén và chạy (V20 dùng <code>tia-v20.cmd</code>). Thêm <code>--fix</code> để tự sửa lỗi nhóm Openness.</p>
            <Cmd text="cd /d C:\TIA_MCP && tia.cmd doctor" />
          </li>
          <li>
            <b>Kết nối vào Claude</b>
            <p>Cách nhanh: nhấp đúp <code>配置MCP.bat</code> (V20: <code>配置MCP-v20.bat</code>) trong thư mục giải nén. Công cụ tự tìm Claude Desktop, Claude Code, Cursor, VS Code, sao lưu cấu hình cũ thành <code>.bak</code> rồi thêm server. Hoặc chạy lệnh:</p>
            <Cmd text="tia.cmd config" />
            <p>Chỉ cấu hình cho Claude Code bằng tay (V21):</p>
            <Cmd text={'claude mcp add tia-portal -- "C:\\TIA_MCP\\tools\\tiaportal-mcp\\src\\TiaMcpServer\\bin\\Release\\net48\\TiaMcpServer.exe"'} />
            <p>V20 đổi <code>bin\Release</code> thành <code>bin-v20\Release</code>. Máy cài nhiều bản TIA thì thêm <code>--tia-major-version 20</code> (hoặc 21) vào cuối.</p>
          </li>
          <li>
            <b>Khởi động lại Claude và dùng thử</b>
            <p>Tắt hẳn rồi mở lại Claude, kiểm tra server “tia-portal” đã bật. Nhắn ví dụ: <i>“Kết nối TIA Portal, mở project D:\PLC\Demo.ap21 và liệt kê các khối trong CPU.”</i> Trình tự Claude gọi: Bootstrap → Connect → OpenProject → GetProjectTree.</p>
            <p>Mẹo: nhấp đúp <code>scripts\预热.bat</code> và để cửa sổ mở, các lệnh sau kết nối khoảng 1 giây thay vì 3 phút.</p>
          </li>
        </ol>
        <p className="muted mcp-note">Chỉ muốn Claude đọc, không sửa project: thêm biến môi trường <code>TIA_MCP_READ_ONLY=1</code> hoặc tham số <code>--read-only</code>. Có 235 công cụ; mặc định chỉ hiện 65 công cụ chính, <code>tia.cmd config --full</code> để hiện tất cả.</p>
      </details>

      <div className="mcp-actions">
        <a className="button primary" href={`${REPO}/releases`} target="_blank" rel="noreferrer">
          <ExternalLink className="ico" size={16} aria-hidden="true" /> Tải bản mới nhất
        </a>
        <a className="button" href={REPO} target="_blank" rel="noreferrer">
          <ExternalLink className="ico" size={16} aria-hidden="true" /> Trang GitHub
        </a>
      </div>
    </article>
  );
}
