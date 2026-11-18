// Campaign Engine - queueing, suppression, send worker (Prompt 6 §33-37, 41-42).
//
// Flow: launch -> queue jobs for (recipient × next due step)
//       worker tick -> claim jobs atomically -> suppression + limit + schedule
//       checks -> SMTP send -> events -> advance recipient -> queue next step.
//
// Duplicate-send protection (§34): a job is claimed with a guarded UPDATE
//   UPDATE email_jobs SET status='sending', claimed_by=:worker
//   WHERE id=:id AND status='queued'
// Exactly one concurrent worker can win that UPDATE per job.

const { sequelize } = require('../db');
const models = require('../models');
const emailService = require('./email');
const templateRenderer = require('./template-renderer');
const allocator = require('./sending-account-allocator');
const { Op } = require('sequelize');

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const MAX_BATCH = 10;

// ---------------------------------------------------------------------------
// Variable substitution (Prompt 6 §12) — only known variables are replaced;
// unknown {{...}} tokens are left untouched so nothing silently corrupts.
const ALLOWED_VARIABLES = new Set([
  'first_name', 'last_name', 'company_name', 'job_title', 'website', 'email',
]);

// Legacy direct substitution (kept for the strict allowlist contract — unknown
// vars stay literal even when present in `vars`). The full Sequence Builder
// pipeline (spintax, fallbacks, conditionals, custom vars) lives in
// services/template-renderer.js and is used by the send path + preview below.
function renderTemplate(template, vars) {
  return String(template || '').replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (match, name) => {
      if (!ALLOWED_VARIABLES.has(name)) return match; // unknown -> keep literal
      const value = vars[name];
      return value == null || value === '' ? '' : String(value);
    }
  );
}

// ---------------------------------------------------------------------------
// Sequence Builder rendering (variables, custom vars, spintax, conditionals,
// account vars, unsubscribe URL). The lead record supplies REAL data — the
// engine never fabricates values (e.g. the old guessed website URL is gone).
// ---------------------------------------------------------------------------
function buildLeadVars(recipient, lead, account, unsubscribeUrl) {
  const firstName = (lead && lead.firstName) || recipient.firstName || '';
  const lastName = (lead && lead.lastName) || recipient.lastName || '';
  const companyName = (lead && lead.companyName) || recipient.companyName || '';
  const jobTitle = (lead && lead.jobTitle) || recipient.jobTitle || '';
  const vars = {
    first_name: firstName, firstName,
    last_name: lastName, lastName,
    company_name: companyName, companyName,
    job_title: jobTitle, jobTitle,
    email: recipient.email,
    website: (lead && lead.website) || '',
    location: (lead && lead.location) || '',
    industry: (lead && lead.industry) || '',
    company_size: (lead && lead.companySize) || '', companySize: (lead && lead.companySize) || '',
    phone: (lead && lead.phone) || '',
    linkedin: (lead && lead.linkedin) || '',
    // Imported "Personalization" column — previously validated as a platform
    // variable but never resolved, leaving a literal {{personalization}} in sends.
    personalization: (lead && lead.personalization) || '',
  };
  // Custom variables from imported Excel/CSV columns (§18). Slugs were
  // validated at import (^[a-z0-9_]{1,40}$); re-validate defensively — no
  // arbitrary keys reach the template context.
  const custom = (lead && lead.customFields) || {};
  for (const [k, v] of Object.entries(custom)) {
    if (/^[a-z0-9_]{1,40}$/.test(k)) vars[k] = v == null ? '' : String(v);
  }
  // Sending-account variables (§36).
  const fromName = (account && account.fromName) || '';
  vars.accountSignature = (account && account.signature) || fromName;
  vars.sendingAccountName = fromName;
  vars.sendingAccountEmail = (account && account.fromEmail) || (account && account.smtpUsername) || '';
  vars.sendingAccountFirstName = fromName.split(' ')[0] || '';
  // Platform unsubscribe URL (§31).
  if (unsubscribeUrl) {
    vars.unsubscribeUrl = unsubscribeUrl;
    vars.unsubscribe_url = unsubscribeUrl;
  }
  return vars;
}

