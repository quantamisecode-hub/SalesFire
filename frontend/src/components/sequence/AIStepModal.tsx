// AIStepModal — rewrite ONE email inside the current sequence (§25-26,
// per-step regeneration). The model sees the neighbouring steps as read-only
// context; the instruction field is treated as an editing note (never a new
// system prompt); the result is shown side-by-side for review and applied
// only behind Accept — everything else in the sequence stays exactly as it is.
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

const PRESETS: Array<{ label: string; prompt: string }> = [
  { label: "Shorten", prompt: "Make it much shorter and punchier — cut filler, keep the ask." },
  { label: "More direct", prompt: "Make it more direct: state the value in the first line and get to the ask faster." },
  { label: "Less salesy", prompt: "Remove salesy language and buzzwords; sound like a thoughtful peer, not a vendor." },
  { label: "Warmer", prompt: "Make it warmer and more conversational while staying professional." },
  { label: "Add urgency", prompt: "Add gentle, honest urgency around timing without pressure tactics." },
  { label: "Stronger CTA", prompt: "Strengthen the call to action — propose a specific time to talk next week." },
];

const stripHtml = (html: string) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const wordCount = (html: string) => stripHtml(html).split(/\s+/).filter(Boolean).length;

export function AIStepModal({ campaignId, stepNumber, totalSteps, current, previous, next, onAccept, onClose }: AIStepModalProps) {
  const [prompt, setPrompt] = useState("");
  const [industry, setIndustry] = useState("");
  const [tone, setTone] = useState("professional");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ subject: string; bodyHtml: string; subjectPreserved?: boolean } | null>(null);
  const [tab, setTab] = useState<"current" | "result">("current");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Show the result as soon as it lands
  useEffect(() => { if (generated) setTab("result"); }, [generated]);

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
  const generatedWords = generated ? wordCount(generated.bodyHtml) : null;
  const currentWords = wordCount(current.bodyHtml);

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

        <label className="text-xs font-medium text-slate-600 block mb-2">
          What should change about this email?
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} autoFocus
            placeholder="e.g. make it shorter and more direct; change the ask to a 15-min demo call; sound less salesy"
            className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-200 focus:border-violet-400" />
        </label>
        {/* One-click instruction presets */}
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Quick instructions">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => setPrompt(p.prompt)}
              className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-medium text-violet-700 transition hover:bg-violet-100 hover:border-violet-300">
              {p.label}
            </button>
          ))}
        </div>
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

        {/* Current vs AI draft — side by side tabs */}
        <div className="rounded-lg border border-slate-200 overflow-hidden mb-3">
          <div className="flex border-b border-slate-200 bg-slate-50" role="tablist" aria-label="Compare versions">
            <button type="button" role="tab" aria-selected={tab === "current"} onClick={() => setTab("current")}
              className={`flex-1 px-3 py-2 text-xs font-semibold transition ${tab === "current" ? "border-b-2 border-primary-600 text-slate-900 bg-white" : "text-slate-500 hover:text-slate-800"}`}>
              Current email <span className="tabular-nums text-slate-400">· {currentWords}w</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === "result"} onClick={() => setTab("result")} disabled={!generated}
              className={`flex-1 px-3 py-2 text-xs font-semibold transition ${tab === "result" ? "border-b-2 border-violet-600 text-violet-800 bg-white" : "text-slate-500 hover:text-slate-800 disabled:opacity-40"}`}>
              AI draft {generated && <span className="tabular-nums text-violet-400">· {generatedWords}w</span>}
            </button>
          </div>

          {tab === "current" && (
            <div className="p-3 max-h-64 overflow-auto">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Subject</p>
              <p className="text-xs font-medium text-slate-700">{current.subject || <span className="text-slate-400 italic">(no subject — thread continuation)</span>}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Body</p>
              <pre className="whitespace-pre-wrap text-xs text-slate-600 font-sans">{stripHtml(current.bodyHtml)}</pre>
            </div>
          )}
          {tab === "result" && generated && (
            <div className="p-3 max-h-64 overflow-auto bg-violet-50/30">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">Subject</p>
                <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                  <Sparkles size={9} /> AI Generated
                </span>
              </div>
              <p className="text-xs font-medium text-slate-800">
                {generated.subject || <span className="text-slate-400 italic">(no subject — thread continuation)</span>}
              </p>
              {generated.subjectPreserved && (
                <p className="mt-1 text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                  The AI left the subject empty, which email 1 forbids — your current subject was kept.
                </p>
              )}
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">Body</p>
              <pre className="whitespace-pre-wrap text-xs text-slate-700 font-sans">{stripHtml(generated.bodyHtml)}</pre>
              <p className={`mt-1 text-[10px] tabular-nums ${generatedWords !== null && generatedWords >= 40 && generatedWords <= 150 ? "text-emerald-600" : "text-amber-600"}`}>
                {generatedWords} words (target 50–130)
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {generated ? (
            <>
              <button type="button" onClick={() => onAccept(generated.subject, generated.bodyHtml)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <CheckCircle2 size={13} /> Accept this version
              </button>
              <button type="button" onClick={() => { setGenerated(null); setTab("current"); }} disabled={busy}
                className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50">Rewrite again</button>
            </>
          ) : (
            <button type="button" onClick={generate} disabled={busy || !campaignId}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {isFollowUp ? `Rewrite email ${stepNumber}` : "Rewrite email 1"}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}
            className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
