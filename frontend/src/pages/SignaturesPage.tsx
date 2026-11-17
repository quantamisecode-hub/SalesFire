// Signatures — manage reusable email signatures and org default (Prompt 9).
// Every action hits the real backend; the preview renders with the same
// pipeline as real sends (signature-resolver + template-renderer), streamed
// over Socket.io and debounced from every keystroke (HTTP is the fallback).
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, Pencil, Trash2, Star, Loader2, X, CheckCircle2, AlertTriangle,
  RefreshCw, PenLine,
} from "lucide-react";
import { signatureService, type EmailSignature } from "@/services/signature";
import { ensureSocketConnected, requestSignaturePreview } from "@/socket";
import { SignatureRichEditor, htmlToText } from "@/components/SignatureRichEditor";
import { Badge } from "@/components/Badge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

const inputCls = (error?: string) =>
  `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${
    error ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
  }`;

export function SignaturesPage() {
  const [items, setItems] = useState<EmailSignature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EmailSignature | null>(null);
  const [name, setName] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [textDirty, setTextDirty] = useState(false);
  const textDirtyRef = useRef(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Live preview: { html, text } rendered by the backend with the same
  // pipeline as real sends — updated on every keystroke (debounced).
  const [preview, setPreview] = useState<{ html: string; text: string } | null>(null);
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await signatureService.list();
      setItems(res.data || []);
    } catch {
      setError("Failed to load signatures.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setHtml('<p><strong>{{first_name}} {{last_name}}</strong></p>\n<p>{{job_title}} · {{company_name}}</p>\n<p><a href="{{website}}">{{website}}</a></p>');
    setText("{{first_name}} {{last_name}}\n{{job_title}} · {{company_name}}");
    textDirtyRef.current = false;
    setTextDirty(false);
    setMakeDefault(items.length === 0);
    setFormError(null);
    setPreview(null);
    setShowForm(true);
  };

  const openEdit = (s: EmailSignature) => {
    setEditing(s);
    setName(s.name);
    setHtml(s.html);
    setText(s.text);
    // Preserve a hand-written plain-text fallback; resume auto-sync otherwise.
    const custom = (s.text || "").trim() !== htmlToText(s.html || "").trim() && (s.text || "").trim() !== "";
    textDirtyRef.current = custom;
    setTextDirty(custom);
    setMakeDefault(false);
    setFormError(null);
    setPreview(null);
    setShowForm(true);
  };

  const handleHtmlChange = (v: string) => {
    setHtml(v);
    if (!textDirtyRef.current) setText(htmlToText(v));
  };

  const handleTextChange = (v: string) => {
    setText(v);
    textDirtyRef.current = true;
    setTextDirty(true);
  };

  const regenerateText = () => {
    setText(htmlToText(html));
    textDirtyRef.current = false;
    setTextDirty(false);
  };

  const save = async () => {
    if (!name.trim()) { setFormError("Name is required."); return; }
    if (!html.trim()) { setFormError("Signature HTML is required."); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await signatureService.update(editing.id, { name: name.trim(), html, text, makeDefault });
        toast.success(`"${name.trim()}" saved.`);
      } else {
        await signatureService.create({ name: name.trim(), html, text, makeDefault });
        toast.success(`"${name.trim()}" created.`);
      }
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to save signature.");
    } finally {
      setSaving(false);
    }
  };

  const makeDefaultSig = async (s: EmailSignature) => {
    setBusyId(s.id);
    try {
      await signatureService.makeDefault(s.id);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to set default.");
    } finally {
      setBusyId(null);
    }
  };

  const removeSig = async (s: EmailSignature) => {
    const ok = await confirm({
      title: `Delete signature "${s.name}"?`,
      message: "Assigned references (campaigns, steps and sending accounts) will be cleared, and emails using this signature will go out unsigned. This cannot be undone.",
      confirmLabel: "Delete signature",
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await signatureService.remove(s.id);
      toast.success(`"${s.name}" deleted.`);
      await load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to delete signature.");
    } finally {
      setBusyId(null);
    }
  };

  const SAMPLE_VARS = {
    first_name: "Prateek", last_name: "Goswami", job_title: "Head of Sales",
    company_name: "Acme Corp", website: "https://acme.example.com",
    email: "prateek@acme.example.com", industry: "SaaS", accountSignature: "",
  };

  const previewReq = useRef(0);
  const runPreview = useCallback(async () => {
    const reqId = ++previewReq.current;
    setPreviewBusy(true);
    const payload = { html, text, variables: SAMPLE_VARS };
    const apply = (d?: { html: string; text: string } | null) => {
      if (previewReq.current !== reqId) return; // superseded by a newer keystroke
      setPreview(d ? { html: d.html, text: d.text } : { html: "(preview failed)", text: "(preview failed)" });
      setPreviewBusy(false);
    };
    if (await ensureSocketConnected()) {
      // Live over Socket.io — the same render pipeline a real send uses.
      const res = await requestSignaturePreview({ ...payload, requestId: reqId });
      apply(res.ok ? res.data : null);
      return;
    }
    // Fallback: HTTP preview (identical backend pipeline).
    try {
      const res = await signatureService.preview(payload);
      apply(res.data ? { html: res.data.html, text: res.data.text } : null);
    } catch {
      apply(null);
    }
  }, [html, text]);

  // Debounced live preview — streams whenever the draft changes, wherever it changes.
  useEffect(() => {
    const t = setTimeout(() => { void runPreview(); }, 250);
    return () => clearTimeout(t);
  }, [runPreview]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <PenLine size={22} className="text-primary" aria-hidden /> Signatures
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Reusable HTML signatures for sending accounts, campaigns and sequence steps. The org default is used when nothing else is configured.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 whitespace-nowrap">
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 whitespace-nowrap">
            <Plus size={16} /> New Signature
          </button>
        </div>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3" role="alert">{error}</div>}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <PenLine className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900">No signatures yet</h2>
          <p className="text-sm text-slate-500 mt-1">Create your first signature — the org default is used for accounts and campaigns without their own.</p>
          <button onClick={openCreate} className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90"><Plus size={16} /> Create Signature</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900 truncate">{s.name}</h2>
                  {s.isOrgDefault && <Badge status="org_default" title="Used in every email that doesn't override it"><CheckCircle2 size={10} /></Badge>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!s.isOrgDefault && (
                    <button title="Set as org default" aria-label={`Set ${s.name} as default`} onClick={() => makeDefaultSig(s)} disabled={busyId === s.id}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50">
                      {busyId === s.id ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
                    </button>
                  )}
                  <button title="Edit" aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                    <Pencil size={14} />
                  </button>
                  <button title="Delete" aria-label={`Delete ${s.name}`} onClick={() => removeSig(s)} disabled={busyId === s.id}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50">
                    {busyId === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
              <div className="p-4 bg-slate-50/40 min-h-[110px] text-sm text-slate-800 overflow-hidden" dangerouslySetInnerHTML={{ __html: s.html }} />
              <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 truncate">
                {s.text.split("\n")[0] || "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Signature editor">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">{editing ? "Edit signature" : "New signature"}</h3>
              <button onClick={() => setShowForm(false)} aria-label="Close" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
            </div>

            {formError && <p className="mb-3 flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert"><AlertTriangle size={13} />{formError}</p>}

            <div className="grid grid-cols-1 lg:grid-cols-7 gap-5">
              <div className="lg:col-span-4">
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="sig-name">Name</label>
                <input id="sig-name" className={inputCls()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Founder" autoFocus />

                <span className="block text-xs font-medium text-slate-600 mt-4 mb-1">Signature</span>
                <SignatureRichEditor html={html} onHtmlChange={handleHtmlChange} />

                <div className="flex items-center justify-between mt-4 mb-1">
                  <label className="block text-xs font-medium text-slate-600" htmlFor="sig-text">Plain text (fallback)</label>
                  <button type="button" onClick={regenerateText}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                    <RefreshCw size={10} /> Regenerate from HTML
                  </button>
                </div>
                <textarea id="sig-text" rows={4} className={`${inputCls()} font-mono text-xs`} value={text} onChange={(e) => handleTextChange(e.target.value)} spellCheck={false} />
                <p className="mt-1 text-[11px] text-slate-400">
                  {textDirty ? "Custom fallback — edited by you. The preview below reflects it." : "Auto-synced from the visual editor. Edit directly to override."}
                </p>

                <label className="flex items-center gap-2 mt-4 text-xs font-medium text-slate-600">
                  <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="w-4 h-4 accent-[rgb(var(--primary))]" />
                  Make this the org default
                </label>

                <div className="flex items-center gap-3 mt-5">
                  <button type="button" onClick={save} disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60">
                    {saving && <Loader2 size={14} className="animate-spin" />} {editing ? "Save changes" : "Create signature"}
                  </button>
                  <span className="text-[11px] text-slate-400">{previewBusy ? "Rendering…" : "Live preview"}</span>
                </div>
              </div>

              <div className="lg:col-span-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="block text-xs font-medium text-slate-600">Live preview</span>
                  <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="tablist" aria-label="Preview format">
                    <button role="tab" aria-selected={previewTab === "html"} onClick={() => setPreviewTab("html")}
                      className={`px-2.5 py-1 text-[11px] font-medium ${previewTab === "html" ? "bg-slate-100 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>HTML</button>
                    <button role="tab" aria-selected={previewTab === "text"} onClick={() => setPreviewTab("text")}
                      className={`px-2.5 py-1 text-[11px] font-medium ${previewTab === "text" ? "bg-slate-100 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>Plain text</button>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 min-h-[220px] text-sm text-slate-800">
                  {previewTab === "html" ? (
                    preview ? <div dangerouslySetInnerHTML={{ __html: preview.html }} />
                      : <p className="text-slate-400 text-xs">Type in the editor on the left to see it rendered.</p>
                  ) : (
                    <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono leading-relaxed">{preview?.text || "—"}</pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}
