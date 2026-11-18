// Campaign Recipients page - Prompt 6 §40.
// Real recipient rows with server-side filtering, search and pagination.
import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, Loader2, Search, Users, ShieldCheck, AlertTriangle, ShieldX, CircleHelp } from "lucide-react";
import { campaignService } from "@/services/campaign";
import { deliverabilityService, type CampaignVerificationRow } from "@/services/deliverability";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Badge, statusTone, titleCaseStatus } from "@/components/Badge";
import type { Campaign } from "@/types/prompt5";
import type { CampaignRecipient } from "@/types/prompt6";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "queued", label: "Queued" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "replied", label: "Replied" },
  { value: "bounced", label: "Bounced" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "suppressed", label: "Suppressed" },
];

function fmtDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function VerificationBadge({ verdict }: { verdict: CampaignVerificationRow["verification"] }) {
  if (!verdict) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-slate-100 text-slate-500 border-slate-200">
        <CircleHelp size={11} /> Not Verified
      </span>
    );
  }
  const icons = {
    valid: <ShieldCheck size={11} />,
    risky: <AlertTriangle size={11} />,
    invalid: <ShieldX size={11} />,
    unknown: <CircleHelp size={11} />,
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusTone(verdict.status)}`} title={`Risk score ${verdict.riskScore}/100`}>
      {icons[verdict.status]} {titleCaseStatus(verdict.status)} · {verdict.riskScore}
    </span>
  );
}

export function CampaignRecipientsPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [verification, setVerification] = useState<Map<string, CampaignVerificationRow["verification"]>>(new Map());
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifySummary, setVerifySummary] = useState<Record<string, number> | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    campaignService.get(id).then((res) => setCampaign(res.data)).catch(() => {});
  }, [id]);

  const loadVerification = useCallback(async () => {
    if (!id) return;
    try {
      const res = await deliverabilityService.campaignVerification(id);
      const map = new Map<string, CampaignVerificationRow["verification"]>();
      for (const row of res.data || []) map.set(row.email, row.verification);
      setVerification(map);
    } catch { /* keep last-known state */ }
  }, [id]);

  const verifyAll = async () => {
    if (!id) return;
    setVerifyBusy(true);
    setVerifySummary(null);
    try {
      const res = await deliverabilityService.verifyCampaign(id);
      setVerifySummary(res.data?.summary || {});
      toast.success(`Verification complete — ${res.data?.verified ?? 0} address(es) checked with real DNS lookups.`);
      await loadVerification();
    } catch (err: any) {
      toast.error(err?.data?.error || "Verification failed. Check DNS and try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await campaignService.listRecipients(id, {
        status, search: search || undefined, page, pageSize: 25,
      });
      setRecipients(res.data || []);
      setPagination({ page: res.pagination.page, pages: res.pagination.pages, total: res.pagination.total });
    } catch {
      setError("Failed to load leads.");
    } finally {
      setIsLoading(false);
    }
  }, [id, status, search, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVerification(); }, [loadVerification]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const remove = async (r: CampaignRecipient) => {
    if (!id) return;
    const ok = await confirm({
      title: `Remove ${r.email}?`,
      message: "This recipient will no longer receive any emails from this campaign. The lead itself is kept.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setRemovingId(r.id);
    try {
      await campaignService.removeRecipient(id, r.id);
      toast.success(`${r.email} removed from the campaign.`);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to remove the lead.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <Link to={`/campaigns/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Back to campaign
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <Users size={22} className="text-primary" aria-hidden />
          Leads
        </h1>
        {campaign && <p className="text-sm text-slate-500 mt-1">{campaign.name} · {pagination.total} leads</p>}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={verifyAll} disabled={verifyBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60">
          {verifyBusy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
          {verifyBusy ? "Verifying leads…" : "Verify all emails"}
        </button>
        {verifySummary && (
          <span className="text-[11px] text-slate-600" role="status">
            valid {verifySummary.valid ?? 0} · risky {verifySummary.risky ?? 0} · invalid {verifySummary.invalid ?? 0} · unknown {verifySummary.unknown ?? 0}
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={status === f.value}
              onClick={() => { setStatus(f.value); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                status === f.value
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form onSubmit={submitSearch} className="sm:ml-auto flex gap-2">
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, email, company…"
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 w-56 focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50" aria-label="Search">
            <Search size={15} />
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-14">
            <div className="w-8 h-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" aria-label="Loading" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-red-600 text-sm mb-3">{error}</p>
            <button onClick={load} className="text-sm font-medium text-primary hover:underline">Try again</button>
          </div>
        ) : recipients.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">No leads found</h3>
            <p className="text-sm text-slate-500 mt-1">Add leads from the campaign wizard's Leads step.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Verification</th>
                  <th className="px-4 py-3">Current Step</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next Send</th>
                  <th className="px-4 py-3">Last Sent</th>
                  <th className="px-4 py-3">Reply</th>
                  <th className="px-4 py-3">Bounce</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recipients.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.email}</td>
                    <td className="px-4 py-3 text-slate-700">{r.companyName || "—"}</td>
                    <td className="px-4 py-3"><VerificationBadge verdict={verification.get(r.email) ?? null} /></td>
                    <td className="px-4 py-3 text-slate-700">{r.currentStep || 0}</td>
                    <td className="px-4 py-3"><Badge status={r.status} /></td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(r.nextSendAt)}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(r.lastSentAt)}</td>
                    <td className="px-4 py-3">{r.repliedAt ? <CheckDot /> : "—"}</td>
                    <td className="px-4 py-3">{r.bouncedAt ? <CheckDot danger /> : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(r)}
                        disabled={removingId === r.id}
                        title="Remove lead"
                        aria-label={`Remove ${r.email}`}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        {removingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog}

      {pagination.pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Lead pages">
          <span className="text-xs text-slate-500">Page {pagination.page} of {pagination.pages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              disabled={pagination.page >= pagination.pages}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

function CheckDot({ danger }: { danger?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${danger ? "bg-red-500" : "bg-violet-500"}`}
      title={danger ? "Bounced" : "Replied"}
      aria-label={danger ? "Bounced" : "Replied"}
    />
  );
}
