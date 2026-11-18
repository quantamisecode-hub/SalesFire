// Campaign engine tests - Prompt 6 §12, §34, §35 (node:test).
// Covers: template substitution (unknown variables rejected), suppression
// blocking, and duplicate-send protection (atomic claim concurrency).
// Run: node --test test/campaign-engine.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-engine-database.sqlite';

const { sequelize } = require('../db');
const models = require('../models');
const engine = require('../services/campaign-engine');

before(async () => {
  // Create the schema in the isolated test database.
  await sequelize.sync();
  // The persistent sqlite test DB accumulates never-claimable queued jobs
  // from previous runs (SMTP in tests is unroutable), and the worker's claim
  // batch is FIFO-limited — stale rows would starve this run's jobs.
  await models.EmailJob.destroy({ where: {} });
  await models.EmailEvent.destroy({ where: {} });
});

// Campaign + real sequence step (email_jobs.step_id has an FK to it).
async function seedCampaignWithStep(org, user, name, status = 'active') {
  const campaign = await models.Campaign.create({
    organizationId: org.id, createdBy: user.id, name, status,
  });
  const sequence = await models.CampaignSequence.create({
    campaignId: campaign.id, organizationId: org.id, name: 'Seq', isActive: true,
  });
  const step = await models.CampaignStep.create({
    sequenceId: sequence.id, stepOrder: 0, name: 'Email 1',
    subjectTemplate: 'Hi {{first_name}}', bodyTemplate: 'Hello {{first_name}}',
    delayDays: 0, delayHours: 0,
  });
  return { campaign, sequence, step };
}

async function seedOrg() {
  const org = await models.Organization.create({ name: 'Engine Test Org ' + Date.now(), slug: 'engine-test-' + Date.now() });
  const user = await models.User.create({
    email: `engine-${Date.now()}@test.io`,
    fullName: 'Engine Tester',
    passwordHash: 'x',
    organizationId: org.id,
    role: 'owner',
  });
  return { org, user };
}

describe('renderTemplate (variable substitution)', () => {
  test('substitutes known variables', () => {
    const out = engine.renderTemplate(
      'Hi {{first_name}} {{last_name}} at {{company_name}}!',
      { first_name: 'Ada', last_name: 'Lovelace', company_name: 'Analytical Engines' }
    );
    assert.strictEqual(out, 'Hi Ada Lovelace at Analytical Engines!');
  });

  test('keeps unknown variables literal (rejected, not substituted)', () => {
    const out = engine.renderTemplate('Hello {{first_name}}, {{secret_admin_var}}', {
      first_name: 'Ada',
      secret_admin_var: 'p@ss',
    });
    assert.ok(out.includes('Ada'));
    assert.ok(out.includes('{{secret_admin_var}}'), 'unknown var must stay literal');
    assert.ok(!out.includes('p@ss'));
  });

  test('empty values render as empty string', () => {
    const out = engine.renderTemplate('Hi {{first_name}}!', { first_name: '' });
    assert.strictEqual(out, 'Hi !');
  });
});

describe('buildLeadVars (render context)', () => {
  const recipient = {
    firstName: 'Ada', lastName: 'Lovelace', companyName: 'Analytical Engines',
    jobTitle: 'CTO', email: 'ada@example.com',
  };

  test('resolves the imported personalization column in the real send path', () => {
    const lead = {
      firstName: 'Ada', lastName: 'Lovelace', companyName: 'Analytical Engines',
      jobTitle: 'CTO', personalization: 'Saw your Series B announcement',
      customFields: undefined,
    };
    const vars = engine.buildLeadVars(recipient, lead, null, 'https://example.com/unsub');
    assert.strictEqual(vars.personalization, 'Saw your Series B announcement');
    const rendered = engine.renderForRecipient({
      step: { subjectTemplate: 'Quick idea for {{first_name}}', bodyTemplate: '<p>Note: {{personalization}}</p>' },
      variants: [],
      vars,
      seed: 'test-seed',
    });
    assert.ok(rendered.html.includes('Saw your Series B announcement'));
    assert.ok(!rendered.html.includes('{{personalization}}'));
    assert.ok(!(rendered.unresolved || []).includes('personalization'));
  });

  test('personalization falls back to empty string when the lead has none', () => {
    const vars = engine.buildLeadVars(recipient, null, null, '');
    assert.strictEqual(vars.personalization, '');
  });

  test('imported custom fields still resolve alongside builtins', () => {
    const lead = { personalization: 'p', customFields: { recent_funding: '$40M', 'bad_key!': 'x' } };
    const vars = engine.buildLeadVars(recipient, lead, null, '');
    assert.strictEqual(vars.recent_funding, '$40M');
    assert.strictEqual(vars['bad_key!'], undefined);
    assert.strictEqual(vars.personalization, 'p');
  });
});

describe('suppression', () => {
  test('isSuppressed blocks emails on the org suppression list', async () => {
    const { org } = await seedOrg();
    await models.Suppression.create({
      organizationId: org.id,
      email: 'blocked@example.com',
      reason: 'unsubscribed',
      source: 'manual',
    });
    const hit = await engine.isSuppressed(org.id, 'BLOCKED@example.com'); // case-insensitive
    assert.strictEqual(hit.suppressed, true);
    assert.strictEqual(hit.reason, 'unsubscribed');
  });

  test('clean emails are not suppressed', async () => {
    const { org } = await seedOrg();
    const hit = await engine.isSuppressed(org.id, 'clean@example.com');
    assert.deepStrictEqual(hit, { suppressed: false });
  });

  test('missing email is treated as invalid/suppressed', async () => {
    const { org } = await seedOrg();
    const hit = await engine.isSuppressed(org.id, '');
    assert.strictEqual(hit.suppressed, true);
  });

  test('suppressEmail is idempotent (findOrCreate)', async () => {
    const { org } = await seedOrg();
    const [a] = await engine.suppressEmail({
      organizationId: org.id, email: 'dupe@example.com', reason: 'blocked', source: 'manual',
    });
    const [b] = await engine.suppressEmail({
      organizationId: org.id, email: 'dupe@example.com', reason: 'unsubscribed', source: 'unsubscribe_link',
    });
    assert.strictEqual(a.id, b.id, 'same row returned, not duplicated');
    const count = await models.Suppression.count({ where: { organizationId: org.id, email: 'dupe@example.com' } });
    assert.strictEqual(count, 1);
  });
});

