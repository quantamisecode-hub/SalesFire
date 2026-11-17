// WarmupPanel — deliverability warm-up control per sending account (Prompt 8).
// Every number rendered here is the backend's real computation — when there
// isn't enough real send data yet, we say "Not enough data" instead of a
// fake health score. When something is wrong, we say exactly what is wrong
// rather than leaving the user to guess why nothing sends.
import { useState, useEffect } from "react";
import { Flame, Loader2, X, RotateCcw, AlertTriangle, Pencil, Check } from "lucide-react";
import { deliverabilityService, type WarmupAccountStatus } from "@/services/deliverability";
import { Badge } from "@/components/Badge";
import { useToast } from "@/components/ui/Toast";

const HEALTH_TITLE = "Deliverability health from real SMTP outcomes";

function healthBadge(score: number | null) {
  if (score === null) return <Badge status="not_enough_data" title="Fewer than 10 real send attempts — keep sending before a health score is meaningful" />;
  const key = score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "at_risk" : "poor";
  return <Badge status={key} title={HEALTH_TITLE}>{`${score} — `}</Badge>;
}

/** Honest one-line reason a plan/account is not delivering (or null when fine). */
function planReason(account: WarmupAccountStatus["account"], plan: WarmupAccountStatus["plan"]): string | null {
  if (!plan) return null;
  if (account.status === "error") {
    return "This account's last SMTP connection failed — warm-up can't deliver. Fix its credentials/host and run Test connection, then resume warm-up.";
  }
  if (!plan.seedRecipients?.trim()) {
    return "No seed recipients configured — the engine has nowhere to send, so it pauses instead of pretending. Add recipients below.";
  }
  if (plan.status === "paused" && plan.consecutiveFailureDays > 0) {
    return `Paused after repeated failing sends (${plan.totalFailed} failure${plan.totalFailed === 1 ? "" : "s"}). The engine paused itself; verify the account, then resume.`;
  }
  if (plan.status === "paused") {
    return "Warm-up is paused. Resume once the account is healthy.";
  }
  if (account.status === "unverified") {
    return "Sending from an unverified account — run Test connection to confirm deliverability before relying on warm-up.";
  }
  return null;
}

export function WarmupPanel() {
  const [items, setItems] = useState<WarmupAccountStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [seedEditId, setSeedEditId] = useState<string | null>(null);
  const [seedDraft, setSeedDraft] = useState("");
  const toast = useToast();

  const refresh = async () => {
    try {
      const res = await deliverabilityService.warmupStatus();
      setItems(res.data || []);
    } catch { /* keep last-known state */ } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    refresh(); // eslint-disable-line react-hooks/exhaustive-deps
    const t = setInterval(refresh, 30000); // auto-refresh so a silent auto-pause surfaces without a manual refresh
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (accountId: string, payload: Parameters<typeof deliverabilityService.updateWarmupPlan>[1]) => {
    setBusyId(accountId);
    try {
      await deliverabilityService.updateWarmupPlan(accountId, payload);
      if (payload.enabled === false) toast.info("Warm-up paused.");
      else if (payload.enabled === true) toast.success("Warm-up resumed.");
      await refresh();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to update the warm-up plan.");
    } finally {
      setBusyId(null);
    }
  };

  const startEditSeeds = (accountId: string, current: string | undefined) => {
    setSeedEditId(accountId);
    setSeedDraft(current || "");
  };

  const saveSeeds = async (accountId: string) => {
    setBusyId(accountId);
    try {
      await deliverabilityService.updateWarmupPlan(accountId, { seedRecipients: seedDraft });
      toast.success("Seed recipients saved.");
      setSeedEditId(null);
      await refresh();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to save seed recipients.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-orange-500" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Warm-up engine</h2>
            <p className="text-[11px] text-slate-500">
              Gradually ramps real sending from new accounts to seed mailboxes. Every stat below is real send data — failures included.
            </p>
          </div>
        </div>
        <button type="button" onClick={refresh} aria-label="Refresh warm-up status"
          className="text-[11px] font-medium text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
          <RotateCcw size={11} /> Refresh
        </button>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map(({ account, plan }) => {
          const enabled = plan?.status === "active";
          const reason = planReason(account, plan);
          const seeds = (plan?.seedRecipients || "").split(",").map((s) => s.trim()).filter(Boolean);
          const editing = seedEditId === account.id;

          return (
            <li key={account.id} className="px-5 py-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="min-w-0 lg:w-64">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-900 truncate">{account.name}</span>
                    {account.status && <Badge status={account.status} />}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{account.fromEmail}</div>
                  {!account.isEnabled && <div className="text-[11px] text-slate-400">Account disabled</div>}
                </div>

                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <Stat label="Day" value={plan ? String(plan.currentDay) : "—"} />
                  <Stat label="Today" value={plan ? `${plan.sentToday}/${plan.dailyTarget}` : "—"} />
                  <Stat label="Total sent" value={plan ? String(plan.totalSent) : "—"} />
                  <Stat label="Failed" value={plan ? String(plan.totalFailed) : "—"} />
                </div>

                <div className="flex items-center gap-3 lg:w-64 justify-between">
                  {healthBadge(plan?.healthScore ?? null)}
                  {enabled ? (
                    <button type="button" onClick={() => update(account.id, { enabled: false })} disabled={busyId === account.id}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-60 inline-flex items-center gap-1">
                      {busyId === account.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Pause
                    </button>
                  ) : (
                    <button type="button" onClick={() => update(account.id, { enabled: true })} disabled={busyId === account.id}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1">
                      {busyId === account.id ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />} Warm up
                    </button>
                  )}
                </div>
              </div>

              {/* Honest reason line — only when something is wrong or warm-up is paused. */}
              {reason && (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2" role="status">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{reason}</span>
                </div>
              )}

              {/* Seed recipients — editable right here; warm-up cannot work without them. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="text-[11px] text-slate-500">Seed recipients:</span>
                {editing ? (
                  <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
                    <input
                      autoFocus
                      value={seedDraft}
                      onChange={(e) => setSeedDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveSeeds(account.id);
                        if (e.key === "Escape") setSeedEditId(null);
                      }}
                      placeholder="qa-seed@test.local, qa-seed2@example.com"
                      aria-label="Seed recipients (comma-separated emails)"
                      className="flex-1 min-w-0 text-[11px] border border-primary/40 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button type="button" onClick={() => saveSeeds(account.id)} disabled={busyId === account.id}
                      className="p-1.5 rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-60" aria-label="Save seed recipients" title="Save seed recipients">
                      {busyId === account.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    </button>
                    <button type="button" onClick={() => setSeedEditId(null)} className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Cancel" title="Cancel">
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-2 min-w-0">
                    {seeds.length > 0 ? (
                      <span className="text-[11px] text-slate-700 truncate max-w-full">{seeds.join(", ")}</span>
                    ) : (
                      <span className="text-[11px] text-amber-700 font-medium">None configured — warm-up can&apos;t send without seeds.</span>
                    )}
                    <button type="button" onClick={() => startEditSeeds(account.id, plan?.seedRecipients)}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-1.5 py-1">
                      <Pencil size={9} /> Edit
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!loaded ? (
        <p className="flex items-center gap-2 px-5 py-6 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading warm-up status…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">Add a sending account above to start warming up.</p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
