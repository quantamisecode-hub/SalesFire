// Realtime client — single Socket.io connection shared by the whole app.
// Auth travels via the same HttpOnly access_token cookie the API uses
// (the backend verifies it on the handshake). Features:
//   - joinCampaign(campaignId) / leaveCampaign — org-checked server-side
//   - requestPreview(payload)                  — live draft preview (§33)
//   - validateDraft(payload)                   — live draft validation (§39-41)
//   - onCampaignUpdated / onSequenceSaved      — cross-session sync fanout
// Own HTTP mutations echo back to this tab tagged with X-Client-Id, so the
// fanout helpers below silently drop them — only OTHER sessions surface.
import { io, type Socket } from "socket.io-client";
import { clientId } from "@/client-id";

export interface LivePreviewPayload {
  campaignId: string;
  stepId?: string | null;
  variantId?: string | null;
  recipientId?: string | null;
  sendingAccountId?: string | null;
  spintaxSeed?: string | null;
  /** Unsaved editor state — when present the server renders the draft. */
  draft?: {
    stepId?: string | null;
    sequenceId?: string | null;
    stepOrder: number;
    subject: string;
    bodyHtml: string;
    prevSubject?: string | null;
    variants?: { variantName?: string; subject?: string; bodyHtml?: string; bodyText?: string; weight?: number }[];
    /** The step's current UNSAVED signature selection — the preview honors it. */
    signatureMode?: "inherit" | "custom" | "none";
    signatureId?: string | null;
  };
  /** Index of the variant being edited — previews exactly that variant (§9). */
  activeVariantIndex?: number;
  requestId?: number;
}

/** Unsaved signature editor state — rendered with the real send pipeline. */
export interface LiveSignaturePreviewResult {
  ok: boolean;
  data?: {
    name: string;
    resolvedFrom: string;
    html: string;
    text: string;
    signatureBlock: string;
    signatureTextBlock: string;
  } | null;
  error?: string | null;
  requestId?: number;
}

export interface LivePreviewResult {
  ok: boolean;
  status?: number;
  data?: {
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
  } | null;
  error?: string | null;
  requestId?: number;
}

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  if (!socket.connected) socket.connect();
  return socket;
}

/** True when the socket is usable (connected). HTTP stays the fallback. */
export function socketConnected(): boolean {
  return Boolean(socket?.connected);
}

/** Ensure the socket connects; resolves true when connected within `timeoutMs`.
 *  Safe on pages that never called joinCampaign — getSocket() creates the
 *  shared singleton and socket.io buffers any emits sent during the handshake. */
export function ensureSocketConnected(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = getSocket();
    if (s.connected) return resolve(true);
    const onConnect = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { s.off("connect", onConnect); resolve(false); }, timeoutMs);
    s.once("connect", onConnect);
    s.connect();
  });
}

export function joinCampaign(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    getSocket().emit("campaign:join", { campaignId }, (res: { ok: boolean; error?: string }) => resolve(res || { ok: false }));
  });
}
export function leaveCampaign(campaignId: string) {
  getSocket().emit("campaign:leave", { campaignId });
}

export function requestPreview(payload: LivePreviewPayload): Promise<LivePreviewResult> {
  return new Promise((resolve) => {
    getSocket().emit("preview:request", payload, (res: LivePreviewResult) => resolve(res || { ok: false, error: "No response from server" }));
  });
}

/** Stream the signature draft over the socket — server renders it like a real send. */
export function requestSignaturePreview(payload: {
  html: string;
  text: string;
  variables: Record<string, string>;
  requestId?: number;
}): Promise<LiveSignaturePreviewResult> {
  return new Promise((resolve) => {
    getSocket().emit("signature:preview", payload, (res: LiveSignaturePreviewResult) =>
      resolve(res || { ok: false, error: "No response from server" }));
  });
}

export interface LiveValidationResult {
  ok: boolean;
  issues?: {
    code: string;
    field?: string;
    variable?: string;
    message: string;
  }[];
  knownVariables?: string[];
  error?: string | null;
  requestId?: number;
}

/** Validate the unsaved draft over the socket (debounced by the caller). */
export function requestValidate(payload: {
  campaignId: string;
  draft: { steps: unknown };
  requestId?: number;
}): Promise<LiveValidationResult> {
  return new Promise((resolve) => {
    getSocket().emit("validate:request", payload, (res: LiveValidationResult) =>
      resolve(res || { ok: false, error: "No response from server" }));
  });
}

/** Subscribe to cross-session campaign/sequence changes. Returns unsubscribe. */
type CampaignUpdatedEvent = { campaignId: string; organizationId?: string; id?: string; status?: string; origin?: string };
type SequenceSavedEvent = { sequenceId: string; campaignId: string; organizationId?: string; origin?: string };

/** Fanout helpers drop events that originated from THIS tab's own HTTP mutations. */
export function onCampaignUpdated(cb: (e: CampaignUpdatedEvent) => void): () => void {
  const s = getSocket();
  const handler = (e: CampaignUpdatedEvent) => { if (e?.origin === clientId) return; cb(e); };
  s.on("campaign:updated", handler);
  return () => { s.off("campaign:updated", handler); };
}
export function onSequenceSaved(cb: (e: SequenceSavedEvent) => void): () => void {
  const s = getSocket();
  const handler = (e: SequenceSavedEvent) => { if (e?.origin === clientId) return; cb(e); };
  s.on("sequence:saved", handler);
  return () => { s.off("sequence:saved", handler); };
}

/** Fires when any org member creates/edits/tests/deletes a sending account — including this tab. */
export function onAccountsChanged(cb: (e: { accountId?: string; origin?: string }) => void): () => void {
  const s = getSocket();
  const handler = (e: { accountId?: string; origin?: string }) => { cb(e); };
  s.on("accounts:changed", handler);
  return () => { s.off("accounts:changed", handler); };
}
