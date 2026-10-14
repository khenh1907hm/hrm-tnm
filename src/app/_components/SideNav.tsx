import type { Actor } from "../../modules/auth/permissions";
import type { PageView } from "./shared";

const NAV_ITEMS = [["employees", "Nhân sự"], ["alerts", "Chứng chỉ sắp hết hạn"], ["signatures", "Thư viện chữ ký"], ["reports", "FORM Báo cáo (Excel)"], ["settings", "Cài đặt email"]] as const;

export function SideNav(props: { view: PageView; onNavigate: (view: PageView) => void; alertCount: number; actor: Actor; onActorChange: (actor: Actor) => void }) {
  const { view, onNavigate, alertCount, actor, onActorChange } = props;
  return (
    <aside className="side-nav">
      <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>Quản lý nhân sự</span></div></div>
      <nav aria-label="Chức năng">
        {NAV_ITEMS.map(([key, label]) => <button className={view === key ? "nav-item active" : "nav-item"} key={key} onClick={() => onNavigate(key)}>{label}{key === "alerts" && alertCount > 0 && <span className="badge">{alertCount}</span>}</button>)}
      </nav>
      <div className="side-foot">
        <span>Vai trò đang xem thử</span>
        <div className="role-switch"><button aria-pressed={actor.role === "admin"} onClick={() => onActorChange({ id: "demo-admin", role: "admin" })}>Admin</button><button aria-pressed={actor.role === "hr"} onClick={() => onActorChange({ id: "demo-hr", role: "hr" })}>HR</button></div>
        <small>Bản thử: dữ liệu chỉ lưu trong phiên làm việc này</small>
      </div>
    </aside>
  );
}
