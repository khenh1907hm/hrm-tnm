import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { KeyRound, LogOut, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import SkillsClient from "../skills/SkillsClient";
import { BackgroundRemoverTool } from "./BackgroundRemoverTool";
import { BeforeAfterTool } from "./BeforeAfterTool";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { EMPLOYEE_VIEWS, parseRoute, routePath, VIEW_TITLES } from "./routes";
import type { PageView } from "./shared";
import { LIMITED_ROLE_INFO, type LimitedRole } from "./workspaceRole";

const NAV_META: Partial<Record<PageView, readonly [string, LucideIcon]>> = {
  skills: ["Kho Skill AI", Sparkles],
  tools: ["Công cụ", Wrench],
};

/** Trang Công cụ: các công cụ làm việc dùng chung. */
export function ToolsPage() {
  return (
    <section className="tools-page">
      <div className="page-head"><div><h1>Công cụ</h1><p>Các công cụ làm việc dùng chung của công ty.</p></div></div>
      <BeforeAfterTool />
      <BackgroundRemoverTool />
    </section>
  );
}

/**
 * Khung app giới hạn cho vai trò Kỹ sư và Nhân viên: chỉ có Công cụ và Kho Skill AI.
 * Kỹ sư mở thẳng trang Công cụ; Nhân viên mở Kho Skill AI.
 * Không dựng app nhân sự, không tải dữ liệu nhân sự (RLS ở Supabase cũng chặn các vai trò này).
 */
export function EmployeeWorkspace(props: { role?: LimitedRole; email: string | null; onSignOut: () => void; mode: "demo" | "live"; onExitPreview?: (() => void) | undefined }) {
  const info = LIMITED_ROLE_INFO[props.role ?? "employee"];
  const route = parseRoute(usePathname());
  const allowed = route && EMPLOYEE_VIEWS.includes(route.view) && !route.employeeId;
  const view: PageView = allowed ? route.view : info.home;
  const [changingPassword, setChangingPassword] = useState(false);

  // Trang gốc hoặc đường dẫn của trang nhân sự (vd /nhan-su) → chuyển về trang mở đầu của vai trò
  useEffect(() => {
    if (!allowed) window.history.replaceState(window.history.state, "", routePath(info.home));
  }, [allowed, info.home]);
  useEffect(() => { document.title = `${VIEW_TITLES[view]} · Thiên Nhật Minh`; }, [view]);

  const navigate = useCallback((next: PageView) => {
    const path = routePath(next);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }, []);

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>{info.label}</span></div></div>
        <nav aria-label="Chức năng">
          {info.nav.map((key) => [key, ...NAV_META[key]!] as const).map(([key, label, Icon]) => (
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
            ? <><span>Đang xem thử vai trò {info.label}</span>{props.onExitPreview && <button type="button" className="button" onClick={props.onExitPreview}>Quay lại Admin</button>}</>
            : <><span className="side-user" title={props.email ?? ""}>{props.email}</span><span className="pill">{info.label}</span></>}
          {props.mode === "live" && props.email && <button type="button" className="button" onClick={() => setChangingPassword(true)}><KeyRound className="ico" size={16} aria-hidden="true" /> Đổi mật khẩu</button>}
          {props.mode === "live" && <button type="button" className="button" onClick={props.onSignOut}><LogOut className="ico" size={16} aria-hidden="true" /> Đăng xuất</button>}
          {changingPassword && props.email && <ChangePasswordModal email={props.email} onClose={() => setChangingPassword(false)} />}
        </div>
      </aside>
      <main className="main-content">
        {view === "skills" ? <SkillsClient embedded /> : <ToolsPage />}
      </main>
    </div>
  );
}
