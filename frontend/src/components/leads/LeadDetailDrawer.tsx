// LeadDetailDrawer — slide-over with real contact, company, sales and
// campaign-activity data (§32). Opens on row click instead of navigating away.
import { useEffect, useState } from "react";
import { X, Loader2, Mail, Phone, Globe, Linkedin, MapPin, Building2 } from "lucide-react";
import { leadService } from "@/services/lead";
import { Badge } from "@/components/Badge";
import type { Lead } from "@/types/lead";

type Detail = Lead & {
  campaigns: Array<{ id: string; name: string; status: string }>;
  events: Array<{ id: string; eventType: string; eventTimestamp: string }>;
};

function scoreLabel(n?: number | null) {
  if (n === null || n === undefined) return "Not scored";
  const band = n >= 80 ? "High" : n >= 60 ? "Medium" : "Low";
  return `${n} · ${band}`;
}

export function LeadDetailDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) { setDetail(null); setError(null); return; }
    setLoading(true);
    leadService.get(leadId)
      .then(setDetail)
      .catch(() => setError("Failed to load the lead."))
      .finally(() => setLoading(false));
  }, [leadId]);

  if (!leadId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Lead details" onClick={onClose}>
      <div className="h-full w-full max-w-md bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">Lead details</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-primary" size={26} /></div>
        )}
        {error && <div className="m-5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3" role="alert">{error}</div>}

        {detail && (
          <div className="px-5 py-4 space-y-6 text-sm">
            {/* Contact */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Contact</h3>
              <p className="text-lg font-semibold text-slate-900">{[detail.firstName, detail.lastName].filter(Boolean).join(" ") || "—"}</p>
              <div className="mt-2 space-y-1.5 text-slate-600">
                <p className="flex items-center gap-2"><Mail size={14} className="text-slate-400" /> {detail.email}</p>
                {detail.phone && <p className="flex items-center gap-2"><Phone size={14} className="text-slate-400" /> {detail.phone}</p>}
                {detail.jobTitle && <p className="text-slate-600">{detail.jobTitle}</p>}
              </div>
            </section>

            {/* Company */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Company</h3>
              <div className="space-y-1.5 text-slate-600">
                <p className="flex items-center gap-2"><Building2 size={14} className="text-slate-400" /> {detail.companyName || "—"}</p>
                {detail.website && <p className="flex items-center gap-2"><Globe size={14} className="text-slate-400" /> <a className="text-primary hover:underline" href={detail.website.startsWith("http") ? detail.website : `https://${detail.website}`} target="_blank" rel="noreferrer">{detail.website}</a></p>}
                {detail.linkedin && <p className="flex items-center gap-2"><Linkedin size={14} className="text-slate-400" /> <a className="text-primary hover:underline truncate max-w-[260px]" href={detail.linkedin} target="_blank" rel="noreferrer">{detail.linkedin}</a></p>}
                {detail.location && <p className="flex items-center gap-2"><MapPin size={14} className="text-slate-400" /> {detail.location}</p>}
                <p>{[detail.industry, detail.companySize].filter(Boolean).join(" · ") || "—"}</p>
              </div>
            </section>

            {/* Sales */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sales</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs text-slate-500">Lead score</p>
                  <p className="font-semibold text-slate-900">{scoreLabel(detail.leadScore)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs text-slate-500">Status</p>
                  <p className="font-semibold text-slate-900 capitalize">{detail.status}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Campaigns: {detail.campaigns.length ? detail.campaigns.map((c) => c.name).join(", ") : "None yet"}
              </p>
            </section>

            {/* Personalization / custom fields */}
            {(detail.customFields || detail.personalization) && (
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Personalization</h3>
                {detail.personalization && <p className="text-slate-600 mb-2">{detail.personalization}</p>}
                {detail.customFields && Object.keys(detail.customFields).length > 0 && (
                  <div className="space-y-1">
                    {Object.entries(detail.customFields).map(([k, v]) => (
                      <p key={k} className="text-slate-600"><span className="text-xs font-mono bg-slate-100 rounded px-1.5 py-0.5">{`{{${k}}}`}</span> {String(v)}</p>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Activity — real email events (§32) */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Activity</h3>
              {detail.events.length === 0 ? (
                <p className="text-slate-500">No email activity yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.events.map((e) => (
                    <li key={e.id} className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                      <Badge status={e.eventType} />
                      <span className="text-xs text-slate-400">{new Date(e.eventTimestamp).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
