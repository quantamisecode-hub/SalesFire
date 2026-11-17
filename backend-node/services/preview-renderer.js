// Preview renderer — single source of truth for POST /campaigns/:id/preview
// and the realtime socket handler (live draft preview). Renders the email a
// recipient would actually receive: variable substitution, spintax resolution,
// A/B variant selection, previous-thread subject continuation (§8, §9, §10,
// §33-34, §53-55). Supports both a persisted stepId (saved DB state) and an
// ad-hoc `draft` payload (the unsaved editor state).
const { Op } = require('sequelize');
const models = require('../models');
const engine = require('./campaign-engine');
const { signUnsubscribeToken } = require('./crypto');

function sampleRecipient() {
  // Clearly-labeled sample used only when the campaign has no recipients yet —
  // the preview panel marks it as sample data.
  return {
    id: 'sample', email: 'john@example.com', firstName: 'John', lastName: 'Doe',
    companyName: 'Acme Technologies', jobTitle: 'CTO', leadId: null, isSample: true,
  };
}

// Tenant chain: step → sequence → campaign. Org always comes from the caller's
// verified token, never from the client payload.
async function loadStepForCampaign(campaignId, orgId, stepId) {
  return models.CampaignStep.findOne({
    where: { id: stepId },
    include: [{
      model: models.CampaignSequence, as: 'sequence',
      where: { campaignId, organizationId: orgId },
      required: true,
    }],
  });
}

async function loadStepsWithVariants(campaignId) {
  const sequences = await models.CampaignSequence.findAll({
    where: { campaignId },
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
  });
  if (!sequences.length) return [];
  return models.CampaignStep.findAll({
    where: { sequenceId: sequences.map((s) => s.id) },
    include: [{ model: models.CampaignStepVariant, as: 'variants' }],
    order: [['stepOrder', 'ASC'], ['createdAt', 'ASC']],
  });
}

async function previousStepSubject(step) {
  const prevStep = await models.CampaignStep.findOne({
    where: { sequenceId: step.sequenceId, stepOrder: { [Op.lt]: step.stepOrder } },
    order: [['stepOrder', 'DESC']],
  });
  if (!prevStep) return null;
  const prevVariant = await models.CampaignStepVariant.findOne({
    where: { stepId: prevStep.id }, order: [['variantOrder', 'ASC']],
  });
  return (prevVariant && prevVariant.subject) || prevStep.subjectTemplate || null;
}

/**
 * Render the preview. Returns { status, body } — callers map that onto an
 * HTTP response or a socket ack/event untouched.
 */
