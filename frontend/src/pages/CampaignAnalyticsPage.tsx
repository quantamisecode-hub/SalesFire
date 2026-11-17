// Campaign Analytics page - Prompt 6 §39.
// Real metrics computed from the email event log by the backend. No fake numbers.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Send, CheckCircle2, AlertTriangle, Reply, UserMinus,
  MailQuestion, Users, BarChart3,
} from "lucide-react";
import { campaignService } from "@/services/campaign";
import { Badge } from "@/components/Badge";
import type { Campaign } from "@/types/prompt5";
import type { CampaignAnalyticsV2, EmailEvent } from "@/types/prompt6";

export function CampaignAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalyticsV2 | null>(null);
  const [recentEvents, setRecentEvents] = useState<EmailEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [campRes, analyticsRes, eventsRes] = await Promise.all([
          campaignService.get(id),
          campaignService.getAnalyticsV2(id),
          campaignService.listEvents(id, { pageSize: 12 }),
        ]);
        if (cancelled) return;
        setCampaign(campRes.data);
        setAnalytics(analyticsRes.data);
        setRecentEvents(eventsRes.data || []);
      } catch {
        if (!cancelled) setError("Failed to load analytics.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center py-16">
        <BarChart3 className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
        <p className="text-red-600 text-sm mb-3">{error || "Analytics not available."}</p>
        <Link to={`/campaigns/${id}`} className="text-sm font-medium text-primary hover:underline">Back to campaign</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Link to={`/campaigns/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Back to campaign
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <BarChart3 size={22} className="text-primary" aria-hidden />
          Analytics
        </h1>
        {campaign && <p className="text-sm text-slate-500 mt-1">{campaign.name}</p>}
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<Send size={15} />} label="Sent" value={analytics.sent} tone="blue" />
        <Kpi icon={<CheckCircle2 size={15} />} label="Delivered" value={analytics.delivered} tone="emerald" />
        <Kpi icon={<AlertTriangle size={15} />} label="Bounced" value={analytics.bounced} tone="red" />
        <Kpi icon={<AlertTriangle size={15} />} label="Failed" value={analytics.failed} tone="red" />
        <Kpi icon={<Reply size={15} />} label="Replied" value={analytics.replied} tone="violet" />
        <Kpi icon={<UserMinus size={15} />} label="Unsubscribed" value={analytics.unsubscribed} tone="amber" />
      </div>

      {/* Rates */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <RateCard label="Reply Rate" value={analytics.replyRate} hint={`${analytics.replied} replies / ${analytics.sent} sent`} />
        <RateCard label="Bounce Rate" value={analytics.bounceRate} hint={`${analytics.bounced} bounces / ${analytics.sent} sent`} />
        <RateCard label="Unsubscribe Rate" value={analytics.unsubscribeRate} hint={`${analytics.unsubscribed} unsubs / ${analytics.sent} sent`} />
      </div>

      {/* Audience overview */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Users size={15} className="text-slate-400" aria-hidden /> Audience
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Metric label="Total recipients" value={analytics.totalRecipients} />
          <Metric label="Active" value={analytics.activeRecipients} />
          <Metric label="Queued jobs" value={analytics.queued} />
          <Metric label="Soft failures (retrying)" value={analytics.softFailed} />
        </div>
        <div className="mt-3">
          <Link to={`/campaigns/${id}/recipients`} className="text-sm font-medium text-primary hover:underline">
            View recipient list →
          </Link>
        </div>
      </div>

      {/* Recent events */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <MailQuestion size={15} className="text-slate-400" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900">Recent email events</h2>
        </div>
        {recentEvents.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500 text-center">
            No events yet. Events appear here as emails are queued and sent.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentEvents.map((ev) => (
              <li key={ev.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <Badge status={ev.eventType} />
                <span className="text-slate-600 text-xs">
                  {typeof ev.metadata?.subject === "string"
                    ? ev.metadata.subject
                    : typeof ev.metadata?.error === "string"
                      ? ev.metadata.error
                      : ""}
                </span>
                <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                  {new Date(ev.eventTimestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50",
    emerald: "text-emerald-600 bg-emerald-50",
    red: "text-red-600 bg-red-50",
    violet: "text-violet-600 bg-violet-50",
    amber: "text-amber-600 bg-amber-50",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className={`inline-flex items-center justify-center w-7 h-7 rounded-lg mb-2 ${tones[tone] || tones.blue}`} aria-hidden>
        {icon}
      </div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function RateCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">{value}%</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden" role="presentation">
        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
