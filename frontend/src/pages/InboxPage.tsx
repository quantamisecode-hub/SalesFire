// Unified Inbox — /campaigns/inbox[/:conversationId]
// Three panes: conversation list | thread + composer | lead/conversation context.
// Instantly-grade density and information layout; all data is live from the API.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Inbox, PanelRight, Loader2, CheckCheck } from "lucide-react";
import { inboxService, type InboxConversationListItem, type InboxConversationDetail, type InboxMember } from "@/services/inbox";
import { ConversationList, type InboxFilter } from "@/components/inbox/ConversationList";
import { ThreadView } from "@/components/inbox/ThreadView";
import { ReplyComposer } from "@/components/inbox/ReplyComposer";
import { ContextPanel } from "@/components/inbox/ContextPanel";
import { useToast } from "@/components/ui/Toast";

export function InboxPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [filter, setFilter] = useState<InboxFilter>((searchParams.get("filter") as InboxFilter) || "all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [conversations, setConversations] = useState<InboxConversationListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [detail, setDetail] = useState<InboxConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [members, setMembers] = useState<InboxMember[]>([]);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const [contextOpen, setContextOpen] = useState(false);

  const searchTimer = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await inboxService.list({
        filter,
        search: search || undefined,
        page,
        pageSize: 25,
      });
      setConversations(res.data || []);
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err: any) {
      setListError(err?.data?.error || err?.message || "Unable to load conversations.");
    } finally {
      setListLoading(false);
    }
  }, [filter, search, page]);

  useEffect(() => { loadList(); }, [loadList]);

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [searchInput]);

  // Poll for updates every 45s (skipped while tab hidden); back off on error
  useEffect(() => {
    const tick = () => { if (!document.hidden) loadList(); };
    pollRef.current = window.setInterval(tick, 45000);
    const onFocus = () => loadList();
    window.addEventListener("focus", onFocus);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadList]);

  useEffect(() => {
    inboxService.listMembers().then((r) => setMembers(r.data || [])).catch(() => {});
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await inboxService.get(id);
      setDetail(res.data);
      // Auto-mark read when opened (Instantly-style); badge updates on next list fetch
      if (res.data.unread > 0) {
        inboxService.markRead(id).catch(() => {});
      }
    } catch (err: any) {
      setDetailError(err?.data?.error || err?.message || "Unable to load the conversation.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!conversationId) { setDetail(null); return; }
    loadDetail(conversationId);
  }, [conversationId, loadDetail]);

  const selectConversation = (id: string) => {
    navigate(`/campaigns/inbox/${id}`, { replace: false });
    setMobilePane("thread");
    setContextOpen(false);
  };

  const refreshAll = useCallback(() => {
    loadList();
    if (conversationId) loadDetail(conversationId);
  }, [loadList, loadDetail, conversationId]);

  const action = async (label: string, fn: () => Promise<unknown>) => {
    setPendingAction(label);
    try {
      await fn();
      refreshAll();
    } catch (err: any) {
      toast.error(err?.data?.error || err?.message || "Action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const activeId = conversationId || null;

  const conversationBody = (
    <>
      {detailLoading && !detail ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
      ) : detailError ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm text-red-600">{detailError}</p>
          <button type="button" onClick={() => activeId && loadDetail(activeId)} className="text-sm font-medium text-primary hover:underline">Retry</button>
        </div>
      ) : detail ? (
        <>
          <ThreadView
            conversation={detail}
            pendingAction={pendingAction}
            onToggleStar={() => action("star", () => inboxService.star(detail.id))}
            onToggleArchive={() => action("archive", () => detail.isArchived ? inboxService.unarchive(detail.id) : inboxService.archive(detail.id))}
            onSnooze={(until) => action("snooze", () => inboxService.snooze(detail.id, until))}
            onToggleRead={() => action("read", () => detail.unread > 0 ? inboxService.markRead(detail.id) : inboxService.markUnread(detail.id))}
          />
          <ReplyComposer conversation={detail} accountEmail={detail.accountEmail} onSent={refreshAll} />
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
          <Inbox size={40} className="text-slate-200" aria-hidden />
          <p className="text-sm font-medium text-slate-500">Select a conversation</p>
          <p className="max-w-[260px] text-xs text-slate-400">Replies from your prospects and campaign recipients will show up here with full lead and campaign context.</p>
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
      {/* Header bar */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Mobile back */}
          {mobilePane === "thread" && (
            <button type="button" onClick={() => setMobilePane("list")} aria-label="Back to list"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden">
              <ArrowLeft size={16} />
            </button>
          )}
          <h1 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            <Inbox size={17} className="text-primary-600" aria-hidden /> Unified Inbox
          </h1>
          <span className="hidden text-[11px] tabular-nums text-slate-400 sm:inline">
            {pagination.total} thread{pagination.total === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => action("read-all", () => inboxService.markAllRead())}
            disabled={pendingAction === "read-all"}
            title="Mark all as read" aria-label="Mark all as read"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
            <CheckCheck size={14} /> <span className="hidden sm:inline">Mark all read</span>
          </button>
          <button type="button" onClick={() => setContextOpen(true)}
            aria-label="Toggle context panel" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 xl:hidden">
            <PanelRight size={16} />
          </button>
        </div>
      </header>

      {/* Body: list | thread | context */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(280px,320px)]">
        {/* List pane — hidden on mobile when viewing thread */}
        <div className={`${mobilePane === "list" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>
          <ConversationList
            conversations={conversations}
            selectedId={activeId}
            onSelect={selectConversation}
            filter={filter}
            onFilterChange={(f) => { setFilter(f); setPage(1); }}
            search={searchInput}
            onSearchChange={setSearchInput}
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            onPageChange={setPage}
            isLoading={listLoading}
            error={listError}
            onRetry={loadList}
          />
        </div>

        {/* Thread pane */}
        <div className={`${mobilePane === "thread" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex`}>
          {conversationBody}
        </div>

        {/* Context pane — desktop */}
        <div className="hidden min-h-0 flex-col xl:flex">
          {detail ? (
            <ContextPanel conversation={detail} members={members} />
          ) : (
            <div className="flex h-full items-center justify-center border-l border-slate-100 p-6 text-center text-xs text-slate-400">
              Lead and company context appears here once you open a conversation.
            </div>
          )}
        </div>
      </div>

      {/* Context drawer — < xl */}
      {contextOpen && detail && (
        <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Lead and conversation context">
          <button className="absolute inset-0 bg-slate-900/40" aria-label="Close panel" onClick={() => setContextOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[min(92vw,380px)] overflow-y-auto bg-white shadow-2xl">
            <button onClick={() => setContextOpen(false)} aria-label="Close" className="sticky top-0 z-10 ml-auto mr-2 mt-2 rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">✕</button>
            <ContextPanel conversation={detail} members={members} />
          </div>
        </div>
      )}
    </div>
  );
}
