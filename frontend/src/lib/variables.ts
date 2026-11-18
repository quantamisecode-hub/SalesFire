// displayVariables — build the variable list shown in the variable pickers.
//
// The backend tracks both casings of each lead field plus a legacy
// `unsubscribe_url` alias. The canonical display list prefers snake_case for
// lead fields and camelCase for platform/account variables, shows each once,
// drops aliases, and appends org-specific custom variables (imported columns)
// at the end. Keep EMBEDDED_VARIABLES in sync with BUILTIN_LEAD_FIELDS and
// templateRenderer.PLATFORM_VARIABLES.

// Lead fields — all import-supported and resolved by campaign-engine.js.
export const LEAD_VARIABLES = [
  "first_name", "last_name", "company_name", "job_title",
  "website", "email", "location", "industry", "company_size",
  "phone", "linkedin", "personalization",
] as const;

// Platform / sending-account scoped — resolved by campaign-engine.js at send time.
export const PLATFORM_VARIABLES = [
  "sendingAccountFirstName", "sendingAccountName", "sendingAccountEmail",
  "accountSignature", "unsubscribeUrl",
] as const;

export const EMBEDDED_VARIABLES: string[] = [...LEAD_VARIABLES, ...PLATFORM_VARIABLES];

/** Aliases that must never be shown in the picker. */
const ALIASES = new Set(["unsubscribe_url"]);

/** camelCase → snake_case for dedupe detection. */
const camelToSnake = (v: string) => v.replace(/([A-Z])/g, (_, c) => `_${c.toLowerCase()}`);

/**
 * Merge the embedded canonical list with server-provided known variables.
 * Server list may contain camelCase/snake_case duplicates of the embedded
 * fields and custom import slugs. Result: embedded list first (fixed order),
 * then any custom slugs not already represented, deduplicated case-insensitively.
 */
export function buildVariableList(knownVariables: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (v: string) => {
    const key = v.toLowerCase();
    if (seen.has(key) || ALIASES.has(v)) return;
    seen.add(key);
    out.push(v);
  };
  for (const v of EMBEDDED_VARIABLES) push(v);
  for (const raw of knownVariables) {
    const v = String(raw || "").trim();
    if (!v) continue;
    if (ALIASES.has(v)) continue;
    // Keep only import-safe custom slugs; casing duplicates of embedded
    // fields are dropped case-insensitively by `seen` + snake check below.
    if (!/^[A-Za-z0-9_]{1,40}$/.test(v)) continue;
    if (EMBEDDED_VARIABLES.includes(v)) continue;
    if (EMBEDDED_VARIABLES.some((e) => camelToSnake(e) === v)) continue;
    if (EMBEDDED_VARIABLES.some((e) => e.toLowerCase() === v.toLowerCase())) continue;
    if (/^[a-z0-9_]{1,40}$/.test(v)) push(v);
  }
  return out;
}
