// Multi Sending Accounts — PROMPT 9.1 test suite (node:test).
// Covers: atomic quota reservation under concurrency, weighted/round-robin/
// availability allocation, global account limits across campaigns, idempotency,
// recipient-level assignment, stickiness + fallback policy, account schedules,
// pool validation (weighted sum = 100), tenant isolation and audit plumbing.
// Run: node --test test/multi-sending-accounts.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-multi-account-database.sqlite';

const { sequelize } = require('../db');
const models = require('../models');
const allocator = require('../services/sending-account-allocator');
const poolService = require('../services/campaign-sending-account-service');
const engine = require('../services/campaign-engine');
const emailService = require('../services/email');
const { encryptSecret } = require('../services/crypto');

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedOrg() {
  const id = uniq();
  const org = await models.Organization.create({ name: `MA Org ${id}`, slug: `ma-org-${id}` });
  const user = await models.User.create({
    email: `ma-${id}@test.io`, fullName: 'MA Tester',
    passwordHash: 'x', organizationId: org.id, role: 'owner',
  });
  return { org, user };
}

async function seedAccount(org, user, overrides = {}) {
  return models.SmtpAccount.create({
    organizationId: org.id, createdBy: user.id,
    name: overrides.name || `Account ${uniq()}`,
    smtpHost: '127.0.0.1', smtpPort: 1, security: 'none',
    fromEmail: overrides.fromEmail || `sender-${uniq()}@test.io`,
    fromName: overrides.fromName || 'Sender',
    isEnabled: true, status: 'verified',
    smtpPasswordEncrypted: encryptSecret('test-password'),
    ...overrides,
  });
}

async function seedCampaign(org, user, overrides = {}) {
  return models.Campaign.create({
    organizationId: org.id, createdBy: user.id, name: `MA Camp ${uniq()}`, status: 'active',
    accountDistribution: 'weighted',
    // Wide window so the schedule gate never flakes outside working hours.
    sendDaysOfWeek: [1, 2, 3, 4, 5, 6, 7], sendBetweenStartHour: 0, sendBetweenEndHour: 24,
    ...overrides,
  });
}

async function seedRecipient(campaign, email) {
  return models.CampaignLead.create({
    campaignId: campaign.id, organizationId: campaign.organizationId, email, status: 'queued',
  });
}

before(async () => {
  await sequelize.sync();
  // Isolate from stale rows left by earlier aborted runs (fresh file per run).
  await models.EmailJob.destroy({ where: {} });
  await models.EmailEvent.destroy({ where: {} });
});

after(async () => {
  await sequelize.close();
});

describe('atomic quota reservation (§26, §27, §38, §39)', () => {
  test('100 concurrent allocations never exceed daily_limit=50', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user, { dailyLimit: 50, hourlyLimit: null });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
    });

    const recipient = await seedRecipient(campaign, 'quota@test.io');
    const attempts = Array.from({ length: 100 }, () =>
      allocator.allocateAndReserve(campaign, recipient, new Date()));
    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.ok).length;
    assert.strictEqual(succeeded, 50, `exactly 50 sends allowed, got ${succeeded}`);

    const usage = await models.SendingAccountUsage.findOne({
      where: { smtpAccountId: account.id, periodType: 'day', periodKey: allocator.utcDayKey() },
    });
    assert.strictEqual(usage.used, 50);
  });

  test('hourly limit caps even when daily has room', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user, { dailyLimit: 50, hourlyLimit: 10 });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
    });
    const recipient = await seedRecipient(campaign, 'hourly@test.io');
    const results = await Promise.all(
      Array.from({ length: 30 }, () => allocator.allocateAndReserve(campaign, recipient, new Date()))
    );
    assert.strictEqual(results.filter((r) => r.ok).length, 10);
  });

  test('global account limit is shared across campaigns (§59)', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user, { dailyLimit: 5, hourlyLimit: null });
    const campA = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    const campB = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    for (const c of [campA, campB]) {
      await models.CampaignSendingAccount.create({
        campaignId: c.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
      });
    }
    const resultsA = await Promise.all(Array.from({ length: 4 }, async () =>
      allocator.allocateAndReserve(campA, await seedRecipient(campA, `a-${uniq()}@test.io`), new Date())));
    const resultsB = await Promise.all(Array.from({ length: 4 }, async () =>
      allocator.allocateAndReserve(campB, await seedRecipient(campB, `b-${uniq()}@test.io`), new Date())));
    const okA = resultsA.filter((r) => r.ok).length;
    const okB = resultsB.filter((r) => r.ok).length;
    assert.strictEqual(okA + okB, 5, 'shared account cap must hold across campaigns');
  });

  test('campaign maxEmailsPerDay tightens but never exceeds the account limit (§37)', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user, { dailyLimit: 50, hourlyLimit: null });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin', maxEmailsPerDay: 3 });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
    });
    const recipient = await seedRecipient(campaign, 'cap@test.io');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => allocator.allocateAndReserve(campaign, recipient, new Date()))
    );
    assert.strictEqual(results.filter((r) => r.ok).length, 3);
  });

  test('releaseUsage gives capacity back (failed send does not burn quota)', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user, { dailyLimit: 1, hourlyLimit: null });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
    });
    const recipient = await seedRecipient(campaign, 'release@test.io');
    const first = await allocator.allocateAndReserve(campaign, recipient, new Date());
    assert.ok(first.ok);
    const second = await allocator.allocateAndReserve(campaign, recipient, new Date());
    assert.ok(!second.ok, 'exhausted');
    await allocator.releaseUsage(account.id);
    const third = await allocator.allocateAndReserve(campaign, recipient, new Date());
    assert.ok(third.ok, 'released capacity is reusable');
  });
});