// Pick a variant by weight (§10) and render subject + body for one recipient.
// Deterministic per (jobId, email) seed. Empty follow-up subject continues the
// previous email's subject (§8).
function renderForRecipient({ step, variants, vars, seed, prevSubject }) {
  const rng = templateRenderer.makeRng(seed);
  const variant = variants && variants.length ? templateRenderer.pickWeighted(variants, rng) : null;
  const subject = variant ? variant.subject : step.subjectTemplate;
  const bodyHtml = variant ? (variant.bodyHtml || variant.bodyText || step.bodyTemplate) : step.bodyTemplate;
  return templateRenderer.renderEmail({ subject, bodyHtml, vars, seed, prevSubject });
}

function recipientVars(recipient) {
  return {
    first_name: recipient.firstName,
    last_name: recipient.lastName,
    company_name: recipient.companyName,
    job_title: recipient.jobTitle,
    website: (recipient.website) || '',
    email: recipient.email,
  };
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Suppression (Prompt 6 §35)

async function isSuppressed(organizationId, email) {
  if (!email) return { suppressed: true, reason: 'invalid' };
  const hit = await models.Suppression.findOne({
    where: { organizationId, email: String(email).trim().toLowerCase() },
  });
  return hit ? { suppressed: true, reason: hit.reason } : { suppressed: false };
}

async function suppressEmail({ organizationId, email, reason, source, campaignId, note }, transaction) {
  return models.Suppression.findOrCreate({
    where: { organizationId, email: String(email).trim().toLowerCase() },
    defaults: { reason, source, campaignId, note },
    transaction,
  });
}

// ---------------------------------------------------------------------------
// Scheduling helpers (Prompt 6 §17) — all enforcement is server-side.

function withinSendingWindow(campaign, account, when = new Date()) {
  const days = campaign.sendDaysOfWeek && campaign.sendDaysOfWeek.length
    ? campaign.sendDaysOfWeek
    : [1, 2, 3, 4, 5];
  const jsDay = when.getUTCDay(); // 0=Sun
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  if (!days.includes(isoDay)) return false;

  const startHour = campaign.sendBetweenStartHour ?? 9;
  const endHour = campaign.sendBetweenEndHour ?? 17;
  const hour = when.getUTCHours();
  return hour >= startHour && hour < endHour;
}

// ---------------------------------------------------------------------------
// Queueing

async function recordEvent(event, transaction) {
  return models.EmailEvent.create(event, { transaction });
}

// Queue the *next* step for a recipient (if any). Returns the created job or null.
async function queueNextStepForRecipient(campaign, recipient, transaction, scheduledFor) {
  const sequences = await models.CampaignSequence.findAll({
    where: { campaignId: campaign.id },
    attributes: ['id'],
    transaction,
  });
  const sequenceIds = sequences.map((s) => s.id);
  const allSteps = sequenceIds.length
    ? await models.CampaignStep.findAll({
        where: { sequenceId: sequenceIds },
        order: [['stepOrder', 'ASC']],
        transaction,
      })
    : [];

  const nextIndex = recipient.currentStep || 0;
  if (nextIndex >= allSteps.length) return null; // sequence exhausted
  const step = allSteps[nextIndex];

  const base = scheduledFor || new Date();
  const delayMs = nextIndex > 0
    ? ((step.delayDays || 0) * 24 * 60 + (step.delayHours || 0) * 60 + (step.delayMinutes || 0)) * 60 * 1000
    : 0;
  const jitter = campaign.maxDelayMinutes
    ? Math.floor(Math.random() * Math.max(0, campaign.maxDelayMinutes - (campaign.minDelayMinutes || 0))) + (campaign.minDelayMinutes || 0)
    : 0;
  const when = new Date(base.getTime() + delayMs + jitter * 60 * 1000);

  // PROMPT 9.1 §28 — idempotency: org+campaign+recipient+step uniquely identify
  // one send attempt. A retry of this enqueue is a no-op, never a duplicate.
  const idempotencyKey = `${campaign.organizationId}:${campaign.id}:${recipient.id}:${step.id}`;
  const [job, created] = await models.EmailJob.findOrCreate({
    where: { idempotencyKey },
    defaults: {
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      campaignRecipientId: recipient.id,
      stepId: step.id,
      status: 'queued',
      scheduledFor: when,
      idempotencyKey,
    },
    transaction,
  });
  if (!created) return job; // already queued — do not advance counters twice

  await recipient.update({
    currentStep: nextIndex + 1,
    currentStepId: step.id,
    nextSendAt: when,
    status: recipient.status === 'pending' ? 'queued' : recipient.status,
  }, { transaction });

  await recordEvent({
    organizationId: campaign.organizationId,
    campaignId: campaign.id,
    campaignRecipientId: recipient.id,
    emailJobId: job.id,
    eventType: 'QUEUED',
    metadata: { stepId: step.id, stepName: step.name, scheduledFor: when.toISOString() },
  }, transaction);

  return job;
}

// ---------------------------------------------------------------------------
// Atomic claim (Prompt 6 §34). Returns the job row if this worker won it.

async function claimJob(jobId, transaction) {
  const [affectedCount] = await models.EmailJob.update(
    { status: 'sending', claimedAt: new Date(), claimedBy: WORKER_ID },
    {
      where: { id: jobId, status: 'queued' },
      transaction,
    }
  );
  // The guarded UPDATE wins for exactly one caller per job: 1 row updated
  // means this worker claimed it; 0 means another worker got there first.
  return Number(affectedCount) > 0;
}

// ---------------------------------------------------------------------------
// Limits — PROMPT 9.1 moves quota enforcement into services/sending-account-
// allocator.js: atomic, database-backed day/hour reservation against the
// sending_account_usage table. Effective limits = min(account, campaign);
// account-global limits stay authoritative across campaigns (§37-39).

// ---------------------------------------------------------------------------
// Worker tick: claim -> re-check everything -> send -> events -> advance.

// ---------------------------------------------------------------------------
// Worker recovery (§67) — jobs stuck in 'sending' longer than LOCK_STALE_MS
// (worker crashed/restarted after claiming) are reclaimed. If a SENT event
// already exists for the job we finalize it instead of re-sending.
const LOCK_STALE_MS = 10 * 60 * 1000;

async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - LOCK_STALE_MS);
  const stuck = await models.EmailJob.findAll({
    where: { status: 'sending', claimedAt: { [Op.lt]: cutoff } },
    limit: 50,
  });
  let recovered = 0, finalized = 0;
  for (const job of stuck) {
    const sent = await models.EmailEvent.findOne({ where: { emailJobId: job.id, eventType: 'SENT' } });
    if (sent) {
      await job.update({ status: 'sent', sentAt: job.sentAt || sent.eventTimestamp });
      finalized++;
    } else {
      // Release the reservation if one exists for that account, then requeue.
      if (job.sendingAccountId) await allocator.releaseUsage(job.sendingAccountId).catch(() => {});
      await job.update({ status: 'queued', claimedAt: null, claimedBy: null, lastError: 'recovered after stale lock' });
      recovered++;
    }
  }
  return { recovered, finalized };
}

