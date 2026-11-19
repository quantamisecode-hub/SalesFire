// ThreadView — center pane: mailbox reading view (SmartLead Master Inbox /
// Gmail-style), NOT chat. Each message is a full-width email card with a
// From / To / Date header and an unboxed body; earlier messages collapse to a
// one-line preview and expand on click (newest + unread start expanded).
// Inbound HTML is rendered sanitized (server sanitized at ingest; we re-sanitize
// client-side with the same policy line) and wrapped to contain layout.
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Star, CalendarClock, CheckCircle2, RotateCcw, Loader2, ChevronDown, Paperclip } from "lucide-react";
import type { InboxConversationDetail, InboxMessage } from "@/services/inbox";
import { StatusDot } from "@/components/leads/StatusDot";
import { timeAgo, initialsOf, avatarHue } from "@/lib/time";
import { lightClean } from "@/components/sequence/RichEmailEditor";

function formatFullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const senderName = (m: InboxMessage) =>
  m.direction === "outbound" ? "You" : m.fromName || m.fromEmail || "Unknown sender";

/** One collapsed/expandable email card in the reading pane. */
function EmailCard({
  message, expanded, onToggle, isLast,
}: {
  message: InboxMessage;
  expanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const m = message;
  const mine = m.direction === "outbound";
  const name = senderName(m);
  const hue = avatarHue(m.fromEmail || name);
  const date = m.sentAt || m.receivedAt || m.createdAt;
  const toLine = (m.toEmails || []).join(", ");

  return (
    <li
      data-testid="email-card"
      data-direction={m.direction}
      className={`overflow-hidden rounded-xl border bg-white transition ${
        mine ? "border-l-[3px] border-l-indigo-400 border-y-slate-200 border-r-slate-200" : "border-slate-200"
      } ${!isLast ? "shadow-sm" : "shadow-sm"}`}
    >
      {/* Header — clickable collapse/expand row */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} message from ${name}`}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: mine ? "#4f46e5" : `hsl(${hue} 40% 52%)` }}
        >
          {initialsOf(name, m.fromEmail)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-semibold text-slate-900">{name}</span>
            {m.fromEmail && (
              <span className="truncate text-[11px] text-slate-400">&lt;{m.fromEmail}&gt;</span>
            )}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400">
              {expanded ? formatFullDate(date) : timeAgo(date)}
            </span>
            <ChevronDown
              size={14}
              aria-hidden
              className={`shrink-0 text-slate-300 transition ${expanded ? "rotate-180" : ""}`}
            />
          </span>
          {!expanded && m.snippet && (
            <span className="mt-0.5 block truncate text-[12px] text-slate-500">{m.snippet}</span>
          )}
        </span>
      </button>

      {/* Expanded body — full-width email block */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-600">To:</span>
            <span className="truncate">{toLine || "(unknown recipient)"}</span>
            {m.messageType !== "UNKNOWN" && m.messageType !== "HUMAN_REPLY" && (
              <span className="ml-auto rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                {m.messageType.replace(/_/g, " ")}
              </span>
            )}
          </p>
          <div className="max-w-none text-[13px] leading-relaxed text-slate-800 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-500 [&_a]:text-primary [&_a]:underline [&_table]:max-w-full">
            {m.textBody && !m.htmlBody ? (
              <pre className="whitespace-pre-wrap font-sans">{m.textBody}</pre>
            ) : m.htmlBody ? (
              <div className="inbound-html" dangerouslySetInnerHTML={{ __html: lightClean(m.htmlBody) }} />
            ) : m.textBody ? (
              <pre className="whitespace-pre-wrap font-sans">{m.textBody}</pre>
            ) : (
              <em className="text-slate-400">(empty message)</em>
            )}
          </div>
          {m.attachments?.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
              {m.attachments.map((a, i) => (
                <li key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                  <Paperclip size={11} aria-hidden /> {a.filename}
                  <span className="text-slate-400">({Math.max(1, Math.round(a.size / 1024))} KB)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

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
  const endRef = useRef<HTMLDivElement>(null);

  // Default expansion: newest message + any unread inbound message open;
  // everything else collapses to a preview row (mailbox reading convention).
  const defaultExpanded = useMemo(() => {
    const set: Record<string, boolean> = {};
    const msgs = conversation.messages;
    msgs.forEach((m, i) => {
      const unreadInbound = m.direction === "inbound" && !m.isRead;
      if (i === msgs.length - 1 || unreadInbound) set[m.id] = true;
    });
    return set;
  }, [conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [expanded, setExpanded] = useState<Record<string, boolean>>(defaultExpanded);

  // Reset expansion when switching conversations.
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    // scrollIntoView is unavailable in jsdom — guard for tests.
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [conversation.id, conversation.messages.length]);

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

      {/* Messages — full-width email cards */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 px-4 py-4">
        <ol className="space-y-3" data-testid="email-thread">
          {conversation.messages.map((m, i) => (
            <EmailCard
              key={m.id}
              message={m}
              isLast={i === conversation.messages.length - 1}
              expanded={!!expanded[m.id]}
              onToggle={() => toggle(m.id)}
            />
          ))}
        </ol>
        <div ref={endRef} aria-hidden />
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
