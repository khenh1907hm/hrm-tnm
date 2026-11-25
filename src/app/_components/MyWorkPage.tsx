"use client";
import { useEffect, useState } from "react";
import { BellRing, Banknote, FileSignature, Inbox, PackageCheck, type LucideIcon } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import type { ProjectStore } from "../../modules/projects/store";
import type { PurchaseStore } from "../../modules/purchases/store";
import { ApprovalBoardPage } from "./ApprovalBoardPage";
import { MyOrdersBoard } from "./purchases/MyOrdersBoard";
import { SkeletonTiles } from "./Skeleton";
import { canOpenView } from "./routes";
import type { PageView } from "./shared";
import type { Notify } from "./Toast";

type Tile = { key: string; label: string; hint: string; count: number; icon: LucideIcon; tone: "warn" | "bad" | "info"; go: () => void };

/**
 * "Việc của tôi": trang mở đầu của mọi người. Ô tóm tắt những việc đang chờ người đăng nhập
 * (chứng chỉ cần chú ý, khoản chờ chi, PO cần phát hành, hàng về chờ nhập kho), bên dưới là bảng phiếu cần duyệt
 * và bảng tình trạng đơn hàng (đơn của tôi; người xem được mọi đơn chọn "Tất cả").
 */
export function MyWorkPage(props: { live: boolean; actor: Actor; store: PurchaseStore; projectStore: ProjectStore | null; certCount: number; onNavigate: (view: PageView) => void; onOpenOrder: (orderId: string) => void; setNotice: Notify }) {
  const { store } = props;
  const [work, setWork] = useState<{ pay: number; po: number; stock: number; firstStock: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([store.myRoles(), store.listOrders(), store.listPendingPayments(), store.myUserId()]).then(([roles, orders, pending, me]) => {
      if (!active) return;
      const stock = orders.filter((order) => order.status === "received" && !order.stockedAt);
      setWork({
        pay: roles.isPayer ? pending.filter((payment) => payment.status === "approved").length : 0,
        // PO do người lập nắm: đơn của tôi (Admin, Kho / Vật tư thấy mọi đơn)
        po: orders.filter((order) => order.usesChain && order.status === "approved" && !order.poIssuedAt
          && (order.requesterId === me || roles.isPoIssuer || props.actor.role === "admin")).length,
        stock: stock.length,
        firstStock: stock.length === 1 ? stock[0]!.id : null,
      });
    }, () => { if (active) setWork({ pay: 0, po: 0, stock: 0, firstStock: null }); });
    return () => { active = false; };
  }, [store, props.actor.role]);

  const tiles: Tile[] = [
    ...(canOpenView(props.actor, "alerts") ? [{ key: "certs", label: "Chứng chỉ cần chú ý", hint: "Hết hạn, sắp hết hạn", count: props.certCount, icon: BellRing, tone: "bad" as const, go: () => props.onNavigate("alerts") }] : []),
    { key: "pay", label: "Khoản chờ chi", hint: "Đã duyệt, chờ kế toán chi", count: work?.pay ?? 0, icon: Banknote, tone: "warn", go: () => props.onNavigate("purchases") },
    { key: "po", label: "PO cần phát hành", hint: "Đơn của bạn đã duyệt, chưa có PO", count: work?.po ?? 0, icon: FileSignature, tone: "info", go: () => props.onNavigate("projectPurchases") },
    { key: "stock", label: "Hàng về chờ nhập kho", hint: "Đã nhận, chưa nhập kho", count: work?.stock ?? 0, icon: PackageCheck, tone: "info", go: () => work?.firstStock ? props.onOpenOrder(work.firstStock) : props.onNavigate("projectPurchases") },
  ];
  const shown = tiles.filter((tile) => tile.count > 0 || tile.key === "certs");

  return (
    <>
      <div className="page-head">
        <div><h1><Inbox className="ico" size={22} aria-hidden="true" /> Việc của tôi</h1><p>Những việc đang chờ bạn. Bấm một ô để mở.</p></div>
      </div>
      {!work && <SkeletonTiles />}
      {work && shown.length > 0 && (
        <div className="mywork-tiles">
          {shown.map((tile) => {
            const Icon = tile.icon;
            return (
              <button key={tile.key} type="button" className={`mywork-tile tone-${tile.tone}${tile.count ? "" : " is-zero"}`} onClick={tile.go}>
                <Icon size={20} aria-hidden="true" />
                <span className="mywork-label">{tile.label}<small>{tile.hint}</small></span>
                <b>{tile.count}</b>
              </button>
            );
          })}
        </div>
      )}
      <ApprovalBoardPage live={props.live} setNotice={props.setNotice} />
      <MyOrdersBoard store={store} projectStore={props.projectStore} onOpenOrder={props.onOpenOrder} />
    </>
  );
}
