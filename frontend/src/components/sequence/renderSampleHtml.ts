// renderSampleHtml — in-app preview for AI-personalized (and hand-authored)
// email HTML inside a sandboxed iframe. It:
//   1. sanitizes the untrusted HTML (lightClean — same contract as the editor)
//   2. substitutes {{variable}} and {{variable | fallback}} tokens with
//      SAMPLE values so the user sees something meaningful
//   3. wraps it in a minimal, email-safe document
//
// Sample substitution is labeled in the UI ("Sample values — real data fills in
// at send time"). Output is only ever rendered inside a sandboxed iframe.
import { lightClean } from "./RichEmailEditor";

export const SAMPLE_VARS: Record<string, string> = {
  first_name: "John",
  last_name: "Doe",
  firstName: "John",
  lastName: "Doe",
  company_name: "Acme Corp",
  job_title: "Head of Sales",
  industry: "SaaS",
  website: "https://acme.example.com",
  email: "john@acme.example.com",
  phone: "+1 555-0100",
  sendingAccountFirstName: "Prateek",
  sendingAccountName: "Prateek",
  sendingAccountEmail: "sales@qatest.local",
  accountSignature: "Regards,\nPrateek\nFounder | Quantamise Code",
};

export function renderSampleHtml(rawHtml: string, extra?: Record<string, string>): string {
  const vars = { ...SAMPLE_VARS, ...(extra || {}) };
  let out = lightClean(String(rawHtml || ""));
  out = out.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*(?:\|\s*([^}]*))?\s*\}\}/g, (_, name, fallback) => {
    const value = vars[name];
    if (value != null && String(value) !== "") return String(value);
    const fb = fallback && String(fallback).trim();
    return fb ? fb : `[${name}]`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;margin:0;padding:14px}p{margin:0 0 12px}a{color:#2563eb}</style></head><body>${out}</body></html>`;
}
