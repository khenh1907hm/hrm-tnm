import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Be Vietnam Pro tự lưu trữ từ public/fonts (dùng chung với bản xuất PDF)
const beVietnamPro = localFont({
  src: [
    { path: "../../public/fonts/BeVietnamPro-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Be_Vietnam_Pro/BeVietnamPro-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Be_Vietnam_Pro/BeVietnamPro-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/BeVietnamPro-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quản lý nhân sự Thiên Nhật Minh",
  description: "Hệ thống quản lý hồ sơ nhân sự và chứng chỉ Thiên Nhật Minh.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>{children}</body>
    </html>
  );
}
