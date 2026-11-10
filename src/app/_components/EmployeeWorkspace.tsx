import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FolderKanban, KeyRound, LogOut, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import SkillsClient from "../skills/SkillsClient";
import { BackgroundRemoverTool } from "./BackgroundRemoverTool";
import { BeforeAfterTool } from "./BeforeAfterTool";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { EMPLOYEE_VIEWS, parseRoute, projectPath, routePath, VIEW_TITLES } from "./routes";
import type { PageView } from "./shared";
import { LIMITED_ROLE_INFO, type LimitedRole } from "./workspaceRole";
import { hasAccess, type Actor, type ActorRole } from "../../modules/auth/permissions";
import { ProjectsPage } from "./projects/ProjectsPage";
import { TimesheetPage } from "./projects/TimesheetPage";
import { useProjectStore } from "./projects/useProjectStore";
import { useToast } from "./Toast";

const NAV_META: Partial<Record<PageView, readonly [string, LucideIcon]>> = {
  skills: ["Kho Skill AI", Sparkles],
  tools: ["Công cụ", Wrench],
  projects: ["Dự án", FolderKanban],
  timesheet: ["Chấm công", ClipboardCheck],
};

/** Có mục Dự án trong khung giới hạn khi: được tick quyền xem dự án, hoặc là thành viên (không phải tổ viên) của một dự án. */
function useHasProjects(store: ReturnType<typeof useProjectStore>["store"], ready: boolean, actor: Actor | undefined): { has: boolean; known: boolean } {
  const byAccess = actor ? hasAccess(actor, "projects.view") : false;
  const [member, setMember] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ready || byAccess) return;
    let active = true;
    void store.myEmployeeId().then(async (employeeId) => {
      const memberships = employeeId ? await store.listMembershipsOf(employeeId) : [];
      if (active) setMember(memberships.some((item) => item.role !== "worker"));
    }).catch(() => { if (active) setMember(false); });
    return () => { active = false; };
  }, [store, ready, byAccess]);
  return { has: byAccess || member === true, known: byAccess || member !== null };
}

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
 * Khung app giới hạn cho người không có mục nhân sự nào: chỉ có Công cụ (nếu được cấp) và Kho Skill AI.
 * Kỹ sư mở thẳng trang Công cụ; Nhân viên mở Kho Skill AI.
 * Không dựng app nhân sự, không tải dữ liệu nhân sự (RLS ở Supabase cũng chặn những người này).
 */
export function EmployeeWorkspace(props: { role?: Exclude<ActorRole, "admin">; canUseTools?: boolean; actor?: Actor; email: string | null; onSignOut: () => void; mode: "demo" | "live"; onExitPreview?: (() => void) | undefined }) {
  const roleInfo = LIMITED_ROLE_INFO[(props.role === "hr" ? "employee" : props.role ?? "employee") satisfies LimitedRole];
  const label = props.role === "hr" ? "HR" : roleInfo.label;
  const canUseTools = props.canUseTools ?? true;
  const projectStore = useProjectStore(props.mode, null);
  const projects = useHasProjects(projectStore.store, projectStore.ready, props.actor);
  const setNotice = useToast();
  const nav = roleInfo.nav.filter((key) => (canUseTools || key !== "tools") && (projects.has || (key !== "projects" && key !== "timesheet")));
  const home: PageView = canUseTools ? roleInfo.home : "skills";
  const route = parseRoute(usePathname());
  // Mở thẳng trang dự án/chấm công: chờ biết người này có dự án hay không rồi mới chuyển hướng
  const waitingProjects = route !== null && (route.view === "projects" || route.view === "timesheet") && !projects.known;
  const allowed = waitingProjects || (route && EMPLOYEE_VIEWS.includes(route.view) && nav.includes(route.view) && !route.employeeId);
  const view: PageView = allowed ? route.view : home;
  const [changingPassword, setChangingPassword] = useState(false);

  // Trang gốc hoặc đường dẫn của trang nhân sự (vd /nhan-su) → chuyển về trang mở đầu của vai trò
  useEffect(() => {
    if (!allowed) window.history.replaceState(window.history.state, "", routePath(home));
  }, [allowed, home]);
  useEffect(() => { document.title = `${VIEW_TITLES[view]} · Thiên Nhật Minh`; }, [view]);

  const navigate = useCallback((next: PageView) => {
    const path = routePath(next);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }, []);

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>{label}</span></div></div>
        <nav aria-label="Chức năng">
          {nav.map((key) => [key, ...NAV_META[key]!] as const).map(([key, label, Icon]) => (
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
            ? <><span>Đang xem thử vai trò {label}</span>{props.onExitPreview && <button type="button" className="button" onClick={props.onExitPreview}>Quay lại Admin</button>}</>
            : <><span className="side-user" title={props.email ?? ""}>{props.email}</span><span className="pill">{label}</span></>}
          {props.mode === "live" && props.email && <button type="button" className="button" onClick={() => setChangingPassword(true)}><KeyRound className="ico" size={16} aria-hidden="true" /> Đổi mật khẩu</button>}
          {props.mode === "live" && <button type="button" className="button" onClick={props.onSignOut}><LogOut className="ico" size={16} aria-hidden="true" /> Đăng xuất</button>}
          {changingPassword && props.email && <ChangePasswordModal email={props.email} onClose={() => setChangingPassword(false)} />}
        </div>
      </aside>
      <main className="main-content">
        {view === "skills" && <SkillsClient embedded />}
        {view === "tools" && <ToolsPage />}
        {view === "projects" && (!props.actor || waitingProjects ? <div className="loading">Đang tải…</div> : <ProjectsPage store={projectStore.store} ready={projectStore.ready} actor={props.actor} employees={null} projectId={route?.projectId ?? null} setNotice={setNotice}
          onOpen={(projectId) => { const path = projectId ? projectPath(projectId) : routePath("projects"); if (path !== window.location.pathname) window.history.pushState(null, "", path); }} />)}
        {view === "timesheet" && (!props.actor || waitingProjects ? <div className="loading">Đang tải…</div> : <TimesheetPage store={projectStore.store} ready={projectStore.ready} actor={props.actor} setNotice={setNotice} />)}
      </main>
    </div>
  );
}
