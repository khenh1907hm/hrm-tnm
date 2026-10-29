"use client";
import { BellRing, FileSpreadsheet, History, LogOut, PanelLeftClose, PanelLeftOpen, PenLine, Settings, ShieldCheck, Sparkles, Users, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Actor } from "../../modules/auth/permissions";
import { routePath } from "./routes";
import type { PageView } from "./shared";

type NavItem = readonly [PageView, string, LucideIcon];
const NAV_GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  { label: "Nhân sự", items: [["employees", "Nhân sự", Users], ["alerts", "Chứng chỉ hết hạn", BellRing], ["signatures", "Thư viện chữ ký", PenLine]] },
  { label: "Tài liệu", items: [["reports", "FORM Báo cáo (Excel)", FileSpreadsheet], ["skills", "Kho Skill AI", Sparkles], ["tools", "Công cụ", Wrench]] },
  { label: "Hệ thống", items: [["settings", "Cài đặt email", Settings], ["accounts", "Tài khoản & phân quyền", ShieldCheck], ["audit", "Nhật ký thay đổi", History]] },
];
/** Mục chỉ admin thấy. */
const ADMIN_ONLY: ReadonlySet<PageView> = new Set(["audit", "accounts"]);
const COLLAPSED_KEY = "tnm.sideNav.collapsed";
const ROLE_LABELS: Record<Actor["role"], string> = { admin: "Admin", hr: "HR" };

/** Hai chữ đầu của email, làm hình đại diện. */
const initialsOf = (email: string | null) => (email ?? "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

export function SideNav(props: { mode: "demo" | "live"; email: string | null; onSignOut: () => void; view: PageView; onNavigate: (view: PageView) => void; alertCount: number; actor: Actor; onActorChange: (actor: Actor) => void; onPreviewEmployee?: (() => void) | undefined }) {
  const { view, onNavigate, alertCount, actor, onActorChange } = props;
  // Thu gọn còn icon; nhớ theo trình duyệt
  const [collapsed, setCollapsed] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const toggle = () => setCollapsed((current) => {
    try { window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1"); } catch { /* trình duyệt chặn lưu trữ */ }
    return !current;
  });

  return (
    <aside className={collapsed ? "side-nav is-collapsed" : "side-nav"}>
      <div className="brand">
        <div className="brand-mark">TNM</div>
        <div className="brand-text"><b>Thiên Nhật Minh</b><span>Quản lý nhân sự</span></div>
        <button type="button" className="side-collapse" onClick={toggle} aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} title={collapsed ? "Mở rộng" : "Thu gọn"}>
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        </button>
      </div>
      <nav aria-label="Chức năng">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(([key]) => actor.role === "admin" || !ADMIN_ONLY.has(key));
          if (!items.length) return null;
          return <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {items.map(([key, label, Icon]) => (
              <a className={view === key ? "nav-item active" : "nav-item"} key={key} href={routePath(key)} aria-current={view === key ? "page" : undefined} title={collapsed ? label : undefined} onClick={(event) => {
                // Giữ Ctrl/Cmd/Shift hoặc chuột giữa thì để trình duyệt mở tab mới
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(key);
              }}>
                <Icon size={18} aria-hidden="true" />
                <span className="nav-label">{label}</span>
                {key === "alerts" && alertCount > 0 && <span className="badge" aria-label={`${alertCount} chứng chỉ cần chú ý`}>{alertCount}</span>}
              </a>
            ))}
          </div>;
        })}
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
            <button type="button" className="side-signout" onClick={props.onSignOut} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={17} aria-hidden="true" /></button>
          </div>
        </div>
      )}
    </aside>
  );
}
