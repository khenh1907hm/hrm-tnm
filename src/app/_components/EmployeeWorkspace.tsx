import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import SkillsClient from "../skills/SkillsClient";
import { BackgroundRemoverTool } from "./BackgroundRemoverTool";
import { EMPLOYEE_VIEWS, parseRoute, routePath, VIEW_TITLES } from "./routes";
import type { PageView } from "./shared";

const NAV_ITEMS: readonly (readonly [PageView, string, LucideIcon])[] = [
  ["skills", "Kho Skill AI", Sparkles],
  ["tools", "Công cụ", Wrench],
];

/** Trang Công cụ: các công cụ làm việc dùng chung. */
export function ToolsPage() {
  return (
    <section className="tools-page">
      <div className="page-head"><div><h1>Công cụ</h1><p>Các công cụ làm việc dùng chung của công ty.</p></div></div>
      <BackgroundRemoverTool />
    </section>
  );
}

/**
 * Khung app cho vai trò Nhân viên: chỉ có Kho Skill AI và Công cụ.
 * Không dựng app nhân sự, không tải dữ liệu nhân sự (RLS ở Supabase cũng chặn vai trò này).
 */
export function EmployeeWorkspace(props: { email: string | null; onSignOut: () => void; mode: "demo" | "live"; onExitPreview?: (() => void) | undefined }) {
  const route = parseRoute(usePathname());
  const allowed = route && EMPLOYEE_VIEWS.includes(route.view) && !route.employeeId;
  const view: PageView = allowed ? route.view : "skills";

  // Đường dẫn của trang nhân sự (vd /nhan-su) → chuyển về Kho Skill AI
  useEffect(() => {
    if (!allowed) window.history.replaceState(window.history.state, "", routePath("skills"));
  }, [allowed]);
  useEffect(() => { document.title = `${VIEW_TITLES[view]} · Thiên Nhật Minh`; }, [view]);

  const navigate = useCallback((next: PageView) => {
    const path = routePath(next);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }, []);

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>Nhân viên</span></div></div>
        <nav aria-label="Chức năng">
          {NAV_ITEMS.map(([key, label, Icon]) => (
            <a className={view === key ? "nav-item active" : "nav-item"} key={key} href={routePath(key)} aria-current={view === key ? "page" : undefined} onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(key);
            }}>
              <Icon size={18} aria-hidden="true" />
              <span className="nav-label">{label}</span>
            </a>
          ))}
        </nav>
        <div className="side-foot">
          {props.mode === "demo"
            ? <><span>Đang xem thử vai trò Nhân viên</span>{props.onExitPreview && <button type="button" className="button" onClick={props.onExitPreview}>Quay lại Admin</button>}</>
            : <><span className="side-user" title={props.email ?? ""}>{props.email}</span><span className="pill">Nhân viên</span></>}
          {props.mode === "live" && <button type="button" className="button" onClick={props.onSignOut}><LogOut className="ico" size={16} aria-hidden="true" /> Đăng xuất</button>}
        </div>
      </aside>
      <main className="main-content">
        {view === "skills" ? <SkillsClient embedded /> : <ToolsPage />}
      </main>
    </div>
  );
}
