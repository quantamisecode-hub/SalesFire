// AudienceStep — table-first lead management for the campaign wizard (§1-5).
// The leads table IS the interface: server-side pagination/search/sort/filters,
// column visibility, row selection with bulk actions, Import Leads workflow,
// Add Lead modal and a detail drawer. Enrollment is a real backend action.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Upload, UserPlus, Loader2, RefreshCw, Columns3, SlidersHorizontal,
  Trash2, MoreVertical, Eye, Ban, Users, X, ChevronLeft, ChevronRight, Download,
} from "lucide-react";
import { leadService } from "@/services/lead";
import { campaignService } from "@/services/campaign";
import { LeadImportModal } from "./LeadImportModal";
import { AddLeadModal } from "./AddLeadModal";
import { LeadDetailDrawer } from "./LeadDetailDrawer";
import { Badge } from "@/components/Badge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Lead } from "@/types/lead";
import type { AudienceCounts, CampaignRecipient } from "@/types/prompt6";

const LEAD_STATUSES = ["new", "approved", "contacted", "replied", "bounced", "unsubscribed", "suppressed", "invalid"];
const EMAIL_STATUSES = ["unknown", "verified", "invalid", "bounced", "unsubscribed", "syntax_valid", "domain_valid", "mx_valid"];

// Column management (§9) — visibility persisted in localStorage.
const COLUMN_DEFS = [
  { key: "firstName", label: "First Name", sortable: true },
  { key: "lastName", label: "Last Name", sortable: true },
  { key: "companyName", label: "Company Name", sortable: true },
  { key: "jobTitle", label: "Job Title", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "phone", label: "Phone", sortable: false },
  { key: "website", label: "Website", sortable: false },
  { key: "linkedin", label: "LinkedIn", sortable: false },
  { key: "location", label: "Location", sortable: false },
  { key: "industry", label: "Industry", sortable: false },
  { key: "companySize", label: "Company Size", sortable: false },
  { key: "leadScore", label: "Lead Score", sortable: true },
  { key: "emailStatus", label: "Email Status", sortable: true },
  { key: "status", label: "Lead Status", sortable: true },
  { key: "createdAt", label: "Created At", sortable: true },
] as const;
type ColKey = typeof COLUMN_DEFS[number]["key"];
const DEFAULT_COLS: ColKey[] = ["firstName", "lastName", "companyName", "jobTitle", "email", "status", "leadScore"];
const COLS_STORAGE = "salesfire.leads.columns";

