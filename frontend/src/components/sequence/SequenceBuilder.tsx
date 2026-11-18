// SequenceBuilder — the 3-pane visual sequence editor (§6-§41).
//
//   Steps rail | Step editor (variants, delay, rich body) | Preview + validation
//
// * Autosave: 1.5s debounced create/update against the sequence API. The save
//   indicator is TRUTHFUL: "Saving…" while in flight, "Saved Ns ago" only after
//   the API confirms, "Save failed …" with the server's real error otherwise.
//   A save is held (never silently dropped) when a variant distribution does
//   not total 100% — the API would reject it with 422.
// * Validation: GET /validate issues render in a click-to-field panel; the
//   wizard's Next button blocks while blocking issues exist (§39-§41).
// * AI: generation is a real server call; results apply only via explicit
//   Accept; a missing AI key surfaces the backend's honest 501 message.
// * Unsaved-changes guard: beforeunload + Cmd/Ctrl+S manual save.
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import {
  Plus, Trash2, ArrowUp, ArrowDown, Loader2, Send, Save, CloudUpload, CloudOff,
  AlertCircle, AlertTriangle, Sparkles, Users, ChevronRight,
} from "lucide-react";
import { RichEmailEditor, type RichEmailEditorHandle } from "./RichEmailEditor";
import { PreviewPanel } from "./PreviewPanel";
import { SpamCheckPanel } from "./SpamCheckPanel";
import { SendTestModal } from "./SendTestModal";
import { ValidationPanel } from "./ValidationPanel";
import { AISequenceModal } from "./AISequenceModal";
import { AIStepModal } from "./AIStepModal";
import { sequenceService } from "@/services/sequence";
import { joinCampaign, leaveCampaign, onSequenceSaved, requestValidate } from "@/socket";
import { signatureService, type EmailSignature } from "@/services/signature";
import type {
  StepDraft, VariantDraft, ValidationIssue, PreviewRecipient, GeneratedStep, SequenceStepPayload,
} from "@/types/sequence";

export type SequenceBuilderHandle = {
  /** Flush pending changes, validate; true when the sequence is launch-clean. */
  save: () => Promise<boolean>;
};

type SequenceBuilderProps = {
  campaignId: string | null;
  sequenceId: string | null;
  steps: StepDraft[];
  recipients: PreviewRecipient[];
  sendingAccountId?: string;
  booted: boolean;
  onChange: (steps: StepDraft[]) => void;
  onSequenceIdChange: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const newKey = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export const newStepDraft = (): StepDraft => ({
  key: newKey(),
  name: "",
  subjectTemplate: "",
  bodyTemplate: "",
  delayDays: 2,
  delayHours: 0,
  delayMinutes: 0,
  signatureMode: "inherit",
  signatureId: null,
  variants: [],
});

export const newVariantDraft = (v?: Partial<VariantDraft>): VariantDraft => ({
  key: newKey(),
  variantName: "",
  subject: "",
  bodyHtml: "",
  bodyText: "",
  weight: 0,
  ...v,
});

/**
 * Effective subject/body of a step: variant content when the step uses A/B
 * variants, otherwise the base step templates. Null when there is no step.
 */
const stepContent = (step?: StepDraft): { subject: string; bodyHtml: string } | null => {
  if (!step) return null;
  const source = step.variants?.length ? step.variants[0] : step;
  return {
    subject: (source as { subject?: string; subjectTemplate?: string }).subject ?? (source as { subjectTemplate?: string }).subjectTemplate ?? "",
    bodyHtml: (source as { bodyHtml?: string; bodyTemplate?: string }).bodyHtml ?? (source as { bodyTemplate?: string }).bodyTemplate ?? "",
  };
};

/** Redistribute weights equally, forcing the exact total of 100. */
export function redistribute(variants: VariantDraft[]): VariantDraft[] {
  if (!variants.length) return variants;
  const base = Math.floor(100 / variants.length);
  const next = variants.map((v, i) => ({ ...v, weight: i === variants.length - 1 ? 100 - base * (variants.length - 1) : base }));
  return next;
}

export function serialize(steps: StepDraft[]): string {
  return JSON.stringify(steps);
}

/** Drafts → API payload. Exported for the wizard's step-4 AI-accept path. */
export function buildSequencePayload(steps: StepDraft[]): SequenceStepPayload[] {
  return steps.map((s, i) => ({
    name: s.name || `Email ${i + 1}`,
    subjectTemplate: s.subjectTemplate,
    bodyTemplate: s.bodyTemplate,
    delayDays: i === 0 ? 0 : Number(s.delayDays) || 0,
    delayHours: i === 0 ? 0 : Number(s.delayHours) || 0,
    delayMinutes: i === 0 ? 0 : Number(s.delayMinutes) || 0,
    signatureMode: s.signatureMode ?? "inherit",
    signatureId: s.signatureMode === "custom" ? s.signatureId ?? null : null,
    variants: s.variants.length
      ? s.variants.map((v) => ({
          variantName: v.variantName || "Variant",
          subject: v.subject,
          bodyHtml: v.bodyHtml,
          bodyText: v.bodyText,
          weight: Number(v.weight) || 0,
        }))
      : undefined,
  }));
}

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; at: number }
  | { state: "error"; message: string }
  | { state: "held"; message: string };

