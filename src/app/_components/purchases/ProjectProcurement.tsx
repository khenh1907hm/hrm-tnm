"use client";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import { FLOW_GROUPS, orderGroup, type FlowGroup } from "../../../modules/purchases/flow";
import type { MaterialRequest } from "../../../modules/purchases/materials";
import type { PurchaseOrder, PurchasePayment } from "../../../modules/purchases/types";
import type { TabProps } from "../projects/ProjectDetail";
import { MaterialsTab } from "../projects/MaterialsTab";
import { errorMessage } from "../projects/projectShared";
import { SkeletonTable } from "../Skeleton";
import { ProjectOrderDetail, useProjectOrder } from "./ProjectOrderDetail";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { PurchaseList } from "./PurchasesPage";
import { getPurchaseStore } from "./usePurchaseStore";
import "./purchases.css";

/** Mục cũ (?muc=…) của tab Purchasing, giữ để link cũ và khung Người duyệt đúng loại phiếu. */
export type ProcurementStage = "materials" | "podraft" | "purchases" | "payments";
const GROUP_OF_STAGE: Record<ProcurementStage, FlowGroup> = { materials: "material", podraft: "draft", purchases: "po", payments: "final" };
export const stageOfGroup = (group: FlowGroup): ProcurementStage =>
  group === "material" ? "materials" : group === "draft" || group === "submitted" ? "podraft" : group === "advance" || group === "prepayment" || group === "final" ? "payments" : "purchases";
const OPEN_MATERIAL = new Set<MaterialRequest["status"]>(["draft", "submitted", "approved", "rejected"]);

/**
 * Tab Purchasing của dự án: một thanh quy trình đầy đủ (YCVT → đơn nháp → … → hoàn tất) thay cho 4 khối cũ.
 * Mỗi khối ghi số phiếu / đơn đang nằm ở bước đó; bấm khối để xem đúng các phiếu ấy. Mở một đơn thì hiện thanh bước của riêng đơn.
 */
export function ProjectProcurement(props: TabProps & { stage: ProcurementStage; onStage: (stage: ProcurementStage) => void }) {
  const { store, data, setNotice } = props;
  const purchases = getPurchaseStore(store.mode);
  const { orderId, open, close } = useProjectOrder(data.project.id, "dat-hang");
  const [group, setGroup] = useState<FlowGroup>(() => GROUP_OF_STAGE[props.stage]);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<{ order: PurchaseOrder; payments: PurchasePayment[]; group: FlowGroup }[] | null>(null);
  const [materials, setMaterials] = useState<MaterialRequest[]>([]);
  const [pending, setPending] = useState<PurchasePayment[]>([]);
  const [creating, setCreating] = useState(false);
  const track = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [all, requests, pays] = await Promise.all([purchases.listOrders(), purchases.listMaterialRequests(data.project.id).catch(() => [] as MaterialRequest[]), purchases.listPendingPayments().catch(() => [] as PurchasePayment[])]);
      const orders = all.filter((order) => order.projectId === data.project.id);
      const withPays = await Promise.all(orders.map(async (order) => {
        const list = await purchases.listPayments(order.id).catch(() => [] as PurchasePayment[]);
        return { order, payments: list, group: orderGroup(order, list) };
      }));
      return { withPays, requests, pays };
    })().then(({ withPays, requests, pays }) => { if (active) { setRows(withPays); setMaterials(requests); setPending(pays); } },
      (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setRows([]); } });
    return () => { active = false; };
  }, [purchases, data.project.id, setNotice, refresh]);

  // Màn hẹp: cuộn để khối đang chọn nằm trong tầm nhìn
  useEffect(() => {
    const list = track.current;
    const node = list?.querySelector<HTMLElement>(".is-current");
    if (!list || !node) return;
    list.scrollLeft = Math.max(0, node.offsetLeft - list.clientWidth / 2 + node.clientWidth / 2);
  }, [group, orderId]);

  if (orderId) return <ProjectOrderDetail {...props} orderId={orderId} onBack={() => { close(); setRefresh((value) => value + 1); }} onChanged={() => setRefresh((value) => value + 1)} />;

  const pick = (next: FlowGroup) => { setGroup(next); props.onStage(stageOfGroup(next)); };
  const count = (key: FlowGroup) => key === "material" ? materials.filter((request) => OPEN_MATERIAL.has(request.status)).length : (rows ?? []).filter((row) => row.group === key).length;
  const shown = (rows ?? []).filter((row) => row.group === group).map((row) => row.order);
  const meta = FLOW_GROUPS.find((item) => item.key === group)!;
  const money = shown.reduce((sum, order) => sum + (order.totalActual ?? order.totalEstimate), 0);

  return (
    <>
      <nav aria-label="Quy trình mua hàng">
        <ol className="op-track op-nav op-flow" ref={track}>
          {FLOW_GROUPS.map((item, index) => {
            const selected = item.key === group;
            const n = rows ? count(item.key) : 0;
            return (
              <li key={item.key} className={`op-step ${selected ? "is-current" : "is-todo"}`}>
                <button type="button" className="op-nav-btn" aria-current={selected ? "step" : undefined} onClick={() => pick(item.key)} title={item.form ? `${item.label} · ${item.form}` : item.label}>
                  <span className="op-num" aria-hidden="true">{index + 1}</span>
                  <span className="op-text">
                    <span className="op-label">{item.label}</span>
                    <small className="op-dept">{n ? `${n} ${item.key === "material" ? "phiếu" : "đơn"}` : item.form ?? " "}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {group === "material" ? <MaterialsTab {...props} /> : (
        <section className="panel pj-section" aria-labelledby="pj-flow-title">
          <div className="pj-section-head">
            <h2 id="pj-flow-title">{meta.label}{meta.form ? ` (${meta.form})` : ""}</h2>
            {group === "draft" && <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus className="ico" size={16} aria-hidden="true" /> New PO Draft</button>}
          </div>
          {rows && <small className="muted">{shown.length ? `${shown.length} đơn đang ở bước này · ${formatVnd(money)}.` : "Không có đơn nào đang ở bước này."} Bấm một đơn để mở thanh bước, chuỗi ký và tệp của đơn.</small>}
          {!rows ? <SkeletonTable rows={4} cols={5} /> : shown.length > 0 && <PurchaseList orders={shown} projects={[data.project]} pending={pending} onOpen={open} hideProject />}
        </section>
      )}
      {creating && <PurchaseFormModal store={purchases} projects={[data.project]} initial={null} defaultProjectId={data.project.id} lockProject onClose={() => setCreating(false)} onSaved={(order, submitted) => { setCreating(false); setNotice(submitted ? `Đã lập đơn ${order.code}, gửi ký duyệt.` : `Đã lưu nháp ${order.code}.`, "success"); open(order.id); }} />}
    </>
  );
}
