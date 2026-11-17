// Deliverability (Prompt 8) — real verification + warm-up endpoints.
// Nothing here is simulated; every number comes from the backend.
import { api } from "@/api/client";

export interface VerificationVerdict {
  status: "valid" | "invalid" | "risky" | "unknown";
  riskScore: number;
  reasons: string[];
  checkedAt: string;
}

export interface CampaignVerificationRow {
  email: string;
  firstName: string | null;
  lastName: string | null;
  verification: VerificationVerdict | null;
}

export interface WarmupPlanStatus {
  id: string;
  status: "active" | "paused" | "completed" | "disabled";
  currentDay: number;
  dailyTarget: number;
  sentToday: number;
  remainingToday: number;
  totalSent: number;
  totalFailed: number;
  /** null until ≥ 10 real attempts — the UI must show "Not enough data". */
  healthScore: number | null;
  startVolume: number;
  rampStep: number;
  targetVolume: number;
  startedOn: string;
  consecutiveFailureDays: number;
  seedRecipients: string;
}

export interface WarmupAccountStatus {
  account: {
    id: string;
    name: string;
    fromEmail: string;
    isEnabled: boolean;
    dailyLimit: number | null;
    status?: string;
  };
  plan: WarmupPlanStatus | null;
}

export const deliverabilityService = {
  /** Verify one address ad-hoc (lead-linked when leadId is passed). */
  async verifyEmail(email: string, leadId?: string) {
    return api.post("/deliverability/verify", { email, leadId });
  },

  /** Bulk-verify every enrolled recipient of a campaign (real DNS lookups). */
  async verifyCampaign(campaignId: string) {
    return api.post(`/deliverability/verify-campaign/${campaignId}`, {});
  },

  /** Latest stored verdicts for this campaign's enrolled recipients. */
  async campaignVerification(campaignId: string) {
    return api.get(`/deliverability/verification?campaignId=${encodeURIComponent(campaignId)}`);
  },

  /** Bulk-verify unverified leads in the org (capped server-side). */
  async verifyLeads(payload: { leadIds?: string[]; unverifiedOnly?: boolean; limit?: number } = {}) {
    return api.post("/deliverability/verify-leads", payload);
  },

  /** Warm-up status for every sending account in this org. */
  async warmupStatus(): Promise<{ success: boolean; data: WarmupAccountStatus[] }> {
    return api.get("/deliverability/warmup");
  },

  /** Enable/update a warm-up plan for an account. Without `enabled`, the update
   *  only applies to the fields provided (ramp, seeds) and keeps the current status. */
  async updateWarmupPlan(
    accountId: string,
    payload: { enabled?: boolean; targetVolume?: number; startVolume?: number; rampStep?: number; seedRecipients?: string; reset?: boolean },
  ) {
    return api.put(`/deliverability/warmup/${accountId}`, payload);
  },
};
