// SendingAccountsSection — Instantly-style "Accounts To Use" for a campaign.
//
// UX mirrors Instantly: pick the inboxes that send for this campaign; the
// allocator rotates between them automatically (round robin); per-account
// limits stay authoritative across all campaigns; the same account waits its
// "Minimum wait time" between sends everywhere it's pooled.
//
// The richer distribution controls (weights/strategy) remain in the data
// model and API, but are deliberately not surfaced here — see
// docs/architecture/multi-sending-accounts.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, Trash2, ChevronDown, Info, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/Badge";
import { useToast } from "@/components/ui/Toast";
import { campaignSendingPoolService, type PoolAccount } from "@/services/campaignSendingPool";
import { emailSendingService } from "@/services/emailSending";
import type { SmtpAccount } from "@/types/prompt6";
import { ApiError } from "@/api/client";

const RECOMMENDED_PER_ACCOUNT = 30; // Instantly guidance

export function SendingAccountsSection({ campaignId }: { campaignId: string }) {
  const toast = useToast();
  const [pool, setPool] = useState<PoolAccount[] | null>(null);
  const [orgAccounts, setOrgAccounts] = useState<SmtpAccount[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ poolId: string; email: string; scheduled: number } | null>(null);
  const [removing, setRemoving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [poolRes, accountsRes] = await Promise.all([
        campaignSendingPoolService.list(campaignId),
        emailSendingService.listAccounts(),
      ]);
      setPool(poolRes.data);
      setOrgAccounts(accountsRes.data);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.data?.error || err?.message || "Failed to load sending accounts.");
    }
  }, [campaignId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [isOpen]);

  const poolByAccount = useMemo(() => new Map((pool ?? []).map((p) => [p.accountId, p])), [pool]);
  const isSelected = (a: SmtpAccount) => poolByAccount.has(a.id);
  const selectedCount = pool?.length ?? 0;

  const toggleAccount = async (a: SmtpAccount) => {
    if (busy) return;
    setBusy(a.id);
    try {
      const existing = poolByAccount.get(a.id);
      if (existing) {
        const res = await campaignSendingPoolService.remove(campaignId, existing.id, "reassign");
        if (res?.requiresPolicy) {
          setRemoval({ poolId: existing.id, email: existing.email, scheduled: res.scheduledRecipients ?? 0 });
          return;
        }
        toast.success(`${a.fromEmail} removed from this campaign — other accounts take over its sends.`);
      } else {
        await campaignSendingPoolService.add(campaignId, a.id, 100);
        toast.success(`${a.fromEmail} added to this campaign.`);
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.requiresPolicy) {
        const existing = poolByAccount.get(a.id);
        setRemoval({ poolId: existing?.id ?? "", email: a.fromEmail, scheduled: err.data.scheduledRecipients ?? 0 });
        return;
      }
      toast.error("Could not update the account pool.");
    } finally {
      setBusy(null);
    }
  };

  const applyRemovalPolicy = async (policy: "reassign" | "keep" | "cancel") => {
    if (!removal) return;
    setRemoving(true);
    try {
      await campaignSendingPoolService.remove(campaignId, removal.poolId, policy);
      toast.success(
        policy === "reassign" ? "Account removed; leads will be reassigned on send."
        : policy === "keep" ? "Account removed; assigned leads keep it until completion."
        : "Account removed; its queued sends were cancelled.",
      );
      setRemoval(null);
      await refresh();
    } catch (err: any) {
      toast.error(err?.data?.error || "Could not remove the account.");
    } finally {
      setRemoving(false);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
        {loadError}
      </div>
    );
  }
  if (!pool) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading sending accounts…
      </div>
    );
  }

  const recommendedLimit = selectedCount * RECOMMENDED_PER_ACCOUNT;
  const uncapped = pool.some((p) => p.dailyLimit == null);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Accounts to use</h2>
        <p className="text-sm text-slate-500 mt-1">
          Select the inboxes that send for this campaign. Instantly rotates between them
          automatically — each account obeys its daily campaign limit and minimum wait time
          across every campaign it's assigned to.
        </p>
      </div>

      {/* Instantly-style multi-select dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button type="button" onClick={() => setIsOpen((v) => !v)}
          aria-haspopup="listbox" aria-expanded={isOpen}
          className="w-full flex items-center justify-between gap-3 border border-slate-300 rounded-xl px-4 py-3 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <span className="text-sm">
            {selectedCount === 0
              ? <span className="text-slate-400">Select sending accounts…</span>
              : <span className="font-semibold text-slate-900">{selectedCount} account{selectedCount === 1 ? "" : "s"} selected</span>}
          </span>
          <ChevronDown size={17} className={`text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>

        {isOpen && (
          <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl max-h-96 overflow-auto" role="listbox" aria-label="Sending accounts">
            {orgAccounts.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Info size={18} className="mx-auto text-slate-300 mb-2" aria-hidden />
                <p className="text-sm font-medium text-slate-800">No email accounts yet</p>
                <p className="text-xs text-slate-500 mt-1">Connect an account from Settings → Email Sending first.</p>
                <a href="/settings/email-sending" className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-primary hover:underline">
                  Get more accounts →
                </a>
              </div>
            ) : (
              <>
                {orgAccounts.map((a) => {
                  const checked = isSelected(a);
                  const busyRow = busy === a.id;
                  return (
                    <label key={a.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                      role="option" aria-selected={checked}>
                      <input type="checkbox" className="w-4 h-4 accent-[rgb(var(--primary))]"
                        checked={checked} disabled={busyRow} onChange={() => void toggleAccount(a)} />
                      {busyRow
                        ? <Loader2 size={14} className="animate-spin text-slate-400" />
                        : <span className={`text-sm ${checked ? "font-semibold text-slate-900" : "text-slate-700"}`}>{a.fromEmail}</span>}
                      <span className="text-[10px] text-slate-400 hidden sm:inline truncate max-w-[140px]">{a.fromName || a.name}</span>
                      <Badge status={!a.isEnabled ? "disabled" : a.status} className="ml-auto" />
                      <span className="text-[10px] tabular-nums text-slate-400 whitespace-nowrap">
                        {a.sentToday ?? 0}/{a.dailyLimit ?? "∞"} today
                      </span>
                    </label>
                  );
                })}
                <div className="px-4 py-2.5 bg-slate-50 text-[11px] text-slate-500 border-t border-slate-100">
                  Removing an account reassigns its queued sends to the remaining accounts.
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Selected pool — Instantly keeps this as chips; we add quota status. */}
      {selectedCount === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>No accounts selected. This campaign cannot send until at least one sending account is assigned.</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(pool ?? []).map((p) => (
              <span key={p.id}
                className="inline-flex items-center gap-2 bg-violet-50 border border-violet-200 text-violet-900 rounded-full pl-3 pr-1.5 py-1 text-xs font-medium">
                {p.email}
                <button type="button" onClick={() => void toggleAccount(orgAccounts.find((a) => a.id === p.accountId)!)}
                  className="rounded-full hover:bg-violet-100 p-0.5 text-violet-700" aria-label={`Remove ${p.email}`}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2">Account</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Health</th>
                  <th className="text-left px-4 py-2">Daily campaign limit</th>
                  <th className="text-left px-4 py-2">Sent today</th>
                  <th className="text-left px-4 py-2">Warmup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(pool ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{p.email}</div>
                      {p.fromName && <div className="text-[11px] text-slate-500">{p.fromName}</div>}
                    </td>
                    <td className="px-4 py-2.5"><Badge status={p.isEnabled ? p.status : "disabled"} /></td>
                    <td className="px-4 py-2.5"><Badge status={p.healthStatus} /></td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{p.dailyLimit ?? "∞"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{p.sentToday}<span className="text-slate-400"> / {p.dailyLimit ?? "∞"}</span></td>
                    <td className="px-4 py-2.5"><Badge status={p.warmupStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {uncapped
                ? `${selectedCount} account${selectedCount === 1 ? "" : "s"} selected — uncapped capacity across all enabled accounts.`
                : `Recommended campaign limit: ${selectedCount} × ${RECOMMENDED_PER_ACCOUNT} = ${recommendedLimit}/day. Remaining today across the pool: ${(pool ?? []).reduce((s, p) => s + (p.remainingToday ?? 0), 0)} emails.`}
            </span>
          </p>
        </>
      )}

      {/* Removal policy dialog (§43) */}
      {removal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Remove sending account">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-3">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <AlertTriangle size={17} className="text-amber-500" /> This account has {removal.scheduled} scheduled lead{removal.scheduled === 1 ? "" : "s"}
            </h3>
            <p className="text-sm text-slate-600">
              <span className="font-medium">{removal.email}</span> is assigned to upcoming sends. What should happen to them?
            </p>
            <div className="space-y-2">
              <button type="button" disabled={removing} onClick={() => void applyRemovalPolicy("reassign")}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-primary hover:bg-primary/5 text-sm">
                <span className="font-medium text-slate-800">Reassign eligible leads</span><br />
                <span className="text-xs text-slate-500">New sends go through the remaining accounts.</span>
              </button>
              <button type="button" disabled={removing} onClick={() => void applyRemovalPolicy("keep")}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-primary hover:bg-primary/5 text-sm">
                <span className="font-medium text-slate-800">Keep assignments until they complete</span><br />
                <span className="text-xs text-slate-500">Do not use this account for new sends; keep its assigned leads.</span>
              </button>
              <button type="button" disabled={removing} onClick={() => void applyRemovalPolicy("cancel")}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-red-300 hover:bg-red-50 text-sm">
                <span className="font-medium text-red-700">Cancel scheduled sends</span><br />
                <span className="text-xs text-slate-500">Queued jobs for this account are cancelled.</span>
              </button>
            </div>
            <button type="button" onClick={() => setRemoval(null)} disabled={removing}
              className="w-full py-2 text-sm text-slate-500 hover:text-slate-800">
              Keep the account in this campaign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
