// AddAccountWizard — SalesBlink-style "Add mailbox" connection flow, improved.
//
// Full-screen 5-step wizard: Provider → Connect → Sending → Warmup → Done.
// Better than the reference flow:
//   - Provider presets (Google / Microsoft / Custom) auto-fill SMTP AND IMAP
//     server settings — users never type smtp.gmail.com.
//   - Reply sync (IMAP) is configured inline with "same as SMTP" shortcuts
//     (the old flow had no way to set IMAP at all).
//   - Progressive disclosure: credential fields collapse behind checkboxes.
//   - Recommended defaults (30/day, Instantly guidance) appear as placeholders.
//   - The final step runs a real SMTP handshake and honestly reports failure
//     with a retry — the account is kept, never silently dropped.
import { useState, useId, isValidElement, cloneElement } from "react";
import {
  X, ChevronLeft, ChevronRight, Check, Loader2, Eye, EyeOff, Info,
  CheckCircle2, XCircle, RotateCcw, PlugZap, Gauge, CalendarClock,
  KeyRound, CircleDot, Mail, Server, Building2,
} from "lucide-react";
import { emailSendingService } from "@/services/emailSending";
import type { EmailSignature } from "@/services/signature";
import type { SmtpAccount, SmtpTestResult } from "@/types/prompt6";

export const WIZARD_STEPS = ["Provider", "Connect", "Sending", "Warmup", "Done"] as const;

export type ProviderId = "google" | "microsoft" | "custom" | "";

interface ProviderDef {
  id: Exclude<ProviderId, "">;
  label: string;
  description: string;
  badge?: string;
  hint?: string;
  tile: string; // icon tile classes
  icon: React.ReactNode;
  smtp?: { host: string; port: number; security: "tls" | "ssl" };
  imap?: { host: string; port: number; secure: boolean };
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "google",
    label: "Google Workspace / Gmail",
    description: "Gmail and Google Workspace mailboxes.",
    badge: "Recommended",
    hint: "Use an App Password: Google Account → Security → 2-Step Verification → App passwords. Your normal password will not work when 2FA is on.",
    tile: "bg-red-50 text-red-600",
    icon: <Mail size={17} aria-hidden />,
    smtp: { host: "smtp.gmail.com", port: 587, security: "tls" },
    imap: { host: "imap.gmail.com", port: 993, secure: true },
  },
  {
    id: "microsoft",
    label: "Microsoft 365 / Outlook",
    description: "Microsoft 365, GoDaddy or free outlook.com.",
    badge: "Recommended",
    hint: "SMTP AUTH must be enabled for the mailbox (Microsoft 365 admin → Settings → Services → SMTP relay).",
    tile: "bg-blue-50 text-blue-600",
    icon: <Building2 size={17} aria-hidden />,
    smtp: { host: "smtp.office365.com", port: 587, security: "tls" },
    imap: { host: "outlook.office365.com", port: 993, secure: true },
  },
  {
    id: "custom",
    label: "Any other SMTP provider",
    description: "Postfix, Zoho, Yahoo, Amazon SES, a private relay…",
    tile: "bg-slate-100 text-slate-600",
    icon: <Server size={17} aria-hidden />,
  },
];

/** Infer the provider from a stored host (edit mode pre-selection). */
export function inferProvider(smtpHost?: string | null): ProviderId {
  const h = (smtpHost || "").toLowerCase();
  if (h.includes("gmail.com") || h.includes("googlemail.com")) return "google";
  if (h.includes("office365.com") || h.includes("outlook.com") || h.includes("hotmail.com") || h.includes("live.com")) return "microsoft";
  if (h) return "custom";
  return "";
}

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Toronto", "Europe/London", "Europe/Berlin", "Europe/Madrid",
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];
const DAY_NAMES: Record<string, string> = {
  "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday",
};
const defaultSchedule = (): Record<string, { enabled: boolean; start: string; end: string }> =>
  Object.fromEntries(
    ["1", "2", "3", "4", "5", "6", "7"].map((d) => [
      d,
      { enabled: !["6", "7"].includes(d), start: "09:00", end: "17:00" },
    ]),
  );

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type WizardForm = {
  provider: ProviderId;
  name: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  smtpHost: string;
  smtpPort: string;
  security: "none" | "tls" | "ssl";
  smtpUsername: string;
  smtpPassword: string;
  imapEnabled: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  imapSameUser: boolean;
  imapSamePass: boolean;
  dailyLimit: string;
  hourlyLimit: string;
  minDelayMinutes: string;
  maxDelayMinutes: string;
  minimumWaitMinutes: string;
  warmupDailyLimit: string;
  timezone: string;
  scheduleEnabled: boolean;
  sendingSchedule: Record<string, { enabled: boolean; start: string; end: string }>;
  signatureMode: "inherit" | "custom" | "none";
  signatureId: string;
};

