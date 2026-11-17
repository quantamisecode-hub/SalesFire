// Campaign Create/Edit wizard - Prompt 6 §7-19.
// 7 steps: Details → Audience → Sequence → Personalization → Schedule →
// Review → Launch. Data persists server-side: the draft campaign row is
// created when leaving step 1 and updated on every later step. Moving
// backward and forward never loses data.
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Loader2,
  Rocket, Eye, Sparkles, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import { campaignService } from "@/services/campaign";
import { onCampaignUpdated, onSequenceSaved } from "@/socket";
import { AudienceStep } from "@/components/leads/AudienceStep";
import { emailSendingService } from "@/services/emailSending";
import { SequenceBuilder, buildSequencePayload, type SequenceBuilderHandle } from "@/components/sequence/SequenceBuilder";
import { useToast } from "@/components/ui/Toast";
import type { SmtpAccount, CampaignRecipient, AudienceCounts } from "@/types/prompt6";
import type { StepDraft } from "@/types/sequence";

const STEPS = ["Details", "Leads", "Sequence", "Personalization", "Schedule", "Review", "Launch"];
const STEP_STORAGE_PREFIX = "salesfire.campaign-wizard.step.";
const readPersistedStep = (campaignId: string | null): number => {
  if (!campaignId) return 1;
  try {
    const n = Number(window.sessionStorage.getItem(STEP_STORAGE_PREFIX + campaignId));
    return Number.isFinite(n) && n >= 1 && n <= STEPS.length ? n : 1;
  } catch {
    return 1;
  }
};
const persistStep = (campaignId: string | null, step: number) => {
  if (!campaignId) return;
  try { window.sessionStorage.setItem(STEP_STORAGE_PREFIX + campaignId, String(step)); } catch { /* ignore */ }
};
const DAYS = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 7, label: "Sun" },
];
const TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

const newStep = (): StepDraft => ({
  key: Math.random().toString(36).slice(2),
  name: "", subjectTemplate: "", bodyTemplate: "",
  delayDays: 2, delayHours: 0, delayMinutes: 0,
  variants: [],
});

