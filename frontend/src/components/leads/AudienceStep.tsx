// AudienceStep — table-first lead management for the campaign wizard (§1-5).
// The leads table IS the interface: server-side pagination/search/sort/filters,
// column visibility, row selection with bulk actions, Import Leads workflow,
// Add Lead modal and a detail drawer. Enrollment is a real backend action.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Upload, UserPlus, Loader2, RefreshCw, Columns3, SlidersHorizontal,
  Trash2, Eye, Ban, Users, X, ChevronLeft, ChevronRight, Download,
  Layers, Sparkles, CheckCircle2, Send, Reply, Undo2, UserMinus,
  ShieldX, CircleHelp, ShieldCheck, Type, Globe, Server,
  Star, CalendarCheck, CalendarClock, Trophy, XCircle, MinusCircle, Plane, UserX, CheckCheck,
  UserCog, ArrowRightCircle,
} from "lucide-react";
import { leadService } from "@/services/lead";
import { campaignService } from "@/services/campaign";
import { memberService } from "@/services/members";
import { deliverabilityService } from "@/services/deliverability";
import { AssignModal } from "./AssignModal";
import { MoveModal } from "./MoveModal";
import { LeadImportModal } from "./LeadImportModal";
import { AddLeadModal } from "./AddLeadModal";
import { LeadDetailDrawer } from "./LeadDetailDrawer";
import { StatusDot } from "./StatusDot";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { IconSelect } from "@/components/ui/IconSelect";
import type { Lead, Member } from "@/types/lead";
import type { AudienceCounts, CampaignRecipient } from "@/types/prompt6";
import type { IconSelectOption } from "@/components/ui/IconSelect";

// Instantly-style options: icon + capitalized label.
// Progression (from the sending engine) + interest signals (manual, CRM-style).
const LEAD_STATUS_OPTIONS: readonly IconSelectOption[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "new", label: "New", icon: Sparkles },
  { value: "approved", label: "Approved", icon: CheckCircle2 },
  { value: "contacted", label: "Contacted", icon: Send },
  { value: "replied", label: "Replied", icon: Reply },
  { value: "bounced", label: "Bounced", icon: Undo2 },
  { value: "unsubscribed", label: "Unsubscribed", icon: UserMinus },
  { value: "suppressed", label: "Suppressed", icon: Ban },
  { value: "invalid", label: "Invalid", icon: ShieldX },
  { value: "completed", label: "Completed", icon: CheckCheck },
  { value: "interested", label: "Interested", icon: Star },
  { value: "meeting_completed", label: "Meeting Completed", icon: CalendarCheck },
  { value: "meeting_completed_not_closed", label: "Meeting Completed, Not Closed", icon: CalendarClock },
  { value: "won", label: "Won", icon: Trophy },
  { value: "lost", label: "Lost", icon: XCircle },
  { value: "not_interested", label: "Not Interested", icon: MinusCircle },
  { value: "out_of_office", label: "Out of Office", icon: Plane },
  { value: "wrong_person", label: "Wrong Person", icon: UserX },
] as const;

// Instantly-style "Data fields" — builtin column names mapped to backend keys, plus custom slug support.
const DATA_FIELD_OPTIONS = [
  { value: "company_name", label: "Company Name" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "job_title", label: "Job Title" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "phone", label: "Phone" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "location", label: "Location" },
  { value: "industry", label: "Industry" },
  { value: "company_size", label: "Company Size" },
  { value: "personalization", label: "Personalization" },
  { value: "status", label: "Lead Status" },
  { value: "email_status", label: "Email Status" },
  { value: "lead_score", label: "Lead Score" },
  { value: "source", label: "Source" },
  { value: "__custom__", label: "Custom variable…" },
] as const;
const DATA_FIELD_OPS: readonly IconSelectOption[] = [
  { value: "eq", label: "Equals", icon: CheckCheck },
  { value: "neq", label: "Not Equals", icon: XCircle },
  { value: "contains", label: "Contains", icon: Globe },
  { value: "not_contains", label: "Not Contains", icon: Ban },
  { value: "is_empty", label: "Is Empty", icon: CircleHelp },
  { value: "is_not_empty", label: "Is Not Empty", icon: ShieldCheck },
  { value: "gt", label: "Greater Than", icon: Type },
  { value: "lt", label: "Less Than", icon: Type },
] as const;

