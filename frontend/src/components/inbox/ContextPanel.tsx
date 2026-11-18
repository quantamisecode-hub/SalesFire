// ContextPanel — right pane: lead / company / campaign / conversation context.
// All data comes from the backend (conversation payload); nothing invented.
// Includes the AI summary block (clearly labeled AI Generated) with its own
// button — never auto-triggered, never auto-sent.
import { useEffect, useState } from "react";
import { Star, Sparkles, Loader2, AlertCircle } from "lucide-react";
import type { InboxConversationDetail, InboxMember } from "@/services/inbox";
import { inboxService } from "@/services/inbox";
import { StatusDot } from "@/components/leads/StatusDot";
import { initialsOf, avatarHue } from "@/lib/time";

export function ContextPanel({ conversation, members }: { conversation: InboxConversationDetail; members: InboxMember[] }) {
  const lead = conversation.lead;
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSignals, setAiSignals] = useState<string[]>([]);
  const [aiObjections, setAiObjections] = useState<string[]>([]);
  const [aiNextStep, setAiNextStep] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    setAiSummary(null); setAiSignals([]); setAiObjections([]); setAiNextStep(null); setAiError(null);
  }, [conversation.id]);

  const runAiSummary = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await inboxService.aiSummary(conversation.id);
      setAiSummary(res?.data?.summary || null);
      setAiSignals(res?.data?.buyingSignals || []);
      setAiObjections(res?.data?.objections || []);
      setAiNextStep(res?.data?.suggestedNextStep || null);
    } catch (err: any) {
      setAiError(err?.data?.error || err?.message || "AI summary failed.");
    } finally {
      setAiBusy(false);
    }
  };

  const assignSelect = (
    <select
      aria-label="Assign conversation"
      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 outline-none focus:border-primary-400"
      value={conversation.assigneeId || ""}
      onChange={async (e) => {
        const v = e.target.value;
        try { await inboxService.assign(conversation.id, v || null); } catch { /* parent reloads */ }
        // optimistic: parent refetches on next poll/action
      }}
    >
      <option value="">Unassigned</option>
      {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
    </select>
  );

  return (
    <aside aria-label="Lead and conversation context" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto border-l border-slate-100 bg-slate-50/30 p-4">
      {/* Lead */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Lead</h2>
        {lead ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-9 w-9 select-none items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: `hsl(${avatarHue(lead.email)} 40% 52%)` }}
              >
                {initialsOf([lead.firstName, lead.lastName].filter(Boolean).join(" "), lead.email)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-900">
                  {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}
                </p>
                <p className="truncate text-[11px] text-slate-500">{lead.jobTitle || "—"}</p>
              </div>
            </div>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-400">Email</dt>
                <dd className="truncate font-medium text-slate-700" title={lead.email}>{lead.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-400">Company</dt>
                <dd className="truncate font-medium text-slate-700">{lead.companyName || "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-400">Lead status</dt>
                <dd><StatusDot status={lead.status} /></dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-400">Email status</dt>
                <dd>{lead.emailStatus ? <StatusDot status={lead.emailStatus} /> : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-400">Lead score</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{lead.leadScore ?? "—"}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-400">
            No lead matched this sender yet. Associate one from the thread when you have time.
          </p>
        )}
      </section>

      {/* Assignment */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Conversation</h2>
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          {assignSelect}
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-400">Status</span>
            <StatusDot status={conversation.status} />
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-400">Starred</span>
            {conversation.isStarred
              ? <Star size={13} className="fill-amber-400 text-amber-400" aria-label="Starred" />
              : <span className="text-slate-300">—</span>}
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-400">Tags</span>
            <span className="text-slate-500">{conversation.tags?.length ? conversation.tags.join(", ") : "—"}</span>
          </div>
        </div>
      </section>

      {/* AI Summary */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">AI Summary</h2>
          <button type="button" onClick={runAiSummary} disabled={aiBusy}
            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50">
            {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {aiSummary ? "Regenerate" : "Summarize"}
          </button>
        </div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-violet-500">AI Generated — not verified fact</p>
        {aiError && (
          <p role="alert" className="mb-2 inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700">
            <AlertCircle size={10} /> {aiError}
          </p>
        )}
        {aiSummary ? (
          <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-[12px] leading-relaxed text-slate-800">
            <p className="whitespace-pre-wrap">{aiSummary}</p>
            {aiSignals.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Buying signals</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-slate-700">{aiSignals.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            {aiObjections.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Objections</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-slate-700">{aiObjections.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            {aiNextStep && (
              <div className="rounded-md border border-violet-200 bg-white px-2 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">Suggested next step</p>
                <p className="mt-0.5">{aiNextStep}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-violet-200 p-3 text-[11px] text-slate-400">
            Summarize the conversation with AI — buying signals, objections and a suggested next step.
          </p>
        )}
      </section>
    </aside>
  );
}
