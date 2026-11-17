// Signature Resolver (Prompt 9 §2-§4) — resolves WHICH signature applies to a
// recipient's email, at send/preview time, from the explicit configuration
// states INHERIT / CUSTOM / NONE (never inferred from null alone).
//
// Hierarchy:
//   Step override  →  Campaign override  →  Account default  →  Org default
// with explicit NONE at any level beating lower-precedence defaults.
const models = require('../models');
const { EmailSignature } = models;
const templateRenderer = require('./template-renderer');

// INHERIT | CUSTOM | NONE — must match campaign/step/account column semantics.
const MODE = { INHERIT: 'inherit', CUSTOM: 'custom', NONE: 'none' };

function modeOf(value) {
  const v = String(value || MODE.INHERIT).toLowerCase();
  return v === MODE.CUSTOM || v === MODE.NONE ? v : MODE.INHERIT;
}

/**
 * Resolve the signature for ONE email delivery context.
 * Never throws for missing config — an absent step/campaign/account just
 * falls through to the next level.
 *
 * Step level can come from two sources:
 *   - a persisted step (`stepId`) — the resolver loads its signatureMode/signatureId;
 *   - an ad-hoc editor draft (`stepMode` / `stepSignatureId`) — the UNSAVED
 *     selection wins over the DB, so the live preview reflects the editor.
 */
async function resolveSignature({ organizationId, stepId, stepMode, stepSignatureId, campaignId, accountId } = {}) {
  // 1) Step level
  let mode = null;
  let sigId = null;
  if (stepMode !== undefined && stepMode !== null) {
    // Ad-hoc draft — the editor's current selection is authoritative.
    mode = modeOf(stepMode);
    sigId = mode === MODE.CUSTOM ? (stepSignatureId || null) : null;
  } else if (stepId) {
    const step = await models.CampaignStep.findOne({ where: { id: stepId, organizationId } });
    mode = modeOf(step?.signatureMode);
    sigId = mode === MODE.CUSTOM ? (step?.signatureId || null) : null;
  }
  if (mode === MODE.NONE) return { resolvedFrom: 'step', signature: null };
  if (mode === MODE.CUSTOM) {
    // Unfinished custom selection (no signature picked yet) is NOT a reason
    // to silently fall back to the org default — render nothing until the
    // user actually picks a signature (or switches back to Inherit).
    const sig = sigId
      ? await EmailSignature.findOne({ where: { id: sigId, organizationId } })
      : null;
    return { resolvedFrom: 'step', signature: sig || null };
  }
  // 2) Campaign level
  if (campaignId) {
    const campaign = await models.Campaign.findOne({ where: { id: campaignId, organizationId } });
    const mode = modeOf(campaign?.signatureMode);
    if (mode === MODE.NONE) return { resolvedFrom: 'campaign', signature: null };
    if (mode === MODE.CUSTOM) {
      const sig = campaign?.signatureId
        ? await EmailSignature.findOne({ where: { id: campaign.signatureId, organizationId } })
        : null;
      return { resolvedFrom: 'campaign', signature: sig || null };
    }
  }
  // 3) Account level (INHERIT default)
  if (accountId) {
    const account = await models.SmtpAccount.findOne({ where: { id: accountId, organizationId } });
    const mode = modeOf(account?.signatureMode);
    if (mode === MODE.NONE) return { resolvedFrom: 'account', signature: null };
    if (mode === MODE.CUSTOM) {
      const sig = account?.signatureId
        ? await EmailSignature.findOne({ where: { id: account.signatureId, organizationId } })
        : null;
      return { resolvedFrom: 'account', signature: sig || null };
    }
  }
  // 4) Organization default (null when none configured → body stays as authored)
  const orgDefault = await EmailSignature.findOne({
    where: { organizationId, isOrgDefault: true },
    order: [['updatedAt', 'DESC']],
  });
  return { resolvedFrom: 'org', signature: orgDefault || null };
}

/** Render a signature's HTML with the same variable vocabulary as the body. */
function renderSignatureHtml(signatureHtml, vars, seed) {
  if (!signatureHtml) return { html: '', unresolved: [] };
  const rendered = templateRenderer.renderTemplate(signatureHtml, vars, { sanitize: true, seed });
  return { html: rendered.text, unresolved: rendered.unresolved };
}

/** Plain-text signature fallback for text/plain MIME parts. */
function renderSignatureText(signatureText, vars, seed) {
  if (!signatureText) return '';
  const rendered = templateRenderer.renderTemplate(signatureText, vars, { sanitize: false, seed });
  return rendered.text;
}

/** Build the HTML signature block that gets appended to the body. */
function signatureHtmlBlock(renderedHtml) {
  if (!renderedHtml || !String(renderedHtml).trim()) return '';
  return `<div data-signature="true" style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">${renderedHtml}</div>`;
}

/** Build the plain-text counterpart separated by a dash rule. */
function signatureTextBlock(renderedText) {
  if (!renderedText || !String(renderedText).trim()) return '';
  return `\n\n--\n${String(renderedText).trim()}`;
}

module.exports = {
  resolveSignature,
  renderSignatureHtml,
  renderSignatureText,
  signatureHtmlBlock,
  signatureTextBlock,
};