// Owner filter: all | unassigned | member id (Instantly lead-owner parity)
const OWNER_FILTER_OPTIONS = (members: Member[]): readonly IconSelectOption[] => [
  { value: "all", label: "All owners", icon: Layers },
  { value: "unassigned", label: "Unassigned", icon: UserMinus },
  ...members.map((m) => ({ value: m.id, label: m.fullName || m.email, icon: Users })),
];

const EMAIL_STATUS_OPTIONS: readonly IconSelectOption[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "unknown", label: "Unknown", icon: CircleHelp },
  { value: "verified", label: "Verified", icon: ShieldCheck },
  { value: "syntax_valid", label: "Syntax Valid", icon: Type },
  { value: "domain_valid", label: "Domain Valid", icon: Globe },
  { value: "mx_valid", label: "MX Valid", icon: Server },
  { value: "invalid", label: "Invalid", icon: ShieldX },
  { value: "bounced", label: "Bounced", icon: Undo2 },
] as const;

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
  { key: "assignedTo", label: "Owner", sortable: true },
  { key: "emailStatus", label: "Email Status", sortable: true },
  { key: "status", label: "Lead Status", sortable: true },
  { key: "createdAt", label: "Created At", sortable: true },
] as const;
type ColKey = typeof COLUMN_DEFS[number]["key"];
const DEFAULT_COLS: ColKey[] = ["firstName", "lastName", "companyName", "jobTitle", "email", "status", "leadScore"];
const COLS_STORAGE = "salesfire.leads.columns";

