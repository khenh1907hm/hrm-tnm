"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, ShieldCheck, Smartphone } from "lucide-react";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { buildToolCheckWorkbook, ITEM_KEYS, ITEM_LABEL, missingCount, parseToolCheck, photoCount, type LoadedImage, type ToolCheck } from "../../../modules/projects/toolCheck";
import { downloadBytes } from "../purchases/FormExport";
import type { TabProps } from "./ProjectDetail";
import { errorMessage } from "./projectShared";
import { formatDateVn } from "./ProjectsPage";

const BUCKET = "tool-check-photos";

/** Thu nhỏ ảnh cạnh dài 800 px để file Excel không quá nặng. */
async function loadImage(url: string): Promise<LoadedImage> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const small = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Không đọc được ảnh."))), "image/jpeg", 0.8));
  return { buffer: await small.arrayBuffer(), width: canvas.width, height: canvas.height };
}

async function fetchChecks(projectId: string): Promise<ToolCheck[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data: rows, error } = await client.from("tool_checks").select("id, check_date, checked_by, rows, updated_at").eq("project_id", projectId).order("check_date", { ascending: false }).limit(120);
  if (error) throw error;
  return (rows ?? []).map((row) => parseToolCheck(row as Record<string, unknown>));
}

/**
 * Kiểm tra dụng cụ, máy điện (Tool & machine check): phiếu nhập từ app điện thoại, mỗi ngày một phiếu.
 * Xem ảnh từng mục, kết quả OK / NG và xuất Excel theo mẫu TOOL & MACHINE CHECK PHOTO REPORT kèm ảnh.
 */
export function ToolChecksTab({ data, setNotice }: TabProps) {
  const { project } = data;
  const [checks, setChecks] = useState<ToolCheck[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let active = true;
    void fetchChecks(project.id).then(
      (list) => { if (!active) return; setChecks(list); setSelected((current) => current && list.some((c) => c.id === current) ? current : list[0]?.id ?? null); },
      (error: unknown) => { if (active) { setChecks([]); setNotice(errorMessage(error), "error"); } },
    );
    return () => { active = false; };
  }, [project.id, setNotice]);

  const check = useMemo(() => checks?.find((c) => c.id === selected) ?? null, [checks, selected]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!check || !client) return;
    const paths = check.rows.flatMap((r) => Object.values(r.photos)).filter((p): p is string => Boolean(p) && !urls[p!]);
    if (!paths.length) return;
    let active = true;
    void client.storage.from(BUCKET).createSignedUrls(paths, 3600).then(({ data: signed }) => {
      if (!active) return;
      setUrls((map) => ({ ...map, ...Object.fromEntries((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string])) }));
    });
    return () => { active = false; };
  }, [check, urls]);

  const exportExcel = async () => {
    if (!check) return;
    setBusy("Đang tải ảnh…");
    try {
      const images = new Map<string, LoadedImage>();
      const paths = check.rows.flatMap((r) => r.items.map((k) => r.photos[k]).filter((p): p is string => Boolean(p)));
      let done = 0;
      for (const path of paths) {
        const url = urls[path] ?? (await getSupabaseClient()?.storage.from(BUCKET).createSignedUrl(path, 600))?.data?.signedUrl;
        if (url) { try { images.set(path, await loadImage(url)); } catch { /* ảnh lỗi: ô ghi "photo not loaded" */ } }
        setBusy(`Đang tải ảnh ${++done}/${paths.length}…`);
      }
      setBusy("Đang tạo file Excel…");
      const bytes = await buildToolCheckWorkbook(check, project, images);
      downloadBytes(bytes, `${check.date.replaceAll("-", "")} - ${project.code} - Tool check.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (error) { setNotice(errorMessage(error), "error"); } finally { setBusy(""); }
  };

  return (
    <section className="panel pj-section" aria-labelledby="pj-tools-title">
      <div className="pj-section-head">
        <h2 id="pj-tools-title"><ShieldCheck className="ico" size={18} aria-hidden="true" /> Kiểm tra dụng cụ điện (Tool &amp; machine check)</h2>
        <div className="pj-toolbar">
          {checks && checks.length > 0 && (
            <select aria-label="Ngày kiểm tra" value={selected ?? ""} onChange={(event) => setSelected(event.target.value)}>
              {checks.map((c) => <option key={c.id} value={c.id}>Tháng {c.date.slice(5, 7)}/{c.date.slice(0, 4)} (ngày {formatDateVn(c.date)}) · {c.rows.length} dụng cụ{c.rows.some((r) => r.result === "NG") ? " · có NG" : ""}</option>)}
            </select>
          )}
          <button type="button" className="button primary" disabled={!check || Boolean(busy)} onClick={() => void exportExcel()}><Download className="ico" size={16} aria-hidden="true" /> {busy || "Xuất Excel kèm ảnh"}</button>
        </div>
      </div>
      <p className="muted"><small><Smartphone className="ico" size={14} aria-hidden="true" /> Kiểm tra định kỳ mỗi tháng một phiếu, nhập trên app điện thoại: nút + → Kiểm tra dụng cụ điện. Tháng sau bấm dùng danh sách tháng trước rồi chụp ảnh, có dụng cụ mới thì thêm. Người quản lý đặt loại dụng cụ ở nút ⚙.</small></p>
      {checks === null ? <p className="muted">Đang tải…</p> : !check ? <p className="muted">Chưa có phiếu kiểm tra nào.</p> : (
        <>
          <p>Kiểm tra định kỳ tháng <b>{check.date.slice(5, 7)}/{check.date.slice(0, 4)}</b> · ngày {formatDateVn(check.date)} · Checked by <b>{check.checkedBy || "—"}</b> · {check.rows.length} dụng cụ · OK {check.rows.filter((r) => r.result === "OK").length} · <span className={check.rows.some((r) => r.result === "NG") ? "form-error" : undefined}>NG {check.rows.filter((r) => r.result === "NG").length}</span> · {photoCount(check)} ảnh{missingCount(check) ? <span className="warn-text"> · thiếu {missingCount(check)} ảnh</span> : null}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Serial/Code</th><th>Sub con.</th>{ITEM_KEYS.map((k) => <th key={k}>{ITEM_LABEL[k].en}</th>)}<th>Result</th></tr></thead>
              <tbody>
                {check.rows.map((row, index) => (
                  <tr key={`${row.serial}-${index}`} style={row.result === "NG" ? { background: "var(--bad-bg, #fff0f0)" } : undefined}>
                    <td>{index + 1}</td>
                    <td><b>{row.serial}</b>{row.typeName ? <><br /><small className="muted">{row.typeName}</small></> : null}</td>
                    <td>{row.subcon}</td>
                    {ITEM_KEYS.map((k) => {
                      if (!row.items.includes(k)) return <td key={k} className="muted">N/A</td>;
                      const path = row.photos[k];
                      const url = path ? urls[path] : undefined;
                      return <td key={k}>{url ? <a href={url} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element -- ảnh link tạm của Supabase Storage */}
                        <img src={url} alt={`${row.serial} ${ITEM_LABEL[k].en}`} style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 6 }} /></a> : path ? <span className="muted">Đang tải…</span> : <span className="warn-text">Chưa có ảnh</span>}</td>;
                    })}
                    <td><b style={{ color: row.result === "NG" ? "var(--danger, #c00)" : "var(--ok, #0a7d4f)" }}>{row.result}</b>{row.note ? <><br /><small>{row.note}</small></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
