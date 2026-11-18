// ReplyComposer — Instantly-style inline reply box with variable insertion,
// AI draft/improve, signature awareness and debounced draft autosave.
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Braces, Loader2, Trash2, AlertCircle, ChevronDown } from "lucide-react";
import type { InboxConversationDetail } from "@/services/inbox";
import { inboxService } from "@/services/inbox";

const VARIABLES = [
  { token: "{{first_name}}", label: "First name" },
  { token: "{{last_name}}", label: "Last name" },
  { token: "{{company_name}}", label: "Company" },
  { token: "{{job_title}}", label: "Job title" },
  { token: "{{sendingAccountName}}", label: "My name" },
  { token: "{{accountSignature}}", label: "Signature" },
];

export function ReplyComposer({
  conversation, onSent, accountEmail,
}: {
  conversation: InboxConversationDetail;
  onSent: () => void;
  accountEmail: string | null | undefined;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraftLabel, setAiDraftLabel] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<number | null>(null);
  const lastSaved = useRef<string>("");

  // Load the persisted draft when switching conversations.
  useEffect(() => {
    let cancelled = false;
    setBody("");
    setAiDraftLabel(null);
    setError(null);
    setDraftState("idle");
    inboxService.getDraft(conversation.id)
      .then((res) => {
        if (cancelled) return;
        const text = res?.data?.textBody || "";
        setBody(text);
        lastSaved.current = text;
      })
      .catch(() => { /* no draft yet — start empty */ });
    return () => { cancelled = true; };
  }, [conversation.id]);

  // Debounced autosave
  useEffect(() => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (body === lastSaved.current) return;
    draftTimer.current = window.setTimeout(async () => {
      setDraftState("saving");
      try {
        await inboxService.saveDraft(conversation.id, { textBody: body });
        lastSaved.current = body;
        setDraftState("saved");
      } catch {
        setDraftState("error");
      }
    }, 800);
    return () => { if (draftTimer.current) window.clearTimeout(draftTimer.current); };
  }, [body, conversation.id]);

  const insertVariable = (token: string) => {
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + token); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    setVarsOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await inboxService.sendReply(conversation.id, { bodyText: text, subject: `Re: ${conversation.subject.replace(/^Re:\s*/i, "")}` });
      setBody("");
      lastSaved.current = "";
      setDraftState("idle");
      setAiDraftLabel(null);
      onSent();
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    try { await inboxService.deleteDraft(conversation.id); } catch { /* ignore */ }
    setBody("");
    lastSaved.current = "";
    setDraftState("idle");
    setAiDraftLabel(null);
  };

  const aiAction = async (mode: string, label: string) => {
    setAiBusy(mode);
    setError(null);
    try {
      const res = await inboxService.aiReply(conversation.id, { mode, instruction: body.trim() || undefined });
      const draft = res?.data?.draft || "";
      if (draft) {
        setBody(draft);
        setAiDraftLabel(label);
      }
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "AI generation failed.");
    } finally {
      setAiBusy(null);
      setAiOpen(false);
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-2.5">
      {/* Context line */}
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-slate-400">
          Replying as <span className="font-medium text-slate-600">{accountEmail || "sending account"}</span>
          {draftState === "saving" && <span className="ml-2 text-slate-400">Saving draft…</span>}
          {draftState === "saved" && <span className="ml-2 text-emerald-600">Draft saved</span>}
          {draftState === "error" && <span className="ml-2 text-amber-600">Draft failed to save</span>}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {aiDraftLabel && (
            <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              <Sparkles size={10} /> AI Generated — {aiDraftLabel}
            </span>
          )}
          <button type="button" onClick={discard} aria-label="Discard draft" title="Discard draft"
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Textarea */}
      <label htmlFor="reply-body" className="sr-only">Reply body</label>
      <textarea
        id="reply-body"
        ref={bodyRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); setAiDraftLabel(null); }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
        }}
        rows={4}
        placeholder="Write a reply… (⌘/Ctrl+Enter to send)"
        className="block w-full resize-y rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[13px] leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
      />

      {/* Toolbar */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {/* Variables */}
        <div className="relative">
          <button type="button" onClick={() => setVarsOpen((v) => !v)} aria-expanded={varsOpen} aria-haspopup="menu"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
            <Braces size={12} /> Variables
          </button>
          {varsOpen && (
            <div role="menu" className="absolute bottom-full z-20 mb-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {VARIABLES.map((v) => (
                <button key={v.token} role="menuitem" type="button" onClick={() => insertVariable(v.token)}
                  className="block w-full px-3 py-1.5 text-left font-mono text-[11px] text-slate-700 hover:bg-violet-50 hover:text-violet-800">
                  {v.token}<span className="ml-2 font-sans text-slate-400">{v.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI tools */}
        <div className="relative">
          <button type="button" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen} aria-haspopup="menu"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-violet-600 transition hover:bg-violet-50">
            {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI tools <ChevronDown size={12} />
          </button>
          {aiOpen && (
            <div role="menu" className="absolute bottom-full z-20 mb-1 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {[
                ["draft", "Draft reply"],
                ["improve", "Improve reply"],
                ["shorter", "Make shorter"],
                ["professional", "Make professional"],
                ["conversational", "Make conversational"],
                ["followup", "Generate follow-up"],
              ].map(([mode, label]) => (
                <button key={mode} role="menuitem" type="button" disabled={!!aiBusy}
                  onClick={() => aiAction(mode, label)}
                  className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-violet-50 disabled:opacity-50">
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="ml-auto hidden text-[10px] text-slate-400 sm:inline">⌘/Ctrl+Enter to send</span>

        <button type="button" onClick={send} disabled={sending || !body.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  );
}
