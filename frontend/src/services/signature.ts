// Signatures API service (Prompt 9) — management of reusable signatures.
import { api } from "@/api/client";

export interface EmailSignature {
  id: string;
  name: string;
  html: string;
  text: string;
  isOrgDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignaturePayload {
  name: string;
  html: string;
  text?: string;
  makeDefault?: boolean;
}

export interface SignaturePreview {
  name: string | null;
  resolvedFrom: string;
  html: string;
  text: string;
  signatureBlock: string;
  signatureTextBlock: string;
}

export const signatureService = {
  async list(): Promise<{ success: boolean; data: EmailSignature[] }> {
    return api.get("/signatures");
  },
  async create(data: SignaturePayload) {
    return api.post("/signatures", data);
  },
  async update(id: string, data: Partial<SignaturePayload>) {
    return api.put(`/signatures/${id}`, data);
  },
  async remove(id: string) {
    return api.delete(`/signatures/${id}`);
  },
  async makeDefault(id: string) {
    return api.post(`/signatures/${id}/default`, {});
  },
  /** Render a signature exactly as the send pipeline would. */
  async preview(payload: {
    /** Draft mode: render the editor's current content (no save). */
    html?: string;
    text?: string;
    signatureId?: string;
    campaignId?: string;
    stepId?: string;
    accountId?: string;
    variables?: Record<string, string>;
  }): Promise<{ success: boolean; data: SignaturePreview }> {
    return api.post("/signatures/preview", payload);
  },
};