export const SequenceBuilder = forwardRef<SequenceBuilderHandle, SequenceBuilderProps>(
  function SequenceBuilder(
    { campaignId, sequenceId, steps, recipients, sendingAccountId, booted, onChange, onSequenceIdChange, onDirtyChange },
    ref,
  ) {
    const [selectedStep, setSelectedStep] = useState(0);
    const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
    // Live sync: shows a banner when ANOTHER session saves this sequence
    // (own autosaves echo back tagged with our X-Client-Id and are ignored).
    const [remoteSave, setRemoteSave] = useState(false);
    const [issues, setIssues] = useState<ValidationIssue[]>([]);
    const [knownVariables, setKnownVariables] = useState<string[]>([]);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
    const [showTestModal, setShowTestModal] = useState(false);
    const [showAI, setShowAI] = useState(false);
    const [rewriteStepIndex, setRewriteStepIndex] = useState<number | null>(null);
    const [, forceTick] = useState(0);
    // Org signatures for the per-step override picker (Prompt 9).
    const [orgSignatures, setOrgSignatures] = useState<EmailSignature[]>([]);

    const lastSavedSnapshot = useRef<string | null>(null);
    const dirtyRef = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const stepsRef = useRef(steps);
    stepsRef.current = steps;
    const seqIdRef = useRef(sequenceId);
    seqIdRef.current = sequenceId;

    const editorHandles = useRef(new Map<string, RichEmailEditorHandle | null>());
    const stepCardRefs = useRef(new Map<string, HTMLDivElement | null>());
    const distributionRef = useRef<HTMLDivElement | null>(null);

    const current = steps[Math.min(selectedStep, steps.length - 1)];
    const currentVariant = current?.variants.find((v) => v.key === selectedVariant) || null;

    // Keep the active variant valid: with nothing selected the editor binds
    // to the STEP body while Variant A shows its (different) content — the
    // two divergent bodies look exactly like "content disappears". Adopt the
    // first variant whenever the step has them and no valid pick exists.
    useEffect(() => {
      if (!current) return;
      if (selectedVariant && current.variants.some((v) => v.key === selectedVariant)) return;
      setSelectedVariant(current.variants[0]?.key ?? null);
    }, [selectedStep, current?.key, current?.variants?.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load org signatures for the per-step signature picker (Prompt 9).
    useEffect(() => {
      let alive = true;
      signatureService.list()
        .then((res) => { if (alive) setOrgSignatures(res.data || []); })
        .catch(() => { /* picker stays empty — INHERIT/NONE still work */ });
      return () => { alive = false; };
    }, []);

    // --------------------------------------------------------------------
    // Persistence
    // --------------------------------------------------------------------
    const persist = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
      const cid = campaignId;
      if (!cid) return false;
      if (savingRef.current) return false;
      const snapshotSteps = stepsRef.current;

      // Hold autosave while a variant distribution is invalid — the API would
      // 422; the indicator explains what the user has to fix. (Explicit saves
      // surface it in the validation panel.)
      const badDist = snapshotSteps.find((s) => {
        if (!s.variants.length) return false;
        return s.variants.reduce((sum, v) => sum + (Number(v.weight) || 0), 0) !== 100;
      });
      if (badDist) {
        if (!opts?.silent) {
          setSaveStatus({ state: "held", message: "Variant distribution must total exactly 100% before this can be saved." });
        }
        return false;
      }

      savingRef.current = true;
      if (!opts?.silent) setSaveStatus({ state: "saving" });
      try {
        const payload = { name: "Outreach v1", steps: buildSequencePayload(snapshotSteps) };
        let saved: any;
        if (seqIdRef.current) {
          saved = await sequenceService.updateSequence(cid, seqIdRef.current, payload);
        } else {
          saved = await sequenceService.createSequence(cid, payload);
          const newId = saved?.data?.id as string;
          seqIdRef.current = newId;
          onSequenceIdChange(newId);
        }
        // Sync server-assigned ids into the drafts (steps and variants are
        // recreated server-side on every save, so the editor must re-map
        // them to keep preview/test-email calls addressable).
        // IMPORTANT: `key` stays stable for UI identity (variant selection,
        // React keys) — rewriting it would detach the open editor from the
        // active draft and make saved content look deleted.
        const savedSteps = (saved?.data?.steps || []) as any[];
        const remapped = snapshotSteps.map((d, i) => {
          const sv = savedSteps[i];
          if (!sv) return d;
          // Variants come back as full objects (legacy callers may get ids).
          const variantIds: string[] = (sv.variants || [])
            .map((v: any) => (typeof v === "string" ? v : v?.id))
            .filter(Boolean);
          return {
            ...d,
            id: sv.id,
            variants: d.variants.map((v, vi) => ({
              ...v,
              id: variantIds[vi] || v.id,
            })),
          };
        });
        lastSavedSnapshot.current = serialize(remapped);
        dirtyRef.current = false;
        onDirtyChange?.(false);
        if (remapped.some((s, i) => s !== snapshotSteps[i])) onChange(remapped);
        setSaveStatus({ state: "saved", at: Date.now() });

        // Refresh the validation panel after every confirmed save.
        sequenceService.validate(cid).then((v) => {
          setIssues(v.issues || []);
          if (v.knownVariables) setKnownVariables(v.knownVariables);
        }).catch(() => { /* panel keeps the last state */ });
        return true;
      } catch (err: any) {
        setSaveStatus({ state: "error", message: err?.data?.error || "Save failed — check your connection and try again." });
        return false;
      } finally {
        savingRef.current = false;
      }
    }, [campaignId, onChange, onSequenceIdChange, onDirtyChange]);

    // Live validation (§39-§41): stream the draft over Socket.io so the
    // panel flags undefined variables / malformed spintax mid-typing — no
    // save needed. The HTTP validate-after-save stays the backstop.
    const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const validateReq = useRef(0);
    useEffect(() => {
      if (!booted || !campaignId) return;
      if (validateTimer.current) clearTimeout(validateTimer.current);
      validateTimer.current = setTimeout(() => {
        const reqId = ++validateReq.current;
        // buildSequencePayload writes unnamed-steps-as-names just like saves do.
        requestValidate({ campaignId, draft: { steps: buildSequencePayload(steps) }, requestId: reqId })
          .then((res) => {
            if (validateReq.current !== reqId) return;
            if (res?.ok) {
              setIssues((res.issues || []) as ValidationIssue[]);
              if (res.knownVariables) setKnownVariables(res.knownVariables);
            }
          })
          .catch(() => { /* HTTP validate after save remains authoritative */ });
      }, 400);
      return () => { if (validateTimer.current) clearTimeout(validateTimer.current); };
    }, [steps, booted, campaignId]);

    // Live sync: join the campaign room so another session saving this
    // sequence surfaces a banner instead of silently diverging. Events from
    // this tab are tagged with our X-Client-Id and filtered out (socket.ts).
    useEffect(() => {
      if (!campaignId) return;
      let alive = true;
      joinCampaign(campaignId).catch(() => { /* HTTP remains the fallback */ });
      const off = onSequenceSaved((e) => {
        if (!alive || e.campaignId !== campaignId) return;
        setRemoteSave(true);
      });
      return () => { alive = false; off(); leaveCampaign(campaignId); };
    }, [campaignId]);

    // Debounced autosave: any content change 1.5s after the last keystroke.
    useEffect(() => {
      if (!booted) return;
      if (lastSavedSnapshot.current === null) {
        lastSavedSnapshot.current = serialize(steps);
        return;
      }
      const snapshot = serialize(steps);
      const dirty = snapshot !== lastSavedSnapshot.current;
      dirtyRef.current = dirty;
      onDirtyChange?.(dirty);
      if (!dirty || !campaignId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void persist(); }, 1500);
      return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [steps, booted, campaignId, persist, onDirtyChange]);

    // Initial validation (also loads the org's known variables for the picker).
    useEffect(() => {
      if (!campaignId) return;
      sequenceService.validate(campaignId).then((v) => {
        setIssues(v.issues || []);
        if (v.knownVariables) setKnownVariables(v.knownVariables);
      }).catch(() => { /* empty panel until next save */ });
    }, [campaignId]);

    // "Saved Ns ago" ticker.
    useEffect(() => {
      if (saveStatus.state !== "saved") return;
      const t = setInterval(() => forceTick((x) => x + 1), 5000);
      return () => clearInterval(t);
    }, [saveStatus.state]);

    // Unsaved-changes browser guard + Cmd/Ctrl+S.
    useEffect(() => {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
      };
      const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void persist();
        }
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("beforeunload", onBeforeUnload);
        window.removeEventListener("keydown", onKey);
      };
    }, [persist]);

    // Wizard Next: flush + gate on blocking validation issues (§39-§41).
    useImperativeHandle(ref, () => ({
      save: async (): Promise<boolean> => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        const ok = await persist();
        if (!ok) return false;
        try {
          if (campaignId) {
            const v = await sequenceService.validate(campaignId);
            setIssues(v.issues || []);
            if (v.knownVariables) setKnownVariables(v.knownVariables);
            return (v.issues || []).length === 0;
          }
        } catch { /* server validation unreachable — don't block on it twice */ }
        return true;
      },
    }));

    // --------------------------------------------------------------------
    // Step / variant operations
    // --------------------------------------------------------------------
    const updateStep = (key: string, patch: Partial<StepDraft>) => {
      onChange(stepsRef.current.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    };
    const updateVariant = (stepKey: string, variantKey: string, patch: Partial<VariantDraft>) => {
      onChange(stepsRef.current.map((s) => (s.key !== stepKey ? s : {
        ...s,
        variants: s.variants.map((v) => (v.key === variantKey ? { ...v, ...patch } : v)),
      })));
    };

    const addStep = () => {
      const next = [...stepsRef.current, newStepDraft()];
      onChange(next);
      setSelectedStep(next.length - 1);
      setSelectedVariant(null);
    };

    const removeStep = (idx: number) => {
      if (stepsRef.current.length === 1) return;
      onChange(stepsRef.current.filter((_, i) => i !== idx));
      setSelectedStep((prev) => Math.max(0, Math.min(prev, stepsRef.current.length - 2)));
      setSelectedVariant(null);
    };

    const moveStep = (idx: number, dir: -1 | 1) => {
      const next = [...stepsRef.current];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return;
      [next[idx], next[target]] = [next[target], next[idx]];
      onChange(next);
      setSelectedStep(target);
    };

    const startVariants = (stepKey: string) => {
      const s = stepsRef.current.find((x) => x.key === stepKey);
      if (!s) return;
      const a = newVariantDraft({
        variantName: "Variant A",
        subject: s.subjectTemplate,
        bodyHtml: s.bodyTemplate,
        weight: 100,
      });
      updateStep(stepKey, { variants: [a] });
      setSelectedVariant(a.key);
    };

    const addVariant = (stepKey: string) => {
      const s = stepsRef.current.find((x) => x.key === stepKey);
      if (!s) return;
      const base = s.variants.length ? s.variants : [newVariantDraft({
        variantName: "Variant A",
        subject: s.subjectTemplate,
        bodyHtml: s.bodyTemplate,
        weight: 100,
      })];
      const added = newVariantDraft({ variantName: `Variant ${String.fromCharCode(65 + base.length)}` });
      // Keep the total at 100 on every structural change so saves stay valid.
      const next = redistribute([...base, added]);
      updateStep(stepKey, { variants: next });
      setSelectedVariant(added.key);
    };

    const removeVariant = (stepKey: string, variantKey: string) => {
      const s = stepsRef.current.find((x) => x.key === stepKey);
      if (!s) return;
      const next = s.variants.filter((v) => v.key !== variantKey);
      updateStep(stepKey, {
        variants: next.length ? redistribute(next) : [],
        // Dropping back to a single variant restores it as the step content.
        subjectTemplate: next.length === 1 ? next[0].subject : s.subjectTemplate,
        bodyTemplate: next.length === 1 ? next[0].bodyHtml : s.bodyTemplate,
      });
      setSelectedVariant(null);
    };

    const acceptAISequence = (generated: GeneratedStep[], mode: "replace" | "append") => {
      const mapped: StepDraft[] = generated.map((g, i) => ({
        ...newStepDraft(),
        name: `AI Email ${i + 1}`,
        subjectTemplate: g.subject || "",
        bodyTemplate: g.bodyHtml || "",
        delayDays: g.delayUnit === "days" ? Math.max(1, g.delayAmount) : 0,
        delayHours: g.delayUnit === "hours" ? Math.max(1, g.delayAmount) : 0,
        delayMinutes: g.delayUnit === "minutes" ? Math.max(1, g.delayAmount) : 0,
        key: newKey(),
      }));
      if (mode === "append") {
        onChange([...stepsRef.current, ...mapped]);
        setSelectedStep(stepsRef.current.length);
      } else {
        onChange(mapped);
        setSelectedStep(0);
      }
      setSelectedVariant(null);
      setShowAI(false);
    };

    // Single-step rewrite: replace ONLY that step, leaving every other step,
    // its variants, delay and identity exactly as they are.
    const acceptRewriteStep = (subject: string, bodyHtml: string) => {
      const idx = rewriteStepIndex ?? selectedStep;
      onChange(stepsRef.current.map((s, i) => {
        if (i !== idx) return s;
        const hasVariants = s.variants.length > 0;
        return {
          ...s,
          subjectTemplate: subject,
          bodyTemplate: bodyHtml,
          // Keep variants in sync with the base step so the save/validate
          // pipeline stays consistent (A/B variants may diverge later).
          variants: hasVariants
            ? s.variants.map((v, vi) => (vi === 0 ? { ...v, subject, bodyHtml } : v))
            : s.variants,
        };
      }));
      setRewriteStepIndex(null);
    };

    const jumpToIssue = (issue: ValidationIssue) => {
      const stepIdx = issue.stepId
        ? stepsRef.current.findIndex((s) => s.id === issue.stepId || s.key === issue.stepId)
        : selectedStep;
      if (stepIdx >= 0) setSelectedStep(stepIdx);
      const step = stepsRef.current[stepIdx] || current;
      if (!step) return;
      requestAnimationFrame(() => {
        stepCardRefs.current.get(step.key)?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (issue.code === "variant_distribution") {
          distributionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          distributionRef.current?.classList.add("ring-2", "ring-amber-400");
          setTimeout(() => distributionRef.current?.classList.remove("ring-2", "ring-amber-400"), 1600);
          return;
        }
        const variantKey = issue.variantId
          ? (step.variants.find((v) => v.id === issue.variantId)?.key ?? selectedVariant)
          : selectedVariant;
        const handle = editorHandles.current.get(`${step.key}:${variantKey || "_"}`);
        if (!handle) return;
        if (issue.field === "subject") handle.focusSubject();
        else handle.focusBody();
      });
    };

    const delaySummary = (s: StepDraft, idx: number) => {
      if (idx === 0) return "Sends at launch";
      const parts: string[] = [];
      if (s.delayDays) parts.push(`${s.delayDays}d`);
      if (s.delayHours) parts.push(`${s.delayHours}h`);
      if (s.delayMinutes) parts.push(`${s.delayMinutes}m`);
      return parts.length ? `after ${parts.join(" ")}` : "immediately";
    };

    const totalWords = useMemo(() => {
      const s = current;
      if (!s) return 0;
      const html = s.variants.length ? (currentVariant?.bodyHtml ?? s.variants[0]?.bodyHtml ?? "") : s.bodyTemplate;
      return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    }, [current, currentVariant]);

    if (!current) return null;

    const weightTotal = current.variants.reduce((sum, v) => sum + (Number(v.weight) || 0), 0);

    const SaveIndicator = () => {
      switch (saveStatus.state) {
        case "saving":
          return <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Saving…</span>;
        case "saved": {
          const ago = Math.max(0, Math.round((Date.now() - saveStatus.at) / 1000));
          return <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600" role="status"><Save size={12} /> {ago < 5 ? "Saved just now" : `Saved ${ago}s ago`}</span>;
        }
        case "held":
          return <span className="inline-flex items-center gap-1.5 text-xs text-amber-600" role="status"><AlertCircle size={12} /> Not saved — {saveStatus.message}</span>;
        case "error":
          return <span className="inline-flex items-center gap-1.5 text-xs text-red-600" role="alert"><CloudOff size={12} /> {saveStatus.message}</span>;
        default:
          return dirtyRef.current
            ? <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><CloudUpload size={12} /> Unsaved changes</span>
            : <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><CloudUpload size={12} /> All changes saved</span>;
      }
    };

    return (
      <div className="space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Email sequence</h2>
            <p className="text-xs text-slate-500">
              Variables insert real lead data; spintax picks one option per recipient; follow-ups can leave the subject empty to continue the thread.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SaveIndicator />
            <button type="button" onClick={() => setShowAI(true)} disabled={!campaignId}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50">
              <Sparkles size={13} /> Generate with AI
            </button>
          </div>
        </div>

        <ValidationPanel issues={issues} onJump={jumpToIssue} />

        {/* 3-pane workspace: steps rail | editor | preview. Falls back to a
            single column below `lg` so the editor stays usable on tablets. */}
        <div className="grid grid-cols-1 lg:grid-cols-[210px,minmax(0,1fr),320px] 2xl:grid-cols-[250px,minmax(0,1fr),400px] gap-4">
          {/* Steps rail */}
          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <button key={s.key} type="button"
                onClick={() => { setSelectedStep(i); setSelectedVariant(s.variants[0]?.key ?? null); }}
                className={`w-full text-left px-3 py-2 rounded-xl border text-sm transition-colors ${
                  i === selectedStep ? "border-violet-300 bg-violet-50 text-violet-900" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                }`}>
                <span className="font-medium block truncate">{s.name || `Email ${i + 1}`}</span>
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  {delaySummary(s, i)}
                  {s.variants.length > 1 && <ChevronRight size={10} aria-hidden />} {s.variants.length > 1 && `${s.variants.length} variants`}
                </span>
              </button>
            ))}
            <button type="button" onClick={addStep}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50">
              <Plus size={14} /> Add Email
            </button>
            <p className="text-[11px] text-slate-400 px-1 pt-1 flex items-start gap-1">
              <Users size={11} className="mt-0.5 shrink-0" />
              {recipients.length
                ? `Preview renders with your ${recipients.length} enrolled recipient${recipients.length > 1 ? "s" : ""}.`
                : "No recipients yet — the preview uses labeled sample data."}
            </p>
          </div>

          {/* Step editor */}
          <div ref={(el) => { stepCardRefs.current.set(current.key, el); }}
            className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <input value={current.name} onChange={(e) => updateStep(current.key, { name: e.target.value })}
                placeholder={`Email ${selectedStep + 1} name`} aria-label="Step name"
                className="text-sm font-semibold text-slate-800 border-0 p-0 focus:ring-0 placeholder:text-slate-300 max-w-[240px]" />
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Rewrite this email with AI" title="Rewrite this email with AI — the rest of the sequence stays untouched" onClick={() => setRewriteStepIndex(selectedStep)}
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 rounded-lg"><Sparkles size={12} /> AI</button>
                <button type="button" aria-label="Move up" disabled={selectedStep === 0} onClick={() => moveStep(selectedStep, -1)}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ArrowUp size={14} /></button>
                <button type="button" aria-label="Move down" disabled={selectedStep === steps.length - 1} onClick={() => moveStep(selectedStep, 1)}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ArrowDown size={14} /></button>
                <button type="button" aria-label="Delete email" disabled={steps.length === 1} onClick={() => removeStep(selectedStep)}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30"><Trash2 size={14} /></button>
              </div>
            </div>

            {/* Wait / delay + signature mode (Prompt 9) */}
            <div ref={distributionRef} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-slate-500 uppercase tracking-wide">
                {selectedStep === 0 ? "Sends at launch" : "Wait before sending"}
              </span>
              {selectedStep > 0 && (
                <>
                  <input type="number" min={0} max={60} value={current.delayDays} aria-label="Delay days"
                    onChange={(e) => updateStep(current.key, { delayDays: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-14 border border-slate-200 rounded-md px-2 py-1" />
                  <span className="text-slate-400">days</span>
                  <input type="number" min={0} max={23} value={current.delayHours} aria-label="Delay hours"
                    onChange={(e) => updateStep(current.key, { delayHours: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-14 border border-slate-200 rounded-md px-2 py-1" />
                  <span className="text-slate-400">hours</span>
                  <input type="number" min={0} max={59} value={current.delayMinutes} aria-label="Delay minutes"
                    onChange={(e) => updateStep(current.key, { delayMinutes: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-14 border border-slate-200 rounded-md px-2 py-1" />
                  <span className="text-slate-400">minutes</span>
                </>
              )}
              <span className="font-medium text-slate-500 uppercase tracking-wide">Signature</span>
              <select
                value={current.signatureMode || "inherit"}
                aria-label="Step signature"
                onChange={(e) => updateStep(current.key, {
                  signatureMode: e.target.value as StepDraft["signatureMode"],
                  signatureId: e.target.value === "custom" ? current.signatureId ?? null : null,
                })}
                className="border border-slate-200 rounded-md px-2 py-1 bg-white text-xs text-slate-700"
              >
                <option value="inherit">Inherit (campaign / account / org)</option>
                <option value="custom">Custom…</option>
                <option value="none">No signature</option>
              </select>
              {current.signatureMode === "custom" && (
                <select
                  value={current.signatureId ?? ""}
                  aria-label="Choose Signature"
                  onChange={(e) => updateStep(current.key, { signatureId: e.target.value || null })}
                  className={`border rounded-md px-2 py-1 bg-white text-xs ${current.signatureId ? "border-violet-200 text-violet-800" : "border-amber-300 text-amber-800"}`}
                >
                  <option value="">Choose Signature</option>
                  {orgSignatures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {current.signatureMode === "custom" && !current.signatureId && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700" role="note">
                  <AlertTriangle size={11} aria-hidden /> Pick a signature — nothing is attached until you choose one
                </span>
              )}
            </div>

            {/* Variant tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {current.variants.length === 0 ? (
                <button type="button" onClick={() => startVariants(current.key)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <span className="inline-flex items-center gap-1.5"><Plus size={12} /> Add A/B variant</span>
                </button>
              ) : (
                <>
                  {current.variants.map((v, vi) => (
                    <button key={v.key} type="button"
                      onClick={() => setSelectedVariant(v.key)}
                      aria-pressed={(currentVariant?.key || current.variants[0].key) === v.key}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
                        (currentVariant?.key || current.variants[0].key) === v.key
                          ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}>
                      {v.variantName || `Variant ${String.fromCharCode(65 + vi)}`} · {v.weight}%
                    </button>
                  ))}
                  {current.variants.length < 4 && (
                    <button type="button" onClick={() => addVariant(current.key)} aria-label="Add variant"
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Plus size={12} /></button>
                  )}
                  {currentVariant && current.variants.length > 1 && (
                    <button type="button" onClick={() => removeVariant(current.key, currentVariant.key)}
                      className="p-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50" aria-label="Remove this variant"><Trash2 size={12} /></button>
                  )}
                  <span className={`text-xs ml-1 ${weightTotal === 100 ? "text-slate-400" : "text-red-600 font-medium"}`}>
                    distribution {weightTotal}% {weightTotal !== 100 && "— must total exactly 100%"}
                  </span>
                </>
              )}
            </div>

            {/* Weight sliders for the selected variant */}
            {current.variants.length > 0 && currentVariant && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 flex items-center gap-3">
                <label className="text-xs text-slate-500 whitespace-nowrap" htmlFor="variant-weight">
                  {currentVariant.variantName || "Variant"} weight (%)
                </label>
                <input id="variant-weight" type="range" min={0} max={100} value={currentVariant.weight}
                  onChange={(e) => updateVariant(current.key, currentVariant.key, { weight: Number(e.target.value) })}
                  className="flex-1 accent-violet-600" />
                <input type="number" min={0} max={100} value={currentVariant.weight}
                  onChange={(e) => updateVariant(current.key, currentVariant.key, { weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  aria-label="Variant weight percent"
                  className="w-14 border border-slate-200 rounded-md px-2 py-1 text-xs" />
              </div>
            )}

            {/* Subject + body (variant-aware) */}
            {currentVariant ? (
              <RichEmailEditor
                key={currentVariant.key}
                ref={(el) => { editorHandles.current.set(`${current.key}:${currentVariant.key}`, el); }}
                subject={currentVariant.subject}
                onSubjectChange={(v) => updateVariant(current.key, currentVariant.key, { subject: v })}
                bodyHtml={currentVariant.bodyHtml}
                onBodyChange={(v) => updateVariant(current.key, currentVariant.key, { bodyHtml: v })}
                knownVariables={knownVariables}
                campaignId={campaignId}
                onSpamCheck={() => document.getElementById("spam-check-anchor")?.scrollIntoView({ behavior: "smooth" })}
              />
            ) : (
              <RichEmailEditor
                key={current.key}
                ref={(el) => { editorHandles.current.set(`${current.key}:_`, el); }}
                subject={current.subjectTemplate}
                onSubjectChange={(v) => updateStep(current.key, { subjectTemplate: v })}
                bodyHtml={current.bodyTemplate}
                onBodyChange={(v) => updateStep(current.key, { bodyTemplate: v })}
                knownVariables={knownVariables}
                campaignId={campaignId}
                onSpamCheck={() => document.getElementById("spam-check-anchor")?.scrollIntoView({ behavior: "smooth" })}
              />
            )}

            <div className="flex items-center justify-between flex-wrap gap-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2 min-w-0 w-full">
                <button type="button" onClick={() => setShowTestModal(true)}
                  disabled={!campaignId || !((currentVariant ? currentVariant.bodyHtml : current.bodyTemplate) || (currentVariant ? currentVariant.bodyText : current.bodyTemplate))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
                  <Send size={12} /> Send test email
                </button>
                <SpamCheckPanel campaignId={campaignId}
                  getSubject={() => (currentVariant ? currentVariant.subject : current.subjectTemplate)}
                  getBodyHtml={() => (currentVariant ? currentVariant.bodyHtml : current.bodyTemplate)} />
              </div>
              <span className="text-[11px] text-slate-400 whitespace-nowrap">{totalWords} words · autosaves 1.5s after you stop typing · ⌘S to save now</span>
            </div>
          </div>

          {/* Preview + notes */}
          <div className="space-y-3" id="spam-check-anchor">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Live preview</h3>
                {remoteSave && (
                  <button type="button" onClick={() => window.location.reload()}
                    className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 hover:bg-amber-100">
                    Updated in another session — Reload
                  </button>
                )}
              </div>
              <PreviewPanel campaignId={campaignId} stepId={current.id || null}
                variantId={currentVariant?.id || null}
                recipients={recipients} sendingAccountId={sendingAccountId}
                hasSpintax={/\{\{\s*RANDOM/i.test(`${currentVariant ? currentVariant.subject : current.subjectTemplate} ${currentVariant ? currentVariant.bodyHtml : current.bodyTemplate}`)}
                draft={{
                  stepId: current.id || null,
                  sequenceId: sequenceId ?? null,
                  stepOrder: selectedStep,
                  subject: currentVariant ? currentVariant.subject : current.subjectTemplate,
                  bodyHtml: currentVariant ? currentVariant.bodyHtml : current.bodyTemplate,
                  prevSubject: selectedStep > 0
                    ? ((steps[selectedStep - 1]?.variants?.[0]?.subject) || steps[selectedStep - 1]?.subjectTemplate || null)
                    : null,
                  variants: currentVariant ? current.variants : [],
                  activeVariantIndex: currentVariant ? Math.max(0, current.variants.findIndex((v) => v.key === selectedVariant)) : -1,
                  signatureMode: (current.signatureMode || "inherit") as "inherit" | "custom" | "none",
                  signatureId: current.signatureMode === "custom" ? (current.signatureId ?? null) : null,
                }} />
            </div>
          </div>
        </div>

        {showTestModal && (
          <SendTestModal campaignId={campaignId} stepId={current.id || null} variantId={currentVariant?.id || null}
            defaultRecipient={recipients[0]?.email} sendingAccountId={sendingAccountId}
            onClose={() => setShowTestModal(false)} />
        )}
        {showAI && (
          <AISequenceModal campaignId={campaignId} hasExistingSteps={steps.length > 0}
            onAccept={acceptAISequence} onClose={() => setShowAI(false)} />
        )}
        {rewriteStepIndex !== null && (
          <AIStepModal campaignId={campaignId}
            stepNumber={rewriteStepIndex + 1} totalSteps={steps.length}
            current={stepContent(steps[rewriteStepIndex])!}
            previous={stepContent(steps[rewriteStepIndex - 1])}
            next={stepContent(steps[rewriteStepIndex + 1])}
            onAccept={acceptRewriteStep}
            onClose={() => setRewriteStepIndex(null)} />
        )}
      </div>
    );
  },
);
