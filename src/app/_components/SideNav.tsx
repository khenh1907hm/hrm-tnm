"use client";
import { BellRing, ClipboardCheck, FileSpreadsheet, FolderKanban, Inbox, PanelLeftClose, PanelLeftOpen, Settings, ShoppingCart, Users, type LucideIcon, ClipboardList } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { Actor } from "../../modules/auth/permissions";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { NAV_SECTIONS, openViews, sectionOf, type NavSection, type NavSectionKey } from "./navSections";
import { routePath } from "./routes";
import type { PageView } from "./shared";

/** Biểu tượng từng phần của thanh bên (xem navSections.ts). */
const SECTION_ICONS: Record<NavSectionKey, LucideIcon> = {
  inbox: Inbox, people: Users, certs: BellRing, projects: FolderKanban, timesheet: ClipboardCheck, monthly: ClipboardList, purchases: ShoppingCart, docs: FileSpreadsheet, settings: Settings,
};
const COLLAPSED_KEY = "tnm.sideNav.collapsed";
const ROLE_LABELS: Record<Actor["role"], string> = { admin: "Admin", hr: "HR", engineer: "Kỹ sư", employee: "Nhân viên" };

/** Các phần người này mở được, gom theo nhóm (giữ thứ tự); bấm phần là mở màn hình đầu tiên họ được vào. */
function groupsOf(actor: Actor): [string, { section: NavSection; target: PageView }[]][] {
  const groups: [string, { section: NavSection; target: PageView }[]][] = [];
  for (const section of NAV_SECTIONS) {
    const target = openViews(actor, section)[0];
    if (!target) continue;
    const last = groups[groups.length - 1];
    if (last && last[0] === section.group) last[1].push({ section, target });
    else groups.push([section.group, [{ section, target }]]);
  }
  return groups;
}

/** Hai chữ đầu của email, làm hình đại diện. */
const initialsOf = (email: string | null) => (email ?? "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

export function SideNav(props: { mode: "demo" | "live"; email: string | null; onSignOut: () => void; view: PageView; onNavigate: (view: PageView) => void; alertCount: number; actor: Actor; onActorChange: (actor: Actor) => void; onPreviewEmployee?: (() => void) | undefined }) {
  const { view, onNavigate, alertCount, actor, onActorChange } = props;
  // Thu gọn còn icon; nhớ theo trình duyệt
  const [collapsed, setCollapsed] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const toggle = () => setCollapsed((current) => {
    try { window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1"); } catch { /* trình duyệt chặn lưu trữ */ }
    return !current;
  });

  return (
    <aside className={collapsed ? "side-nav is-collapsed" : "side-nav"}>
      <div className="brand">
        <Image className="brand-logo" src="/tnm-emblem.png" alt="Logo Thiên Nhật Minh" width={240} height={150} priority />
        <div className="brand-text"><b>Thiên Nhật Minh</b><span>Quản trị Online TNM</span></div>
        <button type="button" className="side-collapse" onClick={toggle} aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} title={collapsed ? "Mở rộng" : "Thu gọn"}>
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        </button>
      </div>
      <nav aria-label="Chức năng">
        {groupsOf(actor).map(([group, sections]) => (
          <div className="nav-group" key={group || "top"}>
            {group && <span className="nav-group-label">{group}</span>}
            {sections.map(({ section, target }) => {
              const Icon = SECTION_ICONS[section.key];
              const active = sectionOf(view)?.key === section.key;
              return (
                <a className={active ? "nav-item active" : "nav-item"} key={section.key} href={routePath(target)} aria-current={active ? "page" : undefined} title={collapsed ? section.label : undefined} onClick={(event) => {
                  // Giữ Ctrl/Cmd/Shift hoặc chuột giữa thì để trình duyệt mở tab mới
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(target);
                }}>
                  <Icon size={18} aria-hidden="true" />
                  <span className="nav-label">{section.label}</span>
                  {section.key === "certs" && alertCount > 0 && <span className="badge" aria-label={`${alertCount} chứng chỉ cần chú ý`}>{alertCount}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      {props.mode === "demo" ? (
        <div className="side-foot">
          <span className="side-foot-label">Vai trò đang xem thử</span>
          <div className="role-switch"><button aria-pressed={actor.role === "admin"} onClick={() => onActorChange({ id: "demo-admin", role: "admin" })}>Admin</button><button aria-pressed={actor.role === "hr"} onClick={() => onActorChange({ id: "demo-hr", role: "hr" })}>HR</button>{props.onPreviewEmployee && <button aria-pressed={false} onClick={props.onPreviewEmployee}>Nhân viên</button>}</div>
          <small className="side-foot-label">Bản demo: dữ liệu chỉ lưu trong phiên làm việc này</small>
        </div>
      ) : (
        <div className="side-foot">
          <div className="side-user-card">
            <span className="side-avatar" aria-hidden="true">{initialsOf(props.email)}</span>
            <div className="side-user-text"><span className="side-user" title={props.email ?? ""}>{props.email}</span><small>{ROLE_LABELS[actor.role]}</small></div>
          </div>
        </div>
      )}
      {changingPassword && props.email && <ChangePasswordModal email={props.email} onClose={() => setChangingPassword(false)} />}
    </aside>
  );
}
