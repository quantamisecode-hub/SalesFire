// AddLeadModal — compact manual lead creation (§31). The table remains the
// primary interface; this modal is secondary.
import { useEffect, useState } from "react";
import { X, Loader2, UserPlus } from "lucide-react";
import { leadService } from "@/services/lead";
import type { Lead } from "@/types/lead";

const FIELDS: Array<{ key: keyof Lead; label: string; required?: boolean; type?: string }> = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "companyName", label: "Company Name" },
  { key: "jobTitle", label: "Job Title" },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "location", label: "Location" },
  { key: "industry", label: "Industry" },
  { key: "companySize", label: "Company Size" },
];

export function AddLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setForm({}); setError(null); } }, [open]);
  if (!open) return null;

  const submit = async () => {
    if (!form.email?.trim()) { setError("Email is required."); return; }
    setBusy(true); setError(null);
    try {
      await leadService.create(form);
      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "Could not create the lead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Add lead">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">Add Lead</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">
          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={String(f.key)}>
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor={`al-${f.key}`}>
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </label>
                <input
                  id={`al-${f.key}`} type={f.type || "text"}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={form[f.key] || ""}
                  onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="al-personalization">Personalization</label>
              <textarea id="al-personalization" rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
                value={form.personalization || ""}
                onChange={(e) => setForm((p) => ({ ...p, personalization: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            Add Lead
          </button>
        </div>
      </div>
    </div>
  );
}
