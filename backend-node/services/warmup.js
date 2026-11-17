// Warm-up Engine (Prompt 8) — graduated, REAL sending from a new/cold SMTP
// account to seed mailboxes, tracked entirely from actual SMTP outcomes.
//
// What this is NOT: it does not fake "opens", "replies" or inbox placement.
// What it does: sends real messages (real SMTP handshakes, real failures)
// from the account to seed recipients, rotates a small set of subjects, and
// computes a health score strictly from real success/failure history.
const models = require('../models');
const emailService = require('./email');
const { Op } = require('sequelize');

const WARMUP_SUBJECTS = [
  'Quick check-in',
  'Following up',
  'Touching base',
  'Brief note from me',
  'Checking in again',
  'A quick hello',
  'Just a note',
];
const WARMUP_BODY = [
  'Hi,\n\nThis is a quick warm-up note from our sales intelligence platform. If you received this, delivery worked.\n\nBest,',
  'Hello,\n\nWarm-up ping from the outreach platform — confirming deliverability.\n\nThanks,',
  'Hi there,\n\nConfirming this mailbox can reach the outside world.\n\nWarmly,',
];

// ---------------------------------------------------------------------------
// Ramp math (pure, unit-testable).
// ---------------------------------------------------------------------------
function rampVolume(plan, dayIndex) {
  const start = Math.max(0, Number(plan.startVolume) || 0);
  const step = Math.max(0, Number(plan.rampStep) || 0);
  // Honor targetVolume as a hard cap even if misconfigured above startVolume.
  const target = Number(plan.targetVolume) > 0 ? Number(plan.targetVolume) : start;
  return Math.max(0, Math.min(target, start + Math.max(0, dayIndex | 0) * step));
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function dayIndexSince(startedOn) {
  const start = Date.parse(`${startedOn}T00:00:00Z`);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

function healthScore(plan) {
  const attempts = (plan.totalSent || 0) + (plan.totalFailed || 0);
  if (attempts < 10) return null; // not enough real data yet
  return Math.round((plan.totalSent / attempts) * 100);
}

async function resolveSeeds(plan) {
  if (plan.seedRecipients && String(plan.seedRecipients).trim()) {
    return String(plan.seedRecipients)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s));
  }
  const orgAccounts = await models.SmtpAccount.findAll({
    where: {
      organizationId: plan.organizationId,
      isEnabled: true,
      id: { [Op.ne]: plan.accountId },
    },
    attributes: ['id', 'fromEmail'],
  });
  return orgAccounts.map((a) => a.fromEmail).filter(Boolean);
}

/** Full runtime state for a plan, computed from real rows. */
async function planSnapshot(plan) {
  const dayIndex = dayIndexSince(plan.startedOn);
  const base = rampVolume(plan, dayIndex);
  const today = utcToday();
  const sentTodayDate = plan.sentTodayDate === today ? plan.sentToday : 0;
  const remaining = Math.max(0, Math.min(base, plan.targetVolume) - sentTodayDate);
  return {
    id: plan.id,
    status: plan.status,
    currentDay: dayIndex + 1,
    dailyTarget: base,
    sentToday: sentTodayDate,
    remainingToday: remaining,
    totalSent: plan.totalSent,
    totalFailed: plan.totalFailed,
    healthScore: healthScore(plan),
    startVolume: plan.startVolume,
    rampStep: plan.rampStep,
    targetVolume: plan.targetVolume,
    startedOn: plan.startedOn,
    consecutiveFailureDays: plan.consecutiveFailureDays || 0,
    seedRecipients: plan.seedRecipients || '',
  };
}

/** Ensure the daily counter reflects UTC day rollover. */
async function rolloverIfNewDay(plan) {
  const today = utcToday();
  if (plan.sentTodayDate !== today) {
    plan.sentToday = 0;
    plan.sentTodayDate = today;
    await plan.save({ fields: ['sentToday', 'sentTodayDate'] });
  }
}

/**
 * Send one warm-up message. REAL send — real SMTP, honest result.
 */
async function sendWarmupOnce(plan, account, seeds, seedOffset = 0) {
  if (!seeds.length) {
    if (plan.status !== 'paused') await plan.update({ status: 'paused' });
    return { sent: false, reason: 'no_seed_recipients' };
  }
  const target = seeds[(plan.totalSent + seedOffset) % seeds.length];
  const subject = WARMUP_SUBJECTS[plan.totalSent % WARMUP_SUBJECTS.length];
  const body = WARMUP_BODY[plan.totalSent % WARMUP_BODY.length];
  const result = await emailService.sendEmail(account, {
    to: target,
    subject,
    html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    text: body,
    headers: { 'X-Campaign-Id': 'warmup' },
  });

  if (result.ok) {
    await plan.increment('totalSent');
    await plan.increment('sentToday');
    return { sent: true, to: target };
  }
  await plan.increment('totalFailed');
  return { sent: false, to: target, reason: result.error || 'send_failed' };
}

/** One worker tick: send due warm-up mail for every warming account. */
async function processWarmupTick({ logger = console } = {}) {
  const results = { considered: 0, sent: 0, skipped: 0, paused: 0 };
  const plans = await models.WarmupPlan.findAll({
    where: { status: 'active' },
    include: [{ model: models.SmtpAccount, as: 'account' }],
  }).catch(() => []);
  for (const plan of plans) {
    results.considered++;
    const account = plan.account;
    if (!account || !account.isEnabled) { results.paused++; continue; }
    await rolloverIfNewDay(plan);
    const snap = await planSnapshot(plan);
    if (snap.remainingToday <= 0) { results.skipped++; continue; }
    const seeds = await resolveSeeds(plan);
    if (!seeds.length) { await plan.update({ status: 'paused' }); results.paused++; continue; }

    // Send at most a small batch per tick — keep SMTP load gentle.
    const batch = Math.min(snap.remainingToday, 5);
    let sentOk = 0;
    for (let i = 0; i < batch; i++) {
      const r = await sendWarmupOnce(plan, account, seeds, i);
      if (r.sent) sentOk++;
    }
    results.sent += sentOk;
    if (sentOk === 0 && batch > 0) {
      const streak = (plan.consecutiveFailureDays || 0) + 1;
      await plan.update({ consecutiveFailureDays: streak });
      if (streak >= 3) await plan.update({ status: 'paused' }); // honest auto-pause
    } else if (sentOk > 0) {
      await plan.update({ consecutiveFailureDays: 0 });
    }
  }
  return results;
}

let workerTimer = null;
function startWarmupWorker(intervalMs = 60000) {
  if (workerTimer) return workerTimer;
  const tick = async () => {
    try { await processWarmupTick(); }
    catch (err) { console.error('Warm-up tick error:', err); }
  };
  workerTimer = setInterval(tick, intervalMs);
  workerTimer.unref?.();
  // One immediate (caught) run at boot in non-test environments.
  if (process.env.NODE_ENV !== 'test') tick();
  return workerTimer;
}

module.exports = {
  rampVolume,
  dayIndexSince,
  healthScore,
  rolloverIfNewDay,
  planSnapshot,
  processWarmupTick,
  startWarmupWorker,
};