describe('distribution strategies (§21, §53, §55)', () => {
  test('weighted allocation converges to configured weights', async () => {
    const { org, user } = await seedOrg();
    const a = await seedAccount(org, user, { name: 'WA', fromEmail: 'a@wa.test', dailyLimit: 10000, hourlyLimit: null });
    const b = await seedAccount(org, user, { name: 'WB', fromEmail: 'b@wb.test', dailyLimit: 10000, hourlyLimit: null });
    const c = await seedAccount(org, user, { name: 'WC', fromEmail: 'c@wc.test', dailyLimit: 10000, hourlyLimit: null });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'weighted' });
    for (const [acct, weight] of [[a, 50], [b, 30], [c, 20]]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight,
      });
    }
    const counts = new Map();
    for (let i = 0; i < 60; i++) {
      const r = await seedRecipient(campaign, `w-${i}@test.io`);
      const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
      assert.ok(alloc.ok);
      counts.set(alloc.account.id, (counts.get(alloc.account.id) || 0) + 1);
    }
    const ca = counts.get(a.id) || 0, cb = counts.get(b.id) || 0, cc = counts.get(c.id) || 0;
    assert.strictEqual(ca + cb + cc, 60);
    assert.ok(ca > cb && cb > cc, `expected 50/30/20-ish, got ${ca}/${cb}/${cc}`);
    assert.ok(Math.abs(ca - 30) <= 8, `A should be near 30, got ${ca}`);
    assert.ok(Math.abs(cb - 18) <= 8, `B should be near 18, got ${cb}`);
    assert.ok(Math.abs(cc - 12) <= 8, `C should be near 12, got ${cc}`);
  });

  test('round_robin spreads load evenly', async () => {
    const { org, user } = await seedOrg();
    const a = await seedAccount(org, user, { name: 'RA', fromEmail: 'a@rr.test', dailyLimit: 10000, hourlyLimit: null });
    const b = await seedAccount(org, user, { name: 'RB', fromEmail: 'b@rr.test', dailyLimit: 10000, hourlyLimit: null });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    for (const acct of [a, b]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const counts = new Map();
    for (let i = 0; i < 20; i++) {
      const r = await seedRecipient(campaign, `rr-${i}@test.io`);
      const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
      assert.ok(alloc.ok);
      counts.set(alloc.account.id, (counts.get(alloc.account.id) || 0) + 1);
    }
    assert.strictEqual(counts.get(a.id), 10);
    assert.strictEqual(counts.get(b.id), 10);
  });

  test('availability_based prefers the account with most remaining capacity', async () => {
    const { org, user } = await seedOrg();
    const small = await seedAccount(org, user, { name: 'SA', fromEmail: 'small@avail.test', dailyLimit: 10, hourlyLimit: null });
    const large = await seedAccount(org, user, { name: 'LA', fromEmail: 'large@avail.test', dailyLimit: 1000, hourlyLimit: null });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'availability_based' });
    for (const acct of [small, large]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const counts = new Map();
    for (let i = 0; i < 12; i++) {
      const r = await seedRecipient(campaign, `av-${i}@test.io`);
      const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
      assert.ok(alloc.ok);
      counts.set(alloc.account.id, (counts.get(alloc.account.id) || 0) + 1);
    }
    assert.ok((counts.get(large.id) || 0) >= (counts.get(small.id) || 0));
  });
});

