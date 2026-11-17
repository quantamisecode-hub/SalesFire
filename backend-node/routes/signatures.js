// Signatures routes — Prompt 9. Full CRUD + org-default + preview render
// (the preview uses the same resolver + renderer as real sends, so what the
// user sees IS what gets sent).
const express = require('express');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const {
  resolveSignature,
  renderSignatureHtml,
  renderSignatureText,
  signatureHtmlBlock,
  signatureTextBlock,
} = require('../services/signature-resolver');
const { sanitizeHtml } = require('../services/template-renderer');
const { renderSignatureDraft } = require('../services/signature-preview');

const router = express.Router();

function authenticate(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
router.use(authenticate);

function serializeSignature(s) {
  return {
    id: s.id,
    name: s.name,
    html: s.html,
    text: s.text,
    isOrgDefault: s.isOrgDefault,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function canManage(req) {
  const role = String(req.user.roles?.[0] || '').toLowerCase();
  return ['owner', 'admin'].includes(role);
}

// GET /api/v1/signatures — list org signatures, default first then oldest.
router.get('/', async (req, res) => {
  try {
    const sigs = await models.EmailSignature.findAll({
      where: { organizationId: req.user.org },
      order: [['isOrgDefault', 'DESC'], ['createdAt', 'ASC']],
    });
    res.json({ success: true, data: sigs.map(serializeSignature) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load signatures' });
  }
});

// POST /api/v1/signatures — create.
router.post('/', async (req, res) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only owners and admins can create signatures' });
    const { name, html, text, makeDefault } = req.body || {};
    if (!name || !String(name).trim()) return res.status(422).json({ error: 'Name is required' });
    if (!html || !String(html).trim()) return res.status(422).json({ error: 'Signature HTML is required' });
    const cleanHtml = sanitizeHtml(String(html).slice(0, 20000));
    const sig = await models.EmailSignature.create({
      organizationId: req.user.org,
      name: String(name).trim().slice(0, 120),
      html: cleanHtml,
      text: String(text || '').slice(0, 20000),
    });
    if (makeDefault) {
      await models.EmailSignature.update(
        { isOrgDefault: false },
        { where: { organizationId: req.user.org, id: { [require('sequelize').Op.ne]: sig.id } } },
      );
      await sig.update({ isOrgDefault: true });
    }
    res.status(201).json({ success: true, data: serializeSignature(sig) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create signature' });
  }
});

// PUT /api/v1/signatures/:id — update.
router.put('/:id', async (req, res) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only owners and admins can edit signatures' });
    const sig = await models.EmailSignature.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!sig) return res.status(404).json({ error: 'Signature not found' });
    const { name, html, text } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(422).json({ error: 'Name cannot be empty' });
      updates.name = String(name).trim().slice(0, 120);
    }
    if (html !== undefined) {
      if (!String(html).trim()) return res.status(422).json({ error: 'Signature HTML cannot be empty' });
      updates.html = sanitizeHtml(String(html).slice(0, 20000));
    }
    if (text !== undefined) updates.text = String(text || '').slice(0, 20000);
    await sig.update(updates);
    res.json({ success: true, data: serializeSignature(sig) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update signature' });
  }
});

// DELETE /api/v1/signatures/:id — delete (org default flips to another sig).
router.delete('/:id', async (req, res) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only owners and admins can delete signatures' });
    const sig = await models.EmailSignature.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!sig) return res.status(404).json({ error: 'Signature not found' });
    // Clear references from accounts / campaigns / steps rather than orphan ids.
    await models.SmtpAccount.update({ signatureId: null }, { where: { signatureId: sig.id, organizationId: req.user.org } });
    await models.Campaign.update({ signatureId: null }, { where: { signatureId: sig.id, organizationId: req.user.org } });
    await models.CampaignStep.update({ signatureId: null }, { where: { signatureId: sig.id, organizationId: req.user.org } });
    const wasDefault = sig.isOrgDefault;
    await sig.destroy();
    if (wasDefault) {
      const next = await models.EmailSignature.findOne({
        where: { organizationId: req.user.org },
        order: [['createdAt', 'ASC']],
      });
      if (next) await next.update({ isOrgDefault: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete signature' });
  }
});

// POST /api/v1/signatures/:id/default — make this the org default.
router.post('/:id/default', async (req, res) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only owners and admins can set the default signature' });
    const sig = await models.EmailSignature.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!sig) return res.status(404).json({ error: 'Signature not found' });
    const { Op } = require('sequelize');
    await models.EmailSignature.update(
      { isOrgDefault: false },
      { where: { organizationId: req.user.org, id: { [Op.ne]: sig.id } } },
    );
    await sig.update({ isOrgDefault: true });
    res.json({ success: true, data: serializeSignature(sig) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set default signature' });
  }
});

// POST /api/v1/signatures/preview — render like a real send would.
// Body: { html?, text?, signatureId?, campaignId?, stepId?, accountId?, variables? }
// Returns the exact HTML block that would be appended to an email body.
router.post('/preview', async (req, res) => {
  try {
    const { html, text, signatureId, campaignId, stepId, accountId, variables } = req.body || {};
    // Draft mode: render exactly what the editor holds right now (no save).
    if (typeof html === 'string') {
      return res.json({ success: true, data: renderSignatureDraft({ html, text, variables }) });
    }
    if (signatureId) {
      const sig = await models.EmailSignature.findOne({
        where: { id: signatureId, organizationId: req.user.org },
      });
      if (!sig) return res.status(404).json({ error: 'Signature not found' });
      const vars = variables && typeof variables === 'object' ? variables : {};
      const renderedHtml = sanitizeHtml(renderSignatureHtml(sig.html, vars, 'preview').html || '');
      return res.json({
        success: true,
        data: {
          name: sig.name,
          resolvedFrom: 'explicit',
          html: renderedHtml,
          text: renderSignatureText(sig.text, vars, 'preview'),
          signatureBlock: signatureHtmlBlock(renderedHtml),
          signatureTextBlock: signatureTextBlock(renderSignatureText(sig.text, vars, 'preview')),
        },
      });
    }
    // Otherwise resolve like a real send (account/campaign/step context).
    const { resolvedFrom, signature } = await resolveSignature({
      organizationId: req.user.org,
      accountId,
      campaignId,
      stepId,
    });
    if (!signature) {
      return res.json({ success: true, data: { name: null, resolvedFrom, html: '', text: '', signatureBlock: '', signatureTextBlock: '' } });
    }
    const vars = variables && typeof variables === 'object' ? variables : {};
    const renderedHtml = sanitizeHtml(renderSignatureHtml(signature.html, vars, 'preview').html || '');
    res.json({
      success: true,
      data: {
        name: signature.name,
        resolvedFrom,
        html: renderedHtml,
        text: renderSignatureText(signature.text, vars, 'preview'),
        signatureBlock: signatureHtmlBlock(renderedHtml),
        signatureTextBlock: signatureTextBlock(renderSignatureText(signature.text, vars, 'preview')),
      },
    });
  } catch (error) {
    console.error('Signature preview error:', error);
    res.status(500).json({ error: 'Failed to preview signature' });
  }
});

module.exports = router;
