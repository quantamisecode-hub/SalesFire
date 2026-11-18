// ThreadView — center pane: chronological messages, Instantly-style density.
// Inbound HTML is rendered sanitized (server sanitized at ingest; we re-sanitize
// client-side with the same policy line) and wrapped to contain layout.
import { useEffect, useRef } from "react";
import { Archive, ArchiveRestore, Star, CalendarClock, CheckCircle2, RotateCcw, Loader2 } from "lucide-react";
import type { InboxConversationDetail } from "@/services/inbox";
import { StatusDot } from "@/components/leads/StatusDot";
import { timeAgo, initialsOf, avatarHue } from "@/lib/time";
import { lightClean } from "@/components/sequence/RichEmailEditor";

export function ThreadView({
  conversation, onToggleStar, onToggleArchive, onSnooze, onToggleRead, pendingAction,
}: {
  conversation: InboxConversationDetail;
  onToggleStar: () => void;
  onToggleArchive: () => void;
  onSnooze: (until: string | null) => void;
  onToggleRead: () => void;
  pendingAction: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [conversation.id, conversation.messages.length]);

  const senderName = (m: (typeof conversation.messages)[number]) =>
    m.direction === "outbound" ? "You" : (m.fromName || m.fromEmail || "Unknown");

  return (
    <section aria-label="Conversation thread" className="flex h-full min-h-0 flex-col bg-white">
      {/* Thread header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-slate-900">{conversation.subject}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>{conversation.accountEmail}</span>
            {conversation.campaignName && (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-slate-600">{conversation.campaignName}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <StatusDot status={conversation.status} />
            {conversation.threadStatus === "needs_review" && (
              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Thread needs review</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onToggleStar} disabled={pendingAction === "star"} aria-label={conversation.isStarred ? "Unstar" : "Star"}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-amber-500 disabled:opacity-50" title={conversation.isStarred ? "Unstar" : "Star"}>
            {pendingAction === "star" ? <Loader2 size={16} className="animate-spin" /> : <Star size={16} className={conversation.isStarred ? "fill-amber-400 text-amber-400" : ""} />}
          </button>
          <button type="button" onClick={onToggleRead} disabled={pendingAction === "read"} aria-label={conversation.unread > 0 ? "Mark as read" : "Mark as unread"}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50" title={conversation.unread > 0 ? "Mark as read" : "Mark as unread"}>
            {pendingAction === "read" ? <Loader2 size={16} className="animate-spin" /> : (conversation.unread > 0 ? <CheckCircle2 size={16} /> : <RotateCcw size={16} />)}
          </button>
          <button type="button" onClick={onToggleArchive} disabled={pendingAction === "archive"} aria-label={conversation.isArchived ? "Unarchive" : "Archive"}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50" title={conversation.isArchived ? "Unarchive" : "Archive"}>
            {pendingAction === "archive" ? <Loader2 size={16} className="animate-spin" /> : (conversation.isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />)}
          </button>
          <SnoozeMenu onSnooze={onSnooze} pending={pendingAction === "snooze"} />
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ol className="space-y-4">
          {conversation.messages.map((m) => {
            const mine = m.direction === "outbound";
            const name = senderName(m);
            const hue = avatarHue(m.fromEmail || name);
            return (
              <li key={m.id} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: mine ? "#4f46e5" : `hsl(${hue} 40% 52%)` }}
                >
                  {mine ? "You" : initialsOf(name, m.fromEmail)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-slate-800">{name}</span>
                    {!mine && m.fromEmail && <span className="text-[11px] text-slate-400">{m.fromEmail}</span>}
                    <span className="ml-auto text-[10px] tabular-nums text-slate-400">
                      {timeAgo(m.receivedAt || m.sentAt || m.createdAt)}
                    </span>
                  </div>
                  {m.messageType !== "UNKNOWN" && m.messageType !== "HUMAN_REPLY" && (
                    <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">{m.messageType.replace(/_/g, " ")}</p>
                  )}
                  <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[13px] leading-relaxed text-slate-800">
                    {m.textBody ? (
                      <pre className="whitespace-pre-wrap font-sans">{m.textBody}</pre>
                    ) : m.htmlBody ? (
                      <div className="inbound-html max-w-none" dangerouslySetInnerHTML={{ __html: lightClean(m.htmlBody) }} />
                    ) : (
                      <em className="text-slate-400">(empty message)</em>
                    )}
                  </div>
                  {m.attachments?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {m.attachments.map((a, i) => (
                        <li key={i} className="text-[11px] text-slate-500">📎 {a.filename} ({Math.round(a.size / 1024)} KB)</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div ref={bottomRef} aria-hidden />
      </div>
    </section>
  );
}

function SnoozeMenu({ onSnooze, pending }: { onSnooze: (until: string | null) => void; pending: boolean }) {
  const options: Array<{ label: string; hours: number | null }> = [
    { label: "Later today", hours: 4 },
    { label: "Tomorrow", hours: 24 },
    { label: "Next week", hours: 24 * 7 },
    { label: "Never snooze this thread", hours: null },
  ];
  return (
    <div className="relative group">
      <button type="button" disabled={pending} aria-label="Snooze conversation" aria-haspopup="menu"
        className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50" title="Snooze">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
      </button>
      <div role="menu" className="invisible absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-700 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {options.map((o) => (
          <button key={o.label} role="menuitem" type="button"
            onClick={() => onSnooze(o.hours === null ? null : new Date(Date.now() + o.hours * 3600 * 1000).toISOString())}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
