// LeadImportModal — reusable Excel/CSV import workflow (§12-30, §34).
// Steps: Upload (drag & drop) → Column mapping → Validation summary →
// Importing (real backend progress) → Result. Used by the Audience page.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Upload, Download, Loader2, CheckCircle2,
  AlertTriangle, ArrowLeft, Table2, XCircle,
} from "lucide-react";
import { leadService } from "@/services/lead";
import { Badge } from "@/components/Badge";
import {
  LEAD_FIELD_OPTIONS, type ImportJobStatus, type ImportPreview,
  type ImportValidationCounts, type ImportValidationError,
} from "@/types/lead";

type Phase = "upload" | "mapping" | "validating" | "review" | "importing" | "done" | "error";

function fmtBytes(n: number) {
  return n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024) * 10) / 10} MB` : `${Math.round(n / 1024)} KB`;
}

export function LeadImportModal({
  open, onClose, campaignId, onImported,
}: {
  open: boolean;
  onClose: () => void;
  campaignId?: string; // when set, imported leads are enrolled into this campaign (§34)
  onImported?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dupStrategy, setDupStrategy] = useState<"skip" | "update">("skip");
  const [validation, setValidation] = useState<{ counts: ImportValidationCounts; errors: ImportValidationError[] } | null>(null);
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportValidationError[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("upload"); setPreview(null); setMapping({}); setValidation(null);
    setJob(null); setError(null); setImportErrors([]); setShowErrors(false); setDupStrategy("skip");
  }, []);

  useEffect(() => { if (open) reset(); }, [open, reset]);

  // Poll real backend progress — no fake timers (§28).
  useEffect(() => {
    if (phase !== "importing" || !job?.jobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await leadService.status(job.jobId);
        if (cancelled) return;
        setJob(s);
        if (s.status === "completed" || s.status === "failed") {
          const errs = await leadService.errors(job.jobId).catch(() => []);
          if (!cancelled) { setImportErrors(errs); setPhase("done"); onImported?.(); }
        }
      } catch { /* transient poll failures retried on next tick */ }
    };
    poll();
    const id = window.setInterval(poll, 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [phase, job?.jobId, onImported]);

  if (!open) return null;

  const handleFile = async (file: File) => {
    setError(null);
    const ext = file.name.toLowerCase().split(".").pop();
    if (!ext || !["xlsx", "csv"].includes(ext)) {
      setError("Unsupported file type. Upload .xlsx or .csv.");
      return;
    }
    if (file.size === 0) { setError("The file is empty."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("File too large. Maximum is 5 MB."); return; }
    try {
      const p = await leadService.preview(file);
      if (!p.rows.length) { setError("The file has no data rows."); return; }
      setPreview(p);
      setMapping(p.mapping);
      setPhase("mapping");
    } catch (err: any) {
      setError(err?.data?.error || err?.message || "Could not read the file.");
    }
  };

  const runValidate = async () => {
    if (!preview) return;
    if (!Object.values(mapping).includes("email")) {
      setError("Map the Email column — it is required.");
      return;
    }
    setPhase("validating"); setError(null);
    try {
      const v = await leadService.validate({ headers: preview.headers, rows: preview.rows, mapping, duplicateStrategy: dupStrategy, campaignId: campaignId ?? null });
      setValidation(v);
      setPhase("review");
    } catch (err: any) {
      setError(err?.data?.error || "Validation failed.");
      setPhase("mapping");
    }
  };

  const startImport = async () => {
    if (!preview) return;
    setPhase("importing"); setError(null);
    try {
      const { jobId } = await leadService.start({
        headers: preview.headers, rows: preview.rows, mapping,
        duplicateStrategy: dupStrategy, campaignId, filename: preview.filename,
      });
      setJob({ jobId, status: "pending", filename: preview.filename, totalRows: validation?.counts.totalRows || 0, processed: 0, imported: 0, skipped: 0, failed: 0, errorMessage: null });
    } catch (err: any) {
      setError(err?.data?.error || "Could not start the import.");
      setPhase("review");
    }
  };

  const emailMapped = Object.values(mapping).includes("email");
  const pct = job && job.totalRows > 0 ? Math.round((job.processed / job.totalRows) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Import leads">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl border border-slate-200">
        {/* Header (§13) */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Import Leads</h2>
            <p className="text-sm text-slate-500 mt-0.5">Upload your prospect list and map the columns before importing.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="px-6 py-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3" role="alert">{error}</div>
          )}

          {/* ---- Phase: upload (§13, §14) ---- */}
          {phase === "upload" && (
            <div className="space-y-5">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
                className={`rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${dragOver ? "border-primary bg-indigo-50/60" : "border-slate-300 bg-slate-50"}`}
              >
                <Upload className="mx-auto text-slate-400 mb-3" size={32} aria-hidden />
                <p className="text-sm font-medium text-slate-700">Upload your lead file</p>
                <p className="text-sm text-slate-500 mt-1">Drag &amp; drop your file here</p>
                <p className="text-xs text-slate-400 my-2">or</p>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90"
                >
                  Browse Files
                </button>
                <p className="text-xs text-slate-400 mt-3">.xlsx or .csv · Max file size: {fmtBytes(5 * 1024 * 1024)}</p>
                <input
                  ref={fileInput} type="file" accept=".xlsx,.csv" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <a
                  href={leadService.templateUrl}
                  download
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <Download size={15} /> Download Excel Template
                </a>
                <p className="text-xs text-slate-400">Template: First Name, Last Name, Company Name, Job Title, Email, Phone, Website, LinkedIn, Location, Industry, Company Size, Personalization</p>
              </div>
            </div>
          )}

          {/* ---- Phase: mapping (§18-22) ---- */}
          {(phase === "mapping" || phase === "validating") && preview && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Map Your Columns</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{preview.filename} · {preview.rows.length} rows detected · {preview.format.toUpperCase()}</p>
                </div>
                <button onClick={() => setPhase("upload")} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
                  <ArrowLeft size={14} /> Change file
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-xs font-semibold text-slate-500 uppercase">
                      <th className="px-3 py-2">Uploaded Column</th>
                      <th className="px-3 py-2">Sample Data</th>
                      <th className="px-3 py-2">AI Sales Intelligence Field</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.columns.map((c) => {
                      const mapped = mapping[String(c.index)] || "skip";
                      return (
                        <tr key={c.index}>
                          <td className="px-3 py-2 font-medium text-slate-800">{c.header}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-[180px] truncate">
                            {c.samples.length ? c.samples.join(", ") : <span className="italic">no data</span>}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              aria-label={`Map column ${c.header}`}
                              className="w-full max-w-[220px] px-2 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
                              value={mapped.startsWith("custom:") ? mapped : mapped}
                              onChange={(e) => setMapping((m) => ({ ...m, [String(c.index)]: e.target.value }))}
                            >
                              <optgroup label="Fields">
                                {LEAD_FIELD_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}{o.required ? " (Required)" : ""}</option>
                                ))}
                              </optgroup>
                              <optgroup label="Custom Variable">
                                {!mapped.startsWith("custom:") && !LEAD_FIELD_OPTIONS.some((o) => o.value === mapped) && mapped !== "skip" ? null : null}
                                <option value={`custom:${c.header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)}`}>
                                  Custom Variable — {c.header}
                                </option>
                              </optgroup>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {mapped === "email" ? (
                              <Badge status="required" title="The email column is required to import leads" />
                            ) : mapped !== "skip" ? (
                              <Badge status="mapped" />
                            ) : (
                              <span className="text-xs text-slate-400">Skipped</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400">Unknown columns can be imported as <span className="font-medium">Custom Variables</span> usable later as {"{{variable_name}}"} in email personalization.</p>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">Cancel</button>
                <button
                  onClick={runValidate} disabled={phase === "validating" || !emailMapped}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {phase === "validating" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  {phase === "validating" ? "Validating…" : "Validate & Continue"}
                </button>
              </div>
            </div>
          )}

          {/* ---- Phase: review (§23-27) ---- */}
          {phase === "review" && validation && (
            <div className="space-y-5">
              <h3 className="text-base font-semibold text-slate-900">Ready to Import</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                <Stat label="Total rows" value={validation.counts.totalRows} />
                <Stat label="Valid leads" value={validation.counts.valid} tone="emerald" />
                <Stat label="Invalid emails" value={validation.counts.invalidEmail} tone="red" />
                <Stat label="Missing emails" value={validation.counts.missingEmail} tone="red" />
                <Stat label="Duplicates in file" value={validation.counts.duplicateInFile} tone="amber" />
                <Stat label="Duplicates (existing)" value={validation.counts.duplicateExisting} tone="amber" />
                {campaignId && (
                  <Stat label="Already enrolled" value={validation.counts.campaignEnrolled ?? 0} tone="amber" />
                )}
                <Stat label="Suppressed (blocked)" value={validation.counts.suppressed} tone="amber" />
              </div>
              {validation.errors.length > 0 && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-left text-slate-500 uppercase font-semibold">
                        <th className="px-3 py-2">Row</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                      {validation.errors.slice(0, 25).map((e, i) => (
                        <tr key={i}><td className="px-3 py-1.5">{e.row}</td><td className="px-3 py-1.5">{e.email || "—"}</td><td className="px-3 py-1.5 text-slate-500">{e.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-slate-700">Duplicate Strategy</label>
                <div className="mt-1.5 flex gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="dupStrategy" checked={dupStrategy === "skip"} onChange={() => setDupStrategy("skip")} />
                    Skip duplicates
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="dupStrategy" checked={dupStrategy === "update"} onChange={() => setDupStrategy("update")} />
                    Update existing lead
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button onClick={() => setPhase("mapping")} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
                  <ArrowLeft size={14} /> Back to mapping
                </button>
                <button
                  onClick={startImport} disabled={validation.counts.valid === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  <Table2 size={15} /> Import {validation.counts.valid} Lead{validation.counts.valid === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}

          {/* ---- Phase: importing — REAL progress from the job (§28) ---- */}
          {phase === "importing" && job && (
            <div className="py-6 space-y-4 text-center">
              <Loader2 className="mx-auto animate-spin text-primary" size={28} aria-hidden />
              <p className="text-sm font-medium text-slate-700">Importing leads…</p>
              <p className="text-2xl font-semibold text-slate-900">{job.processed} / {job.totalRows}</p>
              <div className="h-2.5 w-full max-w-md mx-auto rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-center gap-6 text-xs text-slate-500">
                <span>Processed: <span className="font-medium text-slate-700">{job.processed}</span></span>
                <span>Imported: <span className="font-medium text-emerald-700">{job.imported}</span></span>
                <span>Skipped: <span className="font-medium text-amber-700">{job.skipped}</span></span>
                <span>Failed: <span className="font-medium text-red-700">{job.failed}</span></span>
              </div>
            </div>
          )}

          {/* ---- Phase: done (§29-30) ---- */}
          {phase === "done" && job && (
            <div className="py-4 space-y-5">
              {job.status === "failed" ? (
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <XCircle className="text-red-600 mt-0.5" size={18} />
                  <div>
                    <p className="text-sm font-semibold text-red-800">Import failed</p>
                    <p className="text-sm text-red-700">{job.errorMessage || "An unknown error occurred."}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="text-emerald-600 mt-0.5" size={18} />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Import Complete — {job.totalRows} processed</p>
                    <p className="text-sm text-emerald-700">{job.imported} imported · {job.skipped} skipped · {job.failed} failed</p>
                  </div>
                </div>
              )}
              {importErrors.length > 0 && (
                <div>
                  <button onClick={() => setShowErrors((s) => !s)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <AlertTriangle size={14} /> {showErrors ? "Hide" : "Show"} error report ({importErrors.length})
                  </button>
                  {showErrors && (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                          <tr className="text-left text-slate-500 uppercase font-semibold">
                            <th className="px-3 py-2">Row</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importErrors.map((e, i) => (
                            <tr key={i}><td className="px-3 py-1.5">{e.row}</td><td className="px-3 py-1.5">{e.email || "—"}</td><td className="px-3 py-1.5 text-slate-500">{e.reason}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button onClick={reset} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
                  Import More Leads
                </button>
                <button onClick={onClose} data-testid="view-imported" className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
                  View Imported Leads
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "red" | "amber" }) {
  const colors = tone === "emerald" ? "text-emerald-700" : tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className={`text-lg font-semibold ${colors}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
