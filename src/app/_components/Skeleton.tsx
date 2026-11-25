/**
 * Khung xương (skeleton) hiện trong lúc tải: giữ đúng bố cục trang để người dùng thấy ngay trang đang mở,
 * không bị nhảy khi dữ liệu về. Trình đọc màn hình nghe nhãn "Đang tải…".
 */
import type { CSSProperties, ReactNode } from "react";

type BoneProps = { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties; className?: string };

/** Một khối xám nhấp nháy. */
export function Bone({ width = "100%", height = 14, radius = 6, style, className }: BoneProps) {
  return <span aria-hidden="true" className={className ? `sk-bone ${className}` : "sk-bone"} style={{ width, height, borderRadius: radius, ...style }} />;
}

function Busy(props: { label?: string | undefined; className?: string; children: ReactNode }) {
  return (
    <div className={props.className ? `sk-wrap ${props.className}` : "sk-wrap"} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{props.label ?? "Đang tải…"}</span>
      {props.children}
    </div>
  );
}

/** Vài dòng chữ. */
export function SkeletonLines(props: { lines?: number; label?: string | undefined }) {
  const lines = props.lines ?? 3;
  return (
    <Busy label={props.label} className="sk-lines">
      {Array.from({ length: lines }, (_, index) => <Bone key={index} width={index === lines - 1 ? "60%" : "100%"} />)}
    </Busy>
  );
}

/** Lưới thẻ (danh sách dự án). */
export function SkeletonCards(props: { count?: number; label?: string | undefined }) {
  return (
    <Busy label={props.label} className="sk-cards">
      {Array.from({ length: props.count ?? 6 }, (_, index) => (
        <div key={index} className="sk-card">
          <Bone width={70} height={12} />
          <Bone width="80%" height={18} />
          <div className="sk-row"><Bone width={64} height={18} radius={999} /><Bone width={110} height={12} /></div>
          <Bone height={8} radius={999} />
          <Bone width="55%" height={11} />
        </div>
      ))}
    </Busy>
  );
}

/** Bảng: dòng tiêu đề + các dòng dữ liệu. */
export function SkeletonTable(props: { rows?: number; cols?: number; label?: string | undefined }) {
  const cols = props.cols ?? 5;
  return (
    <Busy label={props.label} className="sk-table panel">
      <div className="sk-tr sk-th" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, index) => <Bone key={index} width="50%" height={11} />)}
      </div>
      {Array.from({ length: props.rows ?? 6 }, (_, row) => (
        <div key={row} className="sk-tr" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, col) => <Bone key={col} width={col === 1 ? "90%" : `${55 + ((row + col) % 3) * 15}%`} />)}
        </div>
      ))}
    </Busy>
  );
}

/** Bảng tình trạng dạng cột (kanban). */
export function SkeletonBoard(props: { columns?: number; label?: string | undefined }) {
  return (
    <Busy label={props.label} className="sk-board">
      {Array.from({ length: props.columns ?? 6 }, (_, col) => (
        <div key={col} className="sk-col">
          <div className="sk-row"><Bone width="60%" height={14} /><Bone width={22} height={18} radius={999} /></div>
          <Bone width="85%" height={10} />
          {Array.from({ length: col % 3 === 0 ? 2 : 1 }, (_, card) => (
            <div key={card} className="sk-card">
              <Bone width={70} height={11} />
              <Bone width="90%" height={14} />
              <Bone width="45%" height={12} />
              <Bone height={6} radius={999} />
            </div>
          ))}
        </div>
      ))}
    </Busy>
  );
}

/** Ô tóm tắt (Việc của tôi). */
export function SkeletonTiles(props: { count?: number }) {
  return (
    <Busy className="sk-tiles">
      {Array.from({ length: props.count ?? 3 }, (_, index) => (
        <div key={index} className="sk-tile"><Bone width={22} height={22} radius={6} /><div className="sk-stack"><Bone width="70%" /><Bone width="50%" height={10} /></div><Bone width={26} height={22} /></div>
      ))}
    </Busy>
  );
}

/** Trang chi tiết: tiêu đề, dải tab, khối nội dung. */
export function SkeletonDetail(props: { tabs?: number; label?: string | undefined }) {
  return (
    <Busy label={props.label} className="sk-detail">
      <div className="sk-tabs">{Array.from({ length: props.tabs ?? 0 }, (_, index) => <Bone key={index} width={90} height={30} radius={6} />)}</div>
      <div className="sk-grid">
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="sk-card"><Bone width="40%" height={11} /><Bone width="65%" height={22} /></div>)}
      </div>
      <div className="sk-card sk-block">
        <Bone width="30%" height={16} />
        {Array.from({ length: 5 }, (_, index) => <Bone key={index} width={index === 4 ? "55%" : "100%"} />)}
      </div>
    </Busy>
  );
}

/** Cả trang: tiêu đề + thanh lọc + nội dung (bảng, thẻ hoặc cột). */
export function SkeletonPage(props: { kind?: "table" | "cards" | "board" | "detail"; label?: string; toolbar?: boolean }) {
  const kind = props.kind ?? "table";
  return (
    <section className="pj-page sk-page" aria-busy="true">
      <div className="page-head"><div className="sk-stack"><Bone width={220} height={26} /><Bone width={360} height={13} style={{ maxWidth: "70vw" }} /></div><Bone width={130} height={36} radius={6} /></div>
      {props.toolbar !== false && kind !== "detail" && <div className="sk-row sk-toolbar"><Bone height={36} radius={6} style={{ flex: 1 }} /><Bone width={180} height={36} radius={6} /></div>}
      {kind === "cards" ? <SkeletonCards label={props.label} /> : kind === "board" ? <SkeletonBoard label={props.label} /> : kind === "detail" ? <SkeletonDetail tabs={6} label={props.label} /> : <SkeletonTable label={props.label} />}
    </section>
  );
}

/** Khung app lúc mới mở (chưa biết người dùng): thanh bên + trang trống. */
export function SkeletonShell() {
  return (
    <div className="app-shell" aria-busy="true">
      <aside className="side-nav sk-side" aria-hidden="true">
        <div className="sk-row"><Bone width={38} height={38} radius={8} /><div className="sk-stack" style={{ flex: 1 }}><Bone width="80%" /><Bone width="55%" height={10} /></div></div>
        <div className="sk-stack">{Array.from({ length: 8 }, (_, index) => <Bone key={index} height={32} radius={6} />)}</div>
      </aside>
      <main className="main-content"><SkeletonPage label="Đang tải dữ liệu…" /></main>
    </div>
  );
}
