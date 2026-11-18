// Campaign List page - Prompt 6 §6.
// Server-side pagination, search, sort and filtering; real metrics and
// status-aware row actions (View / Edit / Pause / Resume / Duplicate / Archive).
import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus, Search, ExternalLink, Pencil, Pause, Play, Copy, Archive,
  Loader2, ChevronLeft, ChevronRight, Megaphone, Trash2,
} from "lucide-react";
import { campaignService } from "@/services/campaign";
import { useAuth } from "@/contexts/AuthContext";
import { onCampaignUpdated } from "@/socket";
import { Badge, titleCaseStatus } from "@/components/Badge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Campaign } from "@/types/prompt5";

const STATUS_FILTERS = ["all", "draft", "ready_for_review", "scheduled", "active", "paused", "completed", "cancelled", "archived"];

export function CampaignListPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [searchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") || "");
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [status, setStatus] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();

  useEffect(() => {
    if (!isAuthenticated) navigate("/login");
  }, [isAuthenticated, navigate]);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await campaignService.list({
        status: status !== "all" ? status : undefined,
        search: search || undefined,
        sortBy,
        sortDir,
        page,
        pageSize: 10,
      } as any);
      setCampaigns(result?.data || []);
      setPagination(result?.pagination || { page: 1, pages: 1, total: 0 });
    } catch {
      setError("Failed to load campaigns.");
    } finally {
      setIsLoading(false);
    }
  }, [status, search, sortBy, sortDir, page]);

  useEffect(() => { load(); }, [load]);

  // Keep the list in sync with ?q= when the header search navigates here.
  useEffect(() => {
    const q = searchParams.get("q") || "";
    setSearchInput(q);
    setSearch(q);
    setPage(1);
  }, [searchParams]);

  // Live sync: refetch the list whenever any campaign in this org changes
  // (launch/pause/resume/edit from another session).
  useEffect(() => onCampaignUpdated(() => { void load(); }), [load]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const toggleSort = (column: string) => {
    setPage(1);
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
  };

  const rowAction = async (c: Campaign, action: "pause" | "resume" | "duplicate" | "archive" | "delete") => {
    setBusyId(c.id);
    try {
      if (action === "pause") { await campaignService.pause(c.id); toast.success(`"${c.name}" paused.`); }
      if (action === "resume") { await campaignService.resume(c.id); toast.success(`"${c.name}" resumed.`); }
      if (action === "duplicate") { await campaignService.duplicate(c.id); toast.success(`"${c.name}" duplicated.`); }
      if (action === "archive") {
        const ok = await confirm({
          title: `Archive "${c.name}"?`,
          message: "Queued emails stop; the campaign becomes read-only and history is preserved. You can delete it later instead.",
          confirmLabel: "Archive",
        });
        if (!ok) return;
        await campaignService.archive(c.id);
        toast.success(`"${c.name}" archived.`);
      }
      if (action === "delete") {
        const ok = await confirm({
          title: `Delete "${c.name}"?`,
          message: "This permanently deletes the campaign, its sequence, recipients, jobs and analytics. The leads themselves are kept. This cannot be undone.",
          confirmLabel: "Delete campaign",
        });
        if (!ok) return;
        await campaignService.deleteCampaign(c.id);
        toast.success(`"${c.name}" deleted.`);
      }
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  if (!isAuthenticated || !user) return null;

  const SortHeader = ({ label, column }: { label: string; column: string }) => (
    <th className="px-4 py-3">
      <button
        onClick={() => toggleSort(column)}
        className="inline-flex items-center gap-1 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sortBy === column && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} campaign(s)</p>
        </div>
        <Link
          to="/campaigns/new"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Plus size={16} /> Create Campaign
        </Link>
      </header>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={status === s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                status === s
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {s === "all" ? "All" : titleCaseStatus(s)}
            </button>
          ))}
        </div>
        <form onSubmit={submitSearch} className="lg:ml-auto flex gap-2">
          <input
            type="search"
            aria-label="Search campaigns"
            placeholder="Search campaigns…"
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 w-56 focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" aria-label="Search" className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
            <Search size={15} />
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3" aria-label="Loading campaigns">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-red-600 text-sm mb-3">{error}</p>
            <button onClick={load} className="text-sm font-medium text-primary hover:underline">Try again</button>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center">
            <Megaphone className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">
              {search || status !== "all" ? "No campaigns match your filters" : "No campaigns yet"}
            </h3>
            <p className="text-sm text-slate-500 mt-1">Create a campaign to start sending outreach emails.</p>
            <Link
              to="/campaigns/new"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90"
            >
              <Plus size={16} /> Create Campaign
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <SortHeader label="Campaign" column="name" />
                  <SortHeader label="Status" column="status" />
                  <th className="px-4 py-3">Audience</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Delivered</th>
                  <th className="px-4 py-3">Replies</th>
                  <th className="px-4 py-3">Bounce Rate</th>
                  <th className="px-4 py-3">Reply Rate</th>
                  <SortHeader label="Scheduled" column="scheduledStartAt" />
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((c) => {
                  const live = c.status === "active" || c.status === "running";
                  const bounceRate = c.emailsSent > 0 ? Math.round((c.emailsBounced / c.emailsSent) * 100) : 0;
                  const replyRate = c.emailsSent > 0 ? Math.round((c.emailsReplied / c.emailsSent) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link to={`/campaigns/${c.id}`} title={c.name} className="font-medium text-slate-900 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 rounded block max-w-[220px] truncate">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3"><Badge status={c.status} /></td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{c.totalLeads ?? 0}</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{c.emailsSent}</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{c.emailsDelivered}</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{c.emailsReplied}</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{bounceRate}%</td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">{replyRate}%</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {c.scheduledStartAt ? new Date(c.scheduledStartAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {c.createdBy === user.id ? "You" : c.createdBy?.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5" aria-label={`Actions for ${c.name}`}>
                          <RowAction title="View" onClick={() => navigate(`/campaigns/${c.id}`)}>
                            <ExternalLink size={14} />
                          </RowAction>
                          {["draft", "ready_for_review", "paused"].includes(c.status) && (
                            <RowAction title="Edit" onClick={() => navigate(`/campaigns/${c.id}/edit`)}>
                              <Pencil size={14} />
                            </RowAction>
                          )}
                          {live && (
                            <RowAction
                              title="Pause"
                              disabled={busyId === c.id}
                              onClick={() => rowAction(c, "pause")}
                            >
                              {busyId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
                            </RowAction>
                          )}
                          {c.status === "paused" && (
                            <RowAction title="Resume" disabled={busyId === c.id} onClick={() => rowAction(c, "resume")}>
                              {busyId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            </RowAction>
                          )}
                          <RowAction title="Duplicate" disabled={busyId === c.id} onClick={() => rowAction(c, "duplicate")}>
                            <Copy size={14} />
                          </RowAction>
                          {c.status !== "archived" && (
                            <RowAction title="Archive" danger disabled={busyId === c.id} onClick={() => rowAction(c, "archive")}>
                              <Archive size={14} />
                            </RowAction>
                          )}
                          {["draft", "archived"].includes(c.status) && (
                            <RowAction title="Delete" danger disabled={busyId === c.id} onClick={() => rowAction(c, "delete")}>
                              {busyId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </RowAction>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Campaign pages">
          <span className="text-xs text-slate-500">
            Page {pagination.page} of {pagination.pages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              disabled={pagination.page >= pagination.pages}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

function RowAction({
  title, onClick, children, danger, disabled,
}: {
  title: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40 ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}
