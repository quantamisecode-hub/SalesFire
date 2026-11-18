// SpamCheckPanel — deterministic rules-based spam signals (§29). Advisory only:
// a poor score never blocks saving or launching; it only warns and explains.
import { useState } from "react";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { sequenceService } from "@/services/sequence";
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

  return (
    <div className="space-y-2 min-w-0 flex-1 sm:max-w-sm">
      <button type="button" onClick={run} disabled={busy || !campaignId}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Spam check
      </button>

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>}

      {result && (
        <div className={`w-full rounded-xl border p-3 text-xs space-y-2 ${GRADE_STYLES[result.grade]}`} role="status">
          <div className="flex items-center gap-2">
            {result.grade === "poor" || result.grade === "warning"
              ? <ShieldAlert size={14} aria-hidden />
              : <ShieldCheck size={14} aria-hidden />}
            <span className="font-semibold">Spam score {result.score}/100 — {result.grade}</span>
          </div>
          {result.warnings.length === 0 ? (
            <p className="text-slate-600">No spam signals detected. Short, specific, non-pushy emails land best.</p>
          ) : (
            <ul className="list-disc list-inside space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-slate-700">{w.message}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400">Advisory only — this never blocks saving or launching. Word count {result.stats.wordCount}, links {result.stats.linkCount}.</p>
        </div>
      )}
    </div>
  );
}
