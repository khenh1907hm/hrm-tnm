import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import "./employee.css";
import { isWorkerEmail } from "../../lib/workerLogin";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FolderKanban, KeyRound, LogOut, ShoppingCart, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { PurchasesPage } from "./purchases/PurchasesPage";
import { getPurchaseStore } from "./purchases/usePurchaseStore";
import SkillsClient from "../skills/SkillsClient";
import { BackgroundRemoverTool } from "./BackgroundRemoverTool";
import { BeforeAfterTool } from "./BeforeAfterTool";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { EMPLOYEE_VIEWS, parseRoute, projectPath, purchasePath, routePath, VIEW_TITLES } from "./routes";
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
  purchases: ["Đặt hàng", ShoppingCart],
};

/**
 * Mục Dự án: được tick quyền xem dự án, hoặc là thành viên (không phải tổ viên) của một dự án.
 * Mục Chấm công: mọi tài khoản đã liên kết hồ sơ nhân sự (tự chấm công GPS; chưa thuộc dự án thì trang báo cần làm gì).
 */
function useHasProjects(store: ReturnType<typeof useProjectStore>["store"], ready: boolean, actor: Actor | undefined): { has: boolean; attends: boolean; known: boolean } {
  const byAccess = actor ? hasAccess(actor, "projects.view") : false;
  const [found, setFound] = useState<{ member: boolean; attends: boolean } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void store.myEmployeeId().then(async (employeeId) => {
      // Tổ viên không đọc được bảng thành viên: dự án mình đang làm lấy qua hàm my_attendance_context
      const [memberships, attending] = employeeId ? await Promise.all([store.listMembershipsOf(employeeId), store.myAttendance()]) : [[], []];
      if (active) setFound({ member: memberships.some((item) => item.role !== "worker"), attends: employeeId !== null || attending.length > 0 });
    }).catch(() => { if (active) setFound({ member: false, attends: false }); });
    return () => { active = false; };
  }, [store, ready]);
  const has = byAccess || found?.member === true;
  return { has, attends: has || found?.attends === true, known: found !== null };
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
  const nav = roleInfo.nav.filter((key) => (canUseTools || key !== "tools") && (key !== "projects" || projects.has) && (key !== "timesheet" || projects.attends));
  // Công nhân có dự án đang thi công: mở thẳng trang Chấm công
  const home: PageView = projects.attends && !projects.has ? "timesheet" : canUseTools ? roleInfo.home : "skills";
  const route = parseRoute(usePathname());
  // Mở thẳng trang dự án/chấm công: chờ biết người này có dự án hay không rồi mới chuyển hướng
  const waitingProjects = route !== null && (route.view === "projects" || route.view === "timesheet") && !projects.known;
  const allowed = waitingProjects || (route && EMPLOYEE_VIEWS.includes(route.view) && nav.includes(route.view) && !route.employeeId);
  const view: PageView = allowed ? route.view : home;
  const [changingPassword, setChangingPassword] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Trang gốc hoặc đường dẫn của trang nhân sự (vd /nhan-su) → chuyển về trang mở đầu của vai trò
  useEffect(() => {
    // Chờ biết có dự án hay không (trang mở đầu của công nhân là Chấm công)
    if (!allowed && projects.known) window.history.replaceState(window.history.state, "", routePath(home));
  }, [allowed, home, projects.known]);
  useEffect(() => { document.title = `${VIEW_TITLES[view]} · Thiên Nhật Minh`; }, [view]);

  const navigate = useCallback((next: PageView) => {
    const path = routePath(next);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }, []);

  const links = nav.map((key) => [key, ...NAV_META[key]!] as const);
  const go = (event: React.MouseEvent, key: PageView) => {
    // Giữ Ctrl/Cmd/Shift hoặc chuột giữa thì để trình duyệt mở tab mới
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMenuOpen(false);
    navigate(key);
  };
  const initials = (props.email ?? "?").replace(/@.*/, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  // Tài khoản chấm công hiện mã nhân viên (TNM001) thay cho email nội bộ
  const login = props.email ? (isWorkerEmail(props.email) ? props.email.split("@")[0]!.toUpperCase() : props.email) : "";
  const account = (
    <>
      {props.mode === "demo"
        ? <><span className="emp-account-line">Đang xem thử vai trò {label}</span>{props.onExitPreview && <button type="button" className="button" onClick={props.onExitPreview}>Quay lại Admin</button>}</>
        : <><span className="emp-account-line"><span className="emp-avatar" aria-hidden="true">{initials}</span><span><b title={props.email ?? ""}>{login}</b><small>{label}</small></span></span></>}
      {props.mode === "live" && props.email && <button type="button" className="button" onClick={() => { setMenuOpen(false); setChangingPassword(true); }}><KeyRound className="ico" size={16} aria-hidden="true" /> Đổi mật khẩu</button>}
      {props.mode === "live" && <button type="button" className="button" onClick={props.onSignOut}><LogOut className="ico" size={16} aria-hidden="true" /> Đăng xuất</button>}
    </>
  );

  return (
    <div className="app-shell emp-shell">
      {/* Điện thoại: thanh trên cùng (logo, tên trang, tài khoản) và thanh điều hướng dưới đáy */}
      <header className="emp-topbar">
        <Image className="emp-topbar-logo" src="/tnm-emblem.png" alt="Thiên Nhật Minh" width={120} height={75} priority />
        <b>{VIEW_TITLES[view]}</b>
        <button type="button" className="emp-avatar-button" aria-label="Tài khoản" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><span className="emp-avatar">{initials}</span></button>
      </header>
      {menuOpen && <div className="emp-menu" role="dialog" aria-label="Tài khoản">{account}</div>}
      <nav className="emp-tabbar" aria-label="Chức năng">
        {links.map(([key, text, Icon]) => (
          <a key={key} href={routePath(key)} className={view === key ? "active" : undefined} aria-current={view === key ? "page" : undefined} onClick={(event) => go(event, key)}>
            <Icon size={22} aria-hidden="true" /><span>{text}</span>
          </a>
        ))}
      </nav>

      <aside className="side-nav emp-side">
        <div className="brand">
          <Image className="brand-logo" src="/tnm-emblem.png" alt="Logo Thiên Nhật Minh" width={240} height={150} priority />
          <div className="brand-text"><b>Thiên Nhật Minh</b><span>Quản trị Online TNM</span></div>
        </div>
        <nav aria-label="Chức năng">
          {links.map(([key, label, Icon]) => (
            <a className={view === key ? "nav-item active" : "nav-item"} key={key} href={routePath(key)} aria-current={view === key ? "page" : undefined} onClick={(event) => go(event, key)}>
              <Icon size={18} aria-hidden="true" />
              <span className="nav-label">{label}</span>
            </a>
          ))}
        </nav>
        <div className="side-foot emp-side-foot">{account}</div>
      </aside>
      {changingPassword && props.email && <ChangePasswordModal email={props.email} onClose={() => setChangingPassword(false)} />}
      <main className="main-content emp-main" onClick={() => setMenuOpen(false)}>
        {view === "skills" && <SkillsClient embedded />}
        {view === "tools" && <ToolsPage />}
        {view === "projects" && (!props.actor || waitingProjects ? <div className="loading">Đang tải…</div> : <ProjectsPage store={projectStore.store} ready={projectStore.ready} actor={props.actor} employees={null} projectId={route?.projectId ?? null} setNotice={setNotice}
          onOpen={(projectId) => { const path = projectId ? projectPath(projectId) : routePath("projects"); if (path !== window.location.pathname) window.history.pushState(null, "", path); }} />)}
        {view === "purchases" && props.actor && <PurchasesPage store={getPurchaseStore(props.mode)} projectStore={projectStore.store} ready={projectStore.ready} actor={props.actor} employees={null} orderId={route?.purchaseId ?? null} setNotice={setNotice}
          onOpen={(orderId) => { const path = orderId ? purchasePath(orderId) : routePath("purchases"); if (path !== window.location.pathname) window.history.pushState(null, "", path); }} />}
        {view === "timesheet" && (!props.actor || waitingProjects ? <div className="loading">Đang tải…</div> : <TimesheetPage store={projectStore.store} ready={projectStore.ready} actor={props.actor} setNotice={setNotice} onOpenProject={(projectId) => window.history.pushState(null, "", projectPath(projectId))} />)}
      </main>
    </div>
  );
}
