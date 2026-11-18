// PreviewPanel — full render preview (§33-§34, §53-§55): desktop/mobile,
// real recipient vs labeled sample, sending-account selector, spintax
// variation cycling. The email renders inside a sandboxed iframe (scripts can
// never run in the preview).
//
// LIVE PREVIEW (§33): while the editor is open, the unsaved draft is streamed
// to the backend over Socket.io on every change (300ms debounce) and the
// server renders the recipient's email against real lead data — no save step,
// no stale preview. HTTP remains the fallback when the socket can't connect.
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Monitor, Smartphone, AlertTriangle, Info, X } from "lucide-react";
import { sequenceService } from "@/services/sequence";
import { emailSendingService, type SmtpAccount } from "@/services/emailSending";
import { requestPreview, socketConnected, onAccountsChanged } from "@/socket";
import type { PreviewData, PreviewRecipient } from "@/types/sequence";

export interface DraftPreview {
  stepId: string | null;
  sequenceId: string | null;
  stepOrder: number;
  subject: string;
  bodyHtml: string;
  prevSubject: string | null;
  variants: { variantName?: string; subject?: string; bodyHtml?: string; bodyText?: string; weight?: number }[];
  activeVariantIndex: number;
  /** The step's current UNSAVED signature selection — the preview honors it. */
  signatureMode?: "inherit" | "custom" | "none";
  signatureId?: string | null;
}

type PreviewPanelProps = {
  campaignId: string | null;
  stepId: string | null;
  variantId?: string | null;
  recipients: PreviewRecipient[];
  sendingAccountId?: string;
  /** True when the subject/body contain spintax — otherwise the button is inert. */
  hasSpintax?: boolean;
  /** Unsaved editor state — when present, preview streams over Socket.io. */
  draft?: DraftPreview | null;
};

