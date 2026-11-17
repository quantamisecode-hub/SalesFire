// Unsubscribe routes - Prompt 6 §36. Public (no auth): the link is emailed.
// Token is HMAC-signed and tamper-resistant; confirming suppresses the
// recipient email for the whole organization and cancels queued jobs.
const express = require('express');
const { sequelize } = require('../db');
const models = require('../models');
const { verifyUnsubscribeToken } = require('../services/crypto');
const engine = require('../services/campaign-engine');

const router = express.Router();

function page(title, message, ok) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;text-align:center;box-shadow:0 1px 3px rgb(15 23 42/.06)}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#64748b;margin:0}</style></head>
<body><div class="card"><h1>${ok ? '✓' : '✕'} ${title}</h1><p>${message}</p></div></body></html>`;
}

// Perform the actual unsubscribe + suppression + queued-job cancellation.
async function unsubscribeAndSuppress(payload) {
  const recipient = await models.CampaignLead.findByPk(payload.recipientId);
  if (recipient) {
    await recipient.update({ status: 'unsubscribed', unsubscribedAt: new Date() });
  }
  await sequelize.transaction(async (t) => {
    await engine.suppressEmail({
      organizationId: payload.organizationId,
      email: payload.email,
      reason: 'unsubscribed',
      source: 'unsubscribe_link',
      campaignId: payload.campaignId,
      note: 'Unsubscribed via email link',
    }, t);
    await models.EmailJob.update(
      { status: 'suppressed', failureClass: 'unsubscribed' },
      { where: { campaignRecipientId: payload.recipientId, status: 'queued' }, transaction: t }
    );
    if (payload.campaignId) {
      await models.EmailEvent.create({
        organizationId: payload.organizationId,
        campaignId: payload.campaignId,
        campaignRecipientId: payload.recipientId,
        eventType: 'UNSUBSCRIBED',
        metadata: { email: payload.email },
      }, { transaction: t });
    }
  });
}

// GET: confirmation page with a POST form (email clients may prefetch GET links,
// so the mutation only happens on POST).
router.get('/:token', async (req, res) => {
  const payload = verifyUnsubscribeToken(req.params.token);
  if (!payload) {
    return res.status(400).send(page('Invalid link', 'This unsubscribe link is invalid or has been altered.', false));
  }
  res.status(200).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirm unsubscribe</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;text-align:center;box-shadow:0 1px 3px rgb(15 23 42/.06)}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#64748b;margin:0 0 16px}
button{background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#4338ca}</style></head>
<body><div class="card"><h1>Unsubscribe</h1>
<p>Do you want to stop receiving campaign emails from this organization?</p>
<form method="POST" action="/api/v1/unsubscribe/${req.params.token}"><button type="submit">Confirm unsubscribe</button></form>
</div></body></html>`);
});

router.post('/:token', async (req, res) => {
  const payload = verifyUnsubscribeToken(req.params.token);
  if (!payload) {
    if (req.accepts('html') && !req.is('json')) {
      return res.status(400).send(page('Invalid link', 'This unsubscribe link is invalid or has been altered.', false));
    }
    return res.status(400).json({ success: false, error: 'Invalid or altered unsubscribe link' });
  }
  try {
    await unsubscribeAndSuppress(payload);
    if (req.accepts('html') && !req.is('json')) {
      return res.status(200).send(page('Unsubscribed', `${payload.email} has been removed from this organization's mailing list. Future campaign emails will be blocked.`, true));
    }
    return res.json({ success: true, message: 'You have been unsubscribed.' });
  } catch {
    return res.status(500).send(page('Error', 'Could not process the unsubscribe request. Please try again.', false));
  }
});

module.exports = router;