describe('eligibility, stickiness and fallback (§24, §32, §72, §78, §79)', () => {
  test('paused accounts are excluded from allocation', async () => {
    const { org, user } = await seedOrg();
    const paused = await seedAccount(org, user, { isEnabled: false });
    const live = await seedAccount(org, user, { name: 'Live', fromEmail: 'live@test.io' });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    for (const acct of [paused, live]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const r = await seedRecipient(campaign, 'pause-test@test.io');
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(alloc.ok);
    assert.strictEqual(alloc.account.id, live.id);
  });

  test('all accounts paused → allocation fails honestly, nothing is sent', async () => {
    const { org, user } = await seedOrg();
    const paused = await seedAccount(org, user, { isEnabled: false });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: paused.id, weight: 100,
    });
    const r = await seedRecipient(campaign, 'none-test@test.io');
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(!alloc.ok);
    assert.match(alloc.reason, /no eligible account/i);
  });

  test('error-status accounts are excluded until re-verified', async () => {
    const { org, user } = await seedOrg();
    const broken = await seedAccount(org, user, { status: 'error' });
    const healthy = await seedAccount(org, user, { name: 'Healthy', fromEmail: 'healthy@test.io', status: 'verified' });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    for (const acct of [broken, healthy]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const r = await seedRecipient(campaign, 'smtp-test@test.io');
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(alloc.ok);
    assert.strictEqual(alloc.account.id, healthy.id);
  });

  test('critical health excludes the account', async () => {
    const { org, user } = await seedOrg();
    const sick = await seedAccount(org, user, { healthStatus: 'critical' });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: sick.id, weight: 100,
    });
    const r = await seedRecipient(campaign, 'health@test.io');
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(!alloc.ok);
  });

  test('account disabled for today (per-day schedule) is excluded', async () => {
    const { org, user } = await seedOrg();
    const isoDay = String(allocator.tzParts('UTC', new Date()).isoDay);
    // Disable only today — but every OTHER day must be enabled for contrast.
    const schedule = {};
    for (const d of ['1', '2', '3', '4', '5', '6', '7']) {
      schedule[d] = { enabled: d !== isoDay, start: '00:00', end: '23:59' };
    }
    const off = await seedAccount(org, user, { sendingSchedule: schedule, timezone: 'UTC' });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin' });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: off.id, weight: 100,
    });
    const r = await seedRecipient(campaign, 'schedule@test.io');
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(!alloc.ok, 'account scheduled off today must not be reachable');
  });

  test('sticky recipients stay on the assigned account', async () => {
    const { org, user } = await seedOrg();
    const a = await seedAccount(org, user, { name: 'SA', fromEmail: 'stick-a@test.io' });
    const b = await seedAccount(org, user, { name: 'SB', fromEmail: 'stick-b@test.io' });
    const campaign = await seedCampaign(org, user, { accountDistribution: 'round_robin', accountStickiness: 'sticky' });
    for (const acct of [a, b]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const r = await seedRecipient(campaign, 'sticky@test.io');
    await r.update({ sendingAccountId: b.id, assignmentMethod: 'sticky', assignedAt: new Date() });
    for (let i = 0; i < 5; i++) {
      const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
      assert.ok(alloc.ok);
      assert.strictEqual(alloc.account.id, b.id);
      assert.strictEqual(alloc.method, 'sticky');
    }
  });

  test('fallback policy "pause" holds the recipient when the assigned account is gone', async () => {
    const { org, user } = await seedOrg();
    const assigned = await seedAccount(org, user, { name: 'Gone', fromEmail: 'gone@test.io', isEnabled: false });
    const other = await seedAccount(org, user, { name: 'Other', fromEmail: 'other@test.io' });
    const campaign = await seedCampaign(org, user, {
      accountDistribution: 'round_robin', accountStickiness: 'sticky', fallbackPolicy: 'pause',
    });
    for (const acct of [assigned, other]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const r = await seedRecipient(campaign, 'fallback-pause@test.io');
    await r.update({ sendingAccountId: assigned.id, assignmentMethod: 'sticky', assignedAt: new Date() });
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(!alloc.ok);
    assert.strictEqual(alloc.paused, true);
  });

  test('fallback policy "reassign" moves the recipient to another eligible account', async () => {
    const { org, user } = await seedOrg();
    const assigned = await seedAccount(org, user, { name: 'Gone2', fromEmail: 'gone2@test.io', isEnabled: false });
    const other = await seedAccount(org, user, { name: 'Other2', fromEmail: 'other2@test.io' });
    const campaign = await seedCampaign(org, user, {
      accountDistribution: 'round_robin', accountStickiness: 'sticky', fallbackPolicy: 'reassign',
    });
    for (const acct of [assigned, other]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight: 50,
      });
    }
    const r = await seedRecipient(campaign, 'fallback-reassign@test.io');
    await r.update({ sendingAccountId: assigned.id, assignmentMethod: 'sticky', assignedAt: new Date() });
    const alloc = await allocator.allocateAndReserve(campaign, r, new Date());
    assert.ok(alloc.ok);
    assert.strictEqual(alloc.account.id, other.id);
  });
});

