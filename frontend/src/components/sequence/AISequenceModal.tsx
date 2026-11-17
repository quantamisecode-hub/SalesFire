// AISequenceModal — AI multi-step sequence writer (§25-§26). Generation is a
// real server call; the result is shown for review and only applied behind an
// explicit Accept (nothing is ever auto-applied, §47). A 501 (AI not
// configured) surfaces the backend's honest message.
import { useEffect, useState } from "react";
import { Loader2, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { sequenceService } from "@/services/sequence";
import type { GeneratedStep } from "@/types/sequence";

type AISequenceModalProps = {
  campaignId: string | null;
  onAccept: (steps: GeneratedStep[], mode: "replace" | "append") => void;
  onClose: () => void;
  hasExistingSteps: boolean;
};

export function AISequenceModal({ campaignId, onAccept, onClose, hasExistingSteps }: AISequenceModalProps) {
  const [prompt, setPrompt] = useState("");
  const [industry, setIndustry] = useState("");
  const [tone, setTone] = useState("professional");
  const [stepsCount, setStepsCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedStep[] | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");

  // Esc closes the dialog (§50).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const steps = await sequenceService.generateSequence({ prompt, industry, tone, stepsCount });
      setGenerated(steps);
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "AI generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Generate sequence with AI"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-auto">
        <h3 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-1.5"><Sparkles size={14} className="text-violet-600" /> Generate sequence with AI</h3>
        <p className="text-xs text-slate-500 mb-4">
          The AI may only reference your known variables and verified recipient data. Nothing is applied to your sequence until you press Accept.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <label className="text-xs font-medium text-slate-600 block sm:col-span-3">
            What should this sequence do?
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
              placeholder="e.g. re-engage trial users who haven't invited a teammate, book a 15-min onboarding call"
              className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-200 focus:border-violet-400" />
          </label>
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
          <label className="text-xs font-medium text-slate-600 block">
            Number of emails
            <select value={stepsCount} onChange={(e) => setStepsCount(Number(e.target.value))} className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
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
            <p className="text-[11px] font-semibold text-violet-600 uppercase">AI-generated draft — review before accepting</p>
            {generated.map((s, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-slate-700">Email {s.stepNumber}</span>
                  <span className="text-slate-400">
                    {s.stepNumber > 1 ? `wait ${s.delayAmount} ${s.delayUnit}` : "sends at launch"}
                  </span>
                </div>
                <p className="font-medium text-slate-800">{s.subject || <span className="text-slate-400 italic">(no subject — continues thread)</span>}</p>
                <pre className="whitespace-pre-wrap text-slate-600 font-sans mt-1">{s.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)}…</pre>
              </div>
            ))}
            {hasExistingSteps && (
              <div className="flex gap-3 text-xs text-slate-600">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="ai-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace my emails
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="ai-mode" checked={mode === "append"} onChange={() => setMode("append")} /> Append after them
                </label>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {generated ? (
            <>
              <button type="button" onClick={() => onAccept(generated, mode)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <CheckCircle2 size={13} /> Accept into sequence
              </button>
              <button type="button" onClick={() => setGenerated(null)} disabled={busy}
                className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50">Regenerate</button>
            </>
          ) : (
            <button type="button" onClick={generate} disabled={busy || !campaignId}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate sequence
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}
            className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
