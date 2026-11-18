// Email Sending — PROMPT 9.1 Sending Account Management Center.
// Real data only: every number comes from the backend (usage, health,
// capacity). Passwords are write-only (AES-256-GCM at rest); SMTP tests and
// test emails are real SMTP operations, never simulated.
import { useState, useEffect, useCallback } from "react";
import {
  Plus, Mail, Pencil, Trash2, PlugZap, Send, Power,
  RefreshCw, CheckCircle2, XCircle, Loader2, KeyRound, CircleDot,
  ChevronLeft, ChevronRight, Gauge, CalendarClock,
} from "lucide-react";
import { emailSendingService, type SendingOverview, type AccountUsage } from "@/services/emailSending";
import { inboxService, type SyncAccountStatus } from "@/services/inbox";
import { WarmupPanel } from "@/components/WarmupPanel";
import { signatureService, type EmailSignature } from "@/services/signature";
import { Badge } from "@/components/Badge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { SmtpAccount, SmtpTestResult, PerDayWindow } from "@/types/prompt6";

type FormState = {
  name: string;
  smtpHost: string;
  smtpPort: string;
  security: "none" | "tls" | "ssl";
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  replyToEmail: string;
  dailyLimit: string;
  hourlyLimit: string;
  minDelayMinutes: string;
  maxDelayMinutes: string;
  minimumWaitMinutes: string;
  warmupDailyLimit: string;
  timezone: string;
  scheduleEnabled: boolean;
  sendingSchedule: Record<string, PerDayWindow>;
  signatureMode: "inherit" | "custom" | "none";
  signatureId: string;
};

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Toronto", "Europe/London", "Europe/Berlin", "Europe/Madrid",
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];
const DAY_NAMES: Record<string, string> = {
  "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday",
};
const defaultSchedule = (): Record<string, PerDayWindow> => Object.fromEntries(
  ["1", "2", "3", "4", "5", "6", "7"].map((d) => [
    d,
    { enabled: !["6", "7"].includes(d), start: "09:00", end: "17:00" },
  ]),
);

const EMPTY_FORM: FormState = {
  name: "", smtpHost: "", smtpPort: "587", security: "tls",
  smtpUsername: "", smtpPassword: "", fromEmail: "", fromName: "",
  replyToEmail: "", dailyLimit: "", hourlyLimit: "",
  minDelayMinutes: "0", maxDelayMinutes: "0", minimumWaitMinutes: "1", warmupDailyLimit: "",
  timezone: "UTC", scheduleEnabled: false, sendingSchedule: defaultSchedule(),
  signatureMode: "inherit", signatureId: "",
};

