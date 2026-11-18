// ConversationList — left pane of the unified inbox.
// Instantly-style compact rows: unread dot, sender, company, subject, snippet,
// relative time, campaign + account context. Search + filter chips; server-side
// pagination and debounced search.
import { Search, Inbox, Star, Archive, X } from "lucide-react";
import type { InboxConversationListItem } from "@/services/inbox";
import { StatusDot } from "@/components/leads/StatusDot";
import { timeAgo, initialsOf, avatarHue } from "@/lib/time";

export type InboxFilter =
  | "all" | "unread" | "mine" | "assigned" | "starred"
  | "needs_reply" | "replied" | "closed" | "snoozed" | "archived";

const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "mine", label: "Mine" },
  { value: "assigned", label: "Assigned" },
  { value: "starred", label: "Starred" },
  { value: "needs_reply", label: "Needs Reply" },
  { value: "replied", label: "Replied" },
  { value: "closed", label: "Closed" },
  { value: "snoozed", label: "Snoozed" },
  { value: "archived", label: "Archived" },
];

export function ConversationList({
  conversations, selectedId, onSelect, filter, onFilterChange, search, onSearchChange,
  page, pages, total, onPageChange, isLoading, error, onRetry,
}: {
  conversations: InboxConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  page: number; pages: number; total: number;
  onPageChange: (p: number) => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section aria-label="Conversations" className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50/40">
      {/* Search */}
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
        {/* Filter chips */}
        <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Inbox filters">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => onFilterChange(f.value)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                filter === f.value
                  ? "bg-primary text-white shadow-sm"
                  : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
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
            return (
              <button
                key={c.id}
                role="option"
                aria-selected={active}
                onClick={() => onSelect(c.id)}
                className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                  active ? "bg-indigo-50/70" : "hover:bg-slate-100/70"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {/* Avatar */}
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: `hsl(${avatarHue(c.lead?.email || c.id)} 40% 52%)` }}
                  >
                    {initialsOf(name, c.lead?.email)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {c.unread > 0 && <span aria-label={`${c.unread} unread`} className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      <span className={`truncate text-[13px] ${c.unread > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                        {name}
                      </span>
                      {c.isStarred && <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
                      {c.isArchived && <Archive size={11} className="shrink-0 text-slate-400" aria-label="Archived" />}
                      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-400">
                        {timeAgo(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">
                      {c.lead?.companyName || "—"}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-slate-600">{c.subject}</span>
                    {c.snippet && (
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">{c.snippet}</span>
                    )}
                    <span className="mt-1 flex items-center gap-2">
                      {c.campaignName && (
                        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
                          {c.campaignName}
                        </span>
                      )}
                      <StatusDot status={c.status} />
                    </span>
                  </span>
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
