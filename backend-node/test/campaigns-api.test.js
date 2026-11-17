// Campaign API integration tests - Prompt 6 §19, §20, §48, §49 (node:test).
// Runs against a real HTTP server on a test port with an isolated test DB.
// Run: node --test test/campaigns-api.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-api-database.sqlite';
process.env.PORT = '8901';
process.env.ENVIRONMENT = 'test'; // silences SQL query logging

const BASE = 'http://localhost:8901/api/v1';

let cookie = null; // auth session cookie

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.includes('access_token=')) {
    cookie = setCookie.split(';')[0];
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (process.env.API_TEST_DEBUG && res.status >= 400) {
    console.error(`DEBUG ${method} ${path} -> ${res.status}`, JSON.stringify(json)?.slice(0, 300));
  }
  return { status: res.status, json };
}

before(async () => {
  const { sequelize } = require('../db');
  require('../models');
  await sequelize.sync(); // test env: build schema in the isolated test DB
  require('../server'); // starts listening on PORT asynchronously after connectDB
  // Wait for the server to come up.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:8901/health');
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0); // the HTTP server keeps the loop alive; tests are done
});

describe('auth + tenant setup', () => {
  test('signup gives an authenticated session', async () => {
    const { status } = await api('POST', '/auth/register', {
      email: `api-test-${Date.now()}@test.io`,
      password: 'ApiTest123!',
      full_name: 'API Tester',
      organization_name: `API Test Org ${Date.now()}`,
    });
    assert.ok([200, 201].includes(status), `signup failed with ${status}`);
  });

  test('requests without a session are rejected', async () => {
    const saved = cookie;
    cookie = null;
    const { status } = await api('GET', '/campaigns');
    assert.strictEqual(status, 401);
    cookie = saved;
  });
});

describe('launch validation (Prompt 6 §19) - backend enforced', () => {
  let campaignId;

  test('launching an empty draft fails with concrete problems', async () => {
    const create = await api('POST', '/campaigns', { name: 'Launch Validation' });
    campaignId = create.json.data.id;

    const launch = await api('POST', `/campaigns/${campaignId}/launch`);
    assert.strictEqual(launch.status, 422);
    assert.ok(Array.isArray(launch.json.problems), 'returns the list of problems');
    assert.ok(launch.json.problems.some((p) => /sequence/i.test(p)));
    assert.ok(launch.json.problems.some((p) => /recipient/i.test(p)));
  });

  test('launching without a sending account fails', async () => {
    const camp = await api('POST', '/campaigns', { name: 'No Account' });
    // enroll a valid recipient + create a sequence step
    await api('POST', `/campaigns/${camp.json.data.id}/recipients`, {
      recipients: [{ email: 'valid@example.com', firstName: 'Val', lastName: 'Id', companyName: 'Valid Co', jobTitle: 'CEO' }],
    });
    const seq = await api('POST', `/campaigns/${camp.json.data.id}/sequences`, {
      name: 'Seq', steps: [{ name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: 'Hello {{first_name}}', delayDays: 0 }],
    });
    assert.ok(seq.status === 201 || seq.status === 200, 'sequence created');

    const launch = await api('POST', `/campaigns/${camp.json.data.id}/launch`);
    assert.strictEqual(launch.status, 422);
    assert.ok(launch.json.problems.some((p) => /sending account/i.test(p)));
  });

  test('review without a sequence is rejected', async () => {
    const camp = await api('POST', '/campaigns', { name: 'Review Empty' });
    const review = await api('POST', `/campaigns/${camp.json.data.id}/review`);
    assert.strictEqual(review.status, 422);
  });
});

