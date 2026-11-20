// Email Sending — PROMPT 9.1 Sending Account Management Center.
// Real data only: every number comes from the backend (usage, health,
// capacity). Passwords are write-only (AES-256-GCM at rest); SMTP tests and
// test emails are real SMTP operations, never simulated.
// Account creation/editing runs through AddAccountWizard (SalesBlink-style
// Provider → Connect → Sending → Warmup → Done stepper with provider presets).
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Mail, Pencil, Trash2, PlugZap, Send, Power,
  RefreshCw, CheckCircle2, XCircle, Loader2, CircleDot, Search, X,
} from "lucide-react";
import { emailSendingService, type SendingOverview, type AccountUsage } from "@/services/emailSending";
import { inboxService, type SyncAccountStatus } from "@/services/inbox";
import { WarmupPanel } from "@/components/WarmupPanel";
import { AddAccountWizard } from "@/components/sending/AddAccountWizard";
import { signatureService, type EmailSignature } from "@/services/signature";
import { Badge } from "@/components/Badge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { SmtpAccount, SmtpTestResult } from "@/types/prompt6";

/** SalesBlink-style status tabs over the account list. */
type AccountTab = "all" | "ready" | "error" | "disabled" | "warmup";
const ACCOUNT_TABS: Array<{ value: AccountTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready for outreach" },
  { value: "error", label: "Has error" },
  { value: "disabled", label: "Paused" },
  { value: "warmup", label: "Warmup active" },
];

function tabMatches(a: SmtpAccount, tab: AccountTab): boolean {
  switch (tab) {
    case "ready": return a.isEnabled && a.status === "verified" && a.healthStatus !== "critical";
    case "error": return a.status === "error" || a.healthStatus === "critical";
    case "disabled": return !a.isEnabled;
    case "warmup": return a.warmupStatus === "active" || a.warmupStatus === "warming";
    default: return true;
  }
}

