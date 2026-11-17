// ValidationPanel — structured sequence issues (§39-§41) with click-to-field.
// Every issue carries {stepId, variantId, field}; clicking scrolls to and
// focuses the exact editor field.
import { AlertTriangle } from "lucide-react";
import type { ValidationIssue } from "@/types/sequence";

const CODE_LABELS: Record<string, string> = {
  no_steps: "No emails",
  variant_distribution: "Distribution",
  empty_body: "Empty body",
  empty_subject: "Missing subject",
  undefined_variable: "Undefined variable",
  malformed_spintax: "Malformed spintax",
  malformed_conditional: "Malformed conditional",
};

type ValidationPanelProps = {
  issues: ValidationIssue[];
  onJump: (issue: ValidationIssue) => void;
};

export function ValidationPanel({ issues, onJump }: ValidationPanelProps) {
  // Nothing to show when the sequence is valid — the green banner was noise.
  if (!issues.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5" role="alert" aria-label="Sequence validation issues">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <AlertTriangle size={13} /> {issues.length} validation issue{issues.length > 1 ? "s" : ""} — click one to jump to the field
      </p>
      <ul className="space-y-1">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`}>
            <button
              type="button"
              onClick={() => onJump(issue)}
              className="w-full text-left text-xs text-amber-900 hover:bg-amber-100 rounded-md px-2 py-1.5 flex gap-2 items-start"
            >
              <span className="shrink-0 mt-0.5 text-[10px] font-semibold tracking-wide bg-amber-200/70 text-amber-900 rounded px-1 py-0.5">
                {CODE_LABELS[issue.code] || issue.code}
              </span>
              <span>{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
