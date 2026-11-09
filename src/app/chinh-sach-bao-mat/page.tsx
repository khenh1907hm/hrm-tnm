import type { Metadata } from "next";
import Image from "next/image";
import "./privacy.css";

export const metadata: Metadata = {
  title: "Chính sách bảo mật · Quản trị Online TNM",
  description: "Chính sách bảo mật của ứng dụng TNM Automation và hệ thống Quản trị Online TNM – Công ty TNHH Thiên Nhật Minh.",
};

const UPDATED = "09/11/2026";
const CONTACT_EMAIL = "hminh19072003@gmail.com";

/** Trang công khai (không cần đăng nhập) để khai báo trên màn hình đồng ý OAuth của Google. */
export default function PrivacyPolicyPage() {
  return (
    <main className="pp-wrap">
      <header className="pp-head">
        <Image src="/tnm-emblem.png" alt="Logo Thiên Nhật Minh" width={240} height={150} className="pp-logo" priority />
        <div>
          <p className="pp-eyebrow">Công ty TNHH Thiên Nhật Minh</p>
          <h1>Chính sách bảo mật</h1>
          <p className="pp-meta">Áp dụng cho ứng dụng <b>TNM Automation</b> và hệ thống <b>Quản trị Online TNM</b> · Cập nhật {UPDATED}</p>
        </div>
      </header>

      <section>
        <h2>1. Phạm vi</h2>
        <p>
          TNM Automation là công cụ tự động hóa nội bộ của Công ty TNHH Thiên Nhật Minh (“TNM”, “chúng tôi”), chạy trên máy chủ do TNM quản lý
          tại <b>tnm.com.vn</b>. Ứng dụng chỉ dành cho nhân viên TNM, dùng để tự động hóa công việc như gửi email thông báo, lưu và đọc tài liệu,
          cập nhật bảng tính và lịch làm việc. Chính sách này giải thích chúng tôi truy cập, sử dụng, lưu trữ và bảo vệ dữ liệu ra sao.
        </p>
      </section>

      <section>
        <h2>2. Dữ liệu Google mà ứng dụng truy cập</h2>
        <p>Khi bạn bấm <b>“Sign in with Google”</b> và đồng ý, ứng dụng chỉ được truy cập những dịch vụ bạn cho phép trên màn hình của Google:</p>
        <ul>
          <li><b>Thông tin tài khoản cơ bản</b>: tên, địa chỉ email – để biết kết nối thuộc về ai.</li>
          <li><b>Gmail</b>: đọc, soạn và gửi email theo các quy trình bạn hoặc quản trị viên thiết lập (ví dụ gửi thông báo chứng chỉ sắp hết hạn).</li>
          <li><b>Google Drive, Docs, Sheets</b>: tạo, đọc và cập nhật tệp, bảng tính dùng trong quy trình làm việc.</li>
          <li><b>Google Calendar</b>: đọc và tạo sự kiện lịch phục vụ công việc.</li>
        </ul>
        <p>Ứng dụng không truy cập dịch vụ nào bạn chưa cho phép, và chỉ xử lý dữ liệu khi một quy trình tự động cần đến.</p>
      </section>

      <section>
        <h2>3. Mục đích sử dụng</h2>
        <p>Dữ liệu chỉ được dùng để thực hiện các quy trình tự động hóa công việc nội bộ mà người dùng yêu cầu. Chúng tôi <b>không</b>:</p>
        <ul>
          <li>bán, cho thuê hoặc chia sẻ dữ liệu cho bên thứ ba;</li>
          <li>dùng dữ liệu cho quảng cáo, kể cả quảng cáo nhắm mục tiêu;</li>
          <li>dùng dữ liệu để đánh giá tín dụng hay cho vay;</li>
          <li>dùng dữ liệu Google để huấn luyện mô hình trí tuệ nhân tạo dùng chung;</li>
          <li>cho người khác đọc dữ liệu của bạn, trừ khi bạn đồng ý, khi cần để xử lý sự cố bảo mật, hoặc khi pháp luật yêu cầu.</li>
        </ul>
      </section>

      <section>
        <h2>4. Tuân thủ chính sách dữ liệu người dùng của Google</h2>
        <p>
          Việc TNM Automation sử dụng và chuyển giao thông tin nhận được từ Google API cho bất kỳ ứng dụng nào khác sẽ tuân thủ{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Chính sách dữ liệu người dùng của Google API Services</a>,
          bao gồm các yêu cầu về <b>Sử dụng có giới hạn (Limited Use)</b>.
        </p>
      </section>

      <section>
        <h2>5. Lưu trữ và bảo mật</h2>
        <ul>
          <li>Mã truy cập (token) Google được mã hóa và lưu trên máy chủ của TNM; không ghi ra tệp công khai và không gửi qua email hay tin nhắn.</li>
          <li>Kết nối giữa trình duyệt, máy chủ và Google luôn dùng HTTPS.</li>
          <li>Chỉ quản trị viên được TNM chỉ định mới có quyền quản trị máy chủ.</li>
          <li>Dữ liệu xử lý trong quy trình chỉ được giữ trong thời gian cần thiết để hoàn thành công việc, sau đó xóa hoặc chỉ giữ nhật ký kỹ thuật tối thiểu.</li>
        </ul>
      </section>

      <section>
        <h2>6. Thu hồi quyền và yêu cầu xóa dữ liệu</h2>
        <ul>
          <li>Bạn có thể thu hồi quyền bất cứ lúc nào tại <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>, chọn <b>TNM Automation</b> rồi bấm <b>Xóa quyền truy cập</b>.</li>
          <li>Để yêu cầu xóa token và dữ liệu liên quan trên máy chủ TNM, gửi email tới địa chỉ ở mục 8. Chúng tôi xử lý trong vòng 30 ngày.</li>
        </ul>
      </section>

      <section>
        <h2>7. Dữ liệu nhân sự trong Quản trị Online TNM</h2>
        <p>
          Hồ sơ nhân sự, chứng chỉ và chữ ký trong hệ thống Quản trị Online TNM chỉ dùng cho công tác quản lý nhân sự của TNM, chỉ người được phân quyền
          mới xem được, và được xử lý theo quy định của pháp luật Việt Nam về bảo vệ dữ liệu cá nhân.
        </p>
      </section>

      <section>
        <h2>8. Liên hệ</h2>
        <address>
          <b>Công ty TNHH Thiên Nhật Minh</b><br />
          75 Nguyễn Cửu Đàm, Phường Tân Sơn Nhì, TP. Hồ Chí Minh, Việt Nam<br />
          Điện thoại: (028) 3812 6990<br />
          Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </address>
        <p className="pp-meta">Chính sách có thể được cập nhật; ngày cập nhật mới nhất luôn ghi ở đầu trang.</p>
      </section>

      <section lang="en" className="pp-en">
        <h2>English summary</h2>
        <p>
          TNM Automation is an internal workflow tool of Thien Nhat Minh Co., Ltd., used only by our employees. With your consent it accesses your basic
          Google profile, Gmail, Drive, Docs, Sheets and Calendar solely to run work automations you or our administrators set up. We do not sell or share
          this data, use it for advertising, or use it to train generalized AI models. Tokens are stored encrypted on servers controlled by TNM and sent only
          over HTTPS. TNM Automation’s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
          including the Limited Use requirements. You can revoke access at any time at myaccount.google.com/permissions, or email {CONTACT_EMAIL} to request
          deletion of your data (handled within 30 days).
        </p>
      </section>
    </main>
  );
}
