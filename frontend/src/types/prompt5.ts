// Campaign Intelligence Engine types.
// Field names mirror the Node backend responses exactly (camelCase attributes
// backed by underscored columns). Response envelope: { success, data, ... }.

export interface CampaignListResponse {
  success: boolean;
  data: Campaign[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
}

export interface Campaign {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  description?: string;
  status: string; // draft, ready_for_review, scheduled, active/running, paused, completed, cancelled, failed, archived
  campaignType: string; // outreach, nurture, re-engagement, announcement
  sendingAccountId?: string;
  /** Signature resolution (Prompt 9): inherit | custom | none. */
  signatureMode?: "inherit" | "custom" | "none";
  signatureId?: string | null;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  archivedAt?: string;
  maxEmailsPerDay?: number;
  dailyLimit?: number;
  maxEmailsPerLead: number;
  hourlyLimit?: number;
  minDelayMinutes?: number;
  maxDelayMinutes?: number;
  sendBetweenStartHour?: number;
  sendBetweenEndHour?: number;
  sendDaysOfWeek?: number[];
  timezone: string;
  aiProvider: string;
  aiPersonalizationEnabled: boolean;
  aiPersonalizationDepth?: string; // light | standard | deep
  aiApprovalRequired: boolean;
  totalLeads: number;
  emailsSent: number;
  emailsDelivered: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  emailsBounced: number;
  emailsUnsubscribed: number;
  totalFailed?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignCreatePayload {
  name: string;
  description?: string;
  campaignType: string;
  sendingAccountId?: string;
  maxEmailsPerDay?: number;
  maxEmailsPerLead?: number;
  hourlyLimit?: number;
  minDelayMinutes?: number;
  maxDelayMinutes?: number;
  sendBetweenStartHour?: number;
  sendBetweenEndHour?: number;
  sendDaysOfWeek?: number[];
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  timezone: string;
  aiProvider: string;
  aiPersonalizationEnabled: boolean;
  aiPersonalizationDepth?: string;
  aiApprovalRequired: boolean;
  /** Signature resolution (Prompt 9): inherit | custom | none. */
  signatureMode?: "inherit" | "custom" | "none";
  signatureId?: string | null;
}

export type CampaignUpdatePayload = Partial<CampaignCreatePayload>;

export interface CampaignResponse {
  success: boolean;
  data: Campaign;
}

// ---- Analytics ----

export interface CampaignAnalytics {
  campaignId: string;
  totalLeads: number;
  emailsSent: number;
  emailsDelivered: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  emailsBounced: number;
  emailsUnsubscribed: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
  unsubscribeRate: number;
}

export interface CampaignAnalyticsResponse {
  success: boolean;
  data: CampaignAnalytics;
}

// ---- Sequences & steps ----

export interface CampaignStep {
  id: string;
  sequenceId: string;
  organizationId?: string;
  stepOrder: number;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays: number;
  delayHours: number;
  isActive: boolean;
  aiPersonalizeSubject?: boolean;
  aiPersonalizeBody?: boolean;
  aiApprovalRequired?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSequence {
  id: string;
  campaignId: string;
  organizationId?: string;
  name: string;
  description?: string;
  stepOrder?: number;
  isActive?: boolean;
  steps?: CampaignStep[];
  createdAt: string;
  updatedAt: string;
}

export interface SequenceStepInput {
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays?: number;
  delayHours?: number;
}

export interface CampaignSequenceCreate {
  name: string;
  description?: string;
  steps?: SequenceStepInput[];
}

export interface CampaignSequenceResponse {
  success: boolean;
  data: CampaignSequence;
}

// ---- Campaign leads ----

export interface CampaignLead {
  id: string;
  campaignId: string;
  leadId: string;
  organizationId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignLeadListResponse {
  success: boolean;
  data: CampaignLead[];
}

export interface CampaignLeadResponse {
  success: boolean;
  data: CampaignLead;
}

// ---- Sending accounts ----

export interface CampaignSendingAccount {
  id: string;
  campaignId: string;
  organizationId?: string;
  emailAddress: string;
  displayName?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername?: string;
  status: string;
  lastTestedAt?: string;
  lastTestResult?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSendingAccountInput {
  emailAddress: string;
  displayName?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername?: string;
  smtpPassword?: string;
}

export interface CampaignSendingAccountResponse {
  success: boolean;
  data: CampaignSendingAccount;
}

export interface SendingAccountTestResult {
  success: boolean;
  message: string;
}

// ---- Email templates ----

export interface CampaignEmailTemplate {
  id: string;
  campaignId: string;
  organizationId?: string;
  name: string;
  subject: string;
  body: string;
  variables?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignEmailTemplateInput {
  name: string;
  subject: string;
  body: string;
  variables?: string[];
}

export interface CampaignEmailTemplateResponse {
  success: boolean;
  data: CampaignEmailTemplate;
}

// ---- AI proposals ----

export interface CampaignAIProposal {
  id: string;
  campaignId: string;
  leadId?: string;
  stepId?: string;
  proposedSubject?: string;
  proposedBody?: string;
  aiProvider?: string;
  aiModel?: string;
  status: string; // pending, approved, rejected
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignAIProposalInput {
  leadId?: string;
  stepId?: string;
  proposedSubject?: string;
  proposedBody?: string;
  aiProvider?: string;
  aiModel?: string;
}

export interface CampaignAIProposalResponse {
  success: boolean;
  data: CampaignAIProposal;
}

export interface CampaignAIProposalListResponse {
  success: boolean;
  data: CampaignAIProposal[];
}

export interface CampaignAIProposalApprove {
  action: string; // approved | rejected
  reason?: string;
  modifiedSubject?: string;
  modifiedBody?: string;
}