describe('idempotency (§28)', () => {
  test('queueing the same step twice creates exactly one job', async () => {
    const { org, user } = await seedOrg();
    const campaign = await models.Campaign.create({
      organizationId: org.id, createdBy: user.id, name: `Idem ${uniq()}`, status: 'active',
    });
    const sequence = await models.CampaignSequence.create({
      campaignId: campaign.id, organizationId: org.id, name: 'Seq', isActive: true,
    });
    const step = await models.CampaignStep.create({
      sequenceId: sequence.id, stepOrder: 0, name: 'Email 1',
      subjectTemplate: 'Hi', bodyTemplate: 'Body', delayDays: 0,
    });
    const recipient = await seedRecipient(campaign, 'idem@test.io');
    const first = await engine.queueNextStepForRecipient(campaign, recipient, null, new Date());
    // Simulate a worker crash + retry: the recipient counter rolled back to 0
    // but the job row survived. Re-enqueueing the same step must return the
    // existing job, not create a duplicate.
    await recipient.update({ currentStep: 0 });
    const retried = await engine.queueNextStepForRecipient(
      campaign, await models.CampaignLead.findByPk(recipient.id), null, new Date()
    );
    assert.strictEqual(retried.id, first.id, 'retry returns the original job');
    const count = await models.EmailJob.count({
      where: { campaignId: campaign.id, campaignRecipientId: recipient.id },
    });
    assert.strictEqual(count, 1);
    // Idempotency key present on the persisted job
    const job = await models.EmailJob.findByPk(first.id);
    assert.ok(job.idempotencyKey && job.idempotencyKey.includes(String(recipient.id)));
  });
});

