// Email Sending Settings - SMTP account management (Prompt 6 §27-31).
// Every action hits the real backend: create/update/delete accounts,
// test the SMTP connection, and send test emails. Passwords are write-only.
import { useState, useEffect, useCallback } from "react";
import {
  Plus, Mail, Pencil, Trash2, PlugZap, Send, Power,
  RefreshCw, CheckCircle2, XCircle, Loader2, KeyRound,
} from "lucide-react";
import { emailSendingService } from "@/services/emailSending";
import { WarmupPanel } from "@/components/WarmupPanel";
import { signatureService, type EmailSignature } from "@/services/signature";
import { Badge } from "@/components/Badge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { SmtpAccount, SmtpTestResult } from "@/types/prompt6";

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
  /** Signature resolution (Prompt 9): inherit | custom | none. */
  signatureMode: "inherit" | "custom" | "none";
  signatureId: string;
};

const EMPTY_FORM: FormState = {
  name: "", smtpHost: "", smtpPort: "587", security: "tls",
  smtpUsername: "", smtpPassword: "", fromEmail: "", fromName: "",
  replyToEmail: "", dailyLimit: "", hourlyLimit: "",
  minDelayMinutes: "0", maxDelayMinutes: "0",
  signatureMode: "inherit", signatureId: "",
};

function toForm(a: SmtpAccount, keepPassword: boolean): FormState {
  return {
    name: a.name, smtpHost: a.smtpHost, smtpPort: String(a.smtpPort),
    security: a.security, smtpUsername: a.smtpUsername || "",
    smtpPassword: keepPassword ? "" : "",
    fromEmail: a.fromEmail, fromName: a.fromName || "",
    replyToEmail: a.replyToEmail || "",
    dailyLimit: a.dailyLimit != null ? String(a.dailyLimit) : "",
    hourlyLimit: a.hourlyLimit != null ? String(a.hourlyLimit) : "",
    minDelayMinutes: a.minDelayMinutes != null ? String(a.minDelayMinutes) : "0",
    maxDelayMinutes: a.maxDelayMinutes != null ? String(a.maxDelayMinutes) : "0",
    signatureMode: (a.signatureMode as FormState["signatureMode"]) || "inherit",
    signatureId: a.signatureId || "",
  };
}

