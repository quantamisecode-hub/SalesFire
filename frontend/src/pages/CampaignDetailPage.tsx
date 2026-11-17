// Campaign Detail page - Prompt 6 §38.
// Header (name/status/sending account/owner/created), KPI cards from real
// events, sequence timeline, activity feed, and status-aware actions:
// Edit / Schedule / Launch / Pause / Resume / Cancel / Archive.
import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Play, Pause, Square, Archive, Rocket,
  Users, BarChart3, Activity, Mail, Loader2, AlertTriangle, Eye, Sparkles, Trash2,
} from "lucide-react";
import { campaignService } from "@/services/campaign";
import { onCampaignUpdated } from "@/socket";
import { signatureService, type EmailSignature } from "@/services/signature";
import { Badge } from "@/components/Badge";
import { useConfirmDialog, type ConfirmOptions } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Campaign, CampaignStep } from "@/types/prompt5";
import type { CampaignAnalyticsV2, EmailEvent, PreviewResult } from "@/types/prompt6";

type StepWithVariants = CampaignStep & { variants?: Array<{ subject?: string; bodyHtml?: string }> };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Strip tags for a human-meaningful character count of the email body. */
function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function effectiveStepBody(step: StepWithVariants): string {
  if (step.bodyTemplate?.trim()) return step.bodyTemplate;
  return step.variants?.map((v) => v.bodyHtml).find((b) => b && stripHtml(b).length > 0) || "";
}