describe('duplicate-send protection (Prompt 6 §34)', () => {
  test('two concurrent claims on one job: exactly one wins', async () => {
    const { org, user } = await seedOrg();
    const { campaign, step } = await seedCampaignWithStep(org, user, 'Claim Race');
    const recipient = await models.CampaignLead.create({
      campaignId: campaign.id,
      organizationId: org.id,
      email: 'race@example.com',
      status: 'queued',
    });
    const job = await models.EmailJob.create({
      organizationId: org.id,
      campaignId: campaign.id,
      campaignRecipientId: recipient.id,
      stepId: step.id,
      status: 'queued',
      scheduledFor: new Date(Date.now() - 1000),
    });

    // Simulate two workers claiming the same job simultaneously.
    const [a, b] = await Promise.all([engine.claimJob(job.id), engine.claimJob(job.id)]);
    const winners = [a, b].filter(Boolean);
    assert.strictEqual(winners.length, 1, 'exactly one worker wins the claim');

    const fresh = await models.EmailJob.findByPk(job.id);
    assert.strictEqual(fresh.status, 'sending');
    assert.strictEqual(fresh.claimedBy, engine.WORKER_ID);
  });

  test('a second sequential claim loses', async () => {
    const { org, user } = await seedOrg();
    const { campaign, step } = await seedCampaignWithStep(org, user, 'Claim Seq');
    const recipient = await models.CampaignLead.create({
      campaignId: campaign.id, organizationId: org.id, email: 'seq@example.com', status: 'queued',
    });
    const job = await models.EmailJob.create({
      organizationId: org.id, campaignId: campaign.id, campaignRecipientId: recipient.id,
      stepId: step.id, status: 'queued', scheduledFor: new Date(),
    });
    assert.strictEqual(await engine.claimJob(job.id), true);
    assert.strictEqual(await engine.claimJob(job.id), false, 'second claim must lose');
  });
});

describe('worker tick: suppression blocks sends before SMTP (§35)', () => {
  test('suppressed recipient job is marked suppressed and never sent', async () => {
    const { org, user } = await seedOrg();
    const account = await models.SmtpAccount.create({
      organizationId: org.id,
      createdBy: user.id,
      name: 'Engine Test SMTP',
      smtpHost: '127.0.0.1', // unroutable SMTP port: any real send attempt would fail loudly
      smtpPort: 1,
      security: 'none',
      fromEmail: 'sender@test.io',
      isEnabled: true,
    });
    const { campaign, step } = await seedCampaignWithStep(org, user, 'Suppression Tick');
    campaign.sendingAccountId = account.id;
    await campaign.save();
    await models.Suppression.create({
      organizationId: org.id, email: 'gone@example.com', reason: 'unsubscribed', source: 'unsubscribe_link',
    });
    const recipient = await models.CampaignLead.create({
      campaignId: campaign.id, organizationId: org.id, email: 'gone@example.com', status: 'queued',
    });
    await models.EmailJob.create({
      organizationId: org.id, campaignId: campaign.id, campaignRecipientId: recipient.id,
      stepId: step.id, status: 'queued',
      scheduledFor: new Date(Date.now() - 60000),
    });

    const results = await engine.processDueJobs();
    assert.ok(results.suppressed >= 1, 'job reported suppressed');

    const job = await models.EmailJob.findOne({ where: { campaignRecipientId: recipient.id } });
    assert.strictEqual(job.status, 'suppressed');
    // No SENT event exists for this recipient — nothing was emailed.
    const sentEvents = await models.EmailEvent.count({
      where: { campaignRecipientId: recipient.id, eventType: 'SENT' },
    });
    assert.strictEqual(sentEvents, 0, 'no SMTP send happened for a suppressed recipient');
  });

  test('jobs for a paused campaign are left queued (not sent)', async () => {
    const { org, user } = await seedOrg();
    const account = await models.SmtpAccount.create({
      organizationId: org.id, createdBy: user.id, name: 'Paused SMTP',
      smtpHost: '127.0.0.1', smtpPort: 1, security: 'none', fromEmail: 's@test.io', isEnabled: true,
    });
    const { campaign, step } = await seedCampaignWithStep(org, user, 'Paused Camp', 'paused');
    campaign.sendingAccountId = account.id;
    await campaign.save();
    const recipient = await models.CampaignLead.create({
      campaignId: campaign.id, organizationId: org.id, email: 'paused@example.com', status: 'queued',
    });
    const job = await models.EmailJob.create({
      organizationId: org.id, campaignId: campaign.id, campaignRecipientId: recipient.id,
      stepId: step.id, status: 'queued',
      scheduledFor: new Date(Date.now() - 60000),
    });

    await engine.processDueJobs();
    const fresh = await models.EmailJob.findByPk(job.id);
    assert.strictEqual(fresh.status, 'queued', 'paused campaign job stays queued');
    const sentEvents = await models.EmailEvent.count({
      where: { campaignRecipientId: recipient.id, eventType: 'SENT' },
    });
    assert.strictEqual(sentEvents, 0);
  });
});

after(async () => {
  await sequelize.close();
});
