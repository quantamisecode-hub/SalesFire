// Realtime layer (Socket.io) — live sync across the app (§51 companion).
// Every socket is authenticated with the same HttpOnly access_token cookie as
// the HTTP API; org membership is verified before a socket joins a campaign
// room, and every event payload is org-scoped. No anonymous listeners.
const { Server } = require('socket.io');
const { verifyAccessToken } = require('../security');
const models = require('../models');
const { renderForPreview } = require('./preview-renderer');

let io = null;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function campaignForOrg(campaignId, orgId) {
  if (!campaignId) return null;
  return models.Campaign.findOne({ where: { id: String(campaignId), organizationId: orgId } });
}

function init(server) {
  if (io) return io;
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5174',
      credentials: true,
    },
    serveClient: false,
  });

  // Auth handshake: the same access_token cookie the API verifies.
  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const payload = verifyAccessToken(cookies.access_token);
    if (!payload || !payload.org) return next(new Error('unauthorized'));
    socket.data.user = payload;
    next();
  });

  io.on('connection', (socket) => {
    const org = socket.data.user.org;
    socket.join(`org:${org}`); // campaign list / dashboard-wide fanout

    // Join a campaign room — tenant-checked against the org in the token.
    socket.on('campaign:join', async ({ campaignId } = {}, ack) => {
      try {
        const campaign = await campaignForOrg(campaignId, org);
        if (!campaign) return ack?.({ ok: false, error: 'Campaign not found' });
        socket.join(`campaign:${campaign.id}`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: 'Failed to join campaign room' });
      }
    });
    socket.on('campaign:leave', ({ campaignId } = {}) => {
      if (campaignId) socket.leave(`campaign:${String(campaignId)}`);
    });

    // Live draft preview (§33): render exactly what the editor holds — the
    // client streams its draft, the server renders the recipient's email.
    socket.on('preview:request', async (payload = {}, ack) => {
      try {
        const { campaignId } = payload;
        const campaign = await campaignForOrg(campaignId, org);
        if (!campaign) return ack?.({ ok: false, error: 'Campaign not found' });
        const { status, body } = await renderForPreview(campaign, org, {
          stepId: payload.stepId,
          variantId: payload.variantId,
          recipientId: payload.recipientId,
          sendingAccountId: payload.sendingAccountId,
          spintaxSeed: payload.spintaxSeed,
          draft: payload.draft,
          activeVariantIndex: payload.activeVariantIndex,
        });
        ack?.({ ok: status === 200, status, data: body?.data || null, error: body?.error || null, requestId: payload.requestId });
      } catch (error) {
        ack?.({ ok: false, error: 'Preview failed', requestId: payload.requestId });
      }
    });

    // Live signature preview (Prompt 9): render the editor draft with the
    // exact pipeline a real send uses. No campaign context required.
    socket.on('signature:preview', async (payload = {}, ack) => {
      try {
        const { renderSignatureDraft } = require('./signature-preview');
        const data = renderSignatureDraft({ html: payload.html, text: payload.text, variables: payload.variables });
        ack?.({ ok: true, data, requestId: payload.requestId });
      } catch (error) {
        ack?.({ ok: false, error: 'Signature preview failed', requestId: payload.requestId });
      }
    });

    // Structured validation for the current draft steps (§39-§41) — same
    // analyzer as the HTTP endpoint, but streamed live with the unsaved draft.
    socket.on('validate:request', async (payload = {}, ack) => {
      try {
        const { campaignId } = payload;
        const campaign = await campaignForOrg(campaignId, org);
        if (!campaign) return ack?.({ ok: false, error: 'Campaign not found' });
        const templateRenderer = require('./template-renderer');
        const { knownVariablesForOrg } = require('./known-vars');
        const steps = Array.isArray(payload?.draft?.steps) ? payload.draft.steps : [];
        const known = await knownVariablesForOrg(org);
        const stepNumber = (i) => `Step ${i + 1}`;
        const issues = [];
        if (!steps.length) {
          issues.push({ code: 'no_steps', field: 'steps', message: 'Sequence has no emails. Add at least one email step.' });
        }
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i] || {};
          const label = stepNumber(i);
          const contents = (Array.isArray(s.variants) && s.variants.length)
            ? s.variants.map((v) => ({ name: v?.variantName || 'Variant', body: v?.bodyHtml || v?.bodyText || '', subject: v?.subject || '', id: null }))
            : [{ name: s.name || '', body: s.bodyTemplate || '', subject: s.subjectTemplate || '', id: null }];
          // Variant distribution must total exactly 100% (§10).
          if (Array.isArray(s.variants) && s.variants.length) {
            const total = s.variants.reduce((sum, v) => sum + (Number(v?.weight) || 0), 0);
            if (total !== 100) {
              issues.push({ code: 'variant_distribution', field: 'variants', message: `${label} variant distribution totals ${total}% — must be exactly 100%.` });
            }
            for (const v of s.variants) {
              if (!v?.bodyHtml && !v?.bodyText) issues.push({ code: 'empty_body', field: 'body', message: `${label} (${v?.variantName || 'Variant'}) has an empty email body.` });
              if (i === 0 && !v?.subject) issues.push({ code: 'empty_subject', field: 'subject', message: `${label} (${v?.variantName || 'Variant'}) needs a subject — the first email cannot continue a thread.` });
            }
          } else {
            if (!s.bodyTemplate) issues.push({ code: 'empty_body', field: 'body', message: `${label} has an empty email body.` });
            else if (i === 0 && !s.subjectTemplate) issues.push({ code: 'empty_subject', field: 'subject', message: `${label} needs a subject — the first email cannot continue a thread.` });
          }
          for (const c of contents) {
            const tag = c.name ? ` (${c.name})` : '';
            for (const [field, text] of [['subject', c.subject], ['body', c.body]]) {
              const a = templateRenderer.analyze(text, known);
              for (const v of a.undefinedVars) issues.push({ code: 'undefined_variable', field, variable: v, message: `${label}${tag} contains an undefined variable {{${v}}}.` });
              for (const bad of a.malformedSpintax) issues.push({ code: 'malformed_spintax', field, message: `${label}${tag} has malformed Spintax — ${bad.reason}` });
              for (const bad of a.malformedConditionals) issues.push({ code: 'malformed_conditional', field, message: `${label}${tag} has malformed Conditional — ${bad.reason}` });
            }
          }
        }
        ack?.({ ok: true, issues, knownVariables: [...known], requestId: payload.requestId });
      } catch (error) {
        ack?.({ ok: false, error: 'Validation failed', requestId: payload.requestId });
      }
    });
  });

  return io;
}