export function CampaignCreatePage() {
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const builderRef = useRef<SequenceBuilderHandle>(null);

  // Persist the current step in sessionStorage (keyed by campaign id) so a
  // page refresh returns the user to the same step instead of step 1.
  const [step, setStep] = useState(() => readPersistedStep(editId || null));
  const [campaignId, setCampaignId] = useState<string | null>(editId || null);
  const [booting, setBooting] = useState(Boolean(editId));

  useEffect(() => {
    persistStep(campaignId, step);
  }, [campaignId, step]);

  // Step 1 - details
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sendingAccountId, setSendingAccountId] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  // Step 2 - audience
  const [enrolled, setEnrolled] = useState<CampaignRecipient[]>([]);
  const [counts, setCounts] = useState<AudienceCounts | null>(null);

  // Step 3 - sequence
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([newStep()]);

  // Step 4 - personalization
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiDepth, setAiDepth] = useState("standard");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Step 5 - schedule
  const [startAt, setStartAt] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState("9");
  const [endHour, setEndHour] = useState("17");
  const [dailyLimit, setDailyLimit] = useState("300");
  const [hourlyLimit, setHourlyLimit] = useState("30");
  const [minDelay, setMinDelay] = useState("5");
  const [maxDelay, setMaxDelay] = useState("15");

  // Wizard plumbing
  const [isSaving, setIsSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [launchBusy, setLaunchBusy] = useState(false);
  const toast = useToast();
  const [launchResult, setLaunchResult] = useState<{ queued: number; suppressed: number } | null>(null);

  const refreshAudience = useCallback(async (cid: string) => {
    try {
      const [countsRes, listRes] = await Promise.all([
        campaignService.audienceCounts(cid),
        campaignService.listRecipients(cid, { pageSize: 50 }),
      ]);
      setCounts(countsRes.data);
      setEnrolled(listRes.data || []);
      return { counts: countsRes.data, list: listRes.data || [] };
    } catch { /* refresh failures surface on save */ return null; }
  }, []);

  // Boot: load accounts; in edit mode also load the campaign.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accRes = await emailSendingService.listAccounts();
        if (!cancelled) setAccounts(accRes.data || []);
      } catch { /* dropdown shows empty state */ }

      if (editId) {
        try {
          const res = await campaignService.get(editId);
          const c = res.data;
          if (cancelled) return;
          setName(c.name || "");
          setDescription(c.description || "");
          setSendingAccountId(c.sendingAccountId || "");
          setTimezone(c.timezone || "UTC");
          setAiEnabled(Boolean(c.aiPersonalizationEnabled));
          setAiDepth(c.aiPersonalizationDepth || "standard");
          setDays(c.sendDaysOfWeek?.length ? c.sendDaysOfWeek : [1, 2, 3, 4, 5]);
          setStartHour(c.sendBetweenStartHour != null ? String(c.sendBetweenStartHour) : "9");
          setEndHour(c.sendBetweenEndHour != null ? String(c.sendBetweenEndHour) : "17");
          setDailyLimit(c.maxEmailsPerDay != null ? String(c.maxEmailsPerDay) : "300");
          setHourlyLimit(c.hourlyLimit != null ? String(c.hourlyLimit) : "30");
          setMinDelay(c.minDelayMinutes != null ? String(c.minDelayMinutes) : "5");
          setMaxDelay(c.maxDelayMinutes != null ? String(c.maxDelayMinutes) : "15");
          if (c.scheduledStartAt) {
            setStartAt(new Date(c.scheduledStartAt).toISOString().slice(0, 16));
          }
          const [seqRes, recRes] = await Promise.all([
            campaignService.listSequences(editId),
            campaignService.listRecipients(editId, { pageSize: 50 }),
          ]);
          const seq = (seqRes.data || []).find((s: any) => (s.steps || []).length > 0) || (seqRes.data || [])[0];
          if (seq) {
            setSequenceId(seq.id);
            setSteps(
              (seq.steps || []).length
                ? (seq.steps as any[]).sort((a, b) => a.stepOrder - b.stepOrder).map((s: any) => ({
                    key: s.id,
                    id: s.id,
                    name: s.name,
                    subjectTemplate: s.subjectTemplate,
                    bodyTemplate: s.bodyTemplate,
                    delayDays: s.delayDays,
                    delayHours: s.delayHours,
                    delayMinutes: s.delayMinutes || 0,
                    signatureMode: s.signatureMode || "inherit",
                    signatureId: s.signatureId || null,
                    variants: (s.variants || []).map((v: any) => ({
                      key: v.id, id: v.id, variantName: v.variantName,
                      subject: v.subject, bodyHtml: v.bodyHtml, bodyText: v.bodyText, weight: v.weight,
                    })),
                  }))
                : [newStep()]
            );
          }
          setEnrolled(recRes.data || []);
          setCounts((await campaignService.audienceCounts(editId)).data);
        } catch {
          if (!cancelled) setStepError("Failed to load the campaign draft.");
        } finally {
          if (!cancelled) setBooting(false);
        }
      } else {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId]);

  // Live sync: another session saved this campaign or its sequence — say so
  // (the builder's own banner offers to reload; edits here don't clobber).
  useEffect(() => {
    if (!editId) return;
    const offA = onCampaignUpdated((e) => { if (e.campaignId === editId) setLiveNotice("This campaign was updated in another session — reload to avoid conflicting saves."); });
    const offB = onSequenceSaved((e) => { if (e.campaignId === editId) setLiveNotice("This campaign's sequence was saved in another session — reload to avoid conflicting edits."); });
    return () => { offA(); offB(); };
  }, [editId]);

  const saveDetails = async (): Promise<boolean> => {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Campaign name is required";
    if (!sendingAccountId) errors.sendingAccountId = "Select a sending account";
    if (!timezone) errors.timezone = "Timezone is required";
    setDetailErrors(errors);
    if (Object.keys(errors).length) return false;

    setIsSaving(true);
    setStepError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description || undefined,
        campaignType: "outreach",
        timezone,
        sendingAccountId,
      };
      if (campaignId) {
        await campaignService.update(campaignId, payload);
      } else {
        const res = await campaignService.create(payload as any);
        const newId = res.data.id;
        setCampaignId(newId);
        window.history.replaceState(null, "", `/campaigns/${newId}/edit`);
      }
      return true;
    } catch (err: any) {
      setStepError(err?.data?.error || "Failed to save campaign details.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveAudience = async (): Promise<boolean> => {
    if (!campaignId) return false;
    setIsSaving(true);
    setStepError(null);
    try {
      // Authoritative post-save state from the server. Enrollment happens in
      // the Audience table (bulk actions / import with campaignId).
      const fresh = await refreshAudience(campaignId);
      if (!fresh) {
        setStepError("Couldn't verify the recipients — the server couldn't be reached (your session may have expired). Refresh the page and try again.");
        return false;
      }
      if (!fresh.counts.total) {
        setStepError("Add at least one recipient — import a list or add leads to the campaign.");
        return false;
      }
      return true;
    } catch (err: any) {
      setStepError(err?.data?.error || "Failed to save recipients.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveSequence = async (): Promise<boolean> => {
    if (!campaignId) return false;
    setStepError(null);
    // The builder flushes pending autosave, persists, and gates on the
    // structured validation issues (undefined variables, malformed spintax,
    // variant distribution — §39-§41), showing them click-to-field.
    try {
      const ok = await builderRef.current?.save();
      if (!ok) {
        setStepError("Fix the highlighted sequence issues before continuing.");
        return false;
      }
      return true;
    } catch (err: any) {
      setStepError(err?.data?.error || "Failed to save the sequence.");
      return false;
    }
  };

  const savePersonalization = async (): Promise<boolean> => {
    if (!campaignId) return false;
    setIsSaving(true);
    setStepError(null);
    try {
      await campaignService.update(campaignId, {
        aiPersonalizationEnabled: aiEnabled,
        aiPersonalizationDepth: aiDepth,
      });
      return true;
    } catch (err: any) {
      setStepError(err?.data?.error || "Failed to save personalization settings.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveSchedule = async (): Promise<boolean> => {
    if (!campaignId) return false;
    if (days.length === 0) {
      setStepError("Pick at least one sending day.");
      return false;
    }
    const sh = parseInt(startHour, 10), eh = parseInt(endHour, 10);
    if (Number.isNaN(sh) || Number.isNaN(eh) || sh < 0 || sh > 23 || eh < 1 || eh > 24 || sh >= eh) {
      setStepError("The sending window must have start before end (0-23h).");
      return false;
    }
    setIsSaving(true);
    setStepError(null);
    try {
      await campaignService.update(campaignId, {
        sendDaysOfWeek: days,
        sendBetweenStartHour: sh,
        sendBetweenEndHour: eh,
        maxEmailsPerDay: dailyLimit ? parseInt(dailyLimit, 10) : undefined,
        hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : undefined,
        minDelayMinutes: minDelay ? parseInt(minDelay, 10) : 0,
        maxDelayMinutes: maxDelay ? parseInt(maxDelay, 10) : 0,
        scheduledStartAt: startAt ? new Date(startAt).toISOString() : undefined,
      });
      return true;
    } catch (err: any) {
      setStepError(err?.data?.error || "Failed to save the schedule.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const next = async () => {
    setStepError(null);
    if (step === 1) {
      if (!(await saveDetails())) return;
      setStep(2);
    } else if (step === 2) {
      if (!(await saveAudience())) return;
      setStep(3);
    } else if (step === 3) {
      if (!(await saveSequence())) return;
      setStep(4);
    } else if (step === 4) {
      if (!(await savePersonalization())) return;
      setStep(5);
    } else if (step === 5) {
      if (!(await saveSchedule())) return;
      setStep(6);
    } else if (step === 6) {
      setStep(7);
    }
  };

  const back = () => {
    setStepError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const launch = async () => {
    if (!campaignId) return;
    setLaunchBusy(true);
    setStepError(null);
    try {
      const res = await campaignService.launch(campaignId);
      setLaunchResult({ queued: res.queuedJobs ?? 0, suppressed: res.suppressedRecipients ?? 0 });
      toast.success(`Campaign launched — ${res.queuedJobs ?? 0} email(s) queued, ${res.suppressedRecipients ?? 0} recipient(s) suppressed.`);
      setTimeout(() => navigate(`/campaigns/${campaignId}`), 1200);
    } catch (err: any) {
      const problems = err?.data?.problems;
      const msg = problems?.length
        ? `${err?.data?.error} ${problems.join(" ")}`
        : err?.data?.error || "Launch failed.";
      toast.error(msg);
      setStepError(msg);
    } finally {
      setLaunchBusy(false);
    }
  };

  // ---- Sequence helpers ----

  // ---- Personalization helpers ----
  const generatePreview = async () => {
    if (!campaignId) return;
    setPreviewBusy(true);
    setAiError(null);
    try {
      const res = await campaignService.preview(campaignId, { stepId: steps[0]?.key });
      setPreview({ subject: res.data.subject, text: res.data.text });
    } catch (err: any) {
      setAiError(err?.data?.error || "Preview failed.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const generateAi = async () => {
    if (!campaignId) return;
    setAiBusy(true);
    setAiError(null);
    setAiText(null);
    try {
      const res = await campaignService.personalize(campaignId, { stepId: steps[0]?.key, depth: aiDepth });
      setAiText(res.data.personalizedBody);
    } catch (err: any) {
      if (err?.status === 501 || err?.data?.code === "AI_NOT_CONFIGURED") {
        setAiError("AI is not configured on the backend (KIMI_API_KEY missing). Personalization stays manual.");
      } else {
        setAiError(err?.data?.error || "AI generation failed.");
      }
    } finally {
      setAiBusy(false);
    }
  };

  const acceptAi = async () => {
    if (!aiText || !campaignId) return;
    // Accept = apply the AI version to email 1 (variant A when the step uses
    // variants) and persist the full sequence, variants included.
    setSteps((prev) => prev.map((s, i) => {
      if (i !== 0) return s;
      if (s.variants.length) {
        return { ...s, variants: s.variants.map((v, vi) => (vi === 0 ? { ...v, bodyHtml: aiText } : v)) };
      }
      return { ...s, bodyTemplate: aiText };
    }));
    setAiText(null);
    setIsSaving(true);
    try {
      const payload = {
        name: "Outreach v1",
        steps: buildSequencePayload(
          steps.map((s, i) => {
            if (i !== 0) return s;
            if (s.variants.length) {
              return { ...s, variants: s.variants.map((v, vi) => (vi === 0 ? { ...v, bodyHtml: aiText } : v)) };
            }
            return { ...s, bodyTemplate: aiText };
          }),
        ),
      };
      if (sequenceId) await campaignService.updateSequence(campaignId, sequenceId, payload);
      else {
        const res = await campaignService.createSequence(campaignId, payload);
        setSequenceId(res.data.id);
      }
    } catch (err: any) {
      setAiError(err?.data?.error || "Failed to apply the AI version.");
    } finally {
      setIsSaving(false);
    }
  };

  if (booting) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  const selectedAccount = accounts.find((a) => a.id === sendingAccountId);

  // The sequence step is a 3-pane workspace (steps rail | editor | preview) and
  // needs the full content width — the other steps stay in the narrow wizard.
  const wideStep = step === 3;

  return (
    <div className={`p-6 mx-auto ${wideStep ? "max-w-[1500px]" : "max-w-4xl"}`}>
      {/* Stepper */}
      <ol className="flex items-center flex-wrap gap-y-2 mb-8" aria-label="Campaign wizard steps">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li key={label} className="flex items-center">
              <div className="flex items-center gap-2">
                <span
                  aria-current={state === "current" ? "step" : undefined}
                  className={`w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center border ${
                    state === "done"
                      ? "bg-primary text-white border-primary"
                      : state === "current"
                        ? "bg-white text-primary border-primary"
                        : "bg-white text-slate-400 border-slate-300"
                  }`}
                >
                  {n}
                </span>
                <span className={`text-xs font-medium ${state === "todo" ? "text-slate-400" : "text-slate-700"}`}>{label}</span>
              </div>
              {n < STEPS.length && <span className="mx-2 w-6 h-px bg-slate-300" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {liveNotice && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-4 py-2" role="status">
          <span>{liveNotice}</span>
          <button type="button" onClick={() => window.location.reload()}
            className="font-semibold px-2 py-1 rounded-md border border-amber-300 hover:bg-amber-100">Reload now</button>
        </div>
      )}
      {stepError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3" role="alert">{stepError}</div>
      )}
      {launchResult && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm px-4 py-3" role="status">
          Campaign launched — {launchResult.queued} email(s) queued, {launchResult.suppressed} recipient(s) suppressed. Opening the campaign…
        </div>
      )}

      {/* The sequence step is a full-width workspace — its own panes carry the
          card styling, so the wizard's white card wrapper is skipped there. */}
      {step === 3 ? (
        <SequenceBuilder
          ref={builderRef}
          campaignId={campaignId}
          sequenceId={sequenceId}
          steps={steps}
          recipients={enrolled}
          sendingAccountId={sendingAccountId || undefined}
          booted={!booting}
          onChange={setSteps}
          onSequenceIdChange={setSequenceId}
        />
      ) : (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 min-h-[320px]">
        {/* ---------------- STEP 1: DETAILS ---------------- */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Campaign details</h2>
            <Field label="Campaign name" required error={detailErrors.name}>
              <input className={inputCls(detailErrors.name)} value={name} placeholder="Q1 Pipeline Outreach"
                onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Description">
              <textarea className={inputCls()} rows={2} value={description} placeholder="What is this campaign for?"
                onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Sending account" required error={detailErrors.sendingAccountId}>
              {accounts.length === 0 ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No sending accounts yet.{" "}
                  <Link to="/settings/email-sending" className="font-medium underline">Add your SMTP server first →</Link>
                </div>
              ) : (
                <select className={inputCls(detailErrors.sendingAccountId)} value={sendingAccountId}
                  onChange={(e) => setSendingAccountId(e.target.value)}>
                  <option value="">Select an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.isEnabled}>
                      {a.name} — {a.fromEmail}{!a.isEnabled ? " (disabled)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Timezone" required error={detailErrors.timezone}>
              <select className={inputCls()} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* ---------------- STEP 2: AUDIENCE (table-first, reusable workflows) ---------------- */}
        {step === 2 && campaignId && (
          <AudienceStep
            campaignId={campaignId}
            counts={counts}
            enrolled={enrolled}
            onCountsChanged={() => { void refreshAudience(campaignId); }}
          />
        )}
        {step === 2 && !campaignId && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Fill in the campaign details (step 1) to start building your audience.
          </div>
        )}

        {/* ---------------- STEP 3: SEQUENCE (visual builder) ---------------- */}
        {/* Rendered full-width above; the white card wrapper is skipped. */}

        {/* ---------------- STEP 4: PERSONALIZATION ---------------- */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">AI personalization</h2>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)}
                className="w-4 h-4 accent-[rgb(var(--primary))]" />
              Enable AI personalization
            </label>
            {aiEnabled && (
              <Field label="Personalization depth">
                <select className={inputCls()} value={aiDepth} onChange={(e) => setAiDepth(e.target.value)}>
                  <option value="light">Light — greeting only</option>
                  <option value="standard">Standard — opening line</option>
                  <option value="deep">Deep — opening paragraph</option>
                </select>
              </Field>
            )}
            <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
              The AI may only use verified recipient data (name, company, job title, email). It never invents company facts, funding, customers or achievements. If data is missing, the template stays close to the original.
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={generatePreview} disabled={previewBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
                {previewBusy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                Template preview
              </button>
              {aiEnabled && (
                <button type="button" onClick={generateAi} disabled={aiBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50">
                  {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Generate AI version
                </button>
              )}
            </div>

            {aiError && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">{aiError}</p>
            )}
            {preview && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-400 uppercase font-medium mb-1">Template preview (real substitution)</div>
                <div className="text-sm font-medium text-slate-800">{preview.subject}</div>
                <pre className="whitespace-pre-wrap text-sm text-slate-700 mt-1 font-sans">{preview.text}</pre>
              </div>
            )}
            {aiText && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                <div className="text-xs text-violet-500 uppercase font-medium mb-1">AI version</div>
                <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans">{aiText}</pre>
                <button type="button" onClick={acceptAi} disabled={isSaving}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                  <CheckCircle2 size={13} /> Accept into Email 1
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------------- STEP 5: SCHEDULE ---------------- */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Schedule</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Start date & time" >
                <input type="datetime-local" className={inputCls()} value={startAt}
                  onChange={(e) => setStartAt(e.target.value)} />
              </Field>
              <Field label="Timezone">
                <input className={inputCls()} value={timezone} disabled />
              </Field>
            </div>
            <Field label="Sending days">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const on = days.includes(d.value);
                  return (
                    <button key={d.value} type="button"
                      aria-pressed={on}
                      onClick={() => setDays((p) => on ? p.filter((x) => x !== d.value) : [...p, d.value].sort())}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
                        on ? "bg-primary text-white border-primary" : "bg-white text-slate-500 border-slate-300"
                      }`}>
                      {d.label} {on ? "✓" : ""}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Start hour (0-23)">
                <input type="number" min={0} max={23} className={inputCls()} value={startHour} onChange={(e) => setStartHour(e.target.value)} />
              </Field>
              <Field label="End hour (1-24)">
                <input type="number" min={1} max={24} className={inputCls()} value={endHour} onChange={(e) => setEndHour(e.target.value)} />
              </Field>
              <Field label="Daily limit">
                <input type="number" min={1} className={inputCls()} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
              </Field>
              <Field label="Hourly limit">
                <input type="number" min={1} className={inputCls()} value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} />
              </Field>
              <Field label="Min delay (min)">
                <input type="number" min={0} className={inputCls()} value={minDelay} onChange={(e) => setMinDelay(e.target.value)} />
              </Field>
              <Field label="Max delay (min)">
                <input type="number" min={0} className={inputCls()} value={maxDelay} onChange={(e) => setMaxDelay(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              All scheduling is enforced server-side: the send worker re-checks days, window and limits before every email.
            </p>
          </div>
        )}

        {/* ---------------- STEP 6: REVIEW ---------------- */}
        {step === 6 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Review</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="border border-slate-200 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Campaign</h3>
                <ReviewRow label="Name" value={name} />
                <ReviewRow label="Sending account" value={selectedAccount ? `${selectedAccount.name} (${selectedAccount.fromEmail})` : "—"} />
                <ReviewRow label="Timezone" value={timezone} />
              </section>
              <section className="border border-slate-200 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Leads</h3>
                <ReviewRow label="Total" value={String(counts?.total ?? enrolled.length)} />
                <ReviewRow label="Eligible" value={String(counts?.eligible ?? "—")} />
                <ReviewRow label="Suppressed" value={String(counts?.suppressed ?? "—")} />
              </section>
              <section className="border border-slate-200 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Sequence</h3>
                {steps.map((s, i) => (
                  <ReviewRow key={s.key} label={`Email ${i + 1}`} value={s.subjectTemplate || "(no subject)"} />
                ))}
              </section>
              <section className="border border-slate-200 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Schedule</h3>
                <ReviewRow label="Start" value={startAt ? new Date(startAt).toLocaleString() : "Immediately"} />
                <ReviewRow label="Days" value={days.map((d) => DAYS[d - 1]?.label).filter(Boolean).join(", ")} />
                <ReviewRow label="Window" value={`${startHour}:00 – ${endHour}:00`} />
                <ReviewRow label="Limits" value={`${dailyLimit || "—"}/day · ${hourlyLimit || "—"}/hour`} />
              </section>
            </div>

            <section className="border border-slate-200 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Compliance</h3>
              <ul className="space-y-2 text-sm">
                <ComplianceItem
                  ok={Boolean(selectedAccount && selectedAccount.isEnabled && selectedAccount.hasPassword)}
                  label="SMTP account enabled with stored credentials"
                />
                <ComplianceItem ok={Boolean(selectedAccount?.fromEmail)} label="Sender identity configured" />
                <ComplianceItem ok={(counts?.eligible ?? 0) > 0} label="At least one eligible recipient" />
                <ComplianceItem ok={(counts?.suppressed ?? 0) === 0 || true}
                  label={`${counts?.suppressed ?? 0} suppressed recipient(s) will be skipped`} neutral />
                <ComplianceItem ok label="Unsubscribe link is appended to every campaign email; unsubscribes become org-wide suppression" />
              </ul>
              <p className="text-xs text-slate-400 mt-3">
                The backend re-validates everything at launch — this checklist mirrors its checks.
              </p>
            </section>
          </div>
        )}

        {/* ---------------- STEP 7: LAUNCH ---------------- */}
        {step === 7 && (
          <div className="space-y-5 text-center py-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Rocket size={26} aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Ready to launch</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              The backend validates state, audience, SMTP account, sender identity, sequence, schedule, suppression and limits — then queues the first emails. The worker sends them inside your schedule window.
            </p>
            <button
              onClick={launch}
              disabled={launchBusy || Boolean(launchResult)}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {launchBusy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {launchBusy ? "Launching…" : "Launch Campaign"}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between mt-6">
        <button onClick={back} disabled={step === 1 || launchBusy}
          className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40">
          <ChevronLeft size={15} /> Back
        </button>
        {step < 7 ? (
          <button onClick={next} disabled={isSaving || launchBusy}
            className="inline-flex items-center gap-1 px-5 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40">
            {isSaving && <Loader2 size={14} className="animate-spin" />}
            Next <ChevronRight size={15} />
          </button>
        ) : (
          <Link to={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}
            className="text-sm text-slate-500 hover:text-slate-800">
            Save and exit
          </Link>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-red-500" aria-hidden>*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

function inputCls(error?: string) {
  return `w-full px-3 py-2 text-sm rounded-lg border bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
    error ? "border-red-300" : "border-slate-300"
  }`;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 text-right font-medium truncate max-w-[60%]" title={value}>{value}</span>
    </div>
  );
}


function ComplianceItem({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      {neutral ? (
        <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" aria-hidden />
      ) : ok ? (
        <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden />
      ) : (
        <XCircle size={15} className="text-red-600 mt-0.5 shrink-0" aria-hidden />
      )}
      <span className={ok || neutral ? "text-slate-600" : "text-red-700"}>{label}</span>
    </li>
  );
}