const AVATAR_HUES = [262, 199, 152, 24, 343, 174, 210, 330];
function avatarHue(seed: string) {
  let h = 7;
  for (const c of String(seed).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}
function initials(l: Lead) {
  const a = (l.firstName || "").trim()[0] || "";
  const b = (l.lastName || "").trim()[0] || "";
  return ((a + b) || (l.email || "?")[0]).toUpperCase();
}

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
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [varField, setVarField] = useState("");
  const [varCustomField, setVarCustomField] = useState("");
  const [varOp, setVarOp] = useState("eq");
  const [varValue, setVarValue] = useState("");
  const [appliedVar, setAppliedVar] = useState<{ field: string; op: string; value: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  /** Lead ids passed to the Assign/Move modals — from bulk selection or a single row action. */
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
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

  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();
  const searchTimer = useRef<number | null>(null);

  // Org members for owner filter + Assign (Instantly lead-owner parity).
  useEffect(() => {
    memberService.list().then(setMembers).catch(() => { /* owner UI just stays minimal */ });
  }, []);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

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
        owner: ownerFilter !== "all" ? ownerFilter : undefined,
        field: appliedVar?.field, op: appliedVar?.op, value: appliedVar?.value,
      });
      setLeads(res.data || []);
      setPagination(res.pagination);
    } catch {
      setError("Failed to load leads.");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, sortBy, sortDir, statusFilter, emailStatusFilter, industryFilter, minScore, campaignId, ownerFilter, appliedVar]);

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

  const onAssigned = (assigned: number) => {
    toast.success(`${assigned} lead(s) assigned.`);
    setSelected(new Set());
    afterChange();
  };
  const onMoved = (s: { moved: number; copied: number; skipped: number }) => {
    const skipped = s.skipped ? ` ${s.skipped} skipped (duplicates or send history).` : "";
    toast.success(`${s.moved + s.copied} lead(s) ${s.moved ? "moved" : "copied"}.${skipped}`);
    setSelected(new Set());
    afterChange();
  };

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

  const verifyOne = async (l: Lead) => {
    setBusy(true);
    try {
      const res: any = await deliverabilityService.verifyEmail(l.email, l.id);
      const result = res?.data ?? res;
      const status = result?.status ?? "checked";
      toast.success(`${l.email}: ${status}${result?.riskScore !== undefined ? ` · risk ${result.riskScore}` : ""}`);
      afterChange();
    } catch (err: any) {
      toast.error(err?.data?.error || "Verification failed. Check DNS and try again.");
    } finally { setBusy(false); }
  };

  const addOne = async (l: Lead) => {
    if (!campaignId) { toast.error("Save the campaign details first (step 1)."); return; }
    setBusy(true);
    try {
      const r = await leadService.bulkAddToCampaign([l.id], campaignId);
      toast.success(r.counts?.rejected ? `${r.counts.rejected} skipped (suppressed or already enrolled).` : "Lead added to campaign.");
      afterChange();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to add the lead.");
    } finally { setBusy(false); }
  };

  const suppressOne = async (l: Lead) => {
    setBusy(true);
    try { await leadService.bulkSuppress([l.id]); toast.success(`${l.email} suppressed.`); afterChange(); }
    catch (err: any) { toast.error(err?.data?.error || "Failed to suppress."); }
    finally { setBusy(false); }
  };

  const deleteOne = async (l: Lead) => {
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
  };

  const removeEnrolled = async (rid: string) => {
    if (!campaignId) return;
    try {
      await campaignService.removeRecipient(campaignId, rid);
      toast.success("Recipient removed from the campaign.");
      onCountsChanged();
    } catch (err: any) { toast.error(err?.data?.error || "Failed to remove the recipient."); }
  };

  const activeFilters = (statusFilter !== "all" ? 1 : 0) + (emailStatusFilter !== "all" ? 1 : 0) + (industryFilter ? 1 : 0) + (minScore ? 1 : 0) + (ownerFilter !== "all" ? 1 : 0) + (appliedVar ? 1 : 0);

  const applyVarFilter = () => {
    const rawField = varField === "__custom__" ? varCustomField.trim().toLowerCase() : varField;
    if (!rawField) return;
    const isEmptyOp = varOp === "is_empty" || varOp === "is_not_empty";
    setAppliedVar({ field: rawField, op: varOp, value: isEmptyOp ? "" : varValue.trim() });
    setPage(1);
  };
  const clearVarFilter = () => { setAppliedVar(null); setVarField(""); setVarCustomField(""); setVarOp("eq"); setVarValue(""); setPage(1); };
  const cols = useMemo(() => COLUMN_DEFS.filter((c) => visibleCols.includes(c.key)), [visibleCols]);

  const cell = (l: Lead, key: ColKey) => {
    switch (key) {
      case "firstName": return (
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white select-none"
            style={{ backgroundColor: `hsl(${avatarHue(l.email || l.firstName || "?")} 42% 52%)` }}>
            {initials(l)}
          </span>
          <span className="truncate">{l.firstName || "—"}</span>
        </span>
      );
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
      case "assignedTo": {
        if (!l.assignedTo) return <span className="text-xs text-slate-400">Unassigned</span>;
        const m = memberById.get(l.assignedTo);
        return <span className="inline-flex items-center gap-1.5" title={m?.fullName || l.assignedTo}><Users size={12} className="text-slate-400" /><span className="max-w-[100px] truncate">{m?.fullName || m?.email || "Owner"}</span></span>;
      }
      case "emailStatus": return <StatusDot status={l.emailStatus} />;
      case "status": return <StatusDot status={l.status} />;
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
          <button type="button" onClick={load} aria-label="Refresh leads" title="Refresh"
            className="inline-flex items-center justify-center p-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600">
            <RefreshCw size={15} />
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
          <IconSelect
            id="lead-status-filter"
            label="Lead status"
            value={statusFilter}
            options={LEAD_STATUS_OPTIONS}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
          />
          <IconSelect
            id="email-status-filter"
            label="Email status"
            value={emailStatusFilter}
            options={EMAIL_STATUS_OPTIONS}
            onChange={(v) => { setEmailStatusFilter(v); setPage(1); }}
          />
          <IconSelect
            id="owner-filter"
            label="Owner"
            value={ownerFilter}
            options={OWNER_FILTER_OPTIONS(members)}
            onChange={(v) => { setOwnerFilter(v); setPage(1); }}
          />
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

          {/* Instantly "Data fields" filter — builtin columns or any imported custom variable */}
          <fieldset className="sm:col-span-4 rounded-lg border border-slate-200 p-3 bg-slate-50/50">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Data fields</legend>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="var-field" className="block text-[11px] font-medium text-slate-500 mb-1">Field</label>
                <select id="var-field" className="px-2 py-1.5 text-sm rounded-lg border border-slate-300 bg-white max-w-[180px]" value={varField}
                  onChange={(e) => setVarField(e.target.value)}>
                  <option value="">Select field…</option>
                  {DATA_FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              {varField === "__custom__" && (
                <div>
                  <label htmlFor="var-slug" className="block text-[11px] font-medium text-slate-500 mb-1">Custom slug</label>
                  <input id="var-slug" value={varCustomField} onChange={(e) => setVarCustomField(e.target.value)}
                    placeholder="e.g. recent_funding" aria-label="Custom variable slug"
                    className="px-2 py-1.5 text-sm rounded-lg border border-slate-300 bg-white w-44 font-mono" />
                </div>
              )}
              <div>
                <IconSelect id="var-op" label="Condition" value={varOp} options={DATA_FIELD_OPS}
                  onChange={setVarOp} ariaLabel="Condition" />
              </div>
              {varOp !== "is_empty" && varOp !== "is_not_empty" && (
                <div className="flex-1 min-w-[140px]">
                  <label htmlFor="var-value" className="block text-[11px] font-medium text-slate-500 mb-1">Value</label>
                  <input id="var-value" value={varValue} onChange={(e) => setVarValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") applyVarFilter(); }}
                    placeholder="e.g. SaaS" className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 bg-white" />
                </div>
              )}
              <button type="button" onClick={applyVarFilter} disabled={!varField || (varField === "__custom__" && !varCustomField.trim())}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40 h-[34px]">
                Apply
              </button>
              {appliedVar && (
                <button type="button" onClick={clearVarFilter}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:text-slate-800 h-[34px] inline-flex items-center gap-1">
                  <X size={12} /> Clear
                </button>
              )}
            </div>
            {appliedVar && (
              <p className="mt-2 text-[11px] text-slate-500">Active: <code className="font-mono bg-white border border-slate-200 rounded px-1">{appliedVar.field} {appliedVar.op}{appliedVar.value ? ` "${appliedVar.value}"` : ""}</code></p>
            )}
          </fieldset>

          <button type="button" onClick={() => { setStatusFilter("all"); setEmailStatusFilter("all"); setIndustryFilter(""); setMinScore(""); setOwnerFilter("all"); clearVarFilter(); setPage(1); }}
            className="sm:col-span-4 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 w-fit">
            <X size={12} /> Clear all filters
          </button>
        </div>
      )}

      {/* Bulk action bar (§5) — Instantly-style floating pill, fixed to the viewport bottom */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 flex items-center gap-1 rounded-full bg-slate-900 py-1.5 pl-4 pr-1.5 shadow-[0_8px_30px_rgb(2_6_23/0.35)] ring-1 ring-white/10"
          data-testid="bulk-toolbar"
          role="toolbar"
          aria-label={`Bulk actions for ${selected.size} selected lead(s)`}
        >
          <span className="text-[13px] font-medium text-white/90 tabular-nums whitespace-nowrap">
            {selected.size} selected
          </span>
          <div className="ml-3 flex flex-wrap items-center gap-0.5">
            <button type="button" onClick={bulkAddToCampaign} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Add to Campaign
            </button>
            <button type="button" onClick={() => setAssignIds([...selected])} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50">
              <UserCog size={13} /> Assign
            </button>
            <button type="button" onClick={() => (campaignId ? setMoveIds([...selected]) : toast.error("Save the campaign details first (step 1)."))} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50">
              <ArrowRightCircle size={13} /> Move
            </button>
            <a type="button" href={leadService.exportUrl([...selected])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full text-white/80 hover:bg-white/10 hover:text-white">
              <Download size={13} /> Export
            </a>
            <button type="button" onClick={bulkSuppress} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full text-amber-300 hover:bg-amber-400/10 disabled:opacity-50">
              <Ban size={13} /> Suppress
            </button>
            <button type="button" onClick={bulkDelete} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full text-red-300 hover:bg-red-400/10 disabled:opacity-50">
              <Trash2 size={13} /> Delete
            </button>
          </div>
          <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection"
            className="ml-1 p-1.5 rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
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
            <table className="w-full text-[13px]" data-testid="leads-table">
              <thead className="bg-slate-50/80 border-b border-slate-200 sticky top-0 z-10 backdrop-blur">
                <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="px-3 py-2 w-10">
                    <input type="checkbox" aria-label="Select all" checked={allOnPageSelected} onChange={toggleAll} />
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-3 py-2 whitespace-nowrap">
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
                  <th className="px-3 py-2 w-[150px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-indigo-50/40 cursor-pointer transition-colors" onClick={() => setDetailId(l.id)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${l.email}`} checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} />
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[220px] truncate">{cell(l, c.key)}</td>
                    ))}
                    <td className="px-3 py-2 text-right relative" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5" role="group" aria-label={`Actions for ${l.email}`}>
                        <button type="button" onClick={() => setDetailId(l.id)} title="View lead" aria-label={`View ${l.email}`}
                          className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                          <Eye size={14} />
                        </button>
                        <button type="button" onClick={() => verifyOne(l)} disabled={busy} title="Verify email (real DNS check)" aria-label={`Verify ${l.email}`}
                          className="p-1.5 rounded-md text-slate-400 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
                          <ShieldCheck size={14} />
                        </button>
                        {!l.enrolledInCampaign && campaignId && (
                          <button type="button" onClick={() => addOne(l)} disabled={busy} title="Add to campaign" aria-label={`Add ${l.email} to campaign`}
                            className="p-1.5 rounded-md text-slate-400 hover:bg-indigo-50 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
                            <Users size={14} />
                          </button>
                        )}
                        {campaignId && (
                          <button type="button" onClick={() => setMoveIds([l.id])} disabled={busy} title="Move lead" aria-label={`Move ${l.email}`}
                            className="p-1.5 rounded-md text-slate-400 hover:bg-indigo-50 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
                            <ArrowRightCircle size={14} />
                          </button>
                        )}
                        <button type="button" onClick={() => suppressOne(l)} disabled={busy} title="Suppress" aria-label={`Suppress ${l.email}`}
                          className="p-1.5 rounded-md text-slate-400 hover:bg-amber-50 hover:text-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
                          <Ban size={14} />
                        </button>
                        <button type="button" onClick={() => deleteOne(l)} disabled={busy} title="Delete lead" aria-label={`Delete ${l.email}`}
                          className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
                          <Trash2 size={14} />
                        </button>
                      </div>
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

      {/* Server-computed audience counts — compact inline summary; warnings
          only surface when non-zero */}
      {counts && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-slate-500">
          <span><span className="font-semibold text-slate-800">{counts.total}</span> total</span>
          <span className="text-emerald-700"><span className="font-semibold">{counts.eligible}</span> eligible</span>
          {counts.suppressed > 0 && <span className="text-amber-700"><span className="font-semibold">{counts.suppressed}</span> suppressed</span>}
          {counts.invalid > 0 && <span className="text-red-700"><span className="font-semibold">{counts.invalid}</span> invalid</span>}
          {counts.unsubscribed > 0 && <span className="text-amber-700"><span className="font-semibold">{counts.unsubscribed}</span> unsubscribed</span>}
          {counts.bounced > 0 && <span className="text-red-700"><span className="font-semibold">{counts.bounced}</span> bounced</span>}
          {counts.duplicates > 0 && <span className="text-slate-600"><span className="font-semibold">{counts.duplicates}</span> duplicates</span>}
        </div>
      )}

      {enrolled.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase">Enrolled in this campaign ({enrolled.length})</p>
          </div>
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {enrolled.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{r.email}</td>
                    <td className="px-4 py-2"><StatusDot status={r.status} /></td>
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
      <AssignModal
        open={assignIds !== null}
        onClose={() => setAssignIds(null)}
        count={assignIds?.length ?? 0}
        leadIds={assignIds ?? []}
        onAssigned={onAssigned}
      />
      {campaignId && (
        <MoveModal
          open={moveIds !== null}
          onClose={() => setMoveIds(null)}
          count={moveIds?.length ?? 0}
          leadIds={moveIds ?? []}
          campaignId={campaignId}
          onMoved={onMoved}
        />
      )}
      <LeadDetailDrawer leadId={detailId} onClose={() => setDetailId(null)} />
      {dialog}
      {busy && <span className="sr-only" aria-live="polite">Working…</span>}
    </div>
  );
}
