// AIStepModal — rewrite ONE email inside the current sequence (§25-26,
// per-step regeneration). The model sees the neighbouring steps as read-only
// context; the result is shown for review and applied only behind Accept —
// everything else in the sequence stays exactly as it is.
import { useEffect, useState } from "react";
import { Loader2, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { sequenceService } from "@/services/sequence";

export type AIStepModalProps = {
  campaignId: string | null;
  stepNumber: number;
  totalSteps: number;
  current: { subject: string; bodyHtml: string };
  previous: { subject: string; bodyHtml: string } | null;
  next: { subject: string; bodyHtml: string } | null;
  onAccept: (subject: string, bodyHtml: string) => void;
  onClose: () => void;
};

export function AIStepModal({ campaignId, stepNumber, totalSteps, current, previous, next, onAccept, onClose }: AIStepModalProps) {
  const [prompt, setPrompt] = useState("");
  const [industry, setIndustry] = useState("");
  const [tone, setTone] = useState("professional");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ subject: string; bodyHtml: string; subjectPreserved?: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const step = await sequenceService.regenerateStep({
        prompt, industry, tone, current, previous, next,
        position: stepNumber, totalSteps,
      });
      setGenerated(step);
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "AI regeneration failed.");
    } finally {
      setBusy(false);
    }
  };

  const isFollowUp = stepNumber > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`Rewrite email ${stepNumber} with AI`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-auto">
        <h3 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-1.5">
          <Sparkles size={14} className="text-violet-600" /> Rewrite email {stepNumber} with AI
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Only this email is rewritten — the other {totalSteps > 1 ? `${totalSteps - 1} email${totalSteps - 1 === 1 ? "" : "s"} in the sequence stay exactly as written.` : "steps are untouched."}
          {generated && <> This version is shown for review; it is applied only when you press Accept.</>}
        </p>

        <label className="text-xs font-medium text-slate-600 block mb-3">
          What should change about this email?
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} autoFocus
            placeholder="e.g. make it shorter and more direct; change the ask to a 15-min demo call; sound less salesy"
            className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-200 focus:border-violet-400" />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <label className="text-xs font-medium text-slate-600 block">
            Industry (optional)
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. SaaS"
              className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
          </label>
          <label className="text-xs font-medium text-slate-600 block">
            Tone
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="direct">Direct</option>
              <option value="consultative">Consultative</option>
            </select>
          </label>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3" role="alert">
            <XCircle size={13} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {generated && (
          <div className="space-y-2 mb-3">
            <p className="text-[11px] font-semibold text-violet-600 uppercase">New version — review before accepting</p>
            {generated.subjectPreserved && (
              <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                The AI left the subject empty for the first email, which the sequence rules forbid — kept your current subject instead.
              </p>
            )}
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-xs">
              <p className="font-medium text-slate-800">
                {generated.subject || <span className="text-slate-400 italic">(no subject — thread continuation)</span>}
              </p>
              <pre className="whitespace-pre-wrap text-slate-600 font-sans mt-1 max-h-56 overflow-auto">{generated.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}</pre>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {generated ? (
            <>
              <button type="button" onClick={() => onAccept(generated.subject, generated.bodyHtml)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <CheckCircle2 size={13} /> Accept this version
              </button>
              <button type="button" onClick={() => setGenerated(null)} disabled={busy}
                className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50">Rewrite again</button>
            </>
          ) : (
            <button type="button" onClick={generate} disabled={busy || !campaignId}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {isFollowUp ? `Rewrite email ${stepNumber}` : 'Rewrite email 1'}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}
            className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
