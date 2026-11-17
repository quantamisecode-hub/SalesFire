// Toasts — app-wide success / error / info / warning messaging.
// Fixed top-right stack; auto-dismiss (success/info 4.5s, warning 6s, error
// persists until dismissed). aria-live regions for screen readers.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info" | "warning";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
}

interface ToastContextValue {
  success: (message: string, opts?: { title?: string }) => void;
  error: (message: string, opts?: { title?: string }) => void;
  info: (message: string, opts?: { title?: string }) => void;
  warning: (message: string, opts?: { title?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const STYLE: Record<ToastKind, { border: string; bg: string; text: string; Icon: typeof Info }> = {
  success: { border: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-800", Icon: CheckCircle2 },
  error:   { border: "border-red-200",     bg: "bg-red-50",     text: "text-red-800",     Icon: XCircle },
  info:    { border: "border-sky-200",     bg: "bg-sky-50",     text: "text-sky-800",     Icon: Info },
  warning: { border: "border-amber-200",   bg: "bg-amber-50",   text: "text-amber-800",   Icon: AlertTriangle },
};

const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  success: 4500,
  info: 4500,
  warning: 6000,
  error: null, // persistent — the user must acknowledge the failure
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Keep a map of timers so removal is deterministic and cancelable.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback((kind: ToastKind, message: string, opts?: { title?: string }) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-2), { id, kind, message, title: opts?.title }]); // cap at 3 visible
    const ms = AUTO_DISMISS_MS[kind];
    if (ms !== null) {
      const timer = setTimeout(() => dismiss(id), ms);
      timers.current.set(id, timer);
    }
  }, [dismiss]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const value = useMemo<ToastContextValue>(() => ({
    success: (m, o) => push("success", m, o),
    error: (m, o) => push("error", m, o),
    info: (m, o) => push("info", m, o),
    warning: (m, o) => push("warning", m, o),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Fixed stack — top-right, above everything, scrollable if long */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed top-3 right-3 z-[60] flex flex-col gap-2 w-[min(24rem,calc(100vw-1.5rem))] max-h-[80vh] overflow-y-auto"
      >
        {toasts.map((t) => {
          const { border, bg, text, Icon } = STYLE[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`toast-in flex items-start gap-2 ${bg} ${border} ${text} border rounded-lg shadow-lg px-3 py-2 text-xs leading-snug`}
            >
              <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                {t.title && <p className="font-semibold">{t.title}</p>}
                <p className="whitespace-pre-line break-words">{t.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 p-0.5 rounded text-inherit opacity-60 hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
