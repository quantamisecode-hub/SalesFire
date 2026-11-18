// Unified Inbox API — conversations, drafts, AI helpers, sync status, notifications.
import { api } from "@/api/client";

export interface InboxMember {
  id: string; email: string; fullName: string; role: string;
}

export interface InboxLead {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email: string;
  jobTitle?: string;
  status: string;
  emailStatus?: string;
  leadScore?: number | null;
}

export interface InboxConversationListItem {
  id: string;
  subject: string;
  status: string;
  unread: number;
  isStarred: boolean;
  isArchived: boolean;
  snoozedUntil?: string | null;
  threadStatus: string;
  tags: string[];
  assigneeId?: string | null;
  assigneeName?: string | null;
  accountEmail?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  lead: InboxLead | null;
  snippet?: string | null;
  lastMessageAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
}

export interface InboxMessage {
  id: string;
  direction: "inbound" | "outbound";
  fromEmail?: string;
  fromName?: string;
  toEmails?: string[];
  ccEmails?: string[];
  subject?: string;
  textBody?: string;
  htmlBody?: string | null;
  snippet?: string | null;
  sentAt?: string | null;
  receivedAt?: string | null;
  isRead: boolean;
  messageType: string;
  status: string;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  createdAt: string;
}

export interface InboxInsight {
  id: string;
  type: string;
  value: string;
  confidence: number;
  model?: string | null;
  createdAt: string;
}

export interface InboxConversationDetail extends InboxConversationListItem {
  messages: InboxMessage[];
  insights: InboxInsight[];
}

export interface InboxSummary {
  summary: string;
  buyingSignals: string[];
  objections: string[];
  suggestedNextStep: string;
}

export interface SyncAccountStatus {
  accountId: string;
  name: string;
  fromEmail: string;
  smtpEnabled: boolean;
  imapConfigured: boolean;
  status: string;
  lastSyncAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  consecutiveFailures: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export const inboxService = {
  async list(params: {
    filter?: string; search?: string; sort?: string; campaignId?: string;
    sendingAccountId?: string; assignedUserId?: string; tag?: string;
    page?: number; pageSize?: number;
  } = {}): Promise<{ data: InboxConversationListItem[]; pagination: { page: number; pages: number; total: number; pageSize: number } }> {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v)); });
    return api.get(`/conversations?${sp.toString()}`);
  },

  async get(id: string): Promise<{ data: InboxConversationDetail }> {
    return api.get(`/conversations/${id}`);
  },

  async patch(id: string, payload: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return api.patch(`/conversations/${id}`, payload);
  },

  async markRead(id: string): Promise<{ data: { unread: number } }> {
    return api.post(`/conversations/${id}/read`, {});
  },
  async markUnread(id: string): Promise<{ data: { unread: number } }> {
    return api.post(`/conversations/${id}/unread`, {});
  },
  async markAllRead(): Promise<{ success: boolean }> {
    return api.post(`/conversations/read-all`, {});
  },

  async star(id: string): Promise<{ data: { isStarred: boolean } }> {
    return api.post(`/conversations/${id}/star`, {});
  },
  async archive(id: string): Promise<{ data: { isArchived: boolean } }> {
    return api.post(`/conversations/${id}/archive`, {});
  },
  async unarchive(id: string): Promise<{ data: { isArchived: boolean } }> {
    return api.post(`/conversations/${id}/unarchive`, {});
  },
  async assign(id: string, userId: string | null): Promise<{ data: { assignedUserId: string | null } }> {
    return api.post(`/conversations/${id}/assign`, { userId });
  },
  async setTags(id: string, tags: string[]): Promise<{ data: { tags: string[] } }> {
    return api.post(`/conversations/${id}/tags`, { tags });
  },
  async snooze(id: string, until: string | null): Promise<{ data: { snoozedUntil: string | null } }> {
    return api.post(`/conversations/${id}/snooze`, { until });
  },

  async unreadCount(): Promise<{ data: { unread: number } }> {
    return api.get(`/conversations/unread-count`);
  },

  async sendReply(id: string, payload: {
    subject?: string; bodyText?: string; bodyHtml?: string;
    toEmails?: string[]; ccEmails?: string[]; bccEmails?: string[];
    sendingAccountId?: string | null; signatureId?: string | null;
  }): Promise<{ data: { messageId: string; providerMessageId: string | null; conversationId: string } }> {
    return api.post(`/conversations/${id}/reply`, payload);
  },

  async getDraft(id: string): Promise<{ data: { textBody?: string; htmlBody?: string; subject?: string; sendingAccountId?: string; toEmails?: string[] } | null }> {
    return api.get(`/conversations/${id}/draft`);
  },
  async saveDraft(id: string, payload: {
    textBody?: string; htmlBody?: string; subject?: string;
    sendingAccountId?: string | null; signatureId?: string | null;
  }): Promise<{ data: unknown }> {
    return api.put(`/conversations/${id}/draft`, payload);
  },
  async deleteDraft(id: string): Promise<{ success: boolean }> {
    return api.delete(`/conversations/${id}/draft`);
  },

  async aiReply(id: string, payload: { mode: string; instruction?: string }): Promise<{ data: { draft: string } }> {
    return api.post(`/conversations/${id}/ai/reply`, payload);
  },
  async aiSummary(id: string): Promise<{ data: InboxSummary }> {
    return api.post(`/conversations/${id}/ai/summary`, {});
  },

  async syncStatus(): Promise<{ data: SyncAccountStatus[] }> {
    return api.get(`/email-sync/status`);
  },
  async triggerSync(accountId: string): Promise<{ data: { ok?: boolean; processed?: number; code?: string; error?: string } }> {
    return api.post(`/email-sync/${accountId}`, {});
  },

  async listMembers(): Promise<{ data: InboxMember[] }> {
    return api.get(`/members`);
  },

  async unreadNotifications(): Promise<{ data: { unread: number } }> {
    return api.get(`/notifications/unread-count`);
  },
};
