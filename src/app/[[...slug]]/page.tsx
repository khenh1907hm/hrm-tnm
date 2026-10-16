import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HrmClient from "../hrm-client";
import { ToastProvider } from "../_components/Toast";
import { parseRoute, VIEW_TITLES } from "../_components/routes";

const pathOf = (slug: string[]) => `/${slug.map(encodeURIComponent).join("/")}`;

/** Tiêu đề tab đúng ngay khi mở thẳng một đường dẫn; chuyển mục trong app thì client tự đổi. */
export async function generateMetadata({ params }: PageProps<"/[[...slug]]">): Promise<Metadata> {
  const { slug = [] } = await params;
  const route = parseRoute(pathOf(slug));
  if (!route || !slug.length) return {};
  return { title: `${route.employeeId ? "Hồ sơ nhân sự" : VIEW_TITLES[route.view]} · Thiên Nhật Minh` };
}

/** Mọi màn hình của app (/nhan-su, /canh-bao, /nhan-su/<id>…) dùng chung một khung có sidebar. */
export default async function Home({ params }: PageProps<"/[[...slug]]">) {
  const { slug = [] } = await params;
  if (!parseRoute(pathOf(slug))) notFound();
  return (
    <ToastProvider>
      <HrmClient />
    </ToastProvider>
  );
}
