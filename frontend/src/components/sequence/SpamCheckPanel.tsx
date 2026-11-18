// SpamCheckPanel — deterministic rules-based spam signals (§29). Advisory only:
// a poor score never blocks saving or launching; it only warns and explains.
import { useState } from "react";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";import { sequenceService } from "@/services/sequence";
import type { SpamCheckResult } from "@/types/sequence";

const GRADE_STYLES: Record<SpamCheckResult["grade"], string> = {
  excellent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  good: "bg-lime-50 text-lime-700 border-lime-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  poor: "bg-red-50 text-red-700 border-red-200",
};

type SpamCheckPanelProps = {
  campaignId: string | null;
  getSubject: () => string;
  getBodyHtml: () => string;
};

export function SpamCheckPanel({ campaignId, getSubject, getBodyHtml }: SpamCheckPanelProps) {
  const [result, setResult] = useState<SpamCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await sequenceService.spamCheck({
        subject: getSubject(),
        bodyHtml: getBodyHtml(),
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.data?.error || "Spam check failed.");
    } finally {
      setBusy(false);
    }
  };

  const [expanded, setExpanded] = useState(false);
  const warnings = result?.warnings ?? [];
  const hasWarnings = warnings.length > 0;

  return (
    <div className="min-w-0">
      {/* Single-line action cluster: button + result chip */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={busy || !campaignId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Spam check
        </button>

        {result && (
          <button
            type="button"
            disabled={!hasWarnings}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={hasWarnings ? expanded : undefined}
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition ${hasWarnings ? "cursor-pointer hover:brightness-95" : "cursor-default"} ${GRADE_STYLES[result.grade]}`}
            title={hasWarnings ? (expanded ? "Hide warnings" : "Show warnings") : "No spam signals — click nothing to worry about"}
          >
            {result.grade === "poor" || result.grade === "warning"
              ? <ShieldAlert size={12} aria-hidden />
              : <ShieldCheck size={12} aria-hidden />}
            Spam score {result.score}/100 · {result.grade}
            {hasWarnings && <span className="font-normal"> · {warnings.length} warning{warnings.length === 1 ? "" : "s"} {expanded ? "▲" : "▼"}</span>}
          </button>
        )}
      </div>

      {/* Expandable detail — only warnings, only when asked */}
      {result && expanded && hasWarnings && (
        <div className={`mt-1.5 rounded-lg border p-2.5 text-[11px] ${GRADE_STYLES[result.grade]}`} role="alert">
          <ul className="list-disc list-inside space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-slate-700">{w.message}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-slate-400">
            Advisory only — never blocks saving or launching. Word count {result.stats.wordCount}, links {result.stats.linkCount}.
          </p>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>}
    </div>
  );
}
