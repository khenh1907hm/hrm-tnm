"use client";
import { useEffect, useState } from "react";
import { HardHat, Wrench } from "lucide-react";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { myAccount } from "../accountApi";
import { SiteInspections, type InspectionViewer } from "../reports/SiteInspections";
import { SkeletonTable } from "../Skeleton";
import type { TabProps } from "./ProjectDetail";
import { ToolChecksTab } from "./ToolChecksTab";
import "../purchases/purchases.css";
import "../reports/reports.css";

export type MonthlySection = "site" | "tools";

const SECTIONS = [
  ["site", "Báo cáo công trình", "QHSE photo report · trước / sau", HardHat],
  ["tools", "Tool Check", "Kiểm tra dụng cụ, máy điện", Wrench],
] as const;

/** Báo cáo công trình của riêng dự án: Sếp chụp lỗi (before), chỉ huy trưởng / PM chụp kết quả sau khi sửa (after). */
function ProjectInspections(props: TabProps) {
  const { data, actor, setNotice } = props;
  const [viewer, setViewer] = useState<InspectionViewer | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([myAccount(), getSupabaseClient()?.auth.getUser()]).then(([account, auth]) => {
      if (active) setViewer({ userId: auth?.data.user?.id ?? "", employeeId: data.myEmployeeId ?? account?.employeeId ?? null, isAdmin: actor.role === "admin", name: account?.fullName || account?.loginEmail || "" });
    });
    return () => { active = false; };
  }, [actor.role, data.myEmployeeId]);
  if (!getSupabaseClient()) return <p className="muted">Báo cáo công trình cần đăng nhập (chế độ thật).</p>;
  if (!viewer) return <SkeletonTable rows={4} />;
  return <SiteInspections viewer={viewer} projectId={data.project.id} openId={openId} onOpen={setOpenId} setNotice={setNotice} />;
}

/**
 * MONTHLY REPORT của dự án: các mục báo cáo hằng tháng gom một chỗ:
 * Báo cáo công trình (Sếp kiểm tra → chỉ huy trưởng khắc phục) và Tool Check (kiểm tra dụng cụ điện).
 */
export function MonthlyReportTab(props: TabProps & { section: MonthlySection; onSection: (section: MonthlySection) => void }) {
  const { section, onSection, ...tabProps } = props;
  return (
    <>
      <nav aria-label="Mục báo cáo tháng"><ol className="op-track op-nav">
        {SECTIONS.map(([key, label, sub, Icon], index) => (
          <li key={key} className={`op-step ${section === key ? "is-current" : "is-todo"}`}>
            <button type="button" className="op-nav-btn" aria-current={section === key ? "page" : undefined} onClick={() => onSection(key)}>
              <span className="op-num" aria-hidden="true">{index + 1}</span>
              <span className="op-text"><span className="op-label"><Icon size={13} aria-hidden="true" /> {label}</span><small className="op-dept">{sub}</small></span>
            </button>
          </li>
        ))}
      </ol></nav>
      {section === "tools" ? <ToolChecksTab {...tabProps} /> : <ProjectInspections {...tabProps} />}
    </>
  );
}
