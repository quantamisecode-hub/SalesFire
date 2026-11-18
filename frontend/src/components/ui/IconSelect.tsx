// IconSelect — Instantly-style dropdown: icon + capitalized label options.
// Replaces native <select> where visual parity with Instantly matters.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, type LucideIcon } from "lucide-react";

export interface IconSelectOption {
  value: string;
  label: string;
  icon: LucideIcon;
}
export interface IconSelectProps {
  id: string;
  label: string;
  value: string;
  options: readonly IconSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", keyHandler); };
  }, [ref, onClose]);
}

export function IconSelect({ id, label, value, options, onChange, ariaLabel }: IconSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, () => setOpen(false));

  const selected = options.find((o) => o.value === value) || options[0];
  const SelectedIcon = selected?.icon;

  return (
    <div className="relative" ref={ref}>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:border-slate-400 text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <span className="flex items-center gap-2 min-w-0">
          {SelectedIcon && <SelectedIcon size={14} className="text-slate-500 shrink-0" aria-hidden />}
          <span className="truncate">{selected?.label}</span>
        </span>
        <ChevronDown size={15} className={`text-slate-400 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="listbox" aria-label={label} className="absolute z-30 mt-1 w-full min-w-[200px] rounded-xl border border-slate-200 bg-white shadow-card-hover py-1 max-h-72 overflow-auto">
          {options.map((opt) => {
            const active = opt.value === value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left transition ${
                  active ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon size={14} className={active ? "text-primary-600" : "text-slate-400"} aria-hidden />
                <span className="flex-1 truncate">{opt.label}</span>
                {active && <Check size={14} className="text-primary-600 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
