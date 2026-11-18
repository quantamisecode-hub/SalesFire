// Email-sending (SMTP) account service - PROMPT 9.1 management center.
// Passwords are write-only: the backend never returns them.
import { api } from "@/api/client";
import type {
  SmtpAccount,
  SmtpAccountInput,
  SmtpAccountListResponse,
  SmtpAccountResponse,
  SmtpTestResult,
  SmtpSendTestResult,
} from "@/types/prompt6";

export interface SendingOverview {
  totalAccounts: number;
  activeAccounts: number;
  accountsWithErrors: number;
  emailsSentToday: number;
  /** null = no account has a daily cap set (uncapped) — render as ∞ */
  remainingCapacityToday: number | null;
  bounces: number;
  replies: number;
  failedSends: number;
}

export interface AccountUsage {
  sentToday: number;
  sentThisHour: number;
  dailyLimit: number | null;
  hourlyLimit: number | null;
  remainingToday: number | null;
  remainingThisHour: number | null;
  lastSentAt?: string;
  activeCampaigns: number;
  last30Days: { sent: number; failed: number; bounced: number; replied: number };
  healthStatus: string;
}

export const emailSendingService = {
  async listAccounts(): Promise<SmtpAccountListResponse> {
    return api.get("/email-sending/accounts");
  },

  async getAccount(id: string): Promise<SmtpAccountResponse> {
    return api.get(`/email-sending/accounts/${id}`);
  },

  async getUsage(id: string): Promise<{ success: boolean; data: AccountUsage }> {
    return api.get(`/email-sending/accounts/${id}/usage`);
  },

  async getOverview(): Promise<{ success: boolean; data: SendingOverview }> {
    return api.get("/email-sending/overview");
  },

  async createAccount(data: SmtpAccountInput): Promise<SmtpAccountResponse> {
    return api.post("/email-sending/accounts", data);
  },

  async updateAccount(
    id: string,
    data: Partial<SmtpAccountInput> & { isEnabled?: boolean; warmupStatus?: string },
  ): Promise<SmtpAccountResponse> {
    return api.patch(`/email-sending/accounts/${id}`, data);
  },

  async pauseAccount(id: string): Promise<SmtpAccountResponse> {
    return api.post(`/email-sending/accounts/${id}/pause`);
  },

  async resumeAccount(id: string): Promise<SmtpAccountResponse> {
    return api.post(`/email-sending/accounts/${id}/resume`);
  },

  async deleteAccount(id: string): Promise<{ success: boolean }> {
    return api.delete(`/email-sending/accounts/${id}`);
  },

  /** Real SMTP connection attempt; returns a sanitized result. */
  async testConnection(id: string): Promise<SmtpTestResult> {
    return api.post(`/email-sending/accounts/${id}/test`);
  },

  /** Real send to a test address. Never affects campaign analytics. */
  async sendTestEmail(id: string, to: string, subject?: string, body?: string): Promise<SmtpSendTestResult> {
    return api.post(`/email-sending/accounts/${id}/send-test`, { to, subject, body });
  },
};

export type { SmtpAccount };
