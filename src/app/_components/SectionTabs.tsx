"use client";
import type { Actor } from "../../modules/auth/permissions";
import { openViews, sectionOf, TAB_LABELS } from "./navSections";
import { routePath, VIEW_TITLES } from "./routes";
import type { PageView } from "./shared";

/** Tab ở đầu trang cho phần gồm nhiều màn hình (Nhân sự, Tài liệu, Cài đặt). Phần chỉ một màn hình thì không hiện. */
export function SectionTabs(props: { actor: Actor; view: PageView; onNavigate: (view: PageView) => void }) {
  const section = sectionOf(props.view);
  const views = section ? openViews(props.actor, section) : [];
  // Phần Dự án không hiện thanh tab (Danh sách dự án / Đặt hàng dự án): đặt hàng nằm trong từng dự án
  if (views.length < 2 || section?.key === "projects") return null;
  return (
    <nav className="section-tabs" aria-label={section!.label}>
      {views.map((view) => (
        <a key={view} href={routePath(view)} className={view === props.view ? "is-active" : undefined} aria-current={view === props.view ? "page" : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            props.onNavigate(view);
          }}>{TAB_LABELS[view] ?? VIEW_TITLES[view]}</a>
      ))}
    </nav>
  );
}
