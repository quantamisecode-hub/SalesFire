// AI routes — Sequence Builder AI tools (§25-§28). All generation is done
// server-side (the KIMI_API_KEY never reaches the client, §52). AI output is
// UNTRUSTED: it is sanitized before it is returned and the client only applies
// it behind an explicit "Accept" action — nothing is ever auto-applied (§47).
// Without KIMI_API_KEY the endpoints report 501 honestly. The spam checker is
// deterministic (no AI dependency) and always available.
const express = require('express');
const { verifyAccessToken } = require('../security');
const models = require('../models');
const aiService = require('../services/ai');
const spamChecker = require('../services/spam-checker');
const templateRenderer = require('../services/template-renderer');
const { knownVariablesForOrg } = require('../services/known-vars');

const router = express.Router();

function authenticate(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles || [] };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
router.use(authenticate);

// Org-member gate: org identity comes from the signed token only.
function checkOrgMembership(req, res, next) {
  models.OrganizationMembership.findOne({ where: { userId: req.user.id, organizationId: req.user.org } })
    .then((membership) => {
      if (!membership) return res.status(403).json({ error: 'You are not a member of this organization' });
      next();
    })
    .catch(() => res.status(500).json({ error: 'Authorization check failed' }));
}

router.use(checkOrgMembership);

// POST /api/v1/ai/generate-sequence — AI multi-step sequence writer (§25-26).
router.post('/generate-sequence', async (req, res) => {
  try {
    const { prompt, industry, tone, stepsCount } = req.body || {};
    const known = await knownVariablesForOrg(req.user.org);
    const steps = await aiService.generateSequence({
      prompt: String(prompt || '').slice(0, 2000),
      industry: String(industry || '').slice(0, 100),
      tone: String(tone || '').slice(0, 100),
      stepsCount,
      knownVariables: known,
    });
    // Sanitize every returned body — model output is untrusted input (§45).
    for (const s of steps) s.bodyHtml = templateRenderer.sanitizeHtml(s.bodyHtml);
    res.json({ success: true, data: { steps, aiGenerated: true } });
  } catch (error) {
    console.error('AI generate-sequence error:', error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'AI generation failed' });
  }
});

// POST /api/v1/ai/generate-spintax — AI spintax writer (§27).
router.post('/generate-spintax', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!String(text || '').trim()) return res.status(422).json({ error: 'text is required' });
    const result = await aiService.generateSpintax({ text: String(text).slice(0, 6000) });
    res.json({ success: true, data: { text: result, aiGenerated: true } });
  } catch (error) {
    console.error('AI generate-spintax error:', error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'AI generation failed' });
  }
});

// POST /api/v1/ai/personalize — reuses the Prompt 6 personalization service.
router.post('/personalize', async (req, res) => {
  try {
    const { template, vars, depth } = req.body || {};
    if (!String(template || '').trim()) return res.status(422).json({ error: 'template is required' });
    const text = await aiService.personalizeText({
      template: String(template).slice(0, 8000),
      vars: (vars && typeof vars === 'object') ? vars : {},
      depth,
    });
    res.json({ success: true, data: { text, aiGenerated: true } });
  } catch (error) {
    console.error('AI personalize error:', error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'AI personalization failed' });
  }
});

// POST /api/v1/ai/spam-check — deterministic rules engine (§29). Advisory only:
// a poor score never blocks anything, it just warns.
router.post('/spam-check', async (req, res) => {
  try {
    const { subject, bodyHtml, bodyText } = req.body || {};
    if (!String(subject || '').trim() && !String(bodyHtml || '').trim() && !String(bodyText || '').trim()) {
      return res.status(422).json({ error: 'Nothing to check — provide subject or body' });
    }
    const result = spamChecker.checkSpam({ subject, bodyHtml, bodyText });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Spam check error:', error);
    res.status(500).json({ error: 'Spam check failed' });
  }
});

module.exports = router;
