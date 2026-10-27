import { useState, type KeyboardEvent, type PointerEvent } from "react";

/** Chuyển `id` tới vị trí `index` (0-based, tự kẹp trong danh sách). */
export function moveId(ids: readonly string[], id: string, index: number): string[] {
  const next = ids.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}

/**
 * Kéo tay nắm để đổi thứ tự (chuột và cảm ứng, qua pointer events), hoặc chọn tay nắm rồi bấm ↑/↓.
 * Mỗi dòng cần thuộc tính `data-reorder-id`; thả tay mới gọi `onCommit` với thứ tự mới (chỉ khi thật sự đổi).
 */
export function useDragReorder(savedOrder: readonly string[], onCommit: (ids: string[]) => void | Promise<void>) {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const order = dragOrder ?? [...savedOrder];

  const commit = async (next: string[]) => {
    setDraggingId(null);
    if (next.join() !== savedOrder.join()) await onCommit(next);
    setDragOrder(null);
  };

  const handleProps = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingId(id);
      setDragOrder([...savedOrder]);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (draggingId !== id || !dragOrder) return;
      const targetId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-reorder-id]")?.dataset.reorderId;
      if (!targetId || targetId === id || !dragOrder.includes(targetId)) return;
      setDragOrder(moveId(dragOrder, id, dragOrder.indexOf(targetId)));
    },
    onPointerUp: () => { if (draggingId === id) void commit(dragOrder ?? [...savedOrder]); },
    onPointerCancel: () => { setDraggingId(null); setDragOrder(null); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!step) return;
      event.preventDefault();
      void commit(moveId(savedOrder, id, savedOrder.indexOf(id) + step));
    },
  });

  return { order, draggingId, handleProps };
}
