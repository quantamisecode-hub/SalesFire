// Campaign API service - only endpoints that exist in the Node backend.
// Envelope passthrough: responses are { success, data, ... }.
import { api } from "@/api/client";
import type {
  CampaignCreatePayload,
  CampaignUpdatePayload,
  CampaignResponse,
  CampaignListResponse,
  CampaignSequenceCreate,
  CampaignSequenceResponse,
  CampaignLeadListResponse,
  CampaignLeadResponse,
  CampaignSendingAccountInput,
  CampaignSendingAccountResponse,
  SendingAccountTestResult,
  CampaignEmailTemplateInput,
  CampaignEmailTemplateResponse,
  CampaignAIProposalInput,
  CampaignAIProposalApprove,
  CampaignAIProposalResponse,
  CampaignAIProposalListResponse,
  CampaignAnalyticsResponse,
} from "@/types/prompt5";
import type {
  RecipientEnrollInput,
  RecipientEnrollResponse,
  RecipientListResponse,
  AudienceCountsResponse,
  EmailEventListResponse,
  CampaignAnalyticsV2Response,
  LifecycleResponse,
  LaunchResult,
  PreviewResult,
  PersonalizeResult,
} from "@/types/prompt6";

export const campaignService = {
  // ---------- Campaign CRUD ----------

  async create(data: CampaignCreatePayload): Promise<CampaignResponse> {
    return api.post("/campaigns", data);
  },

  async list(params?: {
    status?: string;
    campaignType?: string;
    search?: string;
    sortBy?: string;
    sortDir?: string;
    page?: number;
    pageSize?: number;
  }): Promise<CampaignListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.campaignType) searchParams.set("campaignType", params.campaignType);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortDir) searchParams.set("sortDir", params.sortDir);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return api.get(`/campaigns${query}`);
  },

  async get(id: string): Promise<CampaignResponse> {
    return api.get(`/campaigns/${id}`);
  },

  async update(id: string, data: CampaignUpdatePayload): Promise<CampaignResponse> {
    return api.put(`/campaigns/${id}`, data);
  },

  // ---------- Lifecycle ----------

  async start(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/start`);
  },

  async pause(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/pause`);
  },

  async cancel(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/cancel`);
  },

  async duplicate(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/duplicate`);
  },

  /** Permanently delete a draft/archived campaign and everything it owns. */
  async deleteCampaign(id: string): Promise<{ success: boolean; data: { deleted: string } }> {
    return api.delete(`/campaigns/${id}`);
  },

  async getAnalytics(id: string): Promise<CampaignAnalyticsResponse> {
    return api.get(`/campaigns/${id}/analytics`);
  },

  // ---------- Sequences (with steps) ----------

  async createSequence(
    campaignId: string,
    data: CampaignSequenceCreate,
  ): Promise<CampaignSequenceResponse> {
    return api.post(`/campaigns/${campaignId}/sequences`, data);
  },

  async listSequences(campaignId: string): Promise<{ success: boolean; data: any[] }> {
    return api.get(`/campaigns/${campaignId}/sequences`);
  },

  /** Replace a sequence's steps (draft-time sequence editor). */
  async updateSequence(
    campaignId: string,
    sequenceId: string,
    data: CampaignSequenceCreate,
  ): Promise<CampaignSequenceResponse> {
    return api.put(`/campaigns/${campaignId}/sequences/${sequenceId}`, data);
  },

  async deleteSequence(campaignId: string, sequenceId: string): Promise<{ success: boolean }> {
    return api.delete(`/campaigns/${campaignId}/sequences/${sequenceId}`);
  },

  // ---------- Campaign leads ----------

  async addLead(
    campaignId: string,
    leadId: string,
  ): Promise<CampaignLeadResponse> {
    return api.post(`/campaigns/${campaignId}/leads`, { leadId });
  },

  async listLeads(campaignId: string): Promise<CampaignLeadListResponse> {
    return api.get(`/campaigns/${campaignId}/leads`);
  },

  // ---------- Sending accounts ----------

  async createSendingAccount(
    campaignId: string,
    data: CampaignSendingAccountInput,
  ): Promise<CampaignSendingAccountResponse> {
    return api.post(`/campaigns/${campaignId}/sending-accounts`, data);
  },

  async listSendingAccounts(
    campaignId: string,
  ): Promise<{ success: boolean; data: any[] }> {
    return api.get(`/campaigns/${campaignId}/sending-accounts`);
  },

  async testSendingAccount(
    campaignId: string,
    accountId: string,
    data: CampaignSendingAccountInput,
  ): Promise<SendingAccountTestResult> {
    return api.post(
      `/campaigns/${campaignId}/sending-accounts/${accountId}/test`,
      data,
    );
  },

  // ---------- Email templates ----------

  async createTemplate(
    campaignId: string,
    data: CampaignEmailTemplateInput,
  ): Promise<CampaignEmailTemplateResponse> {
    return api.post(`/campaigns/${campaignId}/templates`, data);
  },

  async listTemplates(
    campaignId: string,
  ): Promise<{ success: boolean; data: any[] }> {
    return api.get(`/campaigns/${campaignId}/templates`);
  },

  // ---------- AI proposals ----------

  async createAIProposal(
    campaignId: string,
    data: CampaignAIProposalInput,
  ): Promise<CampaignAIProposalResponse> {
    return api.post(`/campaigns/${campaignId}/ai-proposals`, data);
  },

  async listAIProposals(
    campaignId: string,
    status?: string,
  ): Promise<CampaignAIProposalListResponse> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return api.get(`/campaigns/${campaignId}/ai-proposals${query}`);
  },

  async approveAIProposal(
    campaignId: string,
    proposalId: string,
    data: CampaignAIProposalApprove,
  ): Promise<CampaignAIProposalResponse> {
    return api.post(
      `/campaigns/${campaignId}/ai-proposals/${proposalId}/approve`,
      data,
    );
  },

  // ------------------------------------------------------------------
  // Prompt 6 - Campaign & Outreach Engine endpoints
  // ------------------------------------------------------------------

  /** Enroll recipients with details (audience step). Server validates+dereps. */
  async enrollRecipients(
    campaignId: string,
    recipients: RecipientEnrollInput[],
  ): Promise<RecipientEnrollResponse> {
    return api.post(`/campaigns/${campaignId}/recipients`, { recipients });
  },

  async listRecipients(
    campaignId: string,
    params?: { status?: string; search?: string; page?: number; pageSize?: number },
  ): Promise<RecipientListResponse> {
    const sp = new URLSearchParams();
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.search) sp.set("search", params.search);
    if (params?.page) sp.set("page", String(params.page));
    if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
    const query = sp.toString() ? `?${sp.toString()}` : "";
    return api.get(`/campaigns/${campaignId}/recipients${query}`);
  },

  async removeRecipient(campaignId: string, recipientId: string): Promise<{ success: boolean }> {
    return api.delete(`/campaigns/${campaignId}/recipients/${recipientId}`);
  },

  /** Authoritative audience counts computed server-side (Prompt 6 §9). */
  async audienceCounts(campaignId: string): Promise<AudienceCountsResponse> {
    return api.get(`/campaigns/${campaignId}/audience-counts`);
  },

  async listEvents(
    campaignId: string,
    params?: { eventType?: string; page?: number; pageSize?: number },
  ): Promise<EmailEventListResponse> {
    const sp = new URLSearchParams();
    if (params?.eventType) sp.set("eventType", params.eventType);
    if (params?.page) sp.set("page", String(params.page));
    if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
    const query = sp.toString() ? `?${sp.toString()}` : "";
    return api.get(`/campaigns/${campaignId}/events${query}`);
  },

  async getAnalyticsV2(campaignId: string): Promise<CampaignAnalyticsV2Response> {
    return api.get(`/campaigns/${campaignId}/analytics`);
  },

  async review(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/review`);
  },

  async schedule(id: string, scheduledStartAt: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/schedule`, { scheduledStartAt });
  },

  /** Launch runs full backend validation and queues the first sends. */
  async launch(id: string): Promise<LaunchResult> {
    return api.post(`/campaigns/${id}/launch`);
  },

  async resume(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/resume`);
  },

  async archive(id: string): Promise<CampaignResponse> {
    return api.post(`/campaigns/${id}/archive`);
  },

  async lifecycle(id: string): Promise<LifecycleResponse> {
    return api.get(`/campaigns/${id}/lifecycle`);
  },

  /** Real variable substitution against a campaign recipient (no AI). */
  async preview(
    campaignId: string,
    payload?: { stepId?: string; recipientId?: string },
  ): Promise<PreviewResult> {
    return api.post(`/campaigns/${campaignId}/preview`, payload ?? {});
  },

  /** Real backend AI call; 501 with code AI_NOT_CONFIGURED when unset. */
  async personalize(
    campaignId: string,
    payload: { stepId?: string; recipientId?: string; depth?: string },
  ): Promise<PersonalizeResult> {
    return api.post(`/campaigns/${campaignId}/personalize`, payload);
  },
};