async function processDueJobs() {
  try { await recoverStaleJobs(); } catch { /* recovery is best-effort; never block sends */ }
  const due = await models.EmailJob.findAll({
    where: { status: 'queued' },
    limit: MAX_BATCH,
    order: [['scheduledFor', 'ASC']],
  });
  const now = new Date();
  const results = { claimed: 0, sent: 0, suppressed: 0, failed: 0, skipped: 0 };

  for (const job of due) {
    if (job.scheduledFor > now) { results.skipped++; continue; }

    const transaction = await sequelize.transaction();
    let claimed = false;
    try {
      claimed = await claimJob(job.id, transaction);
      if (!claimed) {
        await transaction.rollback();
        results.skipped++;
        continue; // another worker owns it
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback().catch(() => {});
      results.skipped++;
      continue;
    }
    if (!claimed) { results.skipped++; continue; }
    results.claimed++;

    // Reload fresh state outside the claim transaction
    const freshJob = await models.EmailJob.findByPk(job.id);
    const campaign = await models.Campaign.findByPk(freshJob.campaignId);
    const recipient = await models.CampaignLead.findByPk(freshJob.campaignRecipientId);
    let reservedAccountId = null; // released in catch if the send path throws

    try {
      // Re-check campaign state at send time (Prompt 6 §41). 'running' is
      // treated as a synonym of 'active' (legacy prompt-5 rows).
      const campaignStatus = campaign.status === 'running' ? 'active' : campaign.status;
      if (!campaign || campaignStatus !== 'active') {
        await freshJob.update({ status: 'queued', claimedAt: null, claimedBy: null });
        results.skipped++;
        continue;
      }
      // Suppression re-check
      const sup = await isSuppressed(campaign.organizationId, recipient.email);
      if (sup.suppressed) {
        await freshJob.update({ status: 'suppressed', failureClass: sup.reason });
        await recipient.update({ status: 'suppressed' });
        await recordEvent({
          organizationId: campaign.organizationId,
          campaignId: campaign.id,
          campaignRecipientId: recipient.id,
          emailJobId: freshJob.id,
          eventType: 'FAILED',
          metadata: { reason: `suppressed: ${sup.reason}` },
        });
        results.suppressed++;
        continue;
      }

      // PROMPT 9.1 — schedule + account pool. Campaign window first, then the
      // allocator enforces account eligibility, account schedule, sticky
      // assignment, fallback policy and ATOMIC day/hour quota reservation.
      if (!allocator.campaignInSchedule(campaign, new Date())) {
        await freshJob.update({ status: 'queued', claimedAt: null, claimedBy: null, lastError: 'outside campaign sending window' });
        results.skipped++;
        continue;
      }
      const alloc = await allocator.allocateAndReserve(campaign, recipient, new Date());
      if (!alloc.ok) {
        const patch = { status: 'queued', claimedAt: null, claimedBy: null, lastError: alloc.reason };
        if (alloc.paused) patch.scheduledFor = new Date(Date.now() + 15 * 60 * 1000); // hold until account available
        await freshJob.update(patch);
        results.skipped++;
        continue;
      }
      const account = alloc.account;
      reservedAccountId = account.id;
      // Recipient-level assignment (§23): remember the account + how it was chosen.
      await recipient.update({
        sendingAccountId: account.id,
        assignmentMethod: alloc.method,
        assignedAt: new Date(),
      });
      await freshJob.update({ sendingAccountId: account.id });

      const step = await models.CampaignStep.findByPk(freshJob.stepId);
      if (!step) {
        await freshJob.update({ status: 'failed', failureClass: 'permanent', lastError: 'sequence step missing' });
        results.failed++;
        continue;
      }

      // Real lead record for this recipient: website/location/industry and the
      // custom variables imported with the lead (§18). Never fabricated.
      const lead = recipient.leadId ? await models.Lead.findByPk(recipient.leadId) : null;

      // A/B variants for this step (§9-10) — deterministic per-recipient pick.
      const variants = await models.CampaignStepVariant.findAll({
        where: { stepId: step.id },
        order: [['variantOrder', 'ASC']],
      });

      // §8 — an empty follow-up subject continues the previous email thread.
      const prevStep = await models.CampaignStep.findOne({
        where: { sequenceId: step.sequenceId, stepOrder: { [Op.lt]: step.stepOrder } },
        order: [['stepOrder', 'DESC']],
      });
      let prevSubject = null;
      if (prevStep) {
        const prevVariant = await models.CampaignStepVariant.findOne({
          where: { stepId: prevStep.id }, order: [['variantOrder', 'ASC']],
        });
        prevSubject = (prevVariant && prevVariant.subject) || prevStep.subjectTemplate || null;
      }

      const unsubscribeUrl = `${process.env.APP_BASE_URL || 'http://localhost:8000'}/api/v1/unsubscribe/${require('./crypto').signUnsubscribeToken({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        recipientId: recipient.id,
        email: recipient.email,
      })}`;

      const vars = buildLeadVars(recipient, lead, account, unsubscribeUrl);
      // Resolve the applicable signature (Prompt 9 §3 hierarchy).
      // NONE at any level means genuinely no signature for this email.
      const { resolveSignature, renderSignatureHtml, renderSignatureText, signatureHtmlBlock, signatureTextBlock } = require('./signature-resolver');
      const sigRes = await resolveSignature({
        organizationId: campaign.organizationId,
        stepId: step.id,
        campaignId: campaign.id,
        accountId: account.id,
      });
      let signatureHtmlBlockContent = '';
      let signatureTextBlockContent = '';
      if (sigRes.signature) {
        const seed = `${freshJob.id}:${recipient.email}`;
        const htmlRendered = renderSignatureHtml(sigRes.signature.html, vars, seed).html;
        signatureHtmlBlockContent = signatureHtmlBlock(htmlRendered);
        signatureTextBlockContent = signatureTextBlock(renderSignatureText(sigRes.signature.text, vars, seed));
        // Explicit placement support: {{accountSignature}} in a body/preview
        // template now resolves to the real, rendered signature.
        if (htmlRendered) vars.accountSignature = htmlRendered;
      }

      const rendered = renderForRecipient({
        step, variants, vars,
        seed: `${freshJob.id}:${recipient.email}`,
        prevSubject,
      });
      const subject = rendered.subject;
      // Signature is appended ABOVE the unsubscribe footer (not mixed into the
      // body where a bad sig could eat the unsub link).
      const bodyHtml = `${rendered.html}${signatureHtmlBlockContent}`;
      const textWithSignature = htmlToPlainText(rendered.html) + signatureTextBlockContent;

      const result = await emailService.sendEmail(account, {
        to: recipient.email,
        subject,
        html: `${bodyHtml}<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:12px;color:#888"><a href="${unsubscribeUrl}">Unsubscribe</a></div>`,
        text: textWithSignature,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'X-Campaign-Id': campaign.id,
        },
      });

      if (result.ok) {
        await freshJob.update({ status: 'sent', sentAt: new Date(), messageId: result.messageId });
        await recipient.update({ lastSentAt: new Date(), status: 'active' });
        await account.update({ lastSentAt: new Date() }).catch(() => {});
        await recordEvent({
          organizationId: campaign.organizationId,
          campaignId: campaign.id,
          campaignRecipientId: recipient.id,
          emailJobId: freshJob.id,
          messageId: result.messageId,
          eventType: 'SENT',
          sendingAccountId: account.id,
          sequenceStepId: step.id,
          metadata: { subject },
        });
        await campaign.increment('emailsSent');
        results.sent++;
      } else {
        const attempts = freshJob.attempts + 1;
        const permanent = ['AUTHENTICATION_ERROR', 'PERMANENT_FAILURE', 'MAILBOX_UNAVAILABLE'].includes(result.failureClass);
        // Capacity was reserved before the SMTP attempt — give it back so a
        // failed send never burns a day/hour quota unit.
        await allocator.releaseUsage(account.id).catch(() => {});
        if (permanent || attempts >= freshJob.maxAttempts) {
          await freshJob.update({ status: 'failed', attempts, failureClass: result.failureClass, lastError: result.error });
          await recordEvent({
            organizationId: campaign.organizationId,
            campaignId: campaign.id,
            campaignRecipientId: recipient.id,
            emailJobId: freshJob.id,
            eventType: 'FAILED',
            sendingAccountId: account.id,
            sequenceStepId: step.id,
            metadata: { error: result.error, failureClass: result.failureClass },
          });
          await campaign.increment('totalFailed');
        } else {
          // transient: retry with exponential backoff + jitter (§36)
          const backoffMs = Math.min(2 ** attempts * 60 * 1000, 60 * 60 * 1000);
          const jitterMs = Math.floor(Math.random() * 30 * 1000);
          const retryAt = new Date(Date.now() + backoffMs + jitterMs);
          await freshJob.update({ status: 'queued', attempts, claimedAt: null, claimedBy: null, failureClass: result.failureClass, lastError: result.error, scheduledFor: retryAt });
        }
        results.failed++;
      }
    } catch (err) {
      if (reservedAccountId) await allocator.releaseUsage(reservedAccountId).catch(() => {});
      await freshJob.update({ status: 'failed', failureClass: 'permanent', lastError: 'internal error' }).catch(() => {});
      results.failed++;
    }
  }
  return results;
}

function startWorker(intervalMs = 20000) {
  const tick = async () => {
    try {
      await processDueJobs();
    } catch {
      // never crash the process from the worker loop
    }
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return handle;
}

module.exports = {
  ALLOWED_VARIABLES,
  renderTemplate,
  recipientVars,
  buildLeadVars,
  renderForRecipient,
  htmlToPlainText,
  isSuppressed,
  suppressEmail,
  withinSendingWindow,
  queueNextStepForRecipient,
  claimJob,
  recoverStaleJobs,
  processDueJobs,
  startWorker,
  recordEvent,
  WORKER_ID,
};
