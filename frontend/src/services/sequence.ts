// Sequence Builder API service — the editor talks to the backend through this
// file only. AI calls go to the backend's /ai routes (the API key never
// reaches the client); a 501 means "AI not configured" and is surfaced as such.
import { api } from "@/api/client";
import type {
  ValidateResponse,
  PreviewData,
  SpamCheckResult,
  GeneratedStep,
  SequenceStepPayload,
} from "@/types/sequence";

export interface SequenceSavePayload {
  name?: string;
  steps: SequenceStepPayload[];
}

export const sequenceService = {
  /** Replace a sequence's steps+variants (draft-time editor autosave/save). */
  async updateSequence(campaignId: string, sequenceId: string, data: SequenceSavePayload) {
    return api.put(`/campaigns/${campaignId}/sequences/${sequenceId}`, data);
  },

  /** Create the sequence with steps+variants (first save). */
  async createSequence(campaignId: string, data: SequenceSavePayload) {
    return api.post(`/campaigns/${campaignId}/sequences`, data);
  },

  /** List the campaign's sequences with steps + variants. */
  async listSequences(campaignId: string): Promise<{ success: boolean; data: any[] }> {
    return api.get(`/campaigns/${campaignId}/sequences`);
  },

  /** Structured validation — click-to-field issues for the editor. */
  async validate(campaignId: string): Promise<ValidateResponse> {
    const res = await api.get(`/campaigns/${campaignId}/validate`);
    return res.data;
  },

  /** Full render preview against a real recipient + sending account. */
  async preview(
    campaignId: string,
    payload: { stepId: string; variantId?: string; recipientId?: string; sendingAccountId?: string; spintaxSeed?: string },
  ): Promise<PreviewData> {
    const res = await api.post(`/campaigns/${campaignId}/preview`, payload);
    return res.data;
  },

  /** REAL SMTP test send. Returns sent info or throws with the SMTP error. */
  async sendTestEmail(
    campaignId: string,
    payload: { stepId: string; variantId?: string; recipients: string[]; sendingAccountId?: string },
  ): Promise<{ sent: boolean; messageId: string; to: string[] }> {
    const res = await api.post(`/campaigns/${campaignId}/test-email`, payload);
    return res.data;
  },

  /** AI multi-step sequence writer (501 when KIMI_API_KEY is absent). */
  async generateSequence(payload: { prompt?: string; industry?: string; tone?: string; stepsCount?: number }): Promise<GeneratedStep[]> {
    const res = await api.post("/ai/generate-sequence", payload);
    return res.data.steps;
  },

  /** Rewrite ONE email inside the current sequence (neighbours stay as context). */
  async regenerateStep(payload: {
    prompt?: string; industry?: string; tone?: string;
    current: { subject: string; bodyHtml: string };
    previous?: { subject: string; bodyHtml: string } | null;
    next?: { subject: string; bodyHtml: string } | null;
    position: number; totalSteps: number;
  }): Promise<{ subject: string; bodyHtml: string; subjectPreserved?: boolean }> {
    const res = await api.post("/ai/regenerate-step", payload);
    return res.data.step;
  },

  /** AI spintax writer (501 when KIMI_API_KEY is absent). */
  async generateSpintax(text: string): Promise<string> {
    const res = await api.post("/ai/generate-spintax", { text });
    return res.data.text;
  },

  /** Deterministic rules-based spam check — always available, advisory only. */
  async spamCheck(payload: { subject: string; bodyHtml: string }): Promise<SpamCheckResult> {
    const res = await api.post("/ai/spam-check", payload);
    return res.data;
  },
};
