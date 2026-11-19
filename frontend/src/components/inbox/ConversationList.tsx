// ConversationList — mailbox list pane of the unified inbox.
// Folder filtering lives in the MailboxSidebar; this pane owns search, sort
// (Smartlead-style: latest reply / unread first / oldest) and pagination.
// Rows: subject-forward email-list density — sender, subject, snippet,
// relative time, campaign + account context.
import { Search, Inbox, Star, Archive, X } from "lucide-react";
import type { InboxConversationListItem } from "@/services/inbox";
import { StatusDot } from "@/components/leads/StatusDot";
import { timeAgo, initialsOf, avatarHue } from "@/lib/time";

export type InboxSort = "last_message_at" | "unread" | "oldest";

const SORTS: Array<{ value: InboxSort; label: string }> = [
  { value: "last_message_at", label: "Latest reply" },
  { value: "unread", label: "Unread first" },
  { value: "oldest", label: "Oldest" },
];

export function ConversationList({
  conversations, selectedId, onSelect, search, onSearchChange,
  sort, onSortChange,
  page, pages, total, onPageChange, isLoading, error, onRetry,
}: {
  conversations: InboxConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  sort: InboxSort;
  onSortChange: (s: InboxSort) => void;
  page: number; pages: number; total: number;
  onPageChange: (p: number) => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section aria-label="Conversations" className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
      {/* Search + sort */}
      <div className="border-b border-slate-200 p-2.5">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations, people, companies…"
            aria-label="Search conversations"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-[13px] text-slate-700 placeholder-slate-400 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
          {search && (
            <button type="button" onClick={() => onSearchChange("")} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          )}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
          Sort
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as InboxSort)}
            aria-label="Sort conversations"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-medium text-slate-600 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Conversation list" aria-busy={isLoading}>
        {isLoading ? (
          <div className="space-y-2 p-3" aria-label="Loading conversations">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium text-primary hover:underline">Retry</button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <Inbox size={32} className="text-slate-300" aria-hidden />
            <p className="text-sm font-medium text-slate-600">
              {search ? "No conversations match these filters." : "No conversations yet."}
            </p>
            {!search && (
              <p className="max-w-[220px] text-xs text-slate-400">Once prospects reply to your campaigns, their conversations will appear here.</p>
            )}
          </div>
        ) : (
          conversations.map((c) => {
            const active = c.id === selectedId;
            const name = c.lead ? [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ") || c.lead.email : "Unknown sender";
            const subject = c.subject || "(no subject)";
            return (
              <button
                key={c.id}
                role="option"
                aria-selected={active}
                onClick={() => onSelect(c.id)}
                className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                  active ? "bg-primary-50/70" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-baseline gap-2">
                  {c.unread > 0 && <span aria-label={`${c.unread} unread`} className="mt-1 h-2 w-2 shrink-0 self-center rounded-full bg-primary" />}
                  <span className={`min-w-0 truncate text-[13px] ${c.unread > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                    {name}
                  </span>
                  {c.isStarred && <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
                  {c.isArchived && <Archive size={11} className="shrink-0 text-slate-400" aria-label="Archived" />}
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-400">
                    {timeAgo(c.lastMessageAt)}
                  </span>
                </div>
                <p className={`mt-0.5 truncate text-[12.5px] text-slate-800 ${c.unread > 0 ? "font-semibold" : "font-medium"}`}>
                  {subject}
                </p>
                {c.snippet && (
                  <p className="mt-0.5 truncate text-[11.5px] text-slate-400">{c.snippet}</p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 select-none items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ backgroundColor: `hsl(${avatarHue(c.lead?.email || c.id)} 40% 52%)` }}
                    aria-hidden>
                    {initialsOf(name, c.lead?.email)}
                  </span>
                  {c.campaignName && (
                    <span className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {c.campaignName}
                    </span>
                  )}
                  <StatusDot status={c.status} />
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        <span className="tabular-nums">{total} conversation{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40 hover:bg-slate-100">Prev</button>
          <span className="tabular-nums">Page {page}/{Math.max(1, pages)}</span>
          <button type="button" disabled={page >= pages} onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40 hover:bg-slate-100">Next</button>
        </div>
      </div>
    </section>
  );
}
