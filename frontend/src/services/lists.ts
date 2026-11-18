// CRM Lists API — holding lists (Instantly parity).
import type { LeadList, LeadListDetail } from "@/types/lead";

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

export interface ListMemberAddResult { added: number; requested: number }
export interface ListMoveResult { moved: number; copied: number; skipped: Array<{ email: string; reason: string }> }

export const listsService = {
  async list(): Promise<LeadList[]> {
    return handle<{ data: LeadList[] }>(fetch("/api/v1/lists", { credentials: "include" })).then((r) => r.data);
  },
  async get(id: string, params?: { page?: number; pageSize?: number; search?: string; sortBy?: string; sortDir?: "asc" | "desc" }): Promise<{ data: LeadListDetail; pagination: { page: number; pages: number; total: number; pageSize: number } }> {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== "") sp.set(k, String(v)); });
    return handle(fetch(`/api/v1/lists/${id}?${sp.toString()}`, { credentials: "include" }));
  },
  async create(name: string, description?: string): Promise<LeadList> {
    return handle<{ data: LeadList }>(fetch("/api/v1/lists", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }),
    })).then((r) => r.data);
  },
  async update(id: string, payload: { name?: string; description?: string }): Promise<LeadList> {
    return handle<{ data: LeadList }>(fetch(`/api/v1/lists/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).then((r) => r.data);
  },
  async remove(id: string): Promise<void> {
    await handle(fetch(`/api/v1/lists/${id}`, { method: "DELETE", credentials: "include" }));
  },
  async addMembers(listId: string, leadIds: string[]): Promise<ListMemberAddResult> {
    return handle<{ data: ListMemberAddResult }>(fetch(`/api/v1/lists/${listId}/members`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds }),
    })).then((r) => r.data);
  },
  async removeMembers(listId: string, leadIds: string[]): Promise<{ removed: number }> {
    return handle<{ data: { removed: number } }>(fetch(`/api/v1/lists/${listId}/members`, {
      method: "DELETE", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds }),
    })).then((r) => r.data);
  },
  /** Move (or copy) all members — or the given leadIds — of the list into a campaign. */
  async moveToCampaign(listId: string, targetCampaignId: string, opts: { copy?: boolean; resetStatus?: boolean; checkDuplicates?: boolean; leadIds?: string[] } = {}): Promise<ListMoveResult> {
    return handle<{ data: ListMoveResult }>(fetch(`/api/v1/lists/${listId}/move-to-campaign`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetCampaignId, ...opts }),
    })).then((r) => r.data);
  },
};
