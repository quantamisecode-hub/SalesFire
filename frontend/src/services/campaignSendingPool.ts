// Campaign sending-account pool service — PROMPT 9.1 §18-24.
// Org scoping happens server-side; the frontend never sends organization_id.
import { api } from "@/api/client";

export interface PoolAccount {
  id: string; // pool row id
  accountId: string;
  email: string;
  name: string;
  fromName?: string | null;
  status: string;
  healthStatus: string;
  warmupStatus: string;
  isEnabled: boolean;
  dailyLimit: number;
  sentToday: number;
  remainingToday: number;
  hourlyLimit: number;
  sentThisHour: number;
  remainingThisHour: number;
  distribution: number; // weight %
  weight: number;
  lastSentAt?: string | null;
  activeCampaigns: number;
  timezone: string;
}

export interface PoolResponse {
  success: boolean;
  data: PoolAccount[];
  strategy: string;
  stickiness: string;
  fallbackPolicy: string;
  committedDistribution: number | null;
}

export interface SendingSettings {
  accountDistribution: string; // round_robin | weighted | availability_based
  accountStickiness: string; // rotate | sticky
  fallbackPolicy: string; // reassign | pause
  minDelayMinutes?: number | null;
  maxDelayMinutes?: number | null;
  maxEmailsPerDay?: number | null;
  hourlyLimit?: number | null;
  sendDaysOfWeek?: number[] | null;
  sendBetweenStartHour?: number | null;
  sendBetweenEndHour?: number | null;
  timezone?: string;
}

export interface PoolValidation {
  ok: boolean;
  issues: string[];
  accountCount: number;
  strategy: string;
}

export const campaignSendingPoolService = {
  async list(campaignId: string): Promise<PoolResponse> {
    return api.get(`/campaigns/${campaignId}/sending-accounts`);
  },
  async add(campaignId: string, smtpAccountId: string, weight = 100): Promise<{ success: boolean }> {
    return api.post(`/campaigns/${campaignId}/sending-accounts`, { smtpAccountId, weight });
  },
  async updateWeight(campaignId: string, poolId: string, weight: number): Promise<{ success: boolean }> {
    return api.patch(`/campaigns/${campaignId}/sending-accounts/${poolId}`, { weight });
  },
  async setEnabled(campaignId: string, poolId: string, enabled: boolean): Promise<{ success: boolean }> {
    return api.patch(`/campaigns/${campaignId}/sending-accounts/${poolId}`, { enabled });
  },
  async remove(
    campaignId: string,
    poolId: string,
    removalPolicy?: "reassign" | "keep" | "cancel",
  ): Promise<{ success: boolean; requiresPolicy?: boolean; scheduledRecipients?: number; error?: string }> {
    const qs = removalPolicy ? `?removalPolicy=${encodeURIComponent(removalPolicy)}` : "";
    return api.delete(`/campaigns/${campaignId}/sending-accounts/${poolId}${qs}`);
  },
  async validate(campaignId: string): Promise<PoolValidation> {
    return api.post(`/campaigns/${campaignId}/sending-accounts/validate`);
  },
  async getSettings(campaignId: string): Promise<{ success: boolean; data: SendingSettings }> {
    return api.get(`/campaigns/${campaignId}/sending-settings`);
  },
  async updateSettings(campaignId: string, settings: Partial<SendingSettings>): Promise<{ success: boolean; data: SendingSettings }> {
    return api.patch(`/campaigns/${campaignId}/sending-settings`, settings);
  },
};