describe('recipients + audience counts (Prompt 6 §9)', () => {
  let campaignId;

  before(async () => {
    const create = await api('POST', '/campaigns', { name: 'Audience' });
    campaignId = create.json.data.id;
  });

  test('enrolls recipients with snapshot details', async () => {
    const res = await api('POST', `/campaigns/${campaignId}/recipients`, {
      recipients: [
        { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', companyName: 'Analytical', jobTitle: 'Engineer' },
        { email: 'grace@example.com', firstName: 'Grace', lastName: 'Hopper', companyName: 'Navy', jobTitle: 'Rear Admiral' },
        { email: 'not-an-email', firstName: 'Bad' },
      ],
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.counts.created, 2);
    assert.strictEqual(res.json.counts.rejected, 1);
  });

  test('duplicate enrollment is rejected', async () => {
    const res = await api('POST', `/campaigns/${campaignId}/recipients`, {
      recipients: [{ email: 'ada@example.com', firstName: 'Ada' }],
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.counts.created, 0);
    assert.strictEqual(res.json.counts.rejected, 1);
    assert.match(res.json.data.rejected[0].reason, /already enrolled/);
  });

  test('audience counts are computed server-side', async () => {
    const res = await api('GET', `/campaigns/${campaignId}/audience-counts`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.total, 2);
    assert.strictEqual(res.json.data.eligible, 2);
    assert.strictEqual(res.json.data.invalid, 0);
  });

  test('suppressed emails count as suppressed, not eligible', async () => {
    // Suppress ada via the org-wide suppression list (direct DB insert here;
    // the unsubscribe flow is covered E2E).
    const models = require('../models');
    const campaign = await models.Campaign.findByPk(campaignId);
    await models.Suppression.create({
      organizationId: campaign.organizationId, email: 'ada@example.com', reason: 'blocked', source: 'manual',
    });
    const res = await api('GET', `/campaigns/${campaignId}/audience-counts`);
    assert.strictEqual(res.json.data.eligible, 1);
    assert.strictEqual(res.json.data.suppressed, 1);
  });

  test('recipient list supports search + pagination', async () => {
    const res = await api('GET', `/campaigns/${campaignId}/recipients?search=grace&page=1&pageSize=1`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.length, 1);
    assert.strictEqual(res.json.data[0].email, 'grace@example.com');
    assert.strictEqual(res.json.pagination.total, 1);
  });
});

describe('lifecycle transitions (Prompt 6 §20)', () => {
  let campaignId;

  before(async () => {
    const create = await api('POST', '/campaigns', { name: 'Lifecycle' });
    campaignId = create.json.data.id;
    // Attach an enabled SMTP account so launch validation passes.
    const account = await api('POST', '/email-sending/accounts', {
      name: 'Lifecycle SMTP', smtpHost: 'smtp.lifecycle.test', smtpPort: 587,
      security: 'tls', smtpUsername: 'l@test.io', smtpPassword: 'pw-123456',
      fromEmail: 'l@test.io', fromName: 'Lifecycle',
    });
    const models = require('../models');
    await models.Campaign.update(
      { sendingAccountId: account.json.data.id },
      { where: { id: campaignId } }
    );
    await api('POST', `/campaigns/${campaignId}/recipients`, {
      recipients: [{ email: 'life@example.com', firstName: 'Life' }],
    });
    await api('POST', `/campaigns/${campaignId}/sequences`, {
      name: 'Seq',
      steps: [{ name: 'Email 1', subjectTemplate: 'S {{first_name}}', bodyTemplate: 'B {{first_name}}', delayDays: 0 }],
    });
  });

  test('illegal transition draft -> active is blocked', async () => {
    const res = await api('POST', `/campaigns/${campaignId}/pause`);
    assert.strictEqual(res.status, 400, 'pausing a draft must fail');
  });

  test('legal path: review -> schedule -> launch -> pause -> resume', async () => {
    const review = await api('POST', `/campaigns/${campaignId}/review`);
    assert.strictEqual(review.status, 200);
    assert.strictEqual(review.json.data.status, 'ready_for_review');

    const schedule = await api('POST', `/campaigns/${campaignId}/schedule`, {
      scheduledStartAt: new Date(Date.now() - 3600_000).toISOString(), // past = due now
    });
    assert.strictEqual(schedule.status, 200);
    assert.strictEqual(schedule.json.data.status, 'scheduled');

    const launch = await api('POST', `/campaigns/${campaignId}/launch`);
    assert.strictEqual(launch.status, 200, JSON.stringify(launch.json));
    assert.strictEqual(launch.json.data.status, 'active');
    assert.ok(launch.json.queuedJobs >= 1, 'first-step jobs queued');

    const pause = await api('POST', `/campaigns/${campaignId}/pause`);
    assert.strictEqual(pause.status, 200);
    assert.strictEqual(pause.json.data.status, 'paused');

    const resume = await api('POST', `/campaigns/${campaignId}/resume`);
    assert.strictEqual(resume.status, 200);
    assert.strictEqual(resume.json.data.status, 'active');
  });

  test('paused campaigns stay editable; resume enforces the content gate', async () => {
    // Active campaigns are still locked.
    const locked = await api('PUT', `/campaigns/${campaignId}/sequences/${(await api('GET', `/campaigns/${campaignId}/sequences`)).json.data[0].id}`, { name: 'Nope', steps: [{ name: 'E', subjectTemplate: 's', bodyTemplate: 'b' }] });
    assert.strictEqual(locked.status, 400);

    const pause = await api('POST', `/campaigns/${campaignId}/pause`);
    assert.strictEqual(pause.status, 200);

    // Paused campaigns can be edited — including breaking the content.
    const seqId = (await api('GET', `/campaigns/${campaignId}/sequences`)).json.data[0].id;
    const empty = await api('PUT', `/campaigns/${campaignId}/sequences/${seqId}`, {
      name: 'Seq',
      steps: [{ name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: '', delayDays: 0 }],
    });
    assert.strictEqual(empty.status, 200, JSON.stringify(empty.json));

    // Resume must refuse a body-less sequence with concrete problems.
    const blocked = await api('POST', `/campaigns/${campaignId}/resume`);
    assert.strictEqual(blocked.status, 422);
    assert.ok(Array.isArray(blocked.json.problems));
    assert.ok(blocked.json.problems.some((p) => /body|empty/i.test(p)));

    // Restore valid content; resume now succeeds.
    const fixed = await api('PUT', `/campaigns/${campaignId}/sequences/${seqId}`, {
      name: 'Seq',
      steps: [{ name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: 'Body {{first_name}}', delayDays: 0 }],
    });
    assert.strictEqual(fixed.status, 200, JSON.stringify(fixed.json));

    // Enrolled recipient was repointed at the recreated step (no dead ids).
    const models = require('../models');
    const newStep = (await models.CampaignStep.findOne({ where: { sequenceId: seqId, stepOrder: 0 } })).toJSON();
    const lead = (await models.CampaignLead.findOne({ where: { campaignId } })).toJSON();
    assert.strictEqual(lead.currentStepId, newStep.id, 'recipient current_step_id remapped to recreated step');

    const resume = await api('POST', `/campaigns/${campaignId}/resume`);
    assert.strictEqual(resume.status, 200, JSON.stringify(resume.json));
    assert.strictEqual(resume.json.data.status, 'active');
  });

  test('jobs exist and QUEUED events were recorded', async () => {
    const events = await api('GET', `/campaigns/${campaignId}/events`);
    assert.strictEqual(events.status, 200);
    assert.ok(events.json.data.length >= 1);
    assert.ok(events.json.data.some((e) => e.eventType === 'QUEUED'));
  });
});

describe('multi-tenancy (Prompt 6 §49) - IDOR protection', () => {
  test('foreign campaign ids return 404, not data', async () => {
    // A random UUID cannot belong to this org.
    const foreignId = '00000000-0000-4000-8000-000000000000';
    const res = await api('GET', `/campaigns/${foreignId}`);
    assert.strictEqual(res.status, 404);
    const launch = await api('POST', `/campaigns/${foreignId}/launch`);
    assert.strictEqual(launch.status, 404);
    const recipients = await api('GET', `/campaigns/${foreignId}/recipients`);
    assert.strictEqual(recipients.status, 404);
  });
});

describe('SMTP accounts (Prompt 6 §27-31)', () => {
  let accountId;

  test('create account; password is never returned', async () => {
    const res = await api('POST', '/email-sending/accounts', {
      name: 'Postfix Main', smtpHost: 'smtp.test.local', smtpPort: 587, security: 'tls',
      smtpUsername: 'sender@test.local', smtpPassword: 'super-secret-123',
      fromEmail: 'sender@test.local', fromName: 'Sales Team', dailyLimit: 400, hourlyLimit: 40,
    });
    assert.strictEqual(res.status, 201);
    accountId = res.json.data.id;
    const raw = JSON.stringify(res.json);
    assert.ok(!raw.includes('super-secret-123'), 'plaintext password must never be returned');
    assert.ok(!raw.includes('smtpPasswordEncrypted'), 'ciphertext must never be returned');
    assert.strictEqual(res.json.data.hasPassword, true);
  });

  test('test connection reports the real result (DNS failure, sanitized)', async () => {
    const res = await api('POST', `/email-sending/accounts/${accountId}/test`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, false, 'unreachable host must fail honestly');
    assert.match(res.json.message, /not found|failed|timed out|refused/i);
    const raw = JSON.stringify(res.json);
    assert.ok(!/stack|at\s+\(|node_modules/.test(raw), 'no stack traces leaked');
  });

  test('send-test rejects invalid addresses', async () => {
    const res = await api('POST', `/email-sending/accounts/${accountId}/send-test`, { to: 'not-an-email' });
    assert.strictEqual(res.status, 422);
  });

  test('delete blocked while campaigns reference the account (409)', async () => {
    const camp = await api('POST', '/campaigns', { name: 'Attached' });
    const models = require('../models');
    await models.Campaign.update(
      { sendingAccountId: accountId },
      { where: { id: camp.json.data.id } }
    );
    const del = await api('DELETE', `/email-sending/accounts/${accountId}`);
    assert.strictEqual(del.status, 409);
  });
});

describe('AI personalization honesty (Prompt 6 §14-15)', () => {
  test('returns 501 (not fake content) when the provider is not configured', async () => {
    delete process.env.KIMI_API_KEY;
    const camp = await api('POST', '/campaigns', { name: 'AI Camp', aiPersonalizationEnabled: true });
    // The AI endpoint needs a sequence step and a recipient to personalize for.
    await api('POST', `/campaigns/${camp.json.data.id}/recipients`, {
      recipients: [{ email: 'ai@example.com', firstName: 'Ai', companyName: 'AI Co', jobTitle: 'Engineer' }],
    });
    await api('POST', `/campaigns/${camp.json.data.id}/sequences`, {
      name: 'AI Seq',
      steps: [{ name: 'E1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: 'Hello {{first_name}}', delayDays: 0 }],
    });
    const res = await api('POST', `/campaigns/${camp.json.data.id}/personalize`);
    assert.strictEqual(res.status, 501);
    assert.strictEqual(res.json.code, 'AI_NOT_CONFIGURED');
  });

  test('preview renders real substitutions with a sample recipient', async () => {
    const camp = await api('POST', '/campaigns', { name: 'Preview Camp' });
    await api('POST', `/campaigns/${camp.json.data.id}/recipients`, {
      recipients: [{ email: 'prev@example.com', firstName: 'Prev', companyName: 'Preview Co', jobTitle: 'CTO' }],
    });
    await api('POST', `/campaigns/${camp.json.data.id}/sequences`, {
      name: 'S',
      steps: [{ name: 'E1', subjectTemplate: 'Idea for {{company_name}}', bodyTemplate: 'Hi {{first_name}}, as {{job_title}}...', delayDays: 0 }],
    });
    const res = await api('POST', `/campaigns/${camp.json.data.id}/preview`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.subject, 'Idea for Preview Co');
    assert.ok(res.json.data.text.includes('Hi Prev'));
    assert.strictEqual(res.json.data.isSample, false);
  });
});

describe('campaign deletion (DELETE /campaigns/:id)', () => {
  test('deletes a draft campaign and everything it owns', async () => {
    const camp = await api('POST', '/campaigns', { name: 'DeleteMe' });
    const id = camp.json.data.id;
    await api('POST', `/campaigns/${id}/recipients`, {
      recipients: [{ email: 'gone@example.com', firstName: 'Gone' }],
    });
    await api('POST', `/campaigns/${id}/sequences`, {
      name: 'Seq', steps: [{ name: 'Email 1', subjectTemplate: 'S', bodyTemplate: 'B', delayDays: 0 }],
    });

    const del = await api('DELETE', `/campaigns/${id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.json.data.deleted, id);

    const check = await api('GET', `/campaigns/${id}`);
    assert.strictEqual(check.status, 404);
  });

  test('deletes an archived campaign', async () => {
    const camp = await api('POST', '/campaigns', { name: 'ArchiveDeleteMe' });
    const id = camp.json.data.id;
    const archived = await api('POST', `/campaigns/${id}/archive`);
    assert.strictEqual(archived.status, 200);

    const del = await api('DELETE', `/campaigns/${id}`);
    assert.strictEqual(del.status, 200);
  });

  test('refuses to delete a live campaign (409)', async () => {
    const camp = await api('POST', '/campaigns', { name: 'LiveNoDelete' });
    const id = camp.json.data.id;
    const models = require('../models');
    await models.Campaign.update({ status: 'active' }, { where: { id } });

    const del = await api('DELETE', `/campaigns/${id}`);
    assert.strictEqual(del.status, 409);
    assert.match(del.json.error, /draft or archived/i);
  });
});
