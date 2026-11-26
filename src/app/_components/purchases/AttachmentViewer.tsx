"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { Attachment, AttachmentApi } from "./purchaseFiles";
import { downloadBytes } from "./FormExport";

const isPdf = (name: string) => /\.pdf$/i.test(name);
const isImage = (name: string) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
export const canPreview = (name: string) => isPdf(name) || isImage(name);

type Page = { url: string; width: number; height: number };

/** Mỗi trang PDF (kể cả bản scan) vẽ thành một ảnh để xem / tải riêng từng trang. */
async function pdfPages(bytes: Uint8Array, onPage: (page: Page, index: number, total: number) => void) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  try {
    for (let number = 1; number <= Math.min(pdf.numPages, 60); number += 1) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      onPage({ url: canvas.toDataURL("image/jpeg", 0.88), width: canvas.width, height: canvas.height }, number - 1, pdf.numPages);
    }
  } finally { await task.destroy(); }
}

/**
 * Xem tệp đính kèm ngay trong app: ảnh xem trực tiếp; PDF tách thành từng trang (ảnh), bấm một trang để phóng to,
 * tải riêng trang đó (JPG) hoặc tải nguyên tệp gốc.
 */
export function AttachmentViewer(props: { item: Attachment; api: AttachmentApi; onClose: () => void }) {
  const { item, api } = props;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void api.download(item).then(async (data) => {
      if (!active) return;
      setBytes(data);
      if (isImage(item.fileName)) { objectUrl = URL.createObjectURL(new Blob([data as BlobPart])); setImageUrl(objectUrl); return; }
      if (isPdf(item.fileName)) await pdfPages(data, (page, index, count) => { if (active) { setTotal(count); setPages((current) => { const next = [...current]; next[index] = page; return next; }); } });
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Không mở được tệp."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, item]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (zoom !== null) setZoom(null); else props.onClose(); }
      if (zoom !== null && event.key === "ArrowRight") setZoom((value) => value === null ? value : Math.min(pages.length - 1, value + 1));
      if (zoom !== null && event.key === "ArrowLeft") setZoom((value) => value === null ? value : Math.max(0, value - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom, pages.length, props]);

  const base = item.fileName.replace(/\.[^.]+$/, "");
  const savePage = async (index: number) => {
    const page = pages[index];
    if (!page) return;
    const blob = await (await fetch(page.url)).arrayBuffer();
    downloadBytes(new Uint8Array(blob), `${base} - trang ${index + 1}.jpg`, "image/jpeg");
  };
  const saveOriginal = () => bytes && downloadBytes(bytes, item.fileName, isPdf(item.fileName) ? "application/pdf" : "application/octet-stream");

  return (
    <div className="modal-backdrop preview-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="modal-card file-preview av-card" role="dialog" aria-modal="true" aria-label={`Xem ${item.fileName}`}>
        <header>
          <h2>{item.fileName}{total > 0 && <small className="muted"> · {total} trang</small>}</h2>
          <div className="button-row">
            <button type="button" className="button" disabled={!bytes} onClick={saveOriginal}><Download size={15} aria-hidden="true" /> Tải tệp gốc</button>
            <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={18} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="av-body">
          {error ? <p className="form-error">{error}</p>
            : imageUrl ? <img className="av-image" src={imageUrl} alt={item.fileName} />
              : isPdf(item.fileName) ? (
                <>
                  {!pages.length && <p className="muted">Đang tách từng trang…</p>}
                  <ol className="av-pages">
                    {pages.map((page, index) => page && (
                      <li key={index}>
                        <button type="button" className="av-thumb" onClick={() => setZoom(index)} aria-label={`Phóng to trang ${index + 1}`}><img src={page.url} alt={`Trang ${index + 1}`} /></button>
                        <span className="av-page-bar">Trang {index + 1}<button type="button" className="link-button" onClick={() => void savePage(index)}><Download size={13} aria-hidden="true" /> Tải trang</button></span>
                      </li>
                    ))}
                  </ol>
                  {total > pages.length && pages.length > 0 && <p className="muted">Đang tách trang {pages.length + 1}/{total}…</p>}
                </>
              ) : <p className="muted">Không xem trước được loại tệp này. Bấm “Tải tệp gốc”.</p>}
        </div>
        {zoom !== null && pages[zoom] && (
          <div className="av-zoom" role="dialog" aria-label={`Trang ${zoom + 1}`}>
            <div className="av-zoom-bar">
              <button type="button" className="button" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><ChevronLeft size={16} aria-hidden="true" /> Trước</button>
              <b>Trang {zoom + 1}/{total || pages.length}</b>
              <button type="button" className="button" disabled={zoom >= pages.length - 1} onClick={() => setZoom(zoom + 1)}>Sau <ChevronRight size={16} aria-hidden="true" /></button>
              <button type="button" className="button" onClick={() => void savePage(zoom)}><Download size={15} aria-hidden="true" /> Tải trang này</button>
              <button type="button" className="button" onClick={() => setZoom(null)}>Đóng</button>
            </div>
            <img src={pages[zoom].url} alt={`Trang ${zoom + 1}`} />
          </div>
        )}
      </section>
    </div>
  );
}
