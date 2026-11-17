// Shared in-app confirmation dialog — replaces window.confirm / window.alert
// across the app. Renders above everything (z-50), closes on Esc and on
// overlay click, autofocuses the cancel button for safety, and supports a
// promise-based hook for window.confirm-style call sites.
import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

type Tone = "danger" | "primary";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
};

export function ConfirmDialog({
  title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger",
  busy, onConfirm, onClose,
}: {
  title: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone;
  busy?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
        <div className="flex items-start gap-3">
          {tone === "danger" && (
            <span className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center" aria-hidden>
              <AlertTriangle size={17} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button ref={cancelRef} onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-60 focus:outline-none focus:ring-2 ${
              tone === "danger" ? "bg-red-600 hover:bg-red-700 focus:ring-red-400" : "bg-primary hover:bg-primary/90 focus:ring-primary/40"
            }`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Promise-based hook — drop-in replacement for window.confirm:
 *   const { confirm, dialog } = useConfirmDialog();
 *   if (!(await confirm({ title: "Delete signature?", message: "…" }))) return;
 *   …do the thing…
 *   return (<>{page}{dialog}</>);
 */
export function useConfirmDialog() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<(value: boolean) => void>();

  const confirm = (options: ConfirmOptions): Promise<boolean> =>
    new Promise((resolve) => {
      resolver.current = resolve;
      setOpts(options);
      setBusy(false);
    });

  const close = (value: boolean) => {
    setBusy(false);
    resolver.current?.(value);
    resolver.current = undefined;
    setOpts(null);
  };

  const dialog = opts ? (
    <ConfirmDialog
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel ?? "Confirm"}
      cancelLabel={opts.cancelLabel ?? "Cancel"}
      tone={opts.tone ?? "danger"}
      busy={busy}
      onConfirm={() => close(true)}
      onClose={() => close(false)}
    />
  ) : null;

  return { confirm, dialog };
}
