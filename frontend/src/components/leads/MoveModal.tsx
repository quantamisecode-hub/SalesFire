// MoveModal — move/copy selected recipients to another campaign or a CRM list
// (Instantly "Move to another campaign, subsequence, or list").
import { useEffect, useState } from "react";
import { X, Loader2, ArrowRightCircle, Megaphone, List as ListIcon } from "lucide-react";
import { campaignService } from "@/services/campaign";
import { listsService } from "@/services/lists";
import type { LeadList } from "@/types/lead";

export function MoveModal({
  open, onClose, count, leadIds, campaignId, onMoved,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  /** Selected lead ids (audience table selects leads). */
  leadIds: string[];
  /** Source campaign — required for the move. */
  campaignId: string;
  onMoved?: (summary: { moved: number; copied: number; skipped: number }) => void;
}) {
  const [target, setTarget] = useState<"campaign" | "list">("campaign");
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [targetCampaignId, setTargetCampaignId] = useState("");
  const [targetListId, setTargetListId] = useState("");
  const [copy, setCopy] = useState(false);
  const [resetStatus, setResetStatus] = useState(true);
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null);
    setTarget("campaign"); setCopy(false); setResetStatus(true); setCheckDuplicates(true);
    Promise.all([
      campaignService.list({ pageSize: 100 }).then((r) => r.data.filter((c: any) => c.id !== campaignId)),
      listsService.list(),
    ])
      .then(([camps, ls]) => {
        setCampaigns(camps as Array<{ id: string; name: string }>);
        setLists(ls);
        setTargetCampaignId((camps as Array<{ id: string }>)[0]?.id || "");
        setTargetListId(ls[0]?.id || "");
      })
      .catch(() => setError("Failed to load campaigns and lists."))
      .finally(() => setLoading(false));
  }, [open, campaignId]);

  if (!open) return null;

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      if (target === "campaign") {
        if (!targetCampaignId) { setError("Select a target campaign."); setBusy(false); return; }
        const res = await campaignService.moveRecipients(campaignId, {
          leadIds, targetCampaignId, copy, resetStatus, checkDuplicates,
        });
        onMoved?.({ moved: res.moved, copied: res.copied, skipped: res.skipped.length });
      } else {
        if (!targetListId) { setError("Select a list (create one from Lists in the sidebar)."); setBusy(false); return; }
        const res = await campaignService.moveRecipientsToList(campaignId, {
          leadIds, targetListId, copy,
        });
        onMoved?.({ moved: res.added, copied: res.copied, skipped: res.skipped.length });
      }
      onClose();
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "Failed to move leads.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Move leads">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900 inline-flex items-center gap-2"><ArrowRightCircle size={16} className="text-primary-600" /> Move leads</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">{error}</div>}
          <p className="text-sm text-slate-600">Move or copy <strong>{count}</strong> selected lead{count === 1 ? "" : "s"}.</p>

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Move destination">
            <button type="button" role="radio" aria-checked={target === "campaign"} onClick={() => setTarget("campaign")}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${target === "campaign" ? "border-primary bg-indigo-50 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              <Megaphone size={15} /> Campaign
            </button>
            <button type="button" role="radio" aria-checked={target === "list"} onClick={() => setTarget("list")}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${target === "list" ? "border-primary bg-indigo-50 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              <ListIcon size={15} /> List
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : target === "campaign" ? (
            <select className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" value={targetCampaignId}
              onChange={(e) => setTargetCampaignId(e.target.value)} aria-label="Target campaign">
              {campaigns.length === 0 && <option value="">No other campaigns</option>}
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <select className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" value={targetListId}
              onChange={(e) => setTargetListId(e.target.value)} aria-label="Target list">
              {lists.length === 0 && <option value="">No lists yet</option>}
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.memberCount})</option>)}
            </select>
          )}

          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Options</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
              <span><strong>Copy leads</strong><br /><span className="text-xs text-slate-500">Keep them in this campaign too. Unchecked = move (removes them here).</span></span>
            </label>
            {target === "campaign" && (
              <>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={resetStatus} onChange={(e) => setResetStatus(e.target.checked)} />
                  <span><strong>Reset interest status</strong><br /><span className="text-xs text-slate-500">Interested / Won / Lost / etc. are set back to New. Progression (replied, contacted…) is kept.</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={checkDuplicates} onChange={(e) => setCheckDuplicates(e.target.checked)} />
                  <span><strong>Check duplicates across all campaigns</strong><br /><span className="text-xs text-slate-500">Skip leads enrolled in any other campaign (always skipped: duplicates in the target).</span></span>
                </label>
              </>
            )}
          </fieldset>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy || loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRightCircle size={15} />} {copy ? "Copy" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
