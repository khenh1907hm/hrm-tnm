import { CopyCmd } from "./ToolFold";

/**
 * Hướng dẫn chung: tải một công cụ / skill từ GitHub về máy Windows (3 cách), mở khóa file tải về,
 * cập nhật bản mới và kiểm tra an toàn. Dùng cho mọi công cụ AI cài từ GitHub trong Kho Skill AI.
 */
export function GithubDownloadGuide() {
  return (
    <div className="gh-guide">
      <p className="muted">GitHub là nơi các nhóm đăng mã nguồn và bản cài công cụ. Không cần tài khoản GitHub để tải. Chọn <b>một</b> trong ba cách dưới; nếu hướng dẫn của công cụ nói rõ cách nào thì làm theo cách đó.</p>

      <h3>Cách 1 · Tải bản phát hành (Releases), nên dùng</h3>
      <ol className="mcp-steps">
        <li>Mở trang GitHub của công cụ (nút <b>Trang GitHub</b> trong từng hướng dẫn).</li>
        <li>Cột bên phải, mục <b>Releases</b>, bấm vào bản có nhãn <b>Latest</b>. Không thấy cột phải (điện thoại) thì kéo xuống cuối trang hoặc thêm <code>/releases</code> vào cuối địa chỉ.</li>
        <li>Kéo xuống phần <b>Assets</b>, bấm file <b>.zip</b> của công cụ (thường có tên công cụ và số phiên bản). <b>Không</b> chọn “Source code (zip)” trừ khi hướng dẫn yêu cầu: đó là mã nguồn chưa đóng gói, thường phải tự build.</li>
        <li><b>Mở khóa file</b> trước khi giải nén: chuột phải file .zip → <b>Properties</b> → tick <b>Unblock</b> → OK. Không làm bước này, Windows có thể chặn các file .exe / .dll bên trong và công cụ báo lỗi khó hiểu.</li>
        <li>Chuột phải → <b>Extract All…</b>, giải nén vào thư mục <b>không dấu, không khoảng trắng</b>, ví dụ:
          <CopyCmd text="C:\Tools\ten-cong-cu" />
        </li>
      </ol>

      <h3>Cách 2 · Tải mã nguồn dạng ZIP</h3>
      <ol className="mcp-steps">
        <li>Ở trang chính của công cụ, bấm nút xanh <b>&lt;&gt; Code</b> → <b>Download ZIP</b>.</li>
        <li>File tải về có đuôi <code>-main</code> hoặc <code>-master</code> (ví dụ <code>ten-cong-cu-main.zip</code>). Mở khóa và giải nén như Cách 1, rồi đổi tên thư mục bỏ đuôi <code>-main</code>.</li>
        <li>Cách này lấy bản đang phát triển, có thể chưa ổn định và không tự cập nhật. Chỉ dùng khi công cụ không có mục Releases.</li>
      </ol>

      <h3>Cách 3 · Dùng Git (dễ cập nhật về sau)</h3>
      <ol className="mcp-steps">
        <li>Cài Git một lần. Mở <b>PowerShell</b> và chạy (hoặc tải ở git-scm.com):
          <CopyCmd text="winget install --id Git.Git -e" />
          Đóng và mở lại PowerShell, gõ <code>git --version</code> thấy số phiên bản là được.
        </li>
        <li>Tải công cụ về thư mục mong muốn (thay địa chỉ bằng địa chỉ trang GitHub của công cụ):
          <CopyCmd text="git clone https://github.com/ten-tac-gia/ten-cong-cu.git C:\Tools\ten-cong-cu" />
        </li>
        <li>Khi có bản mới, vào thư mục đó và kéo về:
          <CopyCmd text="cd C:\Tools\ten-cong-cu; git pull" />
        </li>
      </ol>

      <h3>Mở khóa cả thư mục bằng một lệnh</h3>
      <p className="muted">Quên tick Unblock trước khi giải nén thì chạy lệnh này trong PowerShell (đổi đường dẫn cho đúng):</p>
      <CopyCmd text="Get-ChildItem -Recurse 'C:\Tools\ten-cong-cu' | Unblock-File" />

      <h3>Cập nhật bản mới</h3>
      <ul className="gh-list">
        <li>Cách 1 / 2: tải lại file .zip mới, giải nén sang thư mục mới, chạy thử ổn rồi mới xóa thư mục cũ. Nếu công cụ có file cấu hình riêng (.env, config.json…) thì chép sang.</li>
        <li>Cách 3: chạy <code>git pull</code> như trên.</li>
        <li>Bấm <b>Watch → Custom → Releases</b> trên trang GitHub (cần tài khoản) để được báo khi có bản mới.</li>
      </ul>

      <h3>Kiểm tra an toàn trước khi chạy</h3>
      <ul className="gh-list">
        <li>Chỉ tải công cụ có trong Kho Skill AI hoặc được IT duyệt. Xem số sao (★), ngày cập nhật gần nhất, đọc <b>README</b> và mục <b>Issues</b>.</li>
        <li>Quét virus file .zip (chuột phải → Scan with Microsoft Defender).</li>
        <li>Windows hiện “Windows protected your PC”: chỉ bấm <b>More info → Run anyway</b> khi chắc chắn nguồn tin cậy.</li>
        <li>Không chạy công cụ bằng quyền Administrator nếu hướng dẫn không yêu cầu. Thử trên bản sao dữ liệu / project trước.</li>
      </ul>

      <h3>Skill (SKILL.md) đăng trên GitHub</h3>
      <ol className="mcp-steps">
        <li>Tải repo về bằng một trong ba cách trên, tìm thư mục có file <code>SKILL.md</code> (thường nằm trong <code>skills/ten-skill/</code>).</li>
        <li><b>Claude web / app, ChatGPT, Gemini:</b> chuột phải đúng thư mục <code>ten-skill</code> → <b>Send to → Compressed (zipped) folder</b>. File .zip phải chứa thư mục <code>ten-skill/SKILL.md</code>, không nén cả repo. Sau đó cài như tab tương ứng ở mục “Cách cài skill”.</li>
        <li><b>Claude Code:</b> chép thư mục <code>ten-skill</code> vào <code>%USERPROFILE%\.claude\skills\</code>. Nếu repo là plugin marketplace, gõ trong Claude Code:
          <CopyCmd text="/plugin marketplace add ten-tac-gia/ten-repo" />
          rồi <code>/plugin</code> để chọn và cài.
        </li>
      </ol>
    </div>
  );
}
