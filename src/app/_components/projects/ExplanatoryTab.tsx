"use client";
import { useEffect, useMemo, useState } from "react";
import type { CostCode } from "../../../modules/purchases/budget";
import { getPurchaseStore } from "../purchases/usePurchaseStore";
import { ExplanatoryPanel } from "./ExplanatoryPanel";
import type { TabProps } from "./ProjectDetail";
import { errorMessage } from "./projectShared";

/** Tab Explanatory Report (P-COST-05): báo cáo giải thích khi vượt ngân sách, đổi mã, bảo hành. */
export function ExplanatoryTab({ store: projectStore, data, viewer, setNotice, reload }: TabProps) {
  const store = useMemo(() => getPurchaseStore(projectStore.mode), [projectStore.mode]);
  const [codes, setCodes] = useState<CostCode[] | null>(null);
  useEffect(() => {
    let active = true;
    void store.costCodes().then((list) => { if (active) setCodes(list); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setCodes([]); } });
    return () => { active = false; };
  }, [store, setNotice]);
  if (!codes) return <div className="loading">Đang tải…</div>;
  return <ExplanatoryPanel store={store} project={data.project} codes={codes} canEdit={viewer.isLead || viewer.canEditProject || viewer.isPm} setNotice={setNotice} onApproved={() => void reload()} />;
}