function effectiveStepSubject(step: StepWithVariants): string {
  if (step.subjectTemplate?.trim()) return step.subjectTemplate;
  return step.variants?.map((v) => v.subject).find(Boolean) || "";
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [steps, setSteps] = useState<StepWithVariants[]>([]);
  const [analytics, setAnalytics] = useState<CampaignAnalyticsV2 | null>(null);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "activity">("overview");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();
  const navigate = useNavigate();
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);

  useEffect(() => {
    signatureService.list().then((res) => setSignatures(res.data || [])).catch(() => {});
  }, []);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);
      const [campRes, seqRes, analyticsRes, eventsRes] = await Promise.all([
        campaignService.get(id),
        campaignService.listSequences(id),
        campaignService.getAnalyticsV2(id),
        campaignService.listEvents(id, { pageSize: 25 }),
      ]);
      setCampaign(campRes.data);
      const allSteps: StepWithVariants[] = (seqRes.data || []).flatMap((s: any) => s.steps || []);
      allSteps.sort((a, b) => a.stepOrder - b.stepOrder);
      setSteps(allSteps);
      setAnalytics(analyticsRes.data);
      setEvents(eventsRes.data || []);
    } catch {
      setError("Failed to load the campaign.");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Live sync: another session changed this campaign (edit/launch/pause/
  // resume) — reload and say so briefly.
  useEffect(() => onCampaignUpdated((e) => {
    if (e.campaignId !== id) return;
    setLiveNotice("Updated in another session — showing the latest.");
    void load();
    const t = setTimeout(() => setLiveNotice(null), 4000);
    return () => clearTimeout(t);
  }), [id, load]);

  const runAction = async (action: string, confirmOpts?: ConfirmOptions) => {
    if (!id) return;
    if (confirmOpts) {
      const ok = await confirm({ ...confirmOpts, tone: "danger" });
      if (!ok) return;
    }
    setBusyAction(action);
    try {
      if (action === "launch") {
        const res = await campaignService.launch(id);
        toast.success(`Campaign launched. ${res.queuedJobs ?? 0} email(s) queued.`);
      } else if (action === "pause") {
        await campaignService.pause(id);
        toast.success("Campaign paused. No new emails will be sent until resumed.");
      } else if (action === "resume") {
        await campaignService.resume(id);
        toast.success("Campaign resumed. Sends continue at the configured pace.");
      } else if (action === "cancel") {
        await campaignService.cancel(id);
        toast.success("Campaign cancelled. History and analytics are preserved.");
      } else if (action === "delete") {
        await campaignService.deleteCampaign(id);
        toast.success("Campaign deleted.");
        navigate("/campaigns");
        return;
      } else if (action === "archive") {
        await campaignService.archive(id);
        toast.success("Campaign archived.");
      } else if (action === "schedule") {
        const startAt = campaign?.scheduledStartAt ?? new Date(Date.now() + 3600_000).toISOString();
        await campaignService.schedule(id, startAt);
        toast.success("Campaign scheduled.");
      }
      await load();
    } catch (err: any) {
      const problems = err?.data?.problems;
      toast.error(
        problems?.length
          ? `${err?.data?.error || "Action failed."} ${problems.join(" ")}`
          : err?.data?.error || "Action failed."
      );
    } finally {
      setBusyAction(null);
    }
  };

  const openPreview = async () => {
    setShowPreview(true);
    setPreviewLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await campaignService.preview(id!);
      setPreview(res);
    } catch (err: any) {
      setAiError(err?.data?.error || "Failed to render preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const generateAi = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await campaignService.personalize(id!, {});
      setAiResult(res.data.personalizedBody);
    } catch (err: any) {
      if (err?.status === 501 || err?.data?.code === "AI_NOT_CONFIGURED") {
        setAiError("AI provider is not configured on the backend (KIMI_API_KEY missing).");
      } else {
        setAiError(err?.data?.error || "AI generation failed.");
      }
    } finally {
      setAiBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center py-16">
        <AlertTriangle className="mx-auto text-slate-300 mb-3" size={36} aria-hidden />
        <p className="text-red-600 text-sm mb-3">{error || "Campaign not found."}</p>
        <Link to="/campaigns" className="text-sm font-medium text-primary hover:underline">Back to campaigns</Link>
      </div>
    );
  }

  const status = campaign.status === "running" ? "active" : campaign.status;
  const canLaunch = ["draft", "ready_for_review", "scheduled", "failed"].includes(status);
  const canPause = status === "active";
  const canResume = status === "paused";
  const canCancel = ["draft", "ready_for_review", "scheduled", "active", "paused", "failed"].includes(status);
  const canArchive = !["archived"].includes(status);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Back to campaigns
      </Link>

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-slate-900">{campaign.name}</h1>
            <Badge status={campaign.status} />
          </div>
          {campaign.description && <p className="text-sm text-slate-500 mt-1 max-w-2xl">{campaign.description}</p>}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs text-slate-500">
            <div><dt className="inline font-medium text-slate-600">Created: </dt><dd className="inline">{new Date(campaign.createdAt).toLocaleDateString()}</dd></div>
            <div><dt className="inline font-medium text-slate-600">Timezone: </dt><dd className="inline">{campaign.timezone || "UTC"}</dd></div>
            {campaign.scheduledStartAt && (
              <div><dt className="inline font-medium text-slate-600">Scheduled: </dt><dd className="inline">{new Date(campaign.scheduledStartAt).toLocaleString()}</dd></div>
            )}
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openPreview}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Eye size={15} /> Preview
          </button>
          <Link
            to={`/campaigns/${id}/recipients`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
          >
            <Users size={15} /> Recipients
          </Link>
          <Link
            to={`/campaigns/${id}/analytics`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
          >
            <BarChart3 size={15} /> Analytics
          </Link>

          {/* Drafts, review-ready and paused campaigns are editable (paused
              campaigns too — the queue worker re-checks before sending). */}
          {["draft", "ready_for_review", "paused"].includes(status) && (
            <Link
              to={`/campaigns/${id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
            >
              Edit
            </Link>
          )}
          {canLaunch && (
            <button
              onClick={() => runAction("launch")}
              disabled={busyAction === "launch"}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {busyAction === "launch" ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
              Launch
            </button>
          )}
          {canPause && (
            <button
              onClick={() => runAction("pause", {
                title: "Pause this campaign?",
                message: "No new emails will be sent until the campaign is resumed.",
                confirmLabel: "Pause",
              })}
              disabled={busyAction === "pause"}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {busyAction === "pause" ? <Loader2 size={15} className="animate-spin" /> : <Pause size={15} />}
              Pause
            </button>
          )}
          {canResume && (
            <button
              onClick={() => runAction("resume")}
              disabled={busyAction === "resume"}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busyAction === "resume" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Resume
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => runAction("cancel", {
                title: "Cancel this campaign?",
                message: "Queued emails will be stopped. History, analytics and the audit log are preserved. This cannot be undone.",
                confirmLabel: "Cancel campaign",
              })}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50"
            >
              <Square size={14} /> Cancel
            </button>
          )}
          {canArchive && (
            <button
              onClick={() => runAction("archive", {
                title: "Archive this campaign?",
                message: "The campaign becomes read-only and queued emails are stopped. History and analytics are preserved.",
                confirmLabel: "Archive",
              })}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
            >
              <Archive size={14} /> Archive
            </button>
          )}
          {["draft", "archived"].includes(status) && (
            <button
              onClick={() => runAction("delete", {
                title: "Delete this campaign?",
                message: "This permanently deletes the campaign, its sequence, recipients, jobs and analytics. The leads themselves are kept. This cannot be undone.",
                confirmLabel: "Delete campaign",
              })}
              disabled={busyAction === "delete"}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-60"
            >
              {busyAction === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
          )}
        </div>
      </header>

      {liveNotice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 text-sky-800 text-sm px-4 py-2" role="status">{liveNotice}</div>
      )}

      {/* KPI cards */}
      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Recipients" value={analytics.totalRecipients} />
          <Kpi label="Sent" value={analytics.sent} />
          <Kpi label="Delivered" value={analytics.delivered} />
          <Kpi label="Replies" value={analytics.replied} />
          <Kpi label="Bounces" value={analytics.bounced} />
          <Kpi label="Unsubscribes" value={analytics.unsubscribed} />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200" role="tablist" aria-label="Campaign sections">
        {(["overview", "activity"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px capitalize focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              activeTab === tab ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab === "activity" ? <Activity size={14} /> : <Mail size={14} />}
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Sequence timeline */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Sequence</h2>
            {steps.length === 0 ? (
              <p className="text-sm text-slate-500">
                No sequence emails yet.
                {["draft", "ready_for_review", "paused"].includes(status) && (
                  <> <Link to={`/campaigns/${id}/edit`} className="text-primary font-medium hover:underline">Add emails →</Link></>
                )}
              </p>
            ) : (
              <ol className="space-y-0">
                {steps.map((step, i) => (
                  <li key={step.id} className="relative pl-8 pb-6 last:pb-0">
                    {i < steps.length - 1 && (
                      <span className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-200" aria-hidden />
                    )}
                    <span className="absolute left-0 top-0.5 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="text-sm font-medium text-slate-900">{step.name || `Email ${i + 1}`}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Subject: {effectiveStepSubject(step) || "—"}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {i > 0 && <>Wait {step.delayDays}d {step.delayHours ? `${step.delayHours}h` : ""} · </>}
                      Body {stripHtml(effectiveStepBody(step)).length} chars
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Settings summary */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Sending configuration</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Signature">
                <select
                  value={`${campaign.signatureMode || "inherit"}${campaign.signatureMode === "custom" ? `:${campaign.signatureId || ""}` : ""}`}
                  onChange={async (e) => {
                    const v = e.target.value;
                    let signatureMode: "inherit" | "custom" | "none" = "inherit";
                    let signatureId: string | null = null;
                    if (v === "none") signatureMode = "none";
                    else if (v === "inherit") signatureMode = "inherit";
                    else if (v.startsWith("custom:")) { signatureMode = "custom"; signatureId = v.slice(7) || null; }
                    try {
                      await campaignService.update(id!, { signatureMode, signatureId });
                      toast.success(signatureMode === "none" ? "No signature will be attached." : "Signature assignment updated.");
                      await load();
                    } catch (err: any) {
                      toast.error(err?.data?.error || "Failed to update the signature.");
                    }
                  }}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-800 max-w-[220px]"
                  aria-label="Campaign signature"
                >
                  <option value="inherit">Inherit org default</option>
                  {signatures.map((s) => (
                    <option key={s.id} value={`custom:${s.id}`}>Custom — {s.name}</option>
                  ))}
                  {campaign.signatureMode === "custom" && !campaign.signatureId && (
                    <option value="custom:">Choose Signature</option>
                  )}
                  <option value="none">No signature</option>
                </select>
              </Row>
              <Row label="AI personalization">
                {campaign.aiPersonalizationEnabled ? `Enabled (${campaign.aiPersonalizationDepth || "standard"})` : "Disabled"}
              </Row>
              <Row label="Sending days">
                {campaign.sendDaysOfWeek?.length
                  ? campaign.sendDaysOfWeek.map((d) => DAYS[d - 1]).filter(Boolean).join(", ")
                  : "Mon – Fri (default)"}
              </Row>
              <Row label="Sending window">
                {`${String(campaign.sendBetweenStartHour ?? 9).padStart(2, "0")}:00 – ${String(campaign.sendBetweenEndHour ?? 17).padStart(2, "0")}:00 UTC`}
              </Row>
              <Row label="Daily limit">{campaign.maxEmailsPerDay || campaign.dailyLimit || "—"}</Row>
              <Row label="Hourly limit">{campaign.hourlyLimit || "—"}</Row>
              <Row label="Campaign type">{campaign.campaignType}</Row>
            </dl>
            {campaign.aiPersonalizationEnabled && (
              <button
                onClick={generateAi}
                disabled={aiBusy}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-60"
              >
                {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {aiBusy ? "Generating…" : "Generate AI sample"}
              </button>
            )}
            {aiResult && (
              <pre className="mt-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap text-slate-700">{aiResult}</pre>
            )}
            {aiError && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">{aiError}</p>
            )}
          </section>
        </div>
      ) : (
        /* Activity feed */
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Email activity</h2>
            <p className="text-xs text-slate-500 mt-0.5">Real events from the send queue, newest first.</p>
          </div>
          {events.length === 0 ? (
            <p className="px-5 py-10 text-sm text-slate-500 text-center">
              No events yet. Launch the campaign to start sending and events will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.map((ev) => (
                <li key={ev.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <Badge status={ev.eventType} />
                  <span className="text-slate-600 text-xs truncate">
                    {typeof ev.metadata?.subject === "string"
                      ? ev.metadata.subject
                      : typeof ev.metadata?.error === "string"
                        ? ev.metadata.error
                        : typeof ev.metadata?.reason === "string"
                          ? ev.metadata.reason
                          : ev.metadata?.scheduledFor
                            ? `Scheduled for ${new Date(String(ev.metadata.scheduledFor)).toLocaleString()}`
                            : ""}
                  </span>
                  <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                    {new Date(ev.eventTimestamp).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Preview modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Email preview">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowPreview(false)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <h3 className="text-lg font-semibold text-slate-900">Email preview</h3>
            {previewLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={22} className="animate-spin text-primary" aria-label="Rendering preview" />
              </div>
            ) : preview?.data ? (
              <>
                <p className="text-xs text-slate-500 mt-1">
                  {preview.data.isSampleRecipient
                    ? "Using sample data (the campaign has no recipients yet)."
                    : `Rendered for ${preview.data.to?.name || preview.data.to?.email} with real variable substitution.`}
                </p>
                {(preview.data.unresolved?.length ?? 0) > 0 && (
                  <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
                    <strong>Unresolved variables:</strong> {preview.data.unresolved.map((v) => `{{${v}}}`).join(", ")} — this recipient has no data for them.
                  </p>
                )}
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-lg border border-slate-200 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-medium">From</div>
                      <div className="text-slate-800">{preview.data.from?.name} &lt;{preview.data.from?.email}&gt;</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-medium">To</div>
                      <div className="text-slate-800">
                        {preview.data.to?.name}{" "}
                        &lt;{preview.data.to?.email}&gt;
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs text-slate-400 uppercase font-medium">Subject</div>
                    <div className="text-slate-800 font-medium">{preview.data.subject || "(empty)"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs text-slate-400 uppercase font-medium mb-1">Body</div>
                    <pre className="whitespace-pre-wrap text-slate-800 font-sans">{preview.data.text || "(empty)"}</pre>
                  </div>
                </div>
                {campaign.aiPersonalizationEnabled && (
                  <div className="mt-4">
                    <button
                      onClick={generateAi}
                      disabled={aiBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-60"
                    >
                      {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {aiBusy ? "Generating AI version…" : "Generate AI personalized version"}
                    </button>
                    {aiResult && (
                      <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
                        <div className="text-xs text-violet-500 uppercase font-medium mb-1">AI version</div>
                        <pre className="whitespace-pre-wrap text-slate-800 font-sans text-sm">{aiResult}</pre>
                      </div>
                    )}
                    {aiError && (
                      <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">{aiError}</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-red-600 mt-3">{aiError || "Preview unavailable."}</p>
            )}
            <div className="flex justify-end mt-6">
              <button onClick={() => setShowPreview(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 text-right font-medium">{children}</dd>
    </div>
  );
}