const EMPTY_FORM: WizardForm = {
  provider: "",
  name: "", fromName: "", fromEmail: "", replyToEmail: "",
  smtpHost: "", smtpPort: "587", security: "tls",
  smtpUsername: "", smtpPassword: "",
  imapEnabled: false, imapHost: "", imapPort: "993", imapSecure: true,
  imapUsername: "", imapPassword: "", imapSameUser: true, imapSamePass: true,
  dailyLimit: "", hourlyLimit: "",
  minDelayMinutes: "0", maxDelayMinutes: "0", minimumWaitMinutes: "1",
  warmupDailyLimit: "",
  timezone: "UTC", scheduleEnabled: false, sendingSchedule: defaultSchedule(),
  signatureMode: "inherit", signatureId: "",
};

function toForm(a: SmtpAccount): WizardForm {
  const schedule = a.sendingSchedule ?? null;
  return {
    ...EMPTY_FORM,
    provider: inferProvider(a.smtpHost),
    name: a.name,
    fromName: a.fromName || "",
    fromEmail: a.fromEmail,
    replyToEmail: a.replyToEmail || "",
    smtpHost: a.smtpHost,
    smtpPort: String(a.smtpPort),
    security: a.security,
    smtpUsername: a.smtpUsername || "",
    smtpPassword: "",
    imapEnabled: Boolean(a.imapEnabled),
    imapHost: a.imapHost || "",
    imapPort: String(a.imapPort ?? 993),
    imapSecure: a.imapSecure !== false,
    imapUsername: a.imapUsername || "",
    imapPassword: "",
    imapSameUser: Boolean(a.imapUsername) && a.imapUsername === (a.smtpUsername || a.fromEmail),
    imapSamePass: Boolean(a.hasImapPassword), // stored password keeps working while blank
    dailyLimit: a.dailyLimit != null ? String(a.dailyLimit) : "",
    hourlyLimit: a.hourlyLimit != null ? String(a.hourlyLimit) : "",
    minDelayMinutes: a.minDelayMinutes != null ? String(a.minDelayMinutes) : "0",
    maxDelayMinutes: a.maxDelayMinutes != null ? String(a.maxDelayMinutes) : "0",
    minimumWaitMinutes: a.minimumWaitMinutes != null ? String(a.minimumWaitMinutes) : "1",
    warmupDailyLimit: a.warmupDailyLimit != null ? String(a.warmupDailyLimit) : "",
    timezone: a.timezone || "UTC",
    scheduleEnabled: Boolean(schedule),
    sendingSchedule: schedule ? { ...defaultSchedule(), ...schedule } : defaultSchedule(),
    signatureMode: (a.signatureMode as WizardForm["signatureMode"]) || "inherit",
    signatureId: a.signatureId || "",
  };
}

/** Apply a provider preset: auto-fill SMTP + IMAP servers. */
function applyProvider(f: WizardForm, id: ProviderId): WizardForm {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p?.smtp || !p?.imap) return { ...f, provider: id };
  return {
    ...f,
    provider: id,
    smtpHost: p.smtp.host,
    smtpPort: String(p.smtp.port),
    security: p.smtp.security,
    imapHost: p.imap.host,
    imapPort: String(p.imap.port),
    imapSecure: p.imap.secure,
  };
}

/** Step → the field errors that block advancing past it. */
const STEP_FIELDS: Record<number, string[]> = {
  1: ["provider"],
  2: [
    "name", "fromEmail", "replyToEmail", "smtpHost", "smtpPort", "smtpPassword",
    "imapHost", "imapPort", "imapUsername", "imapPassword",
  ],
  3: [
    "dailyLimit", "hourlyLimit", "minDelayMinutes", "maxDelayMinutes", "minimumWaitMinutes",
    "schedule-1", "schedule-2", "schedule-3", "schedule-4", "schedule-5", "schedule-6", "schedule-7",
  ],
  4: ["warmupDailyLimit"],
  5: [],
};

