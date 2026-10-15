import { BellRing, Briefcase, FileSpreadsheet, LogOut, PenLine, Settings, Users, type LucideIcon } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import type { PageView } from "./shared";

const NAV_ITEMS: readonly (readonly [PageView, string, LucideIcon])[] = [
  ["employees", "Nhân sự", Users],
  ["projects", "Dự án", Briefcase],
  ["alerts", "Chứng chỉ sắp hết hạn", BellRing],
  ["signatures", "Thư viện chữ ký", PenLine],
  ["reports", "FORM Báo cáo (Excel)", FileSpreadsheet],
  ["settings", "Cài đặt email", Settings],
];

export function SideNav(props: { mode: "demo" | "live"; email: string | null; onSignOut: () => void; view: PageView; onNavigate: (view: PageView) => void; alertCount: number; actor: Actor; onActorChange: (actor: Actor) => void }) {
  const { view, onNavigate, alertCount, actor, onActorChange } = props;
  return (
    <aside className="side-nav">
      <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>Quản lý nhân sự</span></div></div>
      <nav aria-label="Chức năng">
        {NAV_ITEMS.map(([key, label, Icon]) => (
          <button className={view === key ? "nav-item active" : "nav-item"} key={key} aria-current={view === key ? "page" : undefined} onClick={() => onNavigate(key)}>
            <Icon size={18} aria-hidden="true" />
            <span className="nav-label">{label}</span>
            {key === "alerts" && alertCount > 0 && <span className="badge" aria-label={`${alertCount} chứng chỉ cần chú ý`}>{alertCount}</span>}
          </button>
        ))}
      </nav>
      {props.mode === "demo" ? (
        <div className="side-foot">
          <span>Vai trò đang xem thử</span>
          <div className="role-switch"><button aria-pressed={actor.role === "admin"} onClick={() => onActorChange({ id: "demo-admin", role: "admin" })}>Admin</button><button aria-pressed={actor.role === "hr"} onClick={() => onActorChange({ id: "demo-hr", role: "hr" })}>HR</button></div>
          <small>Bản demo: dữ liệu chỉ lưu trong phiên làm việc này</small>
        </div>
      ) : (
        <div className="side-foot">
          <span className="side-user" title={props.email ?? ""}>{props.email}</span>
          <span className={actor.role === "admin" ? "pill info" : "pill"}>{actor.role === "admin" ? "Admin" : "HR"}</span>
          <button type="button" className="button" onClick={props.onSignOut}><LogOut className="ico" size={16} aria-hidden="true" /> Đăng xuất</button>
        </div>
      )}
    </aside>
  );
}
