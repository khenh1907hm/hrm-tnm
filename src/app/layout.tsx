import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quản lý nhân sự Thiên Nhật Minh",
  description: "Hệ thống quản lý hồ sơ nhân sự và chứng chỉ Thiên Nhật Minh.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