describe('pool management + validation (§18-22, §51)', () => {
  test('weighted pool not summing to 100 fails launch validation', async () => {
    const { org, user } = await seedOrg();
    const a = await seedAccount(org, user);
    const b = await seedAccount(org, user);
    const campaign = await seedCampaign(org, user, { accountDistribution: 'weighted' });
    for (const [acct, weight] of [[a, 40], [b, 40]]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight,
      });
    }
    const result = await poolService.validatePoolForLaunch(campaign);
    assert.ok(!result.ok);
    assert.ok(result.issues.some((i) => /distribution must equal 100/i.test(i)));
  });

  test('weighted pool summing to 100 passes', async () => {
    const { org, user } = await seedOrg();
    const a = await seedAccount(org, user);
    const b = await seedAccount(org, user);
    const campaign = await seedCampaign(org, user, { accountDistribution: 'weighted' });
    for (const [acct, weight] of [[a, 60], [b, 40]]) {
      await models.CampaignSendingAccount.create({
        campaignId: campaign.id, organizationId: org.id, smtpAccountId: acct.id, weight,
      });
    }
    const result = await poolService.validatePoolForLaunch(campaign);
    assert.ok(result.ok, JSON.stringify(result.issues));
  });

  test('account from another organization cannot be added to the pool (IDOR)', async () => {
    const { org, user } = await seedOrg();
    const { org: otherOrg, user: otherUser } = await seedOrg();
    const foreignAccount = await seedAccount(otherOrg, otherUser);
    const campaign = await seedCampaign(org, user);
    const result = await poolService.addAccountToCampaign({ campaign, smtpAccountId: foreignAccount.id });
    assert.ok(!result.ok);
    assert.strictEqual(result.status, 404, 'foreign account must be indistinguishable from missing');
  });

  test('removing an account with scheduled recipients requires an explicit policy', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user);
    const campaign = await seedCampaign(org, user);
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
    });
    const r = await seedRecipient(campaign, 'sched@test.io');
    await r.update({ sendingAccountId: account.id, status: 'queued' });

    const pool = await models.CampaignSendingAccount.findOne({
      where: { campaignId: campaign.id, smtpAccountId: account.id },
    });

    // No policy → blocked with scheduledRecipients reported
    const blocked = await poolService.removeAccountFromCampaign({ campaign, poolId: pool.id });
    assert.ok(!blocked.ok);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.scheduledRecipients, 1);

    // reassign policy → assignments cleared, account removed
    const reassigned = await poolService.removeAccountFromCampaign({ campaign, poolId: pool.id, removalPolicy: 'reassign' });
    assert.ok(reassigned.ok);
    const fresh = await models.CampaignLead.findByPk(r.id);
    assert.strictEqual(fresh.sendingAccountId, null);
  });
});

describe('env-to-envelope integrity (§47, §48)', () => {
  test('the account actually used to send is the assigned account', async () => {
    const { org, user } = await seedOrg();
    const account = await seedAccount(org, user, {
      name: 'Envelope', fromEmail: 'envelope@test.io', fromName: 'Envelope Sender', replyToEmail: 'replies@test.io',
    });
    const campaign = await seedCampaign(org, user, { status: 'active' });
    const sequence = await models.CampaignSequence.create({
      campaignId: campaign.id, organizationId: org.id, name: 'Seq', isActive: true,
    });
    const step = await models.CampaignStep.create({
      sequenceId: sequence.id, stepOrder: 0, name: 'Email 1',
      subjectTemplate: 'Hi {{first_name}}', bodyTemplate: '<p>Hello {{first_name}}</p>', delayDays: 0,
    });
    await models.CampaignSendingAccount.create({
      campaignId: campaign.id, organizationId: org.id, smtpAccountId: account.id, weight: 100,
    });
    const recipient = await seedRecipient(campaign, 'envelope-recipient@test.io');
    await models.EmailJob.create({
      organizationId: org.id, campaignId: campaign.id, campaignRecipientId: recipient.id,
      stepId: step.id, status: 'queued', scheduledFor: new Date(Date.now() - 1000),
      idempotencyKey: `test-envelope-${uniq()}`,
    });

    const realSend = emailService.sendEmail;
    const seen = [];
    emailService.sendEmail = async (acct, message) => {
      seen.push({ acctId: acct.id, replyTo: acct.replyToEmail, from: acct.fromEmail, to: message.to });
      return { ok: true, messageId: `msg-${uniq()}` };
    };
    try {
      const results = await engine.processDueJobs();
      assert.ok(results.sent >= 1, 'job sent');
    } finally {
      emailService.sendEmail = realSend;
    }
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].acctId, account.id);
    assert.strictEqual(seen[0].from, 'envelope@test.io');
    assert.strictEqual(seen[0].replyTo, 'replies@test.io');
    const freshRecipient = await models.CampaignLead.findByPk(recipient.id);
    assert.strictEqual(freshRecipient.sendingAccountId, account.id);
  });
});
