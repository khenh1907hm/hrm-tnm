"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { inferToastVariant, toastDuration, type ToastVariant } from "./toastVariant";

export type Notify = (message: string, variant?: ToastVariant) => void;
type ToastItem = { id: number; message: string; variant: ToastVariant; duration: number; leaving: boolean };

const MAX_TOASTS = 4;
const EXIT_MS = 150;
const ICONS = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert } as const;
const LABELS = { success: "Thành công", info: "Thông tin", warning: "Cần chú ý", error: "Lỗi" } as const;

const ToastContext = createContext<Notify | null>(null);

/** Một thông báo: tự đóng khi hết giờ, tạm dừng khi rê chuột hoặc đang focus. */
function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused || toast.leaving) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.id, toast.leaving, onDismiss]);

  const Icon = ICONS[toast.variant];
  const isError = toast.variant === "error";
  return (
    <div
      className={`toast toast-${toast.variant}${toast.leaving ? " toast-leaving" : ""}${paused ? " toast-paused" : ""}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      style={{ "--toast-duration": `${toast.duration}ms` } as CSSProperties}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className="toast-icon" size={20} aria-hidden="true" />
      <p className="toast-message"><span className="sr-only">{LABELS[toast.variant]}: </span>{toast.message}</p>
      <button type="button" className="toast-close" aria-label="Đóng thông báo" onClick={() => onDismiss(toast.id)}><X size={16} aria-hidden="true" /></button>
      <span className="toast-progress" aria-hidden="true" />
    </div>
  );
}

/** Gắn một lần ở gốc trang; mọi nơi gọi `useToast()` để hiện thông báo góc dưới phải. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, leaving: true } : toast));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), EXIT_MS);
  }, []);

  const notify = useCallback<Notify>((message, variant) => {
    if (!message.trim()) return;
    const toast: ToastItem = { id: nextId.current++, message, variant: variant ?? inferToastVariant(message), duration: toastDuration(message), leaving: false };
    setToasts((current) => [...current, toast].slice(-MAX_TOASTS));
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-region" role="region" aria-label="Thông báo">
        {toasts.map((toast) => <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast phải dùng bên trong ToastProvider.");
  return notify;
}
