import type { Metadata } from "next";
import HrmClient from "../hrm-client";
import { ToastProvider } from "../_components/Toast";

export const metadata: Metadata = {
  title: "Kho Skill AI · Thiên Nhật Minh",
  description: "Thư viện gói skill .zip cho Claude, kèm mô tả, ảnh minh họa và hướng dẫn cài đặt.",
};

/** Đã đăng nhập: Kho Skill nằm trong khung app có sidebar. Chưa đăng nhập: trang công khai. */
export default function SkillsPage() {
  return (
    <ToastProvider>
      <HrmClient />
    </ToastProvider>
  );
}
