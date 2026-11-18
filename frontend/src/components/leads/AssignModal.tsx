// AssignModal — round-robin assign selected leads to org members (Instantly "assign leads").
import { useEffect, useState } from "react";
import { X, Loader2, UserCog, Users } from "lucide-react";
import { leadService } from "@/services/lead";
import { memberService } from "@/services/members";
import type { Member } from "@/types/lead";

export function AssignModal({
  open, onClose, count, leadIds, campaignId, onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  leadIds: string[];
  /** Assign all leads enrolled in this campaign instead of explicit leadIds. */
  campaignId?: string | null;
  onAssigned?: (assigned: number) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null); setChecked(new Set());
    memberService.list()
      .then((m) => { setMembers(m); setChecked(new Set(m.map((x) => x.id))); })
      .catch(() => setError("Failed to load members."))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!checked.size) { setError("Select at least one member."); return; }
    setBusy(true); setError(null);
    try {
      const res = await leadService.bulkAssign(leadIds, [...checked], campaignId || undefined);
      onAssigned?.(res.data.assigned);
      onClose();
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "Failed to assign leads.");
    } finally {
      setBusy(false);
    }
  };

  const per = Math.floor(count / Math.max(1, checked.size));
  const extra = count % Math.max(1, checked.size);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Assign leads">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900 inline-flex items-center gap-2"><UserCog size={16} className="text-primary-600" /> Assign leads</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">{error}</div>}
          <p className="text-sm text-slate-600">
            Assign <strong>{count}</strong> lead{count === 1 ? "" : "s"} to your team members, distributed round-robin.
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-3"><Loader2 size={15} className="animate-spin" /> Loading members…</div>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={checked.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Assign to ${m.fullName}`} />
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-50 text-[11px] font-semibold text-primary-700">
                    {m.fullName.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 truncate">{m.fullName}</span>
                    <span className="block text-[11px] text-slate-400">{m.email} · {m.role}</span>
                  </span>
                </label>
              ))}
              {members.length === 0 && <p className="px-3 py-4 text-sm text-slate-400 text-center">No other members in this organization yet.</p>}
            </div>
          )}
          {checked.size > 0 && (
            <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5"><Users size={12} /> Round-robin: ~{per} lead{per === 1 ? "" : "s"} each{extra ? ` (${extra} gets one extra)` : ""}.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy || loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserCog size={15} />} Assign
          </button>
        </div>
      </div>
    </div>
  );
}