function scoreCell(n?: number | null) {
  if (n === null || n === undefined) return <span className="text-xs text-slate-400">Not scored</span>;
  const tone =
    n >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : n >= 60 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${tone}`}>{n}</span>;
}

export function AudienceStep({
  campaignId, counts, enrolled, onCountsChanged,
}: {
  campaignId: string | null;
  counts: AudienceCounts | null;
  enrolled: CampaignRecipient[];
  onCountsChanged: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailStatusFilter, setEmailStatusFilter] = useState("all");
  const [industryFilter, setIndustryFilter] = useState("");
  const [minScore, setMinScore] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(() => {
    try {
      const saved = localStorage.getItem(COLS_STORAGE);
      if (saved) { const p = JSON.parse(saved); if (Array.isArray(p) && p.length) return p; }
    } catch { /* ignore */ }
    return DEFAULT_COLS;
  });
  const [colsOpen, setColsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    try { localStorage.setItem(COLS_STORAGE, JSON.stringify(visibleCols)); } catch { /* ignore */ }
  }, [visibleCols]);

  // Debounced search (§11) — no query per keystroke.
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => { setSearch(v.trim()); setPage(1); }, 350);
  };

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const res = await leadService.list({
        page, pageSize: 20, search: search || undefined,
        sortBy, sortDir,
        status: statusFilter !== "all" ? statusFilter : undefined,
        emailStatus: emailStatusFilter !== "all" ? emailStatusFilter : undefined,
        industry: industryFilter || undefined,
        minScore: minScore ? parseInt(minScore, 10) : undefined,
        campaignId: campaignId || undefined,
      });
      setLeads(res.data || []);
      setPagination(res.pagination);
    } catch {
      setError("Failed to load leads.");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, sortBy, sortDir, statusFilter, emailStatusFilter, industryFilter, minScore, campaignId]);

  useEffect(() => { load(); }, [load]);

  const allOnPageSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.add(l.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const afterChange = () => { onCountsChanged(); load(); };

  const bulkAddToCampaign = async () => {
    if (!campaignId) { toast.error("Save the campaign details first (step 1)."); return; }
    setBusy(true);
    try {
      const res = await leadService.bulkAddToCampaign([...selected], campaignId);
      setSelected(new Set());
      toast.success(`${res.counts.created} lead(s) added to the campaign.` +
        (res.counts.rejected ? ` ${res.counts.rejected} skipped (suppressed or already enrolled).` : ""));
      afterChange();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to add leads to the campaign.");
    } finally { setBusy(false); }
  };

  const bulkSuppress = async () => {
    const ok = await confirm({
      title: `Suppress ${selected.size} lead${selected.size === 1 ? "" : "s"}?`,
      message: "They will never receive campaign emails. You can unsuppress them later from the lead record.",
      confirmLabel: "Suppress",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await leadService.bulkSuppress([...selected]);
      setSelected(new Set());
      toast.success(`${selected.size} lead(s) suppressed org-wide.`);
      afterChange();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to suppress leads.");
    } finally { setBusy(false); }
  };

  const bulkDelete = async () => {
    const ok = await confirm({
      title: `Delete ${selected.size} lead${selected.size === 1 ? "" : "s"}?`,
      message: "This permanently deletes the selected leads and their campaign enrollments. This cannot be undone.",
      confirmLabel: "Delete leads",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await leadService.bulkDelete([...selected]);
      setSelected(new Set());
      toast.success(`${selected.size} lead(s) deleted.`);
      afterChange();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to delete leads.");
    } finally { setBusy(false); }
  };

  const removeEnrolled = async (rid: string) => {
    if (!campaignId) return;
    try {
      await campaignService.removeRecipient(campaignId, rid);
      toast.success("Recipient removed from the campaign.");
      onCountsChanged();
    } catch (err: any) { toast.error(err?.data?.error || "Failed to remove the recipient."); }
  };

  const activeFilters = (statusFilter !== "all" ? 1 : 0) + (emailStatusFilter !== "all" ? 1 : 0) + (industryFilter ? 1 : 0) + (minScore ? 1 : 0);
  const cols = useMemo(() => COLUMN_DEFS.filter((c) => visibleCols.includes(c.key)), [visibleCols]);

  const cell = (l: Lead, key: ColKey) => {
    switch (key) {
      case "firstName": return l.firstName || "—";
      case "lastName": return l.lastName || "—";
      case "companyName": return l.companyName || "—";
      case "jobTitle": return l.jobTitle || "—";
      case "email": return l.email;
      case "phone": return l.phone || "—";
      case "website": return l.website || "—";
      case "linkedin": return l.linkedin || "—";
      case "location": return l.location || "—";
      case "industry": return l.industry || "—";
      case "companySize": return l.companySize || "—";
      case "leadScore": return scoreCell(l.leadScore);
      case "emailStatus": return <Badge status={l.emailStatus} />;
      case "status": return <Badge status={l.status} />;
      case "createdAt": return new Date(l.createdAt).toLocaleDateString();
      default: return "—";
    }
  };

  return (
    <div className="space-y-4" data-testid="audience-step">
      {/* Header (§2) */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Leads</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage, organize and prepare prospects for this campaign. Select leads and add them to the campaign.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setColsOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
            <Columns3 size={15} /> Columns
          </button>
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border ${filtersOpen ? "border-primary text-primary bg-indigo-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
            <SlidersHorizontal size={15} /> Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <button type="button" onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
            <Upload size={15} /> Import Leads
          </button>
          <button type="button" onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
            <UserPlus size={15} /> Add Lead
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search" aria-label="Search leads" placeholder="Search leads…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={searchInput} onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Columns panel (§9) */}
      {colsOpen && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase">Visible columns</p>
            <button onClick={() => setVisibleCols(DEFAULT_COLS)} className="text-xs text-primary hover:underline">Reset</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {COLUMN_DEFS.map((c) => (
              <label key={c.key} className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={visibleCols.includes(c.key)}
                  onChange={() => setVisibleCols((p) => p.includes(c.key) ? p.filter((k) => k !== c.key) : [...p, c.key])} />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Filters drawer (§10) — server-side */}
      {filtersOpen && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lead status</label>
            <select className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300" value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email status</label>
            <select className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300" value={emailStatusFilter}
              onChange={(e) => { setEmailStatusFilter(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              {EMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Industry</label>
            <input className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300" value={industryFilter}
              placeholder="e.g. Software" onChange={(e) => { setIndustryFilter(e.target.value); setPage(1); }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Min lead score</label>
            <input type="number" min={0} max={100} className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300" value={minScore}
              placeholder="0" onChange={(e) => { setMinScore(e.target.value); setPage(1); }} />
          </div>
          <button type="button" onClick={() => { setStatusFilter("all"); setEmailStatusFilter("all"); setIndustryFilter(""); setMinScore(""); setPage(1); }}
            className="sm:col-span-4 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 w-fit">
            <X size={12} /> Clear all filters
          </button>
        </div>
      )}

      {/* Bulk toolbar (§5) — only backend-implemented actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5" data-testid="bulk-toolbar">
          <span className="text-sm font-medium text-indigo-900">{selected.size} lead(s) selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={bulkAddToCampaign} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Add to Campaign
            </button>
            <a type="button" href={leadService.exportUrl([...selected])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
              <Download size={13} /> Export
            </a>
            <button type="button" onClick={bulkSuppress} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-50 disabled:opacity-50">
              <Ban size={13} /> Suppress
            </button>
            <button type="button" onClick={bulkDelete} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50">
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Leads table (§3-4) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2" aria-label="Loading leads">
            {[...Array(6)].map((_, i) => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button type="button" onClick={load} className="text-sm font-medium text-primary hover:underline">Try again</button>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">
              {search || activeFilters ? "No leads match your filters" : "No leads yet"}
            </h3>
            <p className="text-sm text-slate-500 mt-1">Import a list or add a lead manually to build this campaign's audience.</p>
            <button type="button" onClick={() => setImportOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
              <Upload size={15} /> Import Leads
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm" data-testid="leads-table">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-3 py-2.5 w-10">
                    <input type="checkbox" aria-label="Select all" checked={allOnPageSelected} onChange={toggleAll} />
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                      {c.sortable ? (
                        <button type="button" onClick={() => {
                          if (sortBy === c.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setSortBy(c.key); setSortDir("asc"); }
                          setPage(1);
                        }} className="inline-flex items-center gap-1 hover:text-slate-800" aria-label={`Sort by ${c.label}`}>
                          {c.label}{sortBy === c.key && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 w-12 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setDetailId(l.id)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${l.email}`} checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} />
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[220px] truncate">{cell(l, c.key)}</td>
                    ))}
                    <td className="px-3 py-2 text-right relative" onClick={(e) => e.stopPropagation()}>
                      <button type="button" aria-label={`Actions for ${l.email}`}
                        onClick={() => setMenuFor((m) => (m === l.id ? null : l.id))}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                        <MoreVertical size={15} />
                      </button>
                      {menuFor === l.id && (
                        <div className="absolute right-2 top-8 z-20 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1 text-sm">
                          <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-2"
                            onClick={() => { setDetailId(l.id); setMenuFor(null); }}>
                            <Eye size={13} /> View Lead
                          </button>
                          {!l.enrolledInCampaign && campaignId && (
                            <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-2"
                              onClick={async () => {
                                setMenuFor(null); setBusy(true);
                                try {
                                  const r = await leadService.bulkAddToCampaign([l.id], campaignId);
                                  toast.success(r.counts.rejected ? `${r.counts.rejected} skipped (suppressed or already enrolled).` : "Lead added to campaign.");
                                  afterChange();
                                } catch (err: any) { toast.error(err?.data?.error || "Failed to add."); }
                                finally { setBusy(false); }
                              }}>
                              <Users size={13} /> Add to Campaign
                            </button>
                          )}
                          <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-amber-50 text-amber-800 inline-flex items-center gap-2"
                            onClick={async () => {
                              setMenuFor(null); setBusy(true);
                              try { await leadService.bulkSuppress([l.id]); toast.success("Lead suppressed."); afterChange(); }
                              catch (err: any) { toast.error(err?.data?.error || "Failed to suppress."); }
                              finally { setBusy(false); }
                            }}>
                            <Ban size={13} /> Suppress
                          </button>
                          <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-700 inline-flex items-center gap-2"
                            onClick={async () => {
                              setMenuFor(null);
                              const ok = await confirm({
                                title: `Delete ${l.email}?`,
                                message: "This permanently deletes the lead and its campaign enrollments. This cannot be undone.",
                                confirmLabel: "Delete lead",
                              });
                              if (!ok) return;
                              setBusy(true);
                              try { await leadService.remove(l.id); toast.success("Lead deleted."); afterChange(); }
                              catch (err: any) { toast.error(err?.data?.error || "Failed to delete."); }
                              finally { setBusy(false); }
                            }}>
                            <Trash2 size={13} /> Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination (§4) */}
      {pagination.pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Lead pages">
          <span className="text-xs text-slate-500">Showing {leads.length} of {pagination.total} leads</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
              <ChevronLeft size={14} /> Previous
            </button>
            <button type="button" onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))} disabled={pagination.page >= pagination.pages}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </nav>
      )}

      {/* Server-computed audience counts + enrolled recipients */}
      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center">
          {[
            ["Total", counts.total, "slate"], ["Eligible", counts.eligible, "emerald"],
            ["Suppressed", counts.suppressed, "amber"], ["Invalid", counts.invalid, "red"],
            ["Unsubscribed", counts.unsubscribed, "amber"], ["Bounced", counts.bounced, "red"],
            ["Duplicates", counts.duplicates, "slate"],
          ].map(([label, value, tone]) => {
            const tones: Record<string, string> = { slate: "text-slate-900", emerald: "text-emerald-700", amber: "text-amber-700", red: "text-red-700" };
            return (
              <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className={`text-lg font-semibold ${tones[String(tone)]}`}>{String(value)}</p>
                <p className="text-xs text-slate-500">{String(label)}</p>
              </div>
            );
          })}
        </div>
      )}

      {enrolled.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase">Campaign recipients ({enrolled.length})</p>
          </div>
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {enrolled.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{r.email}</td>
                    <td className="px-4 py-2"><Badge status={r.status} /></td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => removeEnrolled(r.id)} aria-label={`Remove ${r.email}`}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Workflows */}
      <LeadImportModal open={importOpen} onClose={() => setImportOpen(false)} campaignId={campaignId || undefined} onImported={afterChange} />
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={afterChange} />
      <LeadDetailDrawer leadId={detailId} onClose={() => setDetailId(null)} />
      {dialog}
      {busy && <span className="sr-only" aria-live="polite">Working…</span>}
      <button type="button" onClick={load} aria-label="Refresh leads"
        className="sr-only-focusable fixed bottom-2 left-2 inline-flex items-center gap-1 text-xs text-slate-400">
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}
