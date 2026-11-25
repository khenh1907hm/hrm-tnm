"use client";
import { useEffect, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Project } from "../../../modules/projects/types";
import type { PurchaseStore } from "../../../modules/purchases/store";
import type { PurchaseKind, PurchaseOrder, PurchasePayment, PurchaseRoles } from "../../../modules/purchases/types";
import { SkeletonBoard } from "../Skeleton";
import { PurchaseBoard } from "./PurchaseBoard";
import "../projects/projects.css";
import "./purchases.css";

type Loaded = { orders: PurchaseOrder[]; pending: PurchasePayment[]; roles: PurchaseRoles; userId: string; projects: Project[] };

/**
 * Bảng tình trạng đơn hàng ở trang Việc của tôi: mỗi cột một nhóm tình trạng (nháp → ký duyệt → PO → giao hàng → nhận hàng → hoàn tất).
 * Người dùng thấy đơn của mình; người xem được mọi đơn chọn thêm "Tất cả". Lọc được đơn dự án / văn phòng.
 */
export function MyOrdersBoard(props: { store: PurchaseStore; projectStore: ProjectStore | null; onOpenOrder: (orderId: string) => void }) {
  const { store, projectStore } = props;
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [scope, setScope] = useState<"mine" | "all" | null>(null);
  const [kind, setKind] = useState<PurchaseKind | "*">("*");
  useEffect(() => {
    let active = true;
    void Promise.all([store.listOrders(), store.listPendingPayments(), store.myRoles(), store.myUserId(), projectStore ? projectStore.listProjects().catch(() => []) : Promise.resolve([])])
      .then(([orders, pending, roles, userId, projects]) => { if (active) setData({ orders, pending, roles, userId, projects }); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [store, projectStore]);

  const tab = scope ?? (data?.roles.seesAll ? "all" : "mine");
  const shown = useMemo(() => (data?.orders ?? []).filter((order) => order.status !== "cancelled"
    && (tab === "all" || order.requesterId === data?.userId) && (kind === "*" || order.kind === kind)), [data, tab, kind]);

  if (failed) return null;
  return (
    <section className="mywork-board" aria-labelledby="mywork-board-title">
      <div className="pj-section-head">
        <h2 id="mywork-board-title"><LayoutGrid className="ico" size={18} aria-hidden="true" /> Bảng tình trạng đơn hàng</h2>
        {data && (
          <div className="mywork-board-filters">
            <div className="pj-tabs" role="tablist" aria-label="Đơn của ai">
              <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setScope("mine")}>Đơn của tôi</button>
              {data.roles.seesAll && <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setScope("all")}>Tất cả</button>}
            </div>
            <select aria-label="Loại đơn" value={kind} onChange={(event) => setKind(event.target.value as PurchaseKind | "*")}>
              <option value="*">Dự án và văn phòng</option>
              <option value="project">Đặt hàng dự án</option>
              <option value="office">Văn phòng</option>
            </select>
          </div>
        )}
      </div>
      {!data ? <SkeletonBoard /> : <PurchaseBoard orders={shown} projects={data.projects} pending={data.pending} onOpen={props.onOpenOrder} hideProject={kind === "office"} />}
    </section>
  );
}
