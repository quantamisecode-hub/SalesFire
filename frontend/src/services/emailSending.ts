// Email-sending (SMTP) account service - Prompt 6 §27-31.
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

export const emailSendingService = {
  async listAccounts(): Promise<SmtpAccountListResponse> {
    return api.get("/email-sending/accounts");
  },

  async createAccount(data: SmtpAccountInput): Promise<SmtpAccountResponse> {
    return api.post("/email-sending/accounts", data);
  },

  async updateAccount(
    id: string,
    data: Partial<SmtpAccountInput> & { isEnabled?: boolean },
  ): Promise<SmtpAccountResponse> {
    return api.patch(`/email-sending/accounts/${id}`, data);
  },

  async deleteAccount(id: string): Promise<{ success: boolean }> {
    return api.delete(`/email-sending/accounts/${id}`);
  },

  /** Real SMTP connection attempt; returns a sanitized result. */
  async testConnection(id: string): Promise<SmtpTestResult> {
    return api.post(`/email-sending/accounts/${id}/test`);
  },

  /** Real send to a test address. Never affects campaign analytics. */
  async sendTestEmail(id: string, to: string): Promise<SmtpSendTestResult> {
    return api.post(`/email-sending/accounts/${id}/send-test`, { to });
  },
};

export type { SmtpAccount };
