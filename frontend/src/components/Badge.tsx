// Shared status badge — rectangular (rounded-md), color-coded by status.
// Text is rendered title-case (e.g. "ready_for_review" → "Ready For Review").
// Unknown statuses fall back to neutral slate rather than crashing.
import React from "react";

const TONE_BY_STATUS: Record<string, string> = {
  // campaign lifecycle
  draft: "bg-slate-100 text-slate-600 border border-slate-200",
  ready_for_review: "bg-sky-50 text-sky-700 border border-sky-200",
  scheduled: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  running: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  paused: "bg-amber-50 text-amber-700 border border-amber-200",
  completed: "bg-green-50 text-green-700 border border-green-200",
  cancelled: "bg-slate-100 text-slate-500 border border-slate-200",
  failed: "bg-red-50 text-red-700 border border-red-200",
  archived: "bg-slate-100 text-slate-500 border border-slate-200",

  // recipients / leads
  pending: "bg-sky-50 text-sky-700 border border-sky-200",
  queued: "bg-blue-50 text-blue-700 border border-blue-200",
  replied: "bg-violet-50 text-violet-700 border border-violet-200",
  bounced: "bg-red-50 text-red-700 border border-red-200",
  unsubscribed: "bg-orange-50 text-orange-700 border border-orange-200",
  suppressed: "bg-amber-50 text-amber-800 border border-amber-200",
  invalid: "bg-red-50 text-red-700 border border-red-200",
  new: "bg-sky-50 text-sky-700 border border-sky-200",
  approved: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  contacted: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  skipped: "bg-slate-100 text-slate-500 border border-slate-200",

  // email verification
  verified: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  valid: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  risky: "bg-amber-50 text-amber-700 border border-amber-200",
  unknown: "bg-slate-100 text-slate-600 border border-slate-200",
  unverified: "bg-amber-50 text-amber-700 border border-amber-200",
  not_verified: "bg-slate-100 text-slate-600 border border-slate-200",
  syntax_valid: "bg-sky-50 text-sky-700 border border-sky-200",
  domain_valid: "bg-sky-50 text-sky-700 border border-sky-200",
  mx_valid: "bg-sky-50 text-sky-700 border border-sky-200",

  // import mapping
  mapped: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  required: "bg-indigo-50 text-indigo-700 border border-indigo-200",

  // events
  sent: "bg-blue-50 text-blue-700 border border-blue-200",
  delivered: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  opened: "bg-teal-50 text-teal-700 border border-teal-200",
  clicked: "bg-cyan-50 text-cyan-700 border border-cyan-200",

  // SMTP account
  error: "bg-red-50 text-red-700 border border-red-200",
  disabled: "bg-slate-100 text-slate-600 border border-slate-200",

  // signatures / warm-up / health buckets
  org_default: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  excellent: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  good: "bg-lime-50 text-lime-800 border border-lime-200",
  at_risk: "bg-amber-50 text-amber-700 border border-amber-200",
  poor: "bg-red-50 text-red-700 border border-red-200",
  not_enough_data: "bg-slate-100 text-slate-600 border border-slate-200",
  healthy: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border border-amber-200",
  critical: "bg-red-50 text-red-700 border border-red-200",
  warming: "bg-sky-50 text-sky-700 border border-sky-200",
  not_started: "bg-slate-100 text-slate-600 border border-slate-200",
};

// Events sometimes arrive upper-case (SENT, BOUNCED) — normalize before lookup.
function keyOf(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/** "ready_for_review" → "Ready For Review" */
export function titleCaseStatus(value: string): string {
  return keyOf(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusTone(value: string): string {
  return TONE_BY_STATUS[keyOf(value)] || "bg-slate-100 text-slate-600 border border-slate-200";
}

export function Badge({
  status,
  className = "",
  title,
  children,
}: {
  status: string;
  className?: string;
  title?: string;
  /** Optional leading icon node. */
  children?: React.ReactNode;
}) {
  const label = titleCaseStatus(status);
  const base =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";
  return (
    <span className={`${base} ${statusTone(status)} ${className}`} title={title}>
      {children}
      {label}
    </span>
  );
}
