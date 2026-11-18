// List detail — members table + move into a campaign (Instantly CRM Lists parity).
import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Loader2, ArrowRightCircle, Users, Trash2, Megaphone, ShieldCheck } from "lucide-react";
import { listsService } from "@/services/lists";
import { campaignService } from "@/services/campaign";
import { deliverabilityService } from "@/services/deliverability";
import type { LeadListDetail } from "@/types/lead";
import { Badge } from "@/components/Badge";
import { useToast } from "@/components/ui/Toast";

const SORTABLE: Array<{ key: string; label: string; sortKey: string }> = [
  { key: "name", label: "Name", sortKey: "name" },
  { key: "company", label: "Company", sortKey: "company" },
  { key: "email", label: "Email", sortKey: "email" },
  { key: "status", label: "Status", sortKey: "status" },
];

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [list, setList] = useState<LeadListDetail | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState("addedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [verifying, setVerifying] = useState(false);
  const [verifySummary, setVerifySummary] = useState<Record<string, number> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [targetCampaignId, setTargetCampaignId] = useState("");
  const [copy, setCopy] = useState(false);
  const [resetStatus, setResetStatus] = useState(true);
  const [checkDuplicates, setCheckDuplicates] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const res = await listsService.get(id, { page, pageSize: 25, search: search || undefined, sortBy, sortDir });
      setList(res.data);
      setPagination(res.pagination);
    } catch {
      setError("Failed to load the list.");
    } finally {
      setLoading(false);
    }
  }, [id, page, search, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    campaignService.list({ pageSize: 100 }).then((r) => {
      const cs = Array.isArray(r.data) ? r.data : [];
      setCampaigns(cs);
      setTargetCampaignId((prev) => prev || cs[0]?.id || "");
    }).catch(() => { /* campaign picker just stays empty */ });
  }, []);

  const debounce = (v: string) => {
    setSearchInput(v);
    window.clearTimeout((debounce as any)._t);
    (debounce as any)._t = window.setTimeout(() => { setSearch(v.trim()); setPage(1); }, 300);
  };

  const memberIds = (list?.members || []).map((m) => m.leadId);
  const allOnPage = memberIds.length > 0 && memberIds.every((x) => selected.has(x));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allOnPage) memberIds.forEach((x) => next.delete(x));
    else memberIds.forEach((x) => next.add(x));
    return next;
  });
  const toggleOne = (x: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(x)) next.delete(x); else next.add(x);
    return next;
  });

  const toggleSort = (key: string) => {
    setSortBy((prev) => {
      if (prev === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return prev; }
      setSortDir("asc");
      return key;
    });
    setPage(1);
  };

  const verifyAll = async () => {
    const ids = selected.size ? [...selected] : (list?.members || []).map((m) => m.leadId);
    if (!ids.length) return;
    setVerifying(true);
    setVerifySummary(null);
    try {
      const res = await deliverabilityService.verifyLeads({ leadIds: ids });
      setVerifySummary(res?.data?.summary || {});
      toast.success(`Verification complete — ${res?.data?.verified ?? ids.length} address(es) checked with real DNS lookups.`);
      load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Verification failed. Check DNS and try again.");
    } finally {
      setVerifying(false);
    }
  };

  const removeSelected = async () => {
    if (!id || !selected.size) return;
    setBusy(true);
    try {
      const res = await listsService.removeMembers(id, [...selected]);
      toast.success(`${res.removed} lead(s) removed from the list.`);
      setSelected(new Set());
      load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to remove members.");
    } finally { setBusy(false); }
  };

  const enroll = async () => {
    if (!id || !targetCampaignId) { toast.error("Select a campaign first."); return; }
    setBusy(true);
    try {
      const ids = selected.size ? [...selected] : undefined;
      const res = await listsService.moveToCampaign(id, targetCampaignId, {
        copy, resetStatus, checkDuplicates, leadIds: ids,
      });
      const skipped = res.skipped.length ? ` ${res.skipped.length} skipped (duplicates or send history).` : "";
      toast.success(`${res.moved + res.copied} lead(s) ${copy ? "copied to" : "added to"} the campaign.${skipped}`);
      setSelected(new Set());
      load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to add leads to the campaign.");
    } finally { setBusy(false); }
  };

  if (loading && !list) {
    return <div className="p-6 max-w-5xl mx-auto"><div className="h-36 rounded-xl bg-slate-100 animate-pulse" /></div>;
  }
  if (error || !list) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {error || "List not found."}{" "}
          <button type="button" onClick={() => navigate("/lists")} className="underline font-medium">Back to lists</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Link to="/lists" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Lists</Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{list.name}</h1>
          <p className="mt-0.5 text-sm text-slate-500"><strong className="tabular-nums">{list.memberCount}</strong> member{list.memberCount === 1 ? "" : "s"}{selected.size > 0 && <> · <span className="text-primary-700 font-medium">{selected.size} selected</span></>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={verifyAll} disabled={busy || verifying || !list?.members.length}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-40"
            title="Real DNS checks — MX, null-MX, disposable, risk flags">
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {verifying ? "Verifying…" : "Verify emails"}
          </button>
          <select className="px-3 py-2 text-sm rounded-lg border border-slate-300 max-w-[220px]" value={targetCampaignId}
            onChange={(e) => setTargetCampaignId(e.target.value)} aria-label="Target campaign">
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" onClick={enroll} disabled={busy || !targetCampaignId}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightCircle size={14} />} {selected.size ? `Enroll ${selected.size}` : "Enroll all"}
          </button>
          <button type="button" onClick={removeSelected} disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-40">
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="inline-flex items-center gap-1.5"><Megaphone size={12} /> Enroll adds them to the campaign as pending recipients.</span>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Copy (keep in list)</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={resetStatus} onChange={(e) => setResetStatus(e.target.checked)} /> Reset interest status</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={checkDuplicates} onChange={(e) => setCheckDuplicates(e.target.checked)} /> Skip duplicates across campaigns</label>
        {verifySummary && (
          <span> · last verify: valid {verifySummary.verified ?? verifySummary.valid ?? 0} · invalid {verifySummary.invalid ?? 0} · risky {verifySummary.risky ?? 0}</span>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input type="search" aria-label="Search list members" placeholder="Search members…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={searchInput} onChange={(e) => debounce(e.target.value)} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden">
        {list.members.length === 0 ? (
          <div className="p-10 text-center">
            <Users size={30} className="mx-auto text-slate-300 mb-2" aria-hidden />
            <p className="text-sm text-slate-500">{search ? "No members match your search." : "This list is empty. Move leads here from a campaign's Leads table (select → Move → List)."}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-3 py-2.5 w-10"><input type="checkbox" aria-label="Select all" checked={allOnPage} onChange={toggleAll} /></th>
                {SORTABLE.map((col) => (
                  <th key={col.key} className="px-3 py-2.5 whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort(col.sortKey)} aria-label={`Sort by ${col.label}`} className="inline-flex items-center gap-1 hover:text-slate-800 uppercase tracking-wide">
                      {col.label}{sortBy === col.sortKey && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5">Email Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${m.lead?.email}`} checked={selected.has(m.leadId)} onChange={() => toggleOne(m.leadId)} />
                  </td>
                  <td className="px-3 py-2 text-slate-900 font-medium max-w-[200px] truncate">{[m.lead?.firstName, m.lead?.lastName].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[200px] truncate">{m.lead?.companyName || "—"}</td>
                  <td className="px-3 py-2 text-slate-700 max-w-[240px] truncate">{m.lead?.email || "—"}</td>
                  <td className="px-3 py-2">{m.lead?.status ? <Badge status={m.lead.status} /> : "—"}</td>
                  <td className="px-3 py-2">{m.lead?.emailStatus ? <Badge status={m.lead.emailStatus} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-slate-500">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Prev</button>
          <span className="tabular-nums">Page {page} of {pagination.pages}</span>
          <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next</button>
        </div>
      )}
    </div>
  );
}
