"use client";
import { useCallback, useEffect, useState } from "react";
import type { PurchaseRoles } from "../../../modules/purchases/types";
import type { TabProps } from "../projects/ProjectDetail";
import { errorMessage } from "../projects/projectShared";
import { orderIdFromUrl, projectOrderPath, projectPath } from "../routes";
import { SkeletonPage } from "../Skeleton";
import { PurchaseDetail } from "./PurchaseDetail";
import { getPurchaseStore } from "./usePurchaseStore";

/**
 * Đơn hàng đang mở trong dự án (?don=<id>): đọc từ URL, Back/Forward của trình duyệt cập nhật theo.
 * Mở đơn ghi URL dạng /du-an/<dự án>?muc=<tab>&don=<đơn> để luôn ở trong dự án.
 */
export function useProjectOrder(projectId: string, slug: string) {
  const [orderId, setOrderId] = useState<string | null>(orderIdFromUrl);
  useEffect(() => {
    const sync = () => setOrderId(orderIdFromUrl());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const open = useCallback((id: string) => { window.history.pushState(null, "", projectOrderPath(projectId, id, slug)); setOrderId(id); }, [projectId, slug]);
  const close = useCallback(() => { window.history.pushState(null, "", `${projectPath(projectId)}?muc=${slug}`); setOrderId(null); }, [projectId, slug]);
  return { orderId, open, close };
}

/** Chi tiết một đơn của dự án, hiện ngay trong tab (không chuyển sang trang Đặt hàng). */
export function ProjectOrderDetail(props: TabProps & { orderId: string; onBack: () => void; onChanged?: () => void }) {
  const { store, data, viewer, actor, setNotice } = props;
  const purchases = getPurchaseStore(store.mode);
  const [ctx, setCtx] = useState<{ roles: PurchaseRoles; userId: string } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([purchases.myRoles(), purchases.myUserId()]).then(([roles, userId]) => { if (active) setCtx({ roles, userId }); }, (error: unknown) => { if (active) setNotice(errorMessage(error), "error"); });
    return () => { active = false; };
  }, [purchases, setNotice]);
  if (!ctx) return <SkeletonPage kind="detail" label="Đang tải đơn hàng…" />;
  return <PurchaseDetail key={props.orderId} store={purchases} orderId={props.orderId} projects={[data.project]} roles={ctx.roles} userId={ctx.userId} isAdmin={actor.role === "admin"}
    leadProjectIds={new Set(viewer.isLead ? [data.project.id] : [])} onBack={props.onBack} onChanged={() => props.onChanged?.()} setNotice={setNotice} />;
}
