// SendTestModal — REAL SMTP test send (§35). Success is only ever shown when
// the SMTP server accepted the message (the backend returns 502 with the real
// failure otherwise — no simulated "Email Sent" anywhere).
import { useEffect, useState } from "react";
import { Loader2, Send, CheckCircle2, XCircle } from "lucide-react";
import { sequenceService } from "@/services/sequence";
import { emailSendingService, type SmtpAccount } from "@/services/emailSending";
import { useToast } from "@/components/ui/Toast";

type SendTestModalProps = {
  campaignId: string | null;
  stepId: string | null;
  variantId?: string | null;
  defaultRecipient?: string;
  sendingAccountId?: string;
  onClose: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function SendTestModal({ campaignId, stepId, variantId, defaultRecipient, sendingAccountId, onClose }: SendTestModalProps) {
  const [recipients, setRecipients] = useState(defaultRecipient || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string[]; messageId?: string } | null>(null);
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [accountId, setAccountId] = useState<string>(sendingAccountId || "");
  const toast = useToast();

  useEffect(() => {
    if (!campaignId) return;
    emailSendingService.listAccounts()
      .then((res) => {
        const list = res.data || [];
        setAccounts(list);
        if (!sendingAccountId && list.length) setAccountId(list.find((a) => a.isEnabled)?.id || list[0].id);
      })
      .catch(() => { /* the campaign account is used as fallback server-side */ });
  }, [campaignId, sendingAccountId]);

  // Esc closes the dialog (§50).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = recipients.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);

  const send = async () => {
    if (!campaignId || !stepId) return;
    const invalid = list.find((r) => !EMAIL_RE.test(r));
    if (!list.length) { setError("Enter at least one test recipient."); return; }
    if (invalid) { setError(`"${invalid}" is not a valid email address.`); return; }
    setBusy(true);
    setError(null);
    try {
      const data = await sequenceService.sendTestEmail(campaignId, {
        stepId,
        variantId: variantId || undefined,
        recipients: list,
        sendingAccountId: accountId || undefined,
      });
      setSent({ to: data.to, messageId: data.messageId });
      toast.success(`Test email sent to ${data.to.join(", ")}.`);
    } catch (err: any) {
      // Honest failure: the backend's real error (SMTP problem, validation, …).
      const msg = err?.data?.error || err?.message || "The test email could not be sent.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Send test email"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Send test email</h3>
        <p className="text-xs text-slate-500 mb-4">
          Renders this email with real recipient data and sends it through the selected sending account via SMTP.
        </p>

        {sent ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5" role="status">
              <CheckCircle2 size={15} /> Test email sent to {sent.to.join(", ")}.
            </p>
            {sent.messageId && <p className="text-[11px] text-slate-400 font-mono break-all">messageId: {sent.messageId}</p>}
            <button type="button" onClick={onClose}
              className="w-full text-xs font-medium py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block" htmlFor="test-recipients">
              <span className="text-xs font-medium text-slate-600 block mb-1">Test recipients (up to 5, comma-separated)</span>
              <input
                id="test-recipients"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="you@company.com, colleague@company.com"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
              />
            </label>
            {accounts.length > 0 && (
              <label className="block" htmlFor="test-account">
                <span className="text-xs font-medium text-slate-600 block mb-1">Sending account</span>
                <select id="test-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.isEnabled}>
                      {a.name} — {a.fromEmail}{!a.isEnabled ? " (disabled)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error && (
              <p className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
                <XCircle size={13} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={send} disabled={busy || !campaignId || !stepId}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send real test email
              </button>
              <button type="button" onClick={onClose} disabled={busy}
                className="text-xs font-medium py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            </div>
            <p className="text-[11px] text-slate-400">If the sending account's SMTP credentials are wrong, you'll see the real error here — never a fake confirmation.</p>
          </div>
        )}
      </div>
    </div>
  );
}