export function EmailSendingSettingsPage() {
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SmtpTestResult>>({});

  const [testModalId, setTestModalId] = useState<string | null>(null);
  const [testAddress, setTestAddress] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [sendTestResult, setSendTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const res = await emailSendingService.listAccounts();
      setAccounts(res.data || []);
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
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowForm(true);
  };

  const openEdit = (a: SmtpAccount) => {
    setEditingId(a.id);
    setForm(toForm(a, true)); // password field starts empty; blank = unchanged
    setFormErrors({});
    setShowForm(true);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Account name is required";
    if (!form.smtpHost.trim()) errors.smtpHost = "SMTP host is required";
    const port = parseInt(form.smtpPort, 10);
    if (!form.smtpPort || Number.isNaN(port) || port <= 0 || port > 65535) {
      errors.smtpPort = "Port must be 1-65535";
    }
    if (!form.fromEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.fromEmail)) {
      errors.fromEmail = "A valid from email is required";
    }
    if (!editingId && !form.smtpPassword) {
      errors.smtpPassword = "Password is required for a new account";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      const payload = {
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
        signatureMode: form.signatureMode,
        signatureId: form.signatureMode === "custom" ? form.signatureId || null : null,
      };
      if (editingId) {
        await emailSendingService.updateAccount(editingId, payload);
        toast.success(`"${payload.name}" updated.`);
      } else {
        await emailSendingService.createAccount(payload);
        toast.success(`"${payload.name}" added.`);
      }
      setShowForm(false);
      await load();
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
      await load(); // refresh lastTestedAt / status
    } catch {
      toast.error("Connection test failed to run.");
    } finally {
      setTestingId(null);
    }
  };

  const toggleEnabled = async (a: SmtpAccount) => {
    setBusyActionId(a.id);
    try {
      await emailSendingService.updateAccount(a.id, { isEnabled: !a.isEnabled });
      toast.success(a.isEnabled ? `"${a.name}" disabled — it will not send or warm up.` : `"${a.name}" enabled.`);
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
      message: "This cannot be undone. Campaigns using this account will lose their sending identity.",
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
    setSendTestResult(null);
  };

  const sendTest = async () => {
    if (!testModalId) return;
    setIsSendingTest(true);
    setSendTestResult(null);
    try {
      const res = await emailSendingService.sendTestEmail(testModalId, testAddress.trim());
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
    if (value === "inherit") {
      signatureMode = "inherit";
    } else if (value === "none") {
      signatureMode = "none";
    } else if (value.startsWith("custom:")) {
      const id = value.slice(7);
      if (!id) return; // picked the "pick a signature…" placeholder — stay as-is
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

  const signatureValueOf = (a: SmtpAccount) =>
    a.signatureMode === "custom" ? `custom:${a.signatureId ?? ""}`
    : a.signatureMode === "none" ? "none"
    : "inherit";

  const statusBadge = (a: SmtpAccount) => {
    if (!a.isEnabled) {
      return <Badge status="disabled" />;
    }
    if (a.status === "verified") {
      return <Badge status="verified"><CheckCircle2 size={12} /></Badge>;
    }
    if (a.status === "error") {
      return <Badge status="error"><XCircle size={12} /></Badge>;
    }
    return <Badge status="unverified" />;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="email-sending-settings">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Email Sending</h1>
          <p className="text-sm text-slate-500 mt-1">
            Connect your own SMTP servers (e.g. Postfix). Credentials are encrypted at rest and never returned.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40 whitespace-nowrap shrink-0"
            aria-label="Refresh accounts"
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 whitespace-nowrap shrink-0"
          >
            <Plus size={16} /> Add Sending Account
          </button>
        </div>
      </header>

      {/* Account form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" role="form" aria-label="Sending account form">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {editingId ? "Edit Sending Account" : "New Sending Account"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Account Name" error={formErrors.name}>
              <input className={inputCls(formErrors.name)} value={form.name}
                onChange={(e) => {
                  // Display Name drives the From line — keep From Name mirrored
                  // until the user edits From Name directly to override it.
                  const v = e.target.value;
                  setForm({ ...form, name: v, fromName: v });
                }} placeholder="Postfix Main" />
            </Field>
            <Field label="From Email" error={formErrors.fromEmail}>
              <input className={inputCls(formErrors.fromEmail)} value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })} placeholder="sales@yourdomain.com" />
            </Field>
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
                  <option value="none">None</option>
                </select>
              </Field>
            </div>
            <Field label="Username">
              <input className={inputCls()} value={form.smtpUsername} autoComplete="off"
                onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })} />
            </Field>
            <Field label={editingId ? "Password (leave blank to keep)" : "Password"} error={formErrors.smtpPassword}>
              <input type="password" className={inputCls(formErrors.smtpPassword)} value={form.smtpPassword}
                autoComplete="new-password" placeholder="••••••••"
                onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })} />
            </Field>
            <Field label="From Name (mirrors Account Name — edit to override)">
              <input className={inputCls()} value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder={form.name || "Postfix Main"} />
            </Field>
            <Field label="Reply-To">
              <input className={inputCls()} value={form.replyToEmail}
                onChange={(e) => setForm({ ...form, replyToEmail: e.target.value })} />
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
            <div className="grid grid-cols-2 gap-4">
              <Field label="Daily Limit">
                <input type="number" className={inputCls()} value={form.dailyLimit}
                  onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} placeholder="400" />
              </Field>
              <Field label="Hourly Limit">
                <input type="number" className={inputCls()} value={form.hourlyLimit}
                  onChange={(e) => setForm({ ...form, hourlyLimit: e.target.value })} placeholder="40" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Min Delay (min)">
                <input type="number" className={inputCls()} value={form.minDelayMinutes}
                  onChange={(e) => setForm({ ...form, minDelayMinutes: e.target.value })} />
              </Field>
              <Field label="Max Delay (min)">
                <input type="number" className={inputCls()} value={form.maxDelayMinutes}
                  onChange={(e) => setForm({ ...form, maxDelayMinutes: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={save} disabled={isSaving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed">
              {isSaving && <Loader2 size={15} className="animate-spin" />}
              {editingId ? "Save Changes" : "Create Account"}
            </button>
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
                  <th className="px-4 py-3">From Email</th>
                  <th className="px-4 py-3">SMTP Host</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Signature</th>
                  <th className="px-4 py-3">Last Tested</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((a) => {
                  const test = testResults[a.id];
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{a.name}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <KeyRound size={11} aria-hidden /> {a.hasPassword ? "Password stored (encrypted)" : "No password"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{a.fromEmail}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {a.smtpHost}:{a.smtpPort}
                        <span className="ml-1 text-xs text-slate-400 uppercase">{a.security}</span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(a)}</td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Signature for ${a.name}`}
                          value={signatureValueOf(a)}
                          disabled={busyActionId === a.id}
                          onChange={(e) => handleSignatureChange(a, e.target.value)}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 max-w-[190px] disabled:opacity-50"
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
                      <td className="px-4 py-3">
                        {a.lastTestedAt ? (
                          <div>
                            <div className="text-xs text-slate-600">{new Date(a.lastTestedAt).toLocaleString()}</div>
                            {test && (
                              <div className={`text-xs mt-0.5 ${test.success ? "text-emerald-600" : "text-red-600"}`}>{test.message}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Never</span>
                        )}
                      </td>
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
                          <IconBtn title={a.isEnabled ? "Disable" : "Enable"} onClick={() => toggleEnabled(a)} disabled={busyActionId === a.id}>
                            {busyActionId === a.id ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                          </IconBtn>
                          <IconBtn title="Delete" danger onClick={() => remove(a)} disabled={busyActionId === a.id}>
                            <Trash2 size={15} />
                          </IconBtn>
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
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1" htmlFor="test-address">
              Test email address
            </label>
            <input
              id="test-address"
              type="email"
              className={inputCls()}
              value={testAddress}
              autoFocus
              placeholder="you@yourdomain.com"
              onChange={(e) => setTestAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && testAddress.trim()) sendTest(); }}
            />
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

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

function inputCls(error?: string) {
  return `w-full px-3 py-2 text-sm rounded-lg border bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
    error ? "border-red-300" : "border-slate-300"
  }`;
}

function IconBtn({
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
      className={`p-2 rounded-lg border border-transparent hover:border-slate-200 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40 ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
