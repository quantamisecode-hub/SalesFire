// Sequence Builder types (§9-§10, §24-§25, §33-§41).
// Mirrors the backend sequence API: steps hold variants; the editor round-trips
// drafts keyed by local `key`s with optional server ids.

export interface VariantDraft {
  key: string;
  /** Server id once the variant has been saved. */
  id?: string;
  variantName: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** Distribution share of recipients (%). All variants in a step total 100. */
  weight: number;
}

export interface StepDraft {
  key: string;
  /** Server id once the step has been saved. */
  id?: string;
  name: string;
  /** Fallback single-variant content (used when `variants` is empty). */
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays: number;
  delayHours: number;
  delayMinutes: number;
  /** Signature resolution (Prompt 9): inherit | custom | none. */
  signatureMode?: "inherit" | "custom" | "none";
  /** Server id of the chosen signature when signatureMode === "custom". */
  signatureId?: string | null;
  variants: VariantDraft[];
}

export type SequenceIssueCode =
  | "no_steps"
  | "variant_distribution"
  | "empty_body"
  | "empty_subject"
  | "undefined_variable"
  | "malformed_spintax"
  | "malformed_conditional";

export interface ValidationIssue {
  code: SequenceIssueCode;
  message: string;
  stepId?: string;
  variantId?: string;
  field?: "subject" | "body" | "variants" | "steps";
  variable?: string;
}

export interface ValidateResponse {
  issues: ValidationIssue[];
  ready: boolean;
  knownVariables?: string[];
}

export interface PreviewData {
  subject: string;
  html: string;
  text: string;
  unresolved: string[];
  malformed: { snippet: string; reason: string }[];
  from: { name: string; email: string };
  to: { name: string; email: string };
  isSampleRecipient: boolean;
  accountSignature: string;
}

export interface PreviewRecipient {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}

export interface SpamWarning {
  rule: string;
  message: string;
  score: number;
}

export interface SpamCheckResult {
  score: number;
  grade: "excellent" | "good" | "warning" | "poor";
  warnings: SpamWarning[];
  stats: { subjectLength: number; wordCount: number; linkCount: number; exclamationCount: number };
}

export interface GeneratedStep {
  subject: string;
  bodyHtml: string;
  delayAmount: number;
  delayUnit: "minutes" | "hours" | "days";
  stepNumber: number;
}

export interface SequenceStepPayload {
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays?: number;
  delayHours?: number;
  delayMinutes?: number;
  /** Signature resolution (Prompt 9): inherit | custom | none. */
  signatureMode?: "inherit" | "custom" | "none";
  signatureId?: string | null;
  variants?: Array<{
    variantName: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    weight: number;
    id?: string;
  }>;
}
