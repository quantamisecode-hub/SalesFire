// Dashboard - real data from the campaigns API. No mock numbers.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { campaignService } from "@/services/campaign";
import {
  Megaphone,
  Play,
  FileEdit,
  Mail,
  MailOpen,
  Reply,
  Users,
  Plus,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/Badge";

function KpiCard({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: React.FC<{ size?: number | string; className?: string }>;
  label: string;
  value: number | string;
  tint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-500" title={label}>{label}</div>
          <div className="text-lg font-semibold text-slate-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", "campaigns"],
    queryFn: () => campaignService.list({ page: 1, pageSize: 50 }),
  });

  const campaigns = data?.data ?? [];

  const totals = campaigns.reduce(
    (acc, c: any) => ({
      running: acc.running + (c.status === "running" ? 1 : 0),
      draft: acc.draft + (c.status === "draft" ? 1 : 0),
      leads: acc.leads + (c.totalLeads ?? 0),
      sent: acc.sent + (c.emailsSent ?? 0),
      opened: acc.opened + (c.emailsOpened ?? 0),
      replied: acc.replied + (c.emailsReplied ?? 0),
    }),
    { running: 0, draft: 0, leads: 0, sent: 0, opened: 0, replied: 0 }
  );

  const recent = campaigns.slice(0, 5);

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={16} /> Could not load dashboard data
        </div>
        <p className="mt-1 text-red-600">
          {(error as Error).message || "The backend did not respond. Is it running on port 8000?"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Welcome back, {user?.full_name?.split(" ")[0] || user?.email}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Here is what is happening across your outreach.
          </p>
        </div>
        <Link
          to="/campaigns/create"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
        >
          <Plus size={15} /> New Campaign
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={Megaphone}
          label="Campaigns"
          value={campaigns.length}
          tint="bg-primary-50 text-primary-600"
        />
        <KpiCard
          icon={Play}
          label="Running"
          value={totals.running}
          tint="bg-emerald-50 text-emerald-600"
        />
        <KpiCard
          icon={FileEdit}
          label="Drafts"
          value={totals.draft}
          tint="bg-slate-100 text-slate-600"
        />
        <KpiCard
          icon={Users}
          label="Leads"
          value={totals.leads}
          tint="bg-violet-50 text-violet-600"
        />
        <KpiCard
          icon={Mail}
          label="Emails sent"
          value={totals.sent}
          tint="bg-sky-50 text-sky-600"
        />
        <KpiCard
          icon={Reply}
          label="Replies"
          value={totals.replied}
          tint="bg-amber-50 text-amber-600"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Recent campaigns */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-card xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Recent Campaigns</h2>
            <Link
              to="/campaigns"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-hover"
            >
              View all <ArrowRight size={13} />
            </Link>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-400">Loading campaigns...</div>
          ) : recent.length === 0 ? (
            <div className="p-8 text-center">
              <Megaphone size={24} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-500">No campaigns yet.</p>
              <Link
                to="/campaigns/create"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                <Plus size={14} /> Create your first campaign
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Leads</th>
                  <th className="px-5 py-2.5 font-medium">Sent</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {recent.map((c: any) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-slate-50"
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                  >
                    <td className="max-w-[200px] truncate px-5 py-3 font-medium text-slate-900">
                      {c.name}
                    </td>
                    <td className="px-5 py-3">
                      <Badge status={c.status} />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{c.totalLeads ?? 0}</td>
                    <td className="px-5 py-3 text-slate-600">{c.emailsSent ?? 0}</td>
                    <td className="px-5 py-3 text-right">
                      <ArrowRight size={14} className="inline text-slate-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick actions */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to="/campaigns/create"
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 transition hover:border-primary-300 hover:bg-primary-50"
              >
                <Megaphone size={16} className="text-primary-600" />
                Create a campaign
              </Link>
              <Link
                to="/campaigns"
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 transition hover:border-primary-300 hover:bg-primary-50"
              >
                <MailOpen size={16} className="text-primary-600" />
                Review campaign performance
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Engagement Snapshot</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <Mail size={14} className="text-slate-400" /> Emails sent
                </span>
                <span className="font-semibold text-slate-900">{totals.sent}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <MailOpen size={14} className="text-slate-400" /> Opened
                </span>
                <span className="font-semibold text-slate-900">{totals.opened}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <Reply size={14} className="text-slate-400" /> Replies
                </span>
                <span className="font-semibold text-slate-900">{totals.replied}</span>
              </div>
              <div className="border-t border-slate-100 pt-3 text-xs text-slate-400">
                Aggregated live from your campaigns.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