function toForm(a: SmtpAccount): FormState {
  const schedule = a.sendingSchedule ?? null;
  return {
    name: a.name, smtpHost: a.smtpHost, smtpPort: String(a.smtpPort),
    security: a.security, smtpUsername: a.smtpUsername || "",
    smtpPassword: "",
    fromEmail: a.fromEmail, fromName: a.fromName || "",
    replyToEmail: a.replyToEmail || "",
    dailyLimit: a.dailyLimit != null ? String(a.dailyLimit) : "",
    hourlyLimit: a.hourlyLimit != null ? String(a.hourlyLimit) : "",
    minDelayMinutes: a.minDelayMinutes != null ? String(a.minDelayMinutes) : "0",
    maxDelayMinutes: a.maxDelayMinutes != null ? String(a.maxDelayMinutes) : "0",
    minimumWaitMinutes: a.minimumWaitMinutes != null ? String(a.minimumWaitMinutes) : "1",
    warmupDailyLimit: a.warmupDailyLimit != null ? String(a.warmupDailyLimit) : "",
    timezone: a.timezone || "UTC",
    scheduleEnabled: Boolean(schedule),
    sendingSchedule: schedule ? { ...defaultSchedule(), ...schedule } : defaultSchedule(),
    signatureMode: (a.signatureMode as FormState["signatureMode"]) || "inherit",
    signatureId: a.signatureId || "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WIZARD_STEPS = ["Account Details", "SMTP Configuration", "Sending Limits", "Schedule", "Test & Complete"];

export function EmailSendingSettingsPage() {
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [overview, setOverview] = useState<SendingOverview | null>(null);
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdTest, setCreatedTest] = useState<SmtpTestResult | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

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

  const closeForm = () => {
    setShowForm(false);
    setWizardStep(1);
    setCreatedId(null);
    setCreatedTest(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setWizardStep(1);
    setCreatedId(null);
    setCreatedTest(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowForm(true);
  };

  const openEdit = (a: SmtpAccount) => {
    setEditingId(a.id);
    setWizardStep(1);
    setCreatedId(null);
    setCreatedTest(null);
    setForm(toForm(a));
    setFormErrors({});
    setShowForm(true);
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

  // Cross-field validation shared by all steps (§13, §14).
  const buildErrors = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Account name is required";
    if (!form.smtpHost.trim()) errors.smtpHost = "SMTP host is required";
    const port = parseInt(form.smtpPort, 10);
    if (!form.smtpPort || Number.isNaN(port) || port <= 0 || port > 65535) {
      errors.smtpPort = "Port must be 1-65535";
    }
    if (!form.fromEmail.trim() || !EMAIL_RE.test(form.fromEmail)) {
      errors.fromEmail = "A valid from email is required";
    }
    if (form.replyToEmail && !EMAIL_RE.test(form.replyToEmail)) {
      errors.replyToEmail = "Reply-To must be a valid email address";
    }
    if (!editingId && !form.smtpPassword) {
      errors.smtpPassword = "Password is required for a new account";
    }
    const daily = form.dailyLimit ? parseInt(form.dailyLimit, 10) : null;
    const hourly = form.hourlyLimit ? parseInt(form.hourlyLimit, 10) : null;
    if (daily != null && (Number.isNaN(daily) || daily < 1)) errors.dailyLimit = "Must be a positive integer";
    if (hourly != null && (Number.isNaN(hourly) || hourly < 1)) errors.hourlyLimit = "Must be a positive integer";
    if (daily != null && hourly != null && hourly > daily) {
      errors.hourlyLimit = "Hourly limit cannot exceed daily limit";
    }
    const minD = parseInt(form.minDelayMinutes || "0", 10);
    const maxD = parseInt(form.maxDelayMinutes || "0", 10);
    const minW = parseInt(form.minimumWaitMinutes || "1", 10);
    if (Number.isNaN(minW) || minW < 0) errors.minimumWaitMinutes = "Must be 0 or more";
    if (Number.isNaN(minD) || minD < 0) errors.minDelayMinutes = "Must be 0 or more";
    if (Number.isNaN(maxD) || maxD < 0) errors.maxDelayMinutes = "Must be 0 or more";
    if (!Number.isNaN(minD) && !Number.isNaN(maxD) && minD > maxD) {
      errors.maxDelayMinutes = "Maximum delay cannot be less than minimum delay";
    }
    if (form.scheduleEnabled) {
      for (const [day, window] of Object.entries(form.sendingSchedule)) {
        if (!window.enabled) continue;
        if (!HHMM_RE.test(window.start) || !HHMM_RE.test(window.end)) {
          errors[`schedule-${day}`] = `${DAY_NAMES[day]} hours must be HH:MM`;
        } else if (window.start >= window.end) {
          errors[`schedule-${day}`] = `${DAY_NAMES[day]}: start must be before end`;
        }
      }
    }
    return errors;
  };

  const validate = (): boolean => {
    const errors = buildErrors();
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /** Validate only the fields visible on a given wizard step. */
  const validateStep = (step: number): boolean => {
    const errors = buildErrors();
    setFormErrors(errors);
    const stepFields: Record<number, string[]> = {
      1: ["name", "fromEmail", "replyToEmail"],
      2: ["smtpHost", "smtpPort", "smtpPassword"],
      3: ["dailyLimit", "hourlyLimit", "minDelayMinutes", "maxDelayMinutes", "minimumWaitMinutes"],
      4: ["schedule-1", "schedule-2", "schedule-3", "schedule-4", "schedule-5", "schedule-6", "schedule-7"],
    };
    return !Object.keys(errors).some((k) => (stepFields[step] || []).includes(k));
  };

  const payloadOf = () => ({
    name: form.name.trim(),
    smtpHost: form.smtpHost.trim(),
    smtpPort: parseInt(form.smtpPort, 10),
    security: form.security,
    smtpUsername: form.smtpUsername || undefined,
    smtpPassword: form.smtpPassword || undefined,
    fromEmail: form.fromEmail.trim(),
    fromName: form.fromName || undefined,
    replyToEmail: form.replyToEmail || undefined,
    dailyLimit: form.dailyLimit ? parseInt(form.dailyLimit, 10) : undefined,
    hourlyLimit: form.hourlyLimit ? parseInt(form.hourlyLimit, 10) : undefined,
    minDelayMinutes: form.minDelayMinutes ? parseInt(form.minDelayMinutes, 10) : 0,
    maxDelayMinutes: form.maxDelayMinutes ? parseInt(form.maxDelayMinutes, 10) : 0,
    minimumWaitMinutes: form.minimumWaitMinutes !== "" ? Math.max(0, parseInt(form.minimumWaitMinutes, 10) || 0) : 1,
    warmupDailyLimit: form.warmupDailyLimit ? parseInt(form.warmupDailyLimit, 10) : null,
    timezone: form.timezone,
    sendingSchedule: form.scheduleEnabled ? form.sendingSchedule : null,
    signatureMode: form.signatureMode,
    signatureId: form.signatureMode === "custom" ? form.signatureId || null : null,
  });

  const save = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      const payload = payloadOf();
      if (editingId) {
        await emailSendingService.updateAccount(editingId, payload);
        toast.success(`"${payload.name}" updated.`);
        closeForm();
        await load();
      } else {
        const res = await emailSendingService.createAccount(payload);
        setCreatedId(res.data.id);
        // Step 5: immediately run a real SMTP handshake and show the honest result.
        try {
          const test = await emailSendingService.testConnection(res.data.id);
          setCreatedTest(test);
        } catch {
          setCreatedTest({ success: false, message: "SMTP connection test failed to run." });
        }
        await load();
      }
    } catch (err: any) {
      toast.error(err?.data?.error || err?.message || "Failed to save the account.");
    } finally {
      setIsSaving(false);
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

  const setDay = (day: string, patch: Partial<PerDayWindow>) => {
    setForm((prev) => ({
      ...prev,
      sendingSchedule: {
        ...prev.sendingSchedule,
        [day]: { ...prev.sendingSchedule[day], ...patch },
      },
    }));
  };

  const isCreate = !editingId;
  const activeWizardStep = isCreate ? wizardStep : 0;
  const showStep = (n: number) => !isCreate || activeWizardStep === n;
  const createdAccount = createdId ? accounts.find((a) => a.id === createdId) : undefined;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5" data-testid="email-sending-settings">
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

      {/* Account form / wizard */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-h-[88vh] overflow-y-auto" role="form" aria-label="Sending account form">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {isCreate ? "Add Sending Account" : "Edit Sending Account"}
            </h2>
            {isCreate && (
              <ol className="flex items-center gap-1.5 text-xs" aria-label="Setup progress">
                {WIZARD_STEPS.map((label, i) => {
                  const n = i + 1;
                  const done = createdId ? true : n < wizardStep;
                  const current = !createdId && n === wizardStep;
                  return (
                    <li key={label} className="flex items-center gap-1.5">
                      <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-semibold ${
                        done ? "bg-primary text-white border-primary"
                        : current ? "bg-white text-primary border-primary"
                        : "bg-white text-slate-400 border-slate-300"
                      }`}>{done ? "✓" : n}</span>
                      <span className={`hidden md:inline ${current ? "text-slate-800 font-medium" : "text-slate-400"}`}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Stepper gate for create mode; edit mode shows all sections */}
          {showStep(1) && (
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><CircleDot size={12} /> Account details</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Account Name" error={formErrors.name}>
                  <input className={inputCls(formErrors.name)} value={form.name} autoFocus
                    onChange={(e) => setForm({ ...form, name: e.target.value, fromName: form.fromName === form.name ? e.target.value : form.fromName })}
                    placeholder="Prateek Sales" />
                </Field>
                <Field label="From Email" error={formErrors.fromEmail}>
                  <input className={inputCls(formErrors.fromEmail)} value={form.fromEmail}
                    onChange={(e) => setForm({ ...form, fromEmail: e.target.value })} placeholder="sales@yourdomain.com" />
                </Field>
                <Field label="From Name">
                  <input className={inputCls()} value={form.fromName}
                    onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder={form.name || "Prateek Shukla"} />
                </Field>
                <Field label="Reply-To" error={formErrors.replyToEmail}>
                  <input className={inputCls(formErrors.replyToEmail)} value={form.replyToEmail}
                    onChange={(e) => setForm({ ...form, replyToEmail: e.target.value })} placeholder="replies@yourdomain.com" />
                </Field>
                <Field label="Signature">
                  <select className={inputCls()} value={`${form.signatureMode}${form.signatureMode === "custom" ? `:${form.signatureId}` : ""}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "inherit") setForm({ ...form, signatureMode: "inherit", signatureId: "" });
                      else if (v === "none") setForm({ ...form, signatureMode: "none", signatureId: "" });
                      else if (v.startsWith("custom:")) setForm({ ...form, signatureMode: "custom", signatureId: v.slice(7) });
                    }}>
                    <option value="inherit">Inherit org default</option>
                    {signatures.map((s) => (
                      <option key={s.id} value={`custom:${s.id}`}>Custom — {s.name}</option>
                    ))}
                    <option value="none">No signature</option>
                  </select>
                </Field>
              </div>
            </fieldset>
          )}

          {showStep(2) && (
            <fieldset className="space-y-4 mt-5">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><KeyRound size={12} /> SMTP configuration</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="SMTP Host" error={formErrors.smtpHost}>
                  <input className={inputCls(formErrors.smtpHost)} value={form.smtpHost}
                    onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="mail.yourdomain.com" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Port" error={formErrors.smtpPort}>
                    <input type="number" className={inputCls(formErrors.smtpPort)} value={form.smtpPort}
                      onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} />
                  </Field>
                  <Field label="Security">
                    <select className={inputCls()} value={form.security}
                      onChange={(e) => setForm({ ...form, security: e.target.value as FormState["security"] })}>
                      <option value="tls">STARTTLS (587)</option>
                      <option value="ssl">SSL/TLS (465)</option>
                      <option value="none">None (insecure)</option>
                    </select>
                  </Field>
                </div>
                {form.security === "none" && (
                  <p className="md:col-span-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
                    Plain SMTP sends credentials and mail unencrypted. Only use this on a trusted private relay. STARTTLS or SSL/TLS is strongly recommended.
                  </p>
                )}
                <Field label="Username">
                  <input className={inputCls()} value={form.smtpUsername} autoComplete="off"
                    onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })} />
                </Field>
                <Field label={editingId ? "Password (leave blank to keep)" : "Password"} error={formErrors.smtpPassword}>
                  <input type="password" className={inputCls(formErrors.smtpPassword)} value={form.smtpPassword}
                    autoComplete="new-password" placeholder="••••••••"
                    onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })} />
                </Field>
              </div>
            </fieldset>
          )}

          {showStep(3) && (
            <fieldset className="space-y-4 mt-5">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><Gauge size={12} /> Sending limits</legend>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Field label="Daily campaign limit" error={formErrors.dailyLimit}>
                  <input type="number" min={1} className={inputCls(formErrors.dailyLimit)} value={form.dailyLimit}
                    onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} placeholder="30" />
                </Field>
                <Field label="Hourly Limit" error={formErrors.hourlyLimit}>
                  <input type="number" min={1} className={inputCls(formErrors.hourlyLimit)} value={form.hourlyLimit}
                    onChange={(e) => setForm({ ...form, hourlyLimit: e.target.value })} placeholder="10" />
                </Field>
                <Field label="Min Delay (min)" error={formErrors.minDelayMinutes}>
                  <input type="number" min={0} className={inputCls(formErrors.minDelayMinutes)} value={form.minDelayMinutes}
                    onChange={(e) => setForm({ ...form, minDelayMinutes: e.target.value })} />
                </Field>
                <Field label="Max Delay (min)" error={formErrors.maxDelayMinutes}>
                  <input type="number" min={0} className={inputCls(formErrors.maxDelayMinutes)} value={form.maxDelayMinutes}
                    onChange={(e) => setForm({ ...form, maxDelayMinutes: e.target.value })} />
                </Field>
                <Field label="Minimum wait (min)" error={formErrors.minimumWaitMinutes}>
                  <input type="number" min={0} className={inputCls(formErrors.minimumWaitMinutes)} value={form.minimumWaitMinutes}
                    onChange={(e) => setForm({ ...form, minimumWaitMinutes: e.target.value })} />
                </Field>
              </div>
              <p className="text-xs text-slate-400">
                Daily campaign limit applies across all campaigns this account is pooled into (Instantly: 30/day per account recommended).
                Hourly cannot exceed daily; minimum delay cannot exceed maximum delay; minimum wait is the gap between two sends from this account.
              </p>
              <Field label="Warm-up daily limit (optional)">
                <input type="number" min={1} className={inputCls()} value={form.warmupDailyLimit}
                  onChange={(e) => setForm({ ...form, warmupDailyLimit: e.target.value })} placeholder="e.g. 20" />
              </Field>
            </fieldset>
          )}

          {showStep(4) && (
            <fieldset className="space-y-4 mt-5">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><CalendarClock size={12} /> Schedule & timezone</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Timezone (IANA)">
                  <select className={inputCls()} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                    {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </Field>
                <label className="flex items-end gap-2 text-sm text-slate-700 pb-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-[rgb(var(--primary))]"
                    checked={form.scheduleEnabled}
                    onChange={(e) => setForm({ ...form, scheduleEnabled: e.target.checked })} />
                  Restrict sending to a weekly schedule
                </label>
              </div>
              {form.scheduleEnabled && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {Object.entries(DAY_NAMES).map(([day, label]) => {
                    const w = form.sendingSchedule[day];
                    const dayError = formErrors[`schedule-${day}`];
                    return (
                      <div key={day} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <label className="flex items-center gap-2 w-36 text-sm font-medium text-slate-700 cursor-pointer">
                          <input type="checkbox" className="w-4 h-4 accent-[rgb(var(--primary))]"
                            checked={w.enabled} onChange={(e) => setDay(day, { enabled: e.target.checked })} />
                          {label}
                        </label>
                        <input type="time" aria-label={`${label} start`} disabled={!w.enabled}
                          className="border border-slate-200 rounded-md px-2 py-1.5 text-sm disabled:opacity-40"
                          value={w.start} onChange={(e) => setDay(day, { start: e.target.value })} />
                        <span className="text-slate-400 text-xs">to</span>
                        <input type="time" aria-label={`${label} end`} disabled={!w.enabled}
                          className="border border-slate-200 rounded-md px-2 py-1.5 text-sm disabled:opacity-40"
                          value={w.end} onChange={(e) => setDay(day, { end: e.target.value })} />
                        {!w.enabled && <span className="text-xs text-slate-400">Disabled</span>}
                        {dayError && <span className="text-xs text-red-600 w-full" role="alert">{dayError}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

          {showStep(5) && isCreate && (
            createdId ? (
              <div className="text-center py-6 space-y-3">
                {createdTest?.success ? (
                  <>
                    <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
                    <h3 className="text-lg font-semibold text-slate-900">Connection successful</h3>
                    <p className="text-sm text-slate-500">{createdAccount?.fromEmail} can send email through this SMTP account.</p>
                  </>
                ) : (
                  <>
                    <XCircle size={40} className="mx-auto text-red-500" />
                    <h3 className="text-lg font-semibold text-slate-900">Connection failed</h3>
                    <p className="text-sm text-slate-600" role="alert">{createdTest?.message || "SMTP connection failed."}</p>
                    <p className="text-xs text-slate-400">The account was created and SMTP credentials were stored encrypted. Fix the SMTP settings and use “Test Connection”.</p>
                  </>
                )}
                <button onClick={closeForm}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Review before creating</h3>
                <dl className="grid grid-cols-2 gap-2 text-sm bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <dt className="text-slate-500">Account</dt><dd className="text-slate-800 font-medium">{form.name || "—"}</dd>
                  <dt className="text-slate-500">From</dt><dd className="text-slate-800">{form.fromName} &lt;{form.fromEmail || "—"}&gt;</dd>
                  <dt className="text-slate-500">SMTP</dt><dd className="text-slate-800">{form.smtpHost || "—"}:{form.smtpPort} · {form.security.toUpperCase()}</dd>
                  <dt className="text-slate-500">Limits</dt><dd className="text-slate-800">{form.dailyLimit || "∞"}/day · {form.hourlyLimit || "∞"}/hour</dd>
                  <dt className="text-slate-500">Timezone</dt><dd className="text-slate-800">{form.timezone}</dd>
                  <dt className="text-slate-500">Schedule</dt><dd className="text-slate-800">{form.scheduleEnabled ? "Weekly schedule set" : "Always eligible (campaign window applies)"}</dd>
                </dl>
                <p className="text-xs text-slate-400">Creating the account stores its password encrypted (AES-256-GCM) and then runs a real SMTP handshake to verify it.</p>
              </div>
            )
          )}

          <div className="flex justify-between items-center gap-2 mt-6 border-t border-slate-100 pt-4">
            <div>
              {isCreate && wizardStep > 1 && !createdId && (
                <button onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
                  <ChevronLeft size={15} /> Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isCreate || !createdId ? (
                <button onClick={closeForm}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
                  Cancel
                </button>
              ) : null}
              {isCreate && wizardStep < 5 && (
                <button onClick={() => { if (validateStep(wizardStep)) setWizardStep((s) => Math.min(5, s + 1)); }}
                  className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
                  Next <ChevronRight size={15} />
                </button>
              )}
              {(!isCreate || wizardStep === 5) && !createdId && (
                <button onClick={save} disabled={isSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed">
                  {isSaving && <Loader2 size={15} className="animate-spin" />}
                  {isCreate ? "Create account & test connection" : "Save Changes"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {dialog}

      {/* Accounts table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
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
          <div className="p-12 text-center">
            <Mail className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">No sending accounts yet</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Add your SMTP server to start sending campaigns. SalesFire works with any standards-compliant server such as Postfix.
            </p>
            <button onClick={openCreate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
              <Plus size={16} /> Add Sending Account
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                {accounts.map((a) => {
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
          <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto p-6 space-y-4">
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

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
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