export function PreviewPanel({ campaignId, stepId, variantId, recipients, sendingAccountId, hasSpintax, draft }: PreviewPanelProps) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [recipientId, setRecipientId] = useState<string>("");
  const [seed, setSeed] = useState(() => Math.random().toString(36).slice(2));
  // Sending-account preview (§33): defaults to the campaign's account, the
  // user can switch to any other org account to see its signature/from line.
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [accountId, setAccountId] = useState<string>(sendingAccountId || "");
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [spintaxHelpOpen, setSpintaxHelpOpen] = useState(false);
  const reqRef = useRef(0);
  const variationRef = useRef<HTMLDivElement>(null);

  const [accountsEpoch, setAccountsEpoch] = useState(0);
  useEffect(() => onAccountsChanged(() => { setAccountsEpoch((e) => e + 1); }), []);

  useEffect(() => {
    if (!campaignId) return;
    let alive = true;
    emailSendingService.listAccounts()
      .then((res) => {
        if (!alive) return;
        const list = res.data || [];
        setAccounts(list);
        if (!sendingAccountId && list.length) setAccountId(list[0].id);
      })
      .catch(() => { /* selector simply stays empty */ })
      .finally(() => { setAccountsLoaded(true); });
    return () => { alive = false; };
  }, [campaignId, sendingAccountId, accountsEpoch]);

  useEffect(() => { if (sendingAccountId) setAccountId(sendingAccountId); }, [sendingAccountId]);

  // Close the "why is this disabled?" popover on Esc / click outside.
  useEffect(() => {
    if (!spintaxHelpOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSpintaxHelpOpen(false); };
    const onDown = (e: MouseEvent) => {
      const root = variationRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) setSpintaxHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [spintaxHelpOpen]);

  const load = async (opts?: { silent?: boolean }) => {
    if (!campaignId) return;
    // Live mode needs the draft; persisted mode needs a stepId.
    if (!draft && !stepId) return;
    const reqId = ++reqRef.current;
    if (!opts?.silent) setBusy(true);
    setError(null);
    try {
      let data: PreviewData;
      if (draft && socketConnected()) {
        // Stream the unsaved draft — the server renders the recipient's
        // email against real lead data.
        const res = await requestPreview({
          campaignId,
          stepId: draft.stepId || undefined,
          recipientId: recipientId || undefined,
          sendingAccountId: accountId || undefined,
          spintaxSeed: seed,
          requestId: reqId,
          draft: {
            stepId: draft.stepId || null,
            sequenceId: draft.sequenceId || null,
            stepOrder: draft.stepOrder,
            subject: draft.subject,
            bodyHtml: draft.bodyHtml,
            prevSubject: draft.prevSubject,
            variants: draft.variants,
            signatureMode: draft.signatureMode,
            signatureId: draft.signatureId,
          },
          activeVariantIndex: draft.activeVariantIndex,
        });
        if (reqRef.current !== reqId) return; // a newer request superseded this one
        if (!res.ok || !res.data) throw { data: { error: res.error || "Preview failed." } };
        data = res.data as PreviewData;
      } else {
        // Fallback: render the saved DB state over HTTP.
        if (!stepId) return;
        data = await sequenceService.preview(campaignId, {
          stepId,
          variantId: variantId || undefined,
          recipientId: recipientId || undefined,
          sendingAccountId: accountId || undefined,
          spintaxSeed: seed,
        });
        if (reqRef.current !== reqId) return;
      }
      setPreview(data);
    } catch (err: any) {
      if (reqRef.current !== reqId) return;
      setError(err?.data?.error || err?.message || "Preview failed.");
    } finally {
      if (reqRef.current === reqId) setBusy(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 300); // debounce — streams only pauses in typing
    return () => clearTimeout(timer);
  }, [campaignId, stepId, variantId, recipientId, seed, sendingAccountId, accountId, accountsLoaded, accountsEpoch, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!campaignId || (!stepId && !draft)) {
    return <p className="text-xs text-slate-400 p-3">Save the sequence to see the preview.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white min-w-0 max-w-full" aria-label="Preview as lead">
          <option value="">First campaign lead{recipients.length === 0 ? " (sample data)" : ""}</option>
          {recipients.slice(0, 100).map((r) => (
            <option key={r.id} value={r.id}>
              {[r.firstName, r.lastName].filter(Boolean).join(" ") || r.email}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
          <button type="button" aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}
            className={`p-1.5 ${device === "desktop" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}><Monitor size={14} /></button>
          <button type="button" aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}
            className={`p-1.5 ${device === "mobile" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}><Smartphone size={14} /></button>
        </div>
        <div className="relative shrink-0" ref={variationRef}>
          {hasSpintax === false ? (
            // Nothing to vary yet — the button explains itself instead of silently doing nothing.
            <button type="button" onClick={() => setSpintaxHelpOpen((v) => !v)} aria-expanded={spintaxHelpOpen}
              aria-controls="spintax-help"
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600">
              <Info size={12} /> Another variation
            </button>
          ) : (
            <button type="button" onClick={() => setSeed(Math.random().toString(36).slice(2))} disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
              title="Re-roll the spintax — the same lead renders with different wording">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Another variation
            </button>
          )}
          {spintaxHelpOpen && (
            <div id="spintax-help" role="dialog" aria-label="How variations work"
              className="absolute z-20 top-full right-0 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg p-4 text-left">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">What this button does</p>
                <button type="button" onClick={() => setSpintaxHelpOpen(false)} aria-label="Close" className="p-0.5 rounded text-slate-400 hover:bg-slate-100"><X size={12} /></button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                <strong>Another variation</strong> re-rolls the spintax pick so the email reads differently for each lead.
                It only has an effect when this email actually contains <span className="font-mono text-violet-700">{"{{RANDOM | Hi | Hello}}"}</span> — that&apos;s why it does nothing (and is inert) right now.
              </p>
              <div className="mt-2 text-[11px] leading-relaxed text-slate-600">
                <p className="font-medium text-slate-700 mb-1">Add spintax in three steps:</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>In the toolbar, click the <span className="font-medium">Spintax builder</span> icon (shuffle arrows).</li>
                  <li>Type one option per line — e.g. <span className="font-mono text-violet-700">Hi</span>, <span className="font-mono text-violet-700">Hello</span>, <span className="font-mono text-violet-700">Hey</span>.</li>
                  <li>Insert — the variable appears in your email and re-rolls per lead.</li>
                </ol>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">A/B variants are previewed by clicking the variant tabs (e.g. “Variant A · 100%”) — this button cycles the spintax options only.</p>
            </div>
          )}
        </div>
      </div>

      {accounts.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <span className="shrink-0">Sending account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" aria-label="Preview sending account">
            {accounts.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.isEnabled}>
                {a.name} — {a.fromEmail}{!a.isEnabled ? " (disabled)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>}

      {preview && (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-0.5">
            <span><strong className="text-slate-600">From:</strong> {preview.from.name} &lt;{preview.from.email}&gt;</span>
            <span><strong className="text-slate-600">To:</strong> {preview.to.name} &lt;{preview.to.email}&gt;</span>
          </div>
          {preview.isSampleRecipient && (
            <p className="px-3 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100 flex items-center gap-1">
              <AlertTriangle size={11} /> This campaign has no leads yet — the preview uses clearly-labeled sample data.
            </p>
          )}
          {(preview.unresolved.length > 0 || preview.malformed.length > 0) && (
            <div className="px-3 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100 space-y-0.5">
              {preview.unresolved.length > 0 && (
                <p><strong>Unresolved variables:</strong> {preview.unresolved.map((v) => `{{${v}}}`).join(", ")} — this lead has no data for them.</p>
              )}
              {preview.malformed.map((m, i) => (
                <p key={i}><strong>{m.reason}</strong> <code className="text-[10px]">{m.snippet}</code></p>
              ))}
            </div>
          )}
          <div className="px-3 py-2 text-sm font-medium text-slate-800 border-b border-slate-50">
            {preview.subject || <span className="text-slate-400 italic">(empty subject — continues the previous thread)</span>}
          </div>
          <div className="flex justify-center bg-slate-100 p-3">
            <iframe
              title="Email preview"
              sandbox=""
              className={`bg-white border border-slate-200 rounded-lg ${device === "mobile" ? "w-[360px]" : "w-full"}`}
              style={{ minHeight: 320 }}
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${preview.html}</body></html>`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