async function renderForPreview(campaign, orgId, opts = {}) {
  const { stepId, variantId, recipientId, sendingAccountId, spintaxSeed, draft, activeVariantIndex } = opts;

  let step = null;
  let variants = [];
  let prevSubject = null;

  if (draft && typeof draft === 'object') {
    // --- Ad-hoc draft mode: render exactly what the editor holds (§33). ---
    const stepOrder = Number.isFinite(draft.stepOrder) ? Number(draft.stepOrder) : 0;
    step = {
      id: 'draft',
      sequenceId: draft.sequenceId || null,
      stepOrder,
      subjectTemplate: typeof draft.subject === 'string' ? draft.subject : '',
      bodyTemplate: typeof draft.bodyHtml === 'string' ? draft.bodyHtml : '',
      delayDays: 0, delayHours: 0, delayMinutes: 0,
    };
    const draftVariants = Array.isArray(draft.variants) ? draft.variants : [];
    variants = draftVariants.map((v, i) => ({
      id: `draft-variant-${i}`,
      variantName: v?.variantName || `Variant ${String.fromCharCode(65 + i)}`,
      variantOrder: i,
      subject: typeof v?.subject === 'string' ? v.subject : '',
      bodyHtml: typeof v?.bodyHtml === 'string' ? v.bodyHtml : '',
      bodyText: typeof v?.bodyText === 'string' ? v.bodyText : '',
      weight: Number(v?.weight) || 0,
    }));
    // The previous thread subject can be supplied by the editor itself (it
    // knows the earlier drafts); otherwise fall back to the DB for persisted
    // drafts with a stepId.
    if (typeof draft.prevSubject === 'string') prevSubject = draft.prevSubject || null;
    else if (draft.stepId) {
      const persisted = await loadStepForCampaign(campaign.id, orgId, draft.stepId);
      if (persisted) prevSubject = await previousStepSubject(persisted);
    }
  } else {
    // --- Persisted mode: render the saved DB state. ---
    let effectiveStepId = stepId;
    if (!effectiveStepId) {
      const steps = await loadStepsWithVariants(campaign.id);
      effectiveStepId = steps[0]?.id;
      if (!effectiveStepId) return { status: 422, body: { error: 'No sequence steps to preview' } };
    }
    step = await loadStepForCampaign(campaign.id, orgId, effectiveStepId);
    if (!step) return { status: 404, body: { error: 'Sequence step not found' } };
    variants = await models.CampaignStepVariant.findAll({
      where: { stepId: step.id },
      order: [['variantOrder', 'ASC']],
    });
    prevSubject = await previousStepSubject(step);
  }

  // Explicit variant selection (persisted by id, draft by index) — §9. Falls
  // back to the deterministic weighted pick when not provided.
  if (variantId) variants = variants.filter((v) => v.id === variantId);
  else if (Number.isInteger(activeVariantIndex) && variants[activeVariantIndex]) {
    variants = [variants[activeVariantIndex]];
  }

  // Recipient: the selected real recipient, the first eligible one, or a
  // labeled sample when the campaign has none yet.
  let recipient = null;
  if (recipientId) {
    recipient = await models.CampaignLead.findOne({
      where: { id: recipientId, campaignId: campaign.id, organizationId: orgId },
    });
    if (!recipient) return { status: 404, body: { error: 'Recipient not found in this campaign' } };
  } else {
    recipient = await models.CampaignLead.findOne({
      where: { campaignId: campaign.id },
      order: [['createdAt', 'ASC']],
    }) || sampleRecipient();
  }
  const lead = recipient.leadId ? await models.Lead.findByPk(recipient.leadId) : null;

  // Sending account preview (§33): org-checked, never trusted from body alone.
  const accountId = sendingAccountId || campaign.sendingAccountId;
  const account = accountId
    ? await models.SmtpAccount.findOne({ where: { id: accountId, organizationId: orgId } })
    : null;

  const unsubscribeUrl = `${process.env.APP_BASE_URL || 'http://localhost:8000'}/api/v1/unsubscribe/${signUnsubscribeToken({
    organizationId: campaign.organizationId,
    campaignId: campaign.id,
    recipientId: recipient.id || 'preview',
    email: recipient.email,
  })}`;

  const vars = engine.buildLeadVars(recipient, lead, account, unsubscribeUrl);
  const seed = spintaxSeed || 'preview';
  const rendered = engine.renderForRecipient({ step, variants, vars, seed, prevSubject });

  // Signature resolution (Prompt 9) for both modes — persisted steps resolve
  // step > campaign > account > org; ad-hoc drafts resolve the step's
  // UNSAVED selection first (stepMode), then fall through to campaign > account > org.
  const { resolveSignature, renderSignatureHtml, renderSignatureText, signatureHtmlBlock, signatureTextBlock } = require('./signature-resolver');
  const isDraft = Boolean(draft && typeof draft === 'object');
  const sigRes = await resolveSignature({
    organizationId: orgId,
    stepId: step?.id && step.id !== 'draft' ? step.id : undefined,
    stepMode: isDraft ? (typeof draft.signatureMode === 'string' ? draft.signatureMode : undefined) : undefined,
    stepSignatureId: isDraft ? (typeof draft.signatureId === 'string' ? draft.signatureId : undefined) : undefined,
    campaignId: campaign.id,
    accountId: account?.id,
  });
  let signatureHtml = '';
  let signatureText = '';
  if (sigRes.signature) {
    const htmlRendered = renderSignatureHtml(sigRes.signature.html, vars, seed).html;
    signatureHtml = signatureHtmlBlock(htmlRendered);
    signatureText = signatureTextBlock(renderSignatureText(sigRes.signature.text, vars, seed));
    if (htmlRendered) vars.accountSignature = htmlRendered;
  }

  return {
    status: 200,
    body: {
      success: true,
      data: {
        subject: rendered.subject,
        html: `${rendered.html}${signatureHtml}`,
        text: `${rendered.text}${signatureText}`,
        unresolved: rendered.unresolved,
        malformed: rendered.malformed,
        from: {
          name: (account && account.fromName) || 'Sample Sender',
          email: (account && account.fromEmail) || (account && account.smtpUsername) || 'sales@company.com',
        },
        to: {
          name: [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || recipient.email,
          email: recipient.email,
        },
        // `isSample` is the legacy key; `isSampleRecipient` the Sequence Builder's.
        isSample: Boolean(recipient.isSample),
        isSampleRecipient: Boolean(recipient.isSample),
        // Where this email's signature resolved from (step | campaign | account | org), or null when NONE.
        signatureResolvedFrom: sigRes.resolvedFrom,
        accountSignature: vars.accountSignature,
      },
    },
  };
}

module.exports = { renderForPreview, sampleRecipient, loadStepForCampaign, loadStepsWithVariants };
