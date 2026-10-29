import { BellRing, FileSpreadsheet, History, LogOut, PenLine, Settings, Sparkles, Users, Wrench, type LucideIcon } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import { routePath } from "./routes";
import type { PageView } from "./shared";

const NAV_ITEMS: readonly (readonly [PageView, string, LucideIcon])[] = [
  ["employees", "Nhân sự", Users],
  ["alerts", "Chứng chỉ sắp hết hạn", BellRing],
  ["signatures", "Thư viện chữ ký", PenLine],
  ["reports", "FORM Báo cáo (Excel)", FileSpreadsheet],
  ["settings", "Cài đặt email", Settings],
  ["skills", "Kho Skill AI", Sparkles],
  ["tools", "Công cụ", Wrench],
  ["audit", "Nhật ký thay đổi", History],
];
/** Mục chỉ admin thấy. */
const ADMIN_ONLY: ReadonlySet<PageView> = new Set(["audit"]);

export function SideNav(props: { mode: "demo" | "live"; email: string | null; onSignOut: () => void; view: PageView; onNavigate: (view: PageView) => void; alertCount: number; actor: Actor; onActorChange: (actor: Actor) => void; onPreviewEmployee?: (() => void) | undefined }) {
  const { view, onNavigate, alertCount, actor, onActorChange } = props;
  return (
    <aside className="side-nav">
      <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>Quản lý nhân sự</span></div></div>
      <nav aria-label="Chức năng">
        {NAV_ITEMS.filter(([key]) => actor.role === "admin" || !ADMIN_ONLY.has(key)).map(([key, label, Icon]) => (
          <a className={view === key ? "nav-item active" : "nav-item"} key={key} href={routePath(key)} aria-current={view === key ? "page" : undefined} onClick={(event) => {
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
      </nav>
      {props.mode === "demo" ? (
        <div className="side-foot">
          <span>Vai trò đang xem thử</span>
          <div className="role-switch"><button aria-pressed={actor.role === "admin"} onClick={() => onActorChange({ id: "demo-admin", role: "admin" })}>Admin</button><button aria-pressed={actor.role === "hr"} onClick={() => onActorChange({ id: "demo-hr", role: "hr" })}>HR</button>{props.onPreviewEmployee && <button aria-pressed={false} onClick={props.onPreviewEmployee}>Nhân viên</button>}</div>
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