/** Fanout helpers — safe to call before init() (tests run without sockets).
 *  `origin` is the caller's X-Client-Id so the emitting tab can drop its own
 *  echoes; every HTTP mutation site passes req.headers['x-client-id']. */
function emitToCampaign(campaignId, event, payload) {
  io?.to(`campaign:${String(campaignId)}`).emit(event, { ...payload, campaignId: String(campaignId) });
}
function emitToOrg(orgId, event, payload) {
  io?.to(`org:${String(orgId)}`).emit(event, { ...payload, organizationId: String(orgId) });
}
function emitCampaignUpdated(campaign, origin) {
  if (!campaign) return;
  emitToCampaign(campaign.id, 'campaign:updated', { id: campaign.id, status: campaign.status, origin });
  emitToOrg(campaign.organizationId, 'campaign:updated', { id: campaign.id, status: campaign.status, origin });
}
function emitSequenceSaved(campaignId, organizationId, sequenceId, origin) {
  emitToCampaign(campaignId, 'sequence:saved', { sequenceId, origin });
  emitToOrg(organizationId, 'sequence:saved', { sequenceId, campaignId: String(campaignId), origin });
}

/** Org-wide fanout for sending-account create/update/delete/test — the live preview's From line reacts to this. */
function emitAccountsChanged(organizationId, accountId, origin) {
  emitToOrg(organizationId, 'accounts:changed', { accountId: accountId ? String(accountId) : undefined, origin });
}

module.exports = { init, emitToCampaign, emitToOrg, emitCampaignUpdated, emitSequenceSaved, emitAccountsChanged };
