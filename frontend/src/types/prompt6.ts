// Prompt 6 types - Campaign & Outreach Engine.
// Field names mirror the Node backend responses exactly.
// Response envelope: { success, data, ... }.

// ---- SMTP sending accounts (settings/email-sending) ----

export interface PerDayWindow {
  enabled: boolean;
  start: string; // HH:MM (account-local timezone)
  end: string;
}

export interface SmtpAccount {
  id: string;
  name: string;
  smtpHost: string;
  smtpPort: number;
  security: "none" | "tls" | "ssl";
  smtpUsername?: string;
  hasPassword: boolean;
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string;
  dailyLimit?: number;
  hourlyLimit?: number;
  minDelayMinutes?: number;
  maxDelayMinutes?: number;
  /** Instantly-style minimum gap (minutes) between sends from this account across ALL campaigns. */
  minimumWaitMinutes?: number;
  isEnabled: boolean;
  status: string; // unverified | verified | error
  /** PROMPT 9.1 */
  healthStatus?: string; // healthy | warning | critical | unknown
  warmupStatus?: string; // not_started | warming | active | paused | completed
  warmupDailyLimit?: number | null;
  timezone?: string; // IANA identifier
  sendingSchedule?: Record<string, PerDayWindow> | null;
  lastSentAt?: string;
  sentToday?: number;
  sentThisHour?: number;
  remainingToday?: number | null;
  remainingThisHour?: number | null;
  activeCampaigns?: number;
  lastTestedAt?: string;
  lastTestResult?: string;
  signatureMode?: "inherit" | "custom" | "none";
  /** Server id of the chosen signature when signatureMode === "custom". */
  signatureId?: string | null;
  createdAt: string;
}

export interface SmtpAccountListResponse {
  success: boolean;
  data: SmtpAccount[];
}

export interface SmtpAccountInput {
  name: string;
  smtpHost: string;
  smtpPort: number;
  security: "none" | "tls" | "ssl";
  smtpUsername?: string;
  smtpPassword?: string;
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string;
  dailyLimit?: number;
  hourlyLimit?: number;
  minDelayMinutes?: number;
  maxDelayMinutes?: number;
  /** Instantly-style minimum gap (minutes) between sends from this account across ALL campaigns. */
  minimumWaitMinutes?: number;
  /** PROMPT 9.1 */
  timezone?: string;
  sendingSchedule?: Record<string, PerDayWindow> | null;
  warmupDailyLimit?: number | null;
  /** Signature resolution (Prompt 9): inherit | custom | none. */
  signatureMode?: "inherit" | "custom" | "none";
  signatureId?: string | null;
}

export interface SmtpAccountResponse {
  success: boolean;
  data: SmtpAccount;
}

export interface SmtpTestResult {
  success: boolean;
  message: string;
  failureClass?: string | null;
}

export interface SmtpSendTestResult {
  success: boolean;
  message?: string;
  messageId?: string;
}

// ---- Recipients (audience) ----

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  organizationId?: string;
  leadId?: string | null;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
  status: string; // pending | queued | active | completed | replied | bounced | unsubscribed | suppressed
  currentStep: number;
  nextSendAt?: string;
  lastSentAt?: string;
  repliedAt?: string;
  unsubscribedAt?: string;
  bouncedAt?: string;
  createdAt: string;
}

export interface RecipientListResponse {
  success: boolean;
  data: CampaignRecipient[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
}

export interface RecipientEnrollInput {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
}

export interface RecipientEnrollResponse {
  success: boolean;
  data: {
    created: CampaignRecipient[];
    rejected: Array<{ email: string; reason: string }>;
  };
  counts: { created: number; rejected: number; total: number };
}

export interface AudienceCounts {
  total: number;
  eligible: number;
  suppressed: number;
  unsubscribed: number;
  bounced: number;
  invalid: number;
  duplicates: number;
}

export interface AudienceCountsResponse {
  success: boolean;
  data: AudienceCounts;
}

// ---- Email events (activity) ----

export interface EmailEvent {
  id: string;
  organizationId: string;
  campaignId: string;
  campaignRecipientId?: string;
  emailJobId?: string;
  messageId?: string;
  eventType: "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "BOUNCED" | "FAILED" | "REPLIED" | "UNSUBSCRIBED";
  eventTimestamp: string;
  metadata?: Record<string, unknown>;
}

export interface EmailEventListResponse {
  success: boolean;
  data: EmailEvent[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
}

// ---- Event-based analytics ----

export interface CampaignAccountMetric {
  accountId: string;
  email: string;
  fromName?: string | null;
  sent: number;
  replied: number;
  bounced: number;
  failed: number;
}

export interface CampaignAnalyticsV2 {
  campaignId: string;
  status: string;
  totalRecipients: number;
  activeRecipients: number;
  queued: number;
  sent: number;
  delivered: number;
  bounced: number;
  softFailed: number;
  failed: number;
  replied: number;
  unsubscribed: number;
  replyRate: number;
  bounceRate: number;
  unsubscribeRate: number;
  failureRate: number;
  /** PROMPT 9.1 §44 — per sending account, from the event log. */
  accounts?: CampaignAccountMetric[];
}

export interface CampaignAnalyticsV2Response {
  success: boolean;
  data: CampaignAnalyticsV2;
}

// ---- Lifecycle ----

export interface LifecycleInfo {
  status: string;
  allowedTransitions: string[];
}

export interface LifecycleResponse {
  success: boolean;
  data: LifecycleInfo;
}

export interface LaunchResult {
  success: boolean;
  data: import("./prompt5").Campaign;
  queuedJobs?: number;
  suppressedRecipients?: number;
}

// ---- Preview & AI personalization ----

// Matches the backend POST /campaigns/:id/preview response envelope
// (v2 Sequence Builder shape — see backend routes/campaigns.js and the
// SequenceBuilder's PreviewPanel). `sampleRecipient` does not exist there;
// the recipient is `to`, the sender is `from`.
export interface PreviewResult {
  success: boolean;
  data: {
    subject: string;
    html: string;
    text: string;
    unresolved: string[];
    malformed: { snippet: string; reason: string }[];
    from: { name: string; email: string };
    to: { name: string; email: string };
    isSample: boolean;
    isSampleRecipient: boolean;
    accountSignature: string;
  };
}

export interface PersonalizeResult {
  success: boolean;
  data: {
    stepId: string;
    recipientId: string;
    depth: string;
    originalSubject: string;
    originalBody: string;
    personalizedBody: string;
    renderedSubject: string;
  };
}