export function AddAccountWizard({
  open, mode, account, signatures, onClose, onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  /** Required in edit mode — the account being changed. */
  account?: SmtpAccount | null;
  signatures: EmailSignature[];
  onClose: () => void;
  /** Called after a successful create (post-test) or save. */
  onSaved: () => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardForm>(() => (mode === "edit" && account ? toForm(account) : EMPTY_FORM));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SmtpTestResult | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!open) return null;

  const set = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const buildErrors = (): Record<string, string> => {
    const f = form;
    const e: Record<string, string> = {};
    if (!f.provider) e.provider = "Choose a provider to continue";
    if (!f.name.trim()) e.name = "Account name is required";
    if (!f.fromEmail.trim() || !EMAIL_RE.test(f.fromEmail)) e.fromEmail = "A valid from email is required";
    if (f.replyToEmail && !EMAIL_RE.test(f.replyToEmail)) e.replyToEmail = "Reply-To must be a valid email address";
    if (!f.smtpHost.trim()) e.smtpHost = "SMTP host is required";
    const port = parseInt(f.smtpPort, 10);
    if (!f.smtpPort || Number.isNaN(port) || port <= 0 || port > 65535) e.smtpPort = "Port must be 1-65535";
    if (mode === "create" && !f.smtpPassword) e.smtpPassword = "Password is required";
    if (f.imapEnabled) {
      if (!f.imapHost.trim()) e.imapHost = "IMAP host is required for reply sync";
      const iPort = parseInt(f.imapPort, 10);
      if (!f.imapPort || Number.isNaN(iPort) || iPort <= 0 || iPort > 65535) e.imapPort = "Port must be 1-65535";
      if (!f.imapSameUser && !f.imapUsername.trim()) e.imapUsername = "IMAP username is required";
      const hasStored = mode === "edit" && Boolean(account?.hasImapPassword);
      const pass = f.imapSamePass ? f.smtpPassword : f.imapPassword;
      if (!pass && !hasStored) {
        e.imapPassword = f.imapSamePass
          ? "Enter the SMTP password, or uncheck “same as SMTP” and enter the IMAP password"
          : "IMAP password is required";
      }
    }
    const daily = f.dailyLimit ? parseInt(f.dailyLimit, 10) : null;
    const hourly = f.hourlyLimit ? parseInt(f.hourlyLimit, 10) : null;
    if (daily != null && (Number.isNaN(daily) || daily < 1)) e.dailyLimit = "Must be a positive integer";
    if (hourly != null && (Number.isNaN(hourly) || hourly < 1)) e.hourlyLimit = "Must be a positive integer";
    if (daily != null && hourly != null && hourly > daily) e.hourlyLimit = "Hourly limit cannot exceed daily limit";
    const minD = parseInt(f.minDelayMinutes || "0", 10);
    const maxD = parseInt(f.maxDelayMinutes || "0", 10);
    const minW = parseInt(f.minimumWaitMinutes || "1", 10);
    if (Number.isNaN(minW) || minW < 0) e.minimumWaitMinutes = "Must be 0 or more";
    if (Number.isNaN(minD) || minD < 0) e.minDelayMinutes = "Must be 0 or more";
    if (Number.isNaN(maxD) || maxD < 0) e.maxDelayMinutes = "Must be 0 or more";
    if (!Number.isNaN(minD) && !Number.isNaN(maxD) && minD > maxD) {
      e.maxDelayMinutes = "Maximum delay cannot be less than minimum delay";
    }
    if (f.warmupDailyLimit) {
      const n = parseInt(f.warmupDailyLimit, 10);
      if (Number.isNaN(n) || n < 1) e.warmupDailyLimit = "Must be a positive integer";
    }
    if (f.scheduleEnabled) {
      for (const [day, w] of Object.entries(f.sendingSchedule)) {
        if (!w.enabled) continue;
        if (!HHMM_RE.test(w.start) || !HHMM_RE.test(w.end)) {
          e[`schedule-${day}`] = `${DAY_NAMES[day]} hours must be HH:MM`;
        } else if (w.start >= w.end) {
          e[`schedule-${day}`] = `${DAY_NAMES[day]}: start must be before end`;
        }
      }
    }
    return e;
  };

  const validateStep = (n: number): boolean => {
    const all = buildErrors();
    setErrors(all);
    return !Object.keys(all).some((k) => (STEP_FIELDS[n] || []).includes(k));
  };

  const payloadOf = () => {
    const f = form;
    return {
      name: f.name.trim(),
      smtpHost: f.smtpHost.trim(),
      smtpPort: parseInt(f.smtpPort, 10),
      security: f.security,
      smtpUsername: f.smtpUsername.trim() || undefined,
      smtpPassword: f.smtpPassword || undefined,
      fromEmail: f.fromEmail.trim(),
      fromName: f.fromName || undefined,
      replyToEmail: f.replyToEmail || undefined,
      dailyLimit: f.dailyLimit ? parseInt(f.dailyLimit, 10) : undefined,
      hourlyLimit: f.hourlyLimit ? parseInt(f.hourlyLimit, 10) : undefined,
      minDelayMinutes: parseInt(f.minDelayMinutes, 10) || 0,
      maxDelayMinutes: parseInt(f.maxDelayMinutes, 10) || 0,
      minimumWaitMinutes: f.minimumWaitMinutes !== "" ? Math.max(0, parseInt(f.minimumWaitMinutes, 10) || 0) : 1,
      warmupDailyLimit: f.warmupDailyLimit ? parseInt(f.warmupDailyLimit, 10) : null,
      timezone: f.timezone,
      sendingSchedule: f.scheduleEnabled ? f.sendingSchedule : null,
      signatureMode: f.signatureMode,
      signatureId: f.signatureMode === "custom" ? f.signatureId || null : null,
      imapEnabled: f.imapEnabled,
      ...(f.imapEnabled
        ? {
            imapHost: f.imapHost.trim(),
            imapPort: parseInt(f.imapPort, 10) || 993,
            imapSecure: f.imapSecure,
            imapUsername: f.imapSameUser
              ? f.smtpUsername.trim() || f.fromEmail.trim()
              : f.imapUsername.trim(),
            imapPassword: f.imapSamePass
              ? f.smtpPassword || undefined
              : f.imapPassword || undefined,
          }
        : {}),
    };
  };

  const runTest = async (id: string): Promise<SmtpTestResult> => {
    try {
      return await emailSendingService.testConnection(id);
    } catch {
      return { success: false, message: "SMTP connection test failed to run." };
    }
  };

  const finish = async () => {
    const all = buildErrors();
    if (Object.keys(all).length > 0) {
      setErrors(all);
      // Jump to the first step that owns a failing field.
      const first = Object.keys(all)[0];
      const owner = Object.entries(STEP_FIELDS).find(([, keys]) => keys.includes(first));
      if (owner) setStep(Number(owner[0]));
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      if (mode === "create") {
        const res = await emailSendingService.createAccount(payloadOf());
        setCreatedId(res.data.id);
        const test = await runTest(res.data.id);
        setTestResult(test);
        onSaved();
      } else if (account) {
        await emailSendingService.updateAccount(account.id, payloadOf());
        setSavedOk(true);
        onSaved();
      }
    } catch (err: any) {
      setActionError(err?.data?.error || err?.message || "Failed to save the account.");
    } finally {
      setIsSaving(false);
    }
  };

  const retryTest = async () => {
    if (!createdId) return;
    setIsSaving(true);
    setTestResult(null);
    setActionError(null);
    try {
      setTestResult(await runTest(createdId));
      onSaved();
    } finally {
      setIsSaving(false);
    }
  };

  const goNext = () => {
    if (validateStep(step)) setStep((s) => Math.min(WIZARD_STEPS.length, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const imapUserSuggestion = form.smtpUsername.trim() || form.fromEmail.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true"
      aria-label={mode === "create" ? "Add sending account" : "Edit sending account"}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-xl"
        data-testid="account-wizard">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">
            {mode === "create" ? "Add mailbox" : `Edit ${account?.fromEmail || "mailbox"}`}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X size={17} />
          </button>
        </div>

        {/* Stepper */}
        <ol className="flex items-center overflow-x-auto border-b border-slate-100 px-5 py-3" aria-label="Setup progress">
          {WIZARD_STEPS.map((label, i) => {
            const n = i + 1;
            const done = createdId || savedOk ? true : n < step;
            const current = !createdId && !savedOk && n === step;
            return (
              <li key={label} className="flex shrink-0 items-center">
                {i > 0 && (
                  <span aria-hidden className={`h-px w-5 sm:w-10 ${done || current ? "bg-primary" : "bg-slate-200"}`} />
                )}
                <span className="flex items-center gap-1.5">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    done ? "border-primary bg-primary text-white"
                    : current ? "border-primary bg-white text-primary"
                    : "border-slate-300 bg-white text-slate-400"
                  }`}>
                    {done ? <Check size={11} aria-hidden /> : n}
                  </span>
                  <span className={`text-xs ${current ? "font-semibold text-slate-800" : done ? "font-medium text-slate-600" : "text-slate-400"}`}>
                    {label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {actionError && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </div>
          )}

          {/* ---------------------------------------------------------------- Step 1: Provider */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Add a mailbox</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Connect a mailbox to send campaigns from it. Server settings are pre-filled for you.
                </p>
              </div>
              <div className="space-y-3" role="radiogroup" aria-label="Mailbox provider">
                {PROVIDERS.map((p) => {
                  const selected = form.provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm((f) => applyProvider(f, p.id))}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        selected
                          ? "border-primary bg-primary-50/40 ring-2 ring-primary/20"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${p.tile}`}>
                          {p.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{p.label}</span>
                            {p.badge && (
                              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700">
                                {p.badge}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">{p.description}</span>
                          {selected && p.hint && (
                            <span className="mt-2 flex gap-1.5 rounded-lg border border-primary-100 bg-white px-2.5 py-2 text-xs text-slate-600">
                              <Info size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                              <span>{p.hint}</span>
                            </span>
                          )}
                          {p.smtp && p.imap && (
                            <span className="mt-1.5 block font-mono text-[11px] text-slate-400">
                              SMTP {p.smtp.host}:{p.smtp.port} · IMAP {p.imap.host}:{p.imap.port}
                            </span>
                          )}
                        </span>
                        {selected && <CheckCircle2 size={18} className="shrink-0 text-primary" aria-hidden />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {errors.provider && <p className="text-xs text-red-600" role="alert">{errors.provider}</p>}
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Your sender reputation depends on the provider — Google Workspace or Microsoft 365 give the best inbox placement.
                Generic SMTP works too but may land in spam more often.
              </p>
            </div>
          )}

          {/* ---------------------------------------------------------------- Step 2: Connect */}
          {step === 2 && (
            <div className="space-y-5">
              <fieldset className="space-y-4">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <CircleDot size={12} aria-hidden /> Sender identity
                </legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Account name" error={errors.name}>
                    <input className={inputCls(errors.name)} value={form.name} autoFocus
                      onChange={(e) => { set("name", e.target.value); if (form.fromName === form.name) set("fromName", e.target.value); }}
                      placeholder="Prateek Sales" />
                  </Field>
                  <Field label="From name">
                    <input className={inputCls()} value={form.fromName}
                      onChange={(e) => set("fromName", e.target.value)} placeholder={form.name || "Prateek Shukla"} />
                  </Field>
                  <Field label="From email" error={errors.fromEmail}>
                    <input className={inputCls(errors.fromEmail)} value={form.fromEmail}
                      onChange={(e) => set("fromEmail", e.target.value)} placeholder="sales@yourdomain.com" />
                  </Field>
                  <Field label="Reply-To (optional)" error={errors.replyToEmail}>
                    <input className={inputCls(errors.replyToEmail)} value={form.replyToEmail}
                      onChange={(e) => set("replyToEmail", e.target.value)} placeholder="replies@yourdomain.com" />
                  </Field>
                  <Field label="Signature">
                    <select className={inputCls()}
                      value={`${form.signatureMode}${form.signatureMode === "custom" ? `:${form.signatureId}` : ""}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "inherit") setForm((f) => ({ ...f, signatureMode: "inherit", signatureId: "" }));
                        else if (v === "none") setForm((f) => ({ ...f, signatureMode: "none", signatureId: "" }));
                        else if (v.startsWith("custom:")) setForm((f) => ({ ...f, signatureMode: "custom", signatureId: v.slice(7) }));
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

              <fieldset className="space-y-4 border-t border-slate-100 pt-4">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <KeyRound size={12} aria-hidden /> Outgoing server (SMTP)
                  {form.provider && form.provider !== "custom" && (
                    <span className="ml-1 normal-case tracking-normal text-primary">— pre-filled, editable</span>
                  )}
                </legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Username" hint="Leave blank to use your from email address.">
                    <input className={inputCls()} value={form.smtpUsername} autoComplete="off"
                      onChange={(e) => set("smtpUsername", e.target.value)}
                      placeholder={form.fromEmail || "email@company.com"} />
                  </Field>
                  <Field label={mode === "edit" ? "Password (leave blank to keep)" : "Password"} error={errors.smtpPassword} htmlFor="wizard-smtp-password">
                    <div className="relative">
                      <input id="wizard-smtp-password" type={showPassword ? "text" : "password"}
                        className={`${inputCls(errors.smtpPassword)} pr-10`} value={form.smtpPassword}
                        autoComplete="new-password" placeholder="••••••••"
                        onChange={(e) => set("smtpPassword", e.target.value)} />
                      <button type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600">
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>
                  <Field label="SMTP host" error={errors.smtpHost}>
                    <input className={inputCls(errors.smtpHost)} value={form.smtpHost}
                      onChange={(e) => set("smtpHost", e.target.value)} placeholder="mail.yourdomain.com" />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Port" error={errors.smtpPort}>
                      <input type="number" className={inputCls(errors.smtpPort)} value={form.smtpPort}
                        onChange={(e) => set("smtpPort", e.target.value)} />
                    </Field>
                    <Field label="Security">
                      <select className={inputCls()} value={form.security}
                        onChange={(e) => set("security", e.target.value as WizardForm["security"])}>
                        <option value="tls">STARTTLS (587)</option>
                        <option value="ssl">SSL/TLS (465)</option>
                        <option value="none">None (insecure)</option>
                      </select>
                    </Field>
                  </div>
                  {form.security === "none" && (
                    <p className="sm:col-span-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
                      Plain SMTP sends credentials and mail unencrypted. Only use this on a trusted private relay.
                    </p>
                  )}
                </div>
              </fieldset>

              <fieldset className="space-y-4 border-t border-slate-100 pt-4">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Mail size={12} aria-hidden /> Reply sync (IMAP)
                </legend>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]"
                    checked={form.imapEnabled} onChange={(e) => set("imapEnabled", e.target.checked)} />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">Sync replies into the Unified Inbox</span>
                    <span className="block text-xs text-slate-500">
                      SalesFire reads this mailbox over IMAP so lead replies land in one inbox with full context.
                    </span>
                  </span>
                </label>
                {form.imapEnabled && (
                  <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="IMAP host" error={errors.imapHost}>
                        <input className={inputCls(errors.imapHost)} value={form.imapHost}
                          onChange={(e) => set("imapHost", e.target.value)} placeholder="imap.yourdomain.com" />
                      </Field>
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Port" error={errors.imapPort}>
                          <input type="number" className={inputCls(errors.imapPort)} value={form.imapPort}
                            onChange={(e) => set("imapPort", e.target.value)} />
                        </Field>
                        <Field label="Security">
                          <select className={inputCls()} value={form.imapSecure ? "ssl" : "starttls"}
                            onChange={(e) => {
                              const ssl = e.target.value === "ssl";
                              setForm((f) => ({ ...f, imapSecure: ssl, imapPort: ssl ? "993" : "143" }));
                            }}>
                            <option value="ssl">SSL/TLS (993)</option>
                            <option value="starttls">STARTTLS (143)</option>
                          </select>
                        </Field>
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]"
                        checked={form.imapSameUser} onChange={(e) => set("imapSameUser", e.target.checked)} />
                      Same username as SMTP
                    </label>
                    {!form.imapSameUser && (
                      <Field label="IMAP username" error={errors.imapUsername}>
                        <input className={inputCls(errors.imapUsername)} value={form.imapUsername} autoComplete="off"
                          onChange={(e) => set("imapUsername", e.target.value)}
                          placeholder={imapUserSuggestion || "email@company.com"} />
                      </Field>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]"
                        checked={form.imapSamePass} onChange={(e) => set("imapSamePass", e.target.checked)} />
                      Same password as SMTP
                    </label>
                    {!form.imapSamePass && (
                      <Field label="IMAP password" error={errors.imapPassword}>
                        <input type="password" className={inputCls(errors.imapPassword)} value={form.imapPassword}
                          autoComplete="new-password"
                          placeholder={mode === "edit" && account?.hasImapPassword ? "•••••••• (stored — leave blank to keep)" : "••••••••"}
                          onChange={(e) => set("imapPassword", e.target.value)} />
                      </Field>
                    )}
                  </div>
                )}
              </fieldset>
            </div>
          )}

          {/* ---------------------------------------------------------------- Step 3: Sending */}
          {step === 3 && (
            <div className="space-y-5">
              <fieldset className="space-y-4">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Gauge size={12} aria-hidden /> Sending limits
                </legend>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <Field label="Daily limit" error={errors.dailyLimit}>
                    <input type="number" min={1} className={inputCls(errors.dailyLimit)} value={form.dailyLimit}
                      onChange={(e) => set("dailyLimit", e.target.value)} placeholder="30" />
                  </Field>
                  <Field label="Hourly limit" error={errors.hourlyLimit}>
                    <input type="number" min={1} className={inputCls(errors.hourlyLimit)} value={form.hourlyLimit}
                      onChange={(e) => set("hourlyLimit", e.target.value)} placeholder="10" />
                  </Field>
                  <Field label="Min delay (min)" error={errors.minDelayMinutes}>
                    <input type="number" min={0} className={inputCls(errors.minDelayMinutes)} value={form.minDelayMinutes}
                      onChange={(e) => set("minDelayMinutes", e.target.value)} />
                  </Field>
                  <Field label="Max delay (min)" error={errors.maxDelayMinutes}>
                    <input type="number" min={0} className={inputCls(errors.maxDelayMinutes)} value={form.maxDelayMinutes}
                      onChange={(e) => set("maxDelayMinutes", e.target.value)} />
                  </Field>
                  <Field label="Min wait (min)" error={errors.minimumWaitMinutes}>
                    <input type="number" min={0} className={inputCls(errors.minimumWaitMinutes)} value={form.minimumWaitMinutes}
                      onChange={(e) => set("minimumWaitMinutes", e.target.value)} />
                  </Field>
                </div>
                <p className="text-xs text-slate-400">
                  Leave blank for no cap. Recommended: 30/day per account. Hourly cannot exceed daily; minimum delay cannot
                  exceed maximum; minimum wait is the gap between two sends from this account across all campaigns.
                </p>
              </fieldset>

              <fieldset className="space-y-4 border-t border-slate-100 pt-4">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <CalendarClock size={12} aria-hidden /> Schedule &amp; timezone
                </legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Timezone (IANA)">
                    <select className={inputCls()} value={form.timezone}
                      onChange={(e) => set("timezone", e.target.value)}>
                      {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </Field>
                  <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm text-slate-700">
                    <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]"
                      checked={form.scheduleEnabled}
                      onChange={(e) => set("scheduleEnabled", e.target.checked)} />
                    Restrict sending to a weekly schedule
                  </label>
                </div>
                {form.scheduleEnabled && (
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {Object.entries(DAY_NAMES).map(([day, label]) => {
                      const w = form.sendingSchedule[day];
                      const dayError = errors[`schedule-${day}`];
                      const patch = (p: Partial<typeof w>) =>
                        setForm((f) => ({
                          ...f,
                          sendingSchedule: { ...f.sendingSchedule, [day]: { ...f.sendingSchedule[day], ...p } },
                        }));
                      return (
                        <div key={day} className="flex flex-wrap items-center gap-3 px-3 py-2">
                          <label className="flex w-36 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]"
                              checked={w.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
                            {label}
                          </label>
                          <input type="time" aria-label={`${label} start`} disabled={!w.enabled}
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:opacity-40"
                            value={w.start} onChange={(e) => patch({ start: e.target.value })} />
                          <span className="text-xs text-slate-400">to</span>
                          <input type="time" aria-label={`${label} end`} disabled={!w.enabled}
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:opacity-40"
                            value={w.end} onChange={(e) => patch({ end: e.target.value })} />
                          {!w.enabled && <span className="text-xs text-slate-400">Disabled</span>}
                          {dayError && <span role="alert" className="w-full text-xs text-red-600">{dayError}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            </div>
          )}

          {/* ---------------------------------------------------------------- Step 4: Warmup */}
          {step === 4 && (
            <div className="space-y-5">
              <fieldset className="space-y-4">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Gauge size={12} aria-hidden /> Warm-up
                </legend>
                <Field label="Warm-up daily limit (optional)" error={errors.warmupDailyLimit}
                  hint="Recommended: 20. Warm-up gradually ramps this mailbox's daily volume to build sender reputation before real outreach.">
                  <input type="number" min={1} className={inputCls(errors.warmupDailyLimit)} value={form.warmupDailyLimit}
                    onChange={(e) => set("warmupDailyLimit", e.target.value)} placeholder="20" />
                </Field>
                <div className="rounded-lg border border-primary-100 bg-primary-50/50 px-3.5 py-3 text-xs leading-relaxed text-slate-600">
                  <strong className="font-semibold text-slate-800">Why warm up?</strong> New or low-volume mailboxes that suddenly
                  send 30+ emails a day look like spam to Google and Microsoft. Warm-up sends gradually increasing volumes from
                  real-looking conversations so your first campaign lands in the inbox, not the spam folder.
                </div>
              </fieldset>
            </div>
          )}

          {/* ---------------------------------------------------------------- Step 5: Done */}
          {step === 5 && (createdId ? (
            <div className="space-y-4 text-center py-6">
              {testResult?.success ? (
                <>
                  <CheckCircle2 size={44} className="mx-auto text-emerald-500" aria-hidden />
                  <h3 className="text-lg font-semibold text-slate-900">Connection successful</h3>
                  <p className="text-sm text-slate-500">
                    {form.fromEmail} can send email through this SMTP account
                    {form.imapEnabled && " and replies will sync into the Unified Inbox"}.
                  </p>
                </>
              ) : testResult ? (
                <>
                  <XCircle size={44} className="mx-auto text-red-500" aria-hidden />
                  <h3 className="text-lg font-semibold text-slate-900">Connection failed</h3>
                  <p role="alert" className="text-sm text-slate-600">{testResult.message}</p>
                  <p className="text-xs text-slate-400">
                    The account was created and its credentials are stored encrypted. Check the server details under
                    Edit on the account row, then retry.
                  </p>
                  <button type="button" onClick={retryTest} disabled={isSaving}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                    {isSaving ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                    Retry test
                  </button>
                </>
              ) : (
                <>
                  <PlugZap size={44} className="mx-auto animate-pulse text-primary" aria-hidden />
                  <h3 className="text-lg font-semibold text-slate-900">Testing connection…</h3>
                  <p className="text-sm text-slate-500">Running a real SMTP handshake with {form.smtpHost}.</p>
                </>
              )}
              {testResult && (
                <button type="button" onClick={onClose}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90">
                  Done
                </button>
              )}
            </div>
          ) : mode === "edit" && savedOk ? (
            <div className="space-y-4 text-center py-6">
              <CheckCircle2 size={44} className="mx-auto text-emerald-500" aria-hidden />
              <h3 className="text-lg font-semibold text-slate-900">Saved</h3>
              <p className="text-sm text-slate-500">{form.fromEmail} has been updated.</p>
              <div className="flex items-center justify-center gap-2">
                <button type="button" onClick={onClose}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90">
                  Close
                </button>
                {account && (
                  <button type="button" onClick={async () => {
                    setIsSaving(true);
                    try { setTestResult(await runTest(account.id)); } finally { setIsSaving(false); }
                  }} disabled={isSaving}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                    {isSaving ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
                    Test connection
                  </button>
                )}
              </div>
              {testResult && (
                <p role="status" className={`text-sm ${testResult.success ? "text-emerald-600" : "text-red-600"}`}>
                  {testResult.message}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {mode === "create" ? "Review before creating" : "Review your changes"}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {mode === "create"
                    ? "Creating stores the passwords encrypted (AES-256-GCM) and then runs a real SMTP handshake to verify them."
                    : "Only the fields you changed will be updated. Passwords stay encrypted and are never returned."}
                </p>
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <ReviewRow label="Provider" value={PROVIDERS.find((p) => p.id === form.provider)?.label || "—"} />
                <ReviewRow label="Account" value={form.name || "—"} />
                <ReviewRow label="From" value={`${form.fromName || "—"} <${form.fromEmail || "—"}>`} />
                <ReviewRow label="SMTP" value={`${form.smtpHost || "—"}:${form.smtpPort} · ${form.security.toUpperCase()}`} />
                <ReviewRow label="Reply sync" value={form.imapEnabled ? `IMAP ${form.imapHost || "—"}:${form.imapPort}` : "Off"} />
                <ReviewRow label="Limits" value={`${form.dailyLimit || "∞"}/day · ${form.hourlyLimit || "∞"}/hour`} />
                <ReviewRow label="Timezone" value={form.timezone} />
                <ReviewRow label="Schedule" value={form.scheduleEnabled ? "Weekly schedule set" : "Always eligible"} />
                <ReviewRow label="Warm-up" value={form.warmupDailyLimit ? `${form.warmupDailyLimit}/day` : "Off"} />
              </dl>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
          <div>
            {step > 1 && !createdId && !savedOk && (
              <button type="button" onClick={goBack} disabled={isSaving}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <ChevronLeft size={15} /> Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!createdId && !savedOk && (
              <button type="button" onClick={onClose} disabled={isSaving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
            )}
            {!createdId && !savedOk && step < 5 && (
              <button type="button" onClick={goNext}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
                Next <ChevronRight size={15} />
              </button>
            )}
            {!createdId && !savedOk && step === 5 && (
              <button type="button" onClick={finish} disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed">
                {isSaving && <Loader2 size={15} className="animate-spin" />}
                {mode === "create" ? "Create account & test connection" : "Save changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-slate-800" title={value}>{value}</dd>
    </div>
  );
}

function Field({ label, error, hint, htmlFor, children }: {
  label: string;
  error?: string;
  hint?: string;
  /** Explicit id for controls wrapped in a positioning div (e.g. password + show/hide). */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const autoId = useId();
  // Associate the label with the control when children is a single input,
  // select or textarea (click-to-focus + screen-reader announcement).
  const isControl =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type);
  const id = htmlFor ?? (isControl ? autoId : undefined);
  const control = isControl && !htmlFor
    ? cloneElement(children as React.ReactElement<{ id?: string }>, { id: autoId })
    : children;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {control}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputCls = (error?: string) =>
  `w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 ${
    error ? "border-red-300" : "border-slate-300"
  }`;
