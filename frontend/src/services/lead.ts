// Leads API service — table, import workflow, bulk actions.
import type {
  ImportPreview, ImportValidationCounts, ImportValidationError, ImportJobStatus, Lead, LeadListResponse,
} from "@/types/lead";

async function handle<T>(resPromise: Promise<Response>): Promise<T> {
  const res = await resPromise;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & { data?: unknown; status?: number };
    err.data = body;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export const leadService = {
  async list(params?: {
    page?: number; pageSize?: number; search?: string; sortBy?: string; sortDir?: string;
    status?: string; emailStatus?: string; industry?: string; companySize?: string; location?: string;
    minScore?: number; maxScore?: number; campaignId?: string;
  }): Promise<LeadListResponse> {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
    });
    return handle<LeadListResponse>(fetch(`/api/v1/leads?${sp.toString()}`, { credentials: "include" }));
  },

  async get(id: string): Promise<Lead & { campaigns: Array<{ id: string; name: string; status: string }>; events: Array<{ id: string; eventType: string; eventTimestamp: string }> }> {
    return handle(fetch(`/api/v1/leads/${id}`, { credentials: "include" })).then((r: any) => r.data);
  },

  async create(payload: Partial<Lead>): Promise<Lead> {
    return handle(fetch("/api/v1/leads", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).then((r: any) => r.data);
  },

  async update(id: string, payload: Partial<Lead>): Promise<Lead> {
    return handle(fetch(`/api/v1/leads/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).then((r: any) => r.data);
  },

  remove(id: string): Promise<{ success: boolean }> {
    return handle(fetch(`/api/v1/leads/${id}`, { method: "DELETE", credentials: "include" }));
  },

  // ---- Import workflow (§12-30) ----
  async preview(file: File): Promise<ImportPreview> {
    const fd = new FormData();
    fd.append("file", file);
    return handle(fetch("/api/v1/leads/import/preview", { method: "POST", credentials: "include", body: fd }))
      .then((r: any) => r.data);
  },

  async validate(payload: { headers: string[]; rows: unknown[][]; mapping: Record<string, string>; duplicateStrategy: string }): Promise<{ counts: ImportValidationCounts; errors: ImportValidationError[] }> {
    return handle(fetch("/api/v1/leads/import/validate", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).then((r: any) => r.data);
  },

  async start(payload: { headers: string[]; rows: unknown[][]; mapping: Record<string, string>; duplicateStrategy: string; campaignId?: string; filename?: string }): Promise<{ jobId: string }> {
    return handle(fetch("/api/v1/leads/import", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).then((r: any) => r.data);
  },

  async status(jobId: string): Promise<ImportJobStatus> {
    return handle(fetch(`/api/v1/leads/import/${jobId}`, { credentials: "include" })).then((r: any) => r.data);
  },

  async errors(jobId: string): Promise<ImportValidationError[]> {
    return handle(fetch(`/api/v1/leads/import/${jobId}/errors`, { credentials: "include" })).then((r: any) => r.data);
  },

  templateUrl: "/api/v1/leads/template",

  // ---- Bulk actions (§5) ----
  async bulkAddToCampaign(leadIds: string[], campaignId: string): Promise<{ counts: { created: number; rejected: number }; data?: { rejected: Array<{ email: string; reason: string }> } }> {
    return handle(fetch("/api/v1/leads/bulk/add-to-campaign", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds, campaignId }),
    }));
  },

  async bulkSuppress(leadIds: string[]): Promise<{ counts: { suppressed: number; leads: number } }> {
    return handle(fetch("/api/v1/leads/bulk/suppress", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds, reason: "blocked" }),
    }));
  },

  async bulkDelete(leadIds: string[]): Promise<{ counts: { deleted: number } }> {
    return handle(fetch("/api/v1/leads/bulk/delete", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds }),
    }));
  },

  exportUrl(ids: string[]): string {
    return `/api/v1/leads/bulk/export?ids=${encodeURIComponent(ids.join(","))}`;
  },
};
