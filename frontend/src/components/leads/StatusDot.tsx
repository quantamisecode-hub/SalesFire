// StatusDot — Instantly-style lead status rendering: colored dot + plain text
// (replaces bordered pill badges in dense tables).
import { titleCaseStatus } from "@/components/Badge";

const DOTS: Record<string, string> = {
  // progression
  new: "bg-sky-500",
  approved: "bg-emerald-500",
  contacted: "bg-indigo-500",
  replied: "bg-violet-500",
  completed: "bg-emerald-600",
  bounced: "bg-red-500",
  unsubscribed: "bg-orange-500",
  suppressed: "bg-amber-500",
  invalid: "bg-red-500",
  skipped: "bg-slate-400",
  // interest signals (manual CRM)
  interested: "bg-violet-600",
  meeting_completed: "bg-violet-600",
  meeting_completed_not_closed: "bg-amber-500",
  won: "bg-emerald-600",
  lost: "bg-red-400",
  not_interested: "bg-slate-400",
  out_of_office: "bg-sky-400",
  wrong_person: "bg-slate-400",
  // email verification
  verified: "bg-emerald-500",
  valid: "bg-emerald-500",
  risky: "bg-amber-500",
  unknown: "bg-slate-400",
  discovered: "bg-slate-400",
  unverified: "bg-amber-500",
  syntax_valid: "bg-sky-400",
  domain_valid: "bg-sky-400",
  mx_valid: "bg-sky-400",
  // campaign recipient progression
  pending: "bg-sky-400",
  queued: "bg-blue-400",
  sending: "bg-blue-500",
  sent: "bg-blue-600",
  delivered: "bg-emerald-500",
  failed: "bg-red-500",
  // conversation status
  open: "bg-sky-400",
  needs_reply: "bg-amber-500",
  waiting_for_reply: "bg-sky-500",
  closed: "bg-slate-400",
  archived: "bg-slate-300",
  snoozed: "bg-violet-400",
};

export function StatusDot({ status }: { status: string }) {
  const key = String(status || "unknown").trim().toLowerCase();
  const dot = DOTS[key] || "bg-slate-400";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700 whitespace-nowrap">
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {titleCaseStatus(status)}
    </span>
  );
}