export function EmailSendingSettingsPage() {
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [overview, setOverview] = useState<SendingOverview | null>(null);
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<"create" | "edit">("create");
  const [editingAccount, setEditingAccount] = useState<SmtpAccount | null>(null);

  const [tab, setTab] = useState<AccountTab>("all");
  const [search, setSearch] = useState("");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SmtpTestResult>>({});

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [syncStatus, setSyncStatus] = useState<Record<string, SyncAccountStatus>>({});
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const [testModalId, setTestModalId] = useState<string | null>(null);
  const [testAddress, setTestAddress] = useState("");
  const [testSubject, setTestSubject] = useState("SalesFire test email");
  const [testBody, setTestBody] = useState("This is a test email from SalesFire. If you received it, your SMTP settings work.");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [sendTestResult, setSendTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const [listRes, overviewRes, syncRes] = await Promise.all([
        emailSendingService.listAccounts(),
        emailSendingService.getOverview().catch(() => null),
        inboxService.syncStatus().catch(() => null),
      ]);
      setAccounts(listRes.data || []);
      setOverview(overviewRes?.data ?? null);
      setSyncStatus(Object.fromEntries((syncRes?.data || []).map((s) => [s.accountId, s])));
    } catch {
      setLoadError("Failed to load sending accounts.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    signatureService.list().then((res) => setSignatures(res.data || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setWizardMode("create");
    setEditingAccount(null);
    setWizardOpen(true);
  };

  const openEdit = (a: SmtpAccount) => {
    setWizardMode("edit");
    setEditingAccount(a);
    setWizardOpen(true);
  };

  const openDrawer = async (id: string) => {
    setDrawerId(id);
    setUsage(null);
    setUsageLoading(true);
    try {
      const res = await emailSendingService.getUsage(id);
      setUsage(res.data);
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result = await emailSendingService.testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      toast[result.success ? "success" : "error"](
        result.success ? "SMTP connection verified — the account can send." : result.message || "SMTP connection failed."
      );
      await load();
    } catch {
      toast.error("Connection test failed to run.");
    } finally {
      setTestingId(null);
    }
  };

  const toggleEnabled = async (a: SmtpAccount) => {
    setBusyActionId(a.id);
    try {
      if (a.isEnabled) {
        await emailSendingService.pauseAccount(a.id);
      } else {
        await emailSendingService.resumeAccount(a.id);
      }
      toast.success(a.isEnabled ? `"${a.name}" paused — it will not send.` : `"${a.name}" resumed.`);
      await load();
    } catch {
      toast.error("Failed to change the account state.");
    } finally {
      setBusyActionId(null);
    }
  };

  const remove = async (a: SmtpAccount) => {
    const ok = await confirm({
      title: `Delete sending account "${a.name}"?`,
      message: "This cannot be undone. Campaigns using this account must have it removed from their sending pools first.",
      confirmLabel: "Delete account",
    });
    if (!ok) return;
    setBusyActionId(a.id);
    try {
      await emailSendingService.deleteAccount(a.id);
      toast.success(`"${a.name}" deleted.`);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to delete the account.");
    } finally {
      setBusyActionId(null);
    }
  };

  const openSendTest = (id: string) => {
    setTestModalId(id);
    setTestAddress("");
    setTestSubject("SalesFire test email");
    setTestBody("This is a test email from SalesFire. If you received it, your SMTP settings work.");
    setSendTestResult(null);
  };

  const sendTest = async () => {
    if (!testModalId) return;
    setIsSendingTest(true);
    setSendTestResult(null);
    try {
      const res = await emailSendingService.sendTestEmail(testModalId, testAddress.trim(), testSubject.trim(), testBody.trim());
      if (res.success) {
        setSendTestResult({ ok: true, message: `Test email sent to ${testAddress}.` });
      } else {
        setSendTestResult({ ok: false, message: "Sending failed. Check the account settings." });
      }
    } catch (err: any) {
      setSendTestResult({ ok: false, message: err?.data?.error || "Sending failed." });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleSignatureChange = async (a: SmtpAccount, value: string) => {
    let signatureMode: "inherit" | "custom" | "none" = "inherit";
    let signatureId: string | null = null;
    if (value === "inherit") signatureMode = "inherit";
    else if (value === "none") signatureMode = "none";
    else if (value.startsWith("custom:")) {
      const id = value.slice(7);
      if (!id) return;
      signatureMode = "custom";
      signatureId = id;
    }
    setBusyActionId(a.id);
    try {
      await emailSendingService.updateAccount(a.id, { signatureMode, signatureId });
      toast.success(`Signature assignment for "${a.name}" updated.`);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to update the account's signature.");
    } finally {
      setBusyActionId(null);
    }
  };

  // Manual IMAP sync — real connection, errors surface honestly
  const syncNow = async (a: SmtpAccount) => {
    setSyncingId(a.id);
    try {
      const res = await inboxService.triggerSync(a.id);
      const ok = res?.data?.ok !== false && !res?.data?.error;
      toast.success(ok ? `Synced ${res?.data?.processed ?? 0} new message(s) from ${a.fromEmail}.` : `Sync failed: ${res?.data?.error || "unknown error"}`);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Sync failed.");
    } finally {
      setSyncingId(null);
    }
  };

  const syncCell = (a: SmtpAccount) => {
    const s = syncStatus[a.id];
    if (!s?.imapConfigured) {
      return (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-700"><CircleDot size={10} /> Not configured</span>
          <p className="text-[10px] text-slate-400 max-w-[140px]">IMAP credentials required</p>
        </div>
      );
    }
    const tone = s.status === "auth_failed"
      ? "text-red-600"
      : s.status === "error" ? "text-red-600"
      : "text-emerald-600";
    const label = s.status === "syncing" ? "Syncing…"
      : s.status === "auth_failed" ? "Auth failed"
      : s.status === "error" ? "Error"
      : "Connected";
    const last = s.lastSuccessfulSyncAt ? new Date(s.lastSuccessfulSyncAt).toLocaleString() : "never";
    return (
      <div className="space-y-1">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
          <CircleDot size={10} />{label}
        </span>
        <p className="text-[10px] text-slate-400">Last sync: {last}</p>
        <button type="button" onClick={() => syncNow(a)} disabled={syncingId === a.id}
          className="text-[10px] font-medium text-primary hover:underline disabled:opacity-50">
          {syncingId === a.id ? "Syncing…" : "Sync now"}
        </button>
      </div>
    );
  };

  const signatureValueOf = (a: SmtpAccount) =>
    a.signatureMode === "custom" ? `custom:${a.signatureId ?? ""}`
    : a.signatureMode === "none" ? "none"
    : "inherit";

  const statusBadge = (a: SmtpAccount) => {
    if (!a.isEnabled) return <Badge status="disabled" />;
    if (a.status === "verified") return <Badge status="verified"><CheckCircle2 size={12} /></Badge>;
    if (a.status === "error") return <Badge status="error"><XCircle size={12} /></Badge>;
    return <Badge status="unverified" />;
  };

  // SalesBlink-style status tabs + search over the account list.
  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!tabMatches(a, tab)) return false;
      if (!q) return true;
      return (
        a.fromEmail.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.fromName || "").toLowerCase().includes(q)
      );
    });
  }, [accounts, tab, search]);

  const tabCount = (t: AccountTab) => accounts.filter((a) => tabMatches(a, t)).length;

  // SalesBlink-style removable filter chips for whatever narrows the list.
  const activeFilterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (tab !== "all") {
    const label = ACCOUNT_TABS.find((t) => t.value === tab)?.label ?? tab;
    activeFilterChips.push({ key: "tab", label: `Status: ${label}`, clear: () => setTab("all") });
  }
  if (search.trim()) {
    activeFilterChips.push({ key: "search", label: `Search: ${search.trim()}`, clear: () => setSearch("") });
  }
  const clearAllFilters = () => { setTab("all"); setSearch(""); };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5" data-testid="email-sending-settings">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Email Sending</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage the SMTP accounts used to send campaigns — pools, rotation, limits and health.
            Credentials are encrypted at rest and never returned.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40 whitespace-nowrap shrink-0"
            aria-label="Refresh accounts">
            <RefreshCw size={15} /> Refresh
          </button>
          <button onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 whitespace-nowrap shrink-0">
            <Plus size={16} /> Add Sending Account
          </button>
        </div>
      </header>

      {/* Org-level sending analytics — real numbers only */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="sending-overview">
        <OverviewCard label="Total accounts" value={overview?.totalAccounts ?? accounts.length} />
        <OverviewCard label="Active accounts" value={overview?.activeAccounts ?? accounts.filter((a) => a.isEnabled).length} />
        <OverviewCard label="Emails sent today" value={overview?.emailsSentToday ?? 0} />
        <OverviewCard label="Remaining capacity today" value={overview?.remainingCapacityToday ?? (accounts.some((a) => a.isEnabled) ? "∞" : 0)} hint={overview?.remainingCapacityToday === null ? "no daily caps set" : "after consumed quota"} />
        <OverviewCard label="Bounces" value={overview?.bounces ?? 0} />
        <OverviewCard label="Replies" value={overview?.replies ?? 0} />
        <OverviewCard label="Failed sends" value={overview?.failedSends ?? 0} tone={(overview?.failedSends ?? 0) > 0 ? "warn" : undefined} />
        <OverviewCard label="Accounts with errors" value={overview?.accountsWithErrors ?? accounts.filter((a) => a.status === "error").length} tone={(overview?.accountsWithErrors ?? 0) > 0 ? "bad" : undefined} />
      </div>

      {/* Add / edit mailbox wizard (SalesBlink-style stepper) — mounted only
          while open so step/form state resets on every open. */}
      {wizardOpen && (
        <AddAccountWizard
          open
          mode={wizardMode}
          account={editingAccount}
          signatures={signatures}
          onClose={() => setWizardOpen(false)}
          onSaved={() => void load()}
        />
      )}

      {dialog}

      {/* Accounts table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Status tabs + search */}
        {!isLoading && !loadError && accounts.length > 0 && (
          <div className="border-b border-slate-200 px-4 py-3" data-testid="account-tabs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Account status">
              {ACCOUNT_TABS.map((t) => {
                const selected = tab === t.value;
                const count = tabCount(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(t.value)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? "bg-primary-50 text-primary ring-1 ring-primary/25"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    }`}
                  >
                    {t.label}
                    <span className={`tabular-nums text-[10px] ${selected ? "text-primary/80" : "text-slate-400"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative shrink-0 sm:w-56">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mailboxes…"
                aria-label="Search sending accounts"
                className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-1.5 pl-8 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            </div>

            {/* Removable chips for whatever narrows the list (SalesBlink-style) */}
            {activeFilterChips.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3" data-testid="account-filter-chips">
                <span className="text-xs font-medium text-slate-500">Filters:</span>
                {activeFilterChips.map((c) => (
                  <span
                    key={c.key}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1.5 text-xs text-slate-700"
                  >
                    {c.label}
                    <button
                      type="button"
                      aria-label={`Remove filter ${c.label}`}
                      onClick={c.clear}
                      className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-14">
            <div className="w-8 h-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" aria-label="Loading" />
          </div>
        ) : loadError ? (
          <div className="p-8 text-center">
            <p className="text-red-600 text-sm mb-3">{loadError}</p>
            <button onClick={load} className="text-sm font-medium text-primary hover:underline">Try again</button>
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-12 text-center" data-testid="accounts-empty-first">
            <Mail className="mx-auto text-primary/30 mb-3" size={36} aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">Connect your first mailbox</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Add a mailbox to send campaigns from it, warm it up and sync replies into the Unified Inbox.
            </p>
            <button onClick={openCreate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
              <Plus size={16} /> Connect mailbox
            </button>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="p-12 text-center" data-testid="accounts-empty-filter">
            <Search className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">No mailboxes match these filters</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Try a different status tab or clear the search to see all {accounts.length} mailbox(es).
            </p>
            <button onClick={() => { setTab("all"); setSearch(""); }}
              className="mt-4 text-sm font-medium text-primary hover:underline">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Signature</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3">Daily campaign limit</th>
                  <th className="px-4 py-3">Sent today</th>
                  <th className="px-4 py-3">Hourly</th>
                  <th className="px-4 py-3">This hour</th>
                  <th className="px-4 py-3">Warmup</th>
                  <th className="px-4 py-3">Inbound sync</th>
                  <th className="px-4 py-3">Active campaigns</th>
                  <th className="px-4 py-3">Last sent</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccounts.map((a) => {
                  const test = testResults[a.id];
                  const remainingToday = a.remainingToday ?? (a.dailyLimit != null ? Math.max(0, a.dailyLimit - (a.sentToday ?? 0)) : null);
                  const remainingHour = a.remainingThisHour ?? (a.hourlyLimit != null ? Math.max(0, a.hourlyLimit - (a.sentThisHour ?? 0)) : null);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <button onClick={() => openDrawer(a.id)} className="text-left group">
                          <span className="font-medium text-slate-900 group-hover:text-primary group-hover:underline">{a.fromEmail}</span>
                          <span className="block text-xs text-slate-500">{a.fromName || a.name}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Signature for ${a.name}`}
                          value={signatureValueOf(a)}
                          disabled={busyActionId === a.id}
                          onChange={(e) => handleSignatureChange(a, e.target.value)}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 max-w-[180px] disabled:opacity-50"
                        >
                          <option value="inherit">Inherit org default</option>
                          {signatures.map((s) => (
                            <option key={s.id} value={`custom:${s.id}`}>Custom — {s.name}</option>
                          ))}
                          {a.signatureMode === "custom" && !a.signatureId && (
                            <option value="custom:">Choose Signature</option>
                          )}
                          <option value="none">No signature</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">{statusBadge(a)}</td>
                      <td className="px-4 py-3"><Badge status={a.healthStatus || "unknown"} /></td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {a.dailyLimit ?? "∞"}
                        {remainingToday != null && <span className="block text-[10px] text-slate-400">{remainingToday} remaining</span>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{a.sentToday ?? 0}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {a.hourlyLimit ?? "∞"}
                        {remainingHour != null && <span className="block text-[10px] text-slate-400">{remainingHour} remaining</span>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{a.sentThisHour ?? 0}</td>
                      <td className="px-4 py-3"><Badge status={a.warmupStatus || "not_started"} /></td>
                      <td className="px-4 py-3">{syncCell(a)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{a.activeCampaigns ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{a.lastSentAt ? timeAgo(a.lastSentAt) : "Never"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1" aria-label={`Actions for ${a.name}`}>
                          <IconBtn title="Test Connection" onClick={() => testConnection(a.id)} disabled={testingId === a.id}>
                            {testingId === a.id ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
                          </IconBtn>
                          <IconBtn title="Send Test Email" onClick={() => openSendTest(a.id)}>
                            <Send size={15} />
                          </IconBtn>
                          <IconBtn title="Edit" onClick={() => openEdit(a)}>
                            <Pencil size={15} />
                          </IconBtn>
                          <IconBtn title={a.isEnabled ? "Pause" : "Resume"} onClick={() => toggleEnabled(a)} disabled={busyActionId === a.id}>
                            {busyActionId === a.id ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                          </IconBtn>
                          <IconBtn title="Delete" danger onClick={() => remove(a)} disabled={busyActionId === a.id}>
                            <Trash2 size={15} />
                          </IconBtn>
                        </div>
                        {test && (
                          <div className={`text-[10px] mt-1 text-right ${test.success ? "text-emerald-600" : "text-red-600"}`}>{test.message}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Account detail drawer (§42) */}
      {drawerId && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Account details">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerId(null)} />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto p-4 sm:p-6 space-y-4">
            {(() => {
              const a = accounts.find((x) => x.id === drawerId);
              if (!a) return <p className="text-sm text-slate-500">Account not found.</p>;
              return (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{a.fromEmail}</h3>
                      <p className="text-sm text-slate-500">{a.fromName || a.name}</p>
                    </div>
                    <Badge status={a.healthStatus || "unknown"} />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm border border-slate-100 rounded-xl p-4">
                    <div><dt className="text-xs text-slate-400">Status</dt><dd>{statusBadge(a)}</dd></div>
                    <div><dt className="text-xs text-slate-400">Warmup</dt><dd><Badge status={a.warmupStatus || "not_started"} /></dd></div>
                    <div><dt className="text-xs text-slate-400">Today's sending</dt><dd className="tabular-nums">{usage?.sentToday ?? a.sentToday ?? 0} / {usage?.dailyLimit ?? a.dailyLimit ?? "∞"}</dd></div>
                    <div><dt className="text-xs text-slate-400">This hour</dt><dd className="tabular-nums">{usage?.sentThisHour ?? a.sentThisHour ?? 0} / {usage?.hourlyLimit ?? a.hourlyLimit ?? "∞"}</dd></div>
                    <div><dt className="text-xs text-slate-400">Active campaigns</dt><dd className="tabular-nums">{usage?.activeCampaigns ?? a.activeCampaigns ?? 0}</dd></div>
                    <div><dt className="text-xs text-slate-400">Last sent</dt><dd>{a.lastSentAt ? new Date(a.lastSentAt).toLocaleString() : "Never"}</dd></div>
                    <div><dt className="text-xs text-slate-400">Timezone</dt><dd>{a.timezone || "UTC"}</dd></div>
                    <div><dt className="text-xs text-slate-400">SMTP</dt><dd className="text-xs">{a.smtpHost}:{a.smtpPort} · {a.security.toUpperCase()}</dd></div>
                  </dl>
                  <div className="border border-slate-100 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Last 30 days</h4>
                    {usageLoading ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading…</div>
                    ) : usage ? (
                      <div className="grid grid-cols-4 gap-2 text-center text-sm">
                        <Stat label="Sent" value={usage.last30Days.sent} />
                        <Stat label="Failed" value={usage.last30Days.failed} />
                        <Stat label="Bounced" value={usage.last30Days.bounced} />
                        <Stat label="Replied" value={usage.last30Days.replied} />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Usage unavailable.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => { setDrawerId(null); toggleEnabled(a); }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                      <Power size={13} /> {a.isEnabled ? "Pause" : "Resume"}
                    </button>
                    <button onClick={() => { setDrawerId(null); openEdit(a); }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => { setDrawerId(null); testConnection(a.id); }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                      <PlugZap size={13} /> Test Connection
                    </button>
                    <button onClick={() => { setDrawerId(null); openSendTest(a.id); }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                      <Send size={13} /> Send Test Email
                    </button>
                  </div>
                </>
              );
            })()}
          </aside>
        </div>
      )}

      {/* Warm-up engine (Prompt 8) */}
      <WarmupPanel />

      {/* Send test email modal */}
      {testModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Send test email">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setTestModalId(null)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900">Send Test Email</h3>
            <p className="text-sm text-slate-500 mt-1">
              A real email is sent through this SMTP account. Test emails never affect campaign analytics.
            </p>
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1" htmlFor="test-address">Recipient</label>
            <input id="test-address" type="email" className={inputCls()} value={testAddress} autoFocus
              placeholder="you@yourdomain.com" onChange={(e) => setTestAddress(e.target.value)} />
            <label className="block text-sm font-medium text-slate-700 mt-3 mb-1" htmlFor="test-subject">Subject</label>
            <input id="test-subject" className={inputCls()} value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)} />
            <label className="block text-sm font-medium text-slate-700 mt-3 mb-1" htmlFor="test-body">Body</label>
            <textarea id="test-body" className={inputCls()} rows={3} value={testBody}
              onChange={(e) => setTestBody(e.target.value)} />
            {sendTestResult && (
              <div className={`mt-3 text-sm px-3 py-2 rounded-lg border ${sendTestResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`} role="status">
                {sendTestResult.ok ? <CheckCircle2 size={14} className="inline mr-1" /> : <XCircle size={14} className="inline mr-1" />}
                {sendTestResult.message}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setTestModalId(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
                Close
              </button>
              <button onClick={sendTest} disabled={isSendingTest || !testAddress.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed">
                {isSendingTest ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {isSendingTest ? "Sending…" : "Send Test"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewCard({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "warn" | "bad" }) {
  const toneCls = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function IconBtn({ title, onClick, danger, disabled, children }: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
        danger ? "text-slate-400 hover:text-red-600 hover:bg-red-50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

const inputCls = (error?: string) =>
  `w-full border rounded-lg px-3 py-2 text-sm bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
    error ? "border-red-300" : "border-slate-300"
  }`;
