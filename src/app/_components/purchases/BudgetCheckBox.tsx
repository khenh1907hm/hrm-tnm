"use client";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { BudgetCheck } from "../../../modules/purchases/budget";

/** Ô "Xác nhận đặt hàng" của P-CC-07: A ngân sách, B đã đặt, C lần này, D = B + C, E = A − D (PRC-02, PRC-03). */
export function BudgetCheckBox({ check, title = "Kiểm tra ngân sách" }: { check: BudgetCheck; title?: string }) {
  const rows: [string, string, number][] = [
    ["(A)", "Giá trị ngân sách của mã", check.a],
    ["(B)", "Đã đặt hàng", check.b],
    ["(C)", "Đặt hàng lần này", check.c],
    ["D = B + C", "Tổng đã đặt", check.d],
    ["E = A − D", "Ngân sách còn lại", check.e],
  ];
  return (
    <section className={`po-budget${check.over ? " over" : ""}`} aria-label={title}>
      <header>
        <b>{title}</b>
        <span>{check.sheetNumber ? `Số ngân sách ${check.sheetNumber} · ` : ""}Mã {check.code}</span>
      </header>
      <table>
        <tbody>{rows.map(([key, label, value]) => (
          <tr key={key} className={key.startsWith("E") ? "po-budget-e" : undefined}><th>{key}</th><td>{label}</td><td className="pj-num">{formatVnd(value)}</td></tr>
        ))}</tbody>
      </table>
      <p role={check.over ? "alert" : undefined}>
        {check.over
          ? <><AlertTriangle className="ico" size={16} aria-hidden="true" /> Vượt ngân sách {formatVnd(-check.e)}. Không gửi duyệt được: cần lập lần ngân sách mới (tăng mã này) và được Lãnh đạo duyệt trước.</>
          : <><CheckCircle2 className="ico" size={16} aria-hidden="true" /> Trong ngân sách.</>}
      </p>
    </section>
  );
}
