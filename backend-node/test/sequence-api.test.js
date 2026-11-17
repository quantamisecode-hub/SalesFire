// Sequence Builder API tests — variants CRUD, preview, validation, test-email
// honesty, and security (XSS sanitization, IDOR / tenant isolation).
// Runs against a real HTTP server on an isolated test DB (node:test).
// Run: node --test test/sequence-api.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-sequence-database.sqlite';
process.env.PORT = '8903';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8903/api/v1';

function makeApi() {
  let cookie = null;
  return {
    async api(method, path, body) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie && setCookie.includes('access_token=')) cookie = setCookie.split(';')[0];
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, json };
    },
  };
}
const orgA = makeApi();
const orgB = makeApi();

let campaignId = null;
let sequenceId = null;
let stepId = null;
let recipientId = null;

/** Re-fetch the first step's id — PUTs recreate steps server-side. */
async function refreshStepId() {
  const res = await orgA.api('GET', `/campaigns/${campaignId}/sequences`);
  const seq = (res.json.data || []).find((s) => s.id === sequenceId) || (res.json.data || [])[0];
  sequenceId = seq?.id || sequenceId;
  stepId = seq?.steps?.[0]?.id || stepId;
  return stepId;
}

before(async () => {
  const { sequelize } = require('../db');
  require('../models');
  await sequelize.sync();
  require('../server');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:8903/health');
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Two isolated organizations (§54 tenant isolation).
  const stamp = Date.now();
  const a = await orgA.api('POST', '/auth/register', {
    email: `seq-a-${stamp}@test.io`, password: 'SeqTest123!', full_name: 'Org A', organization_name: `Seq Org A ${stamp}`,
  });
  assert.ok([200, 201].includes(a.status), `org A signup failed: ${a.status}`);
  const b = await orgB.api('POST', '/auth/register', {
    email: `seq-b-${stamp}@test.io`, password: 'SeqTest123!', full_name: 'Org B', organization_name: `Seq Org B ${stamp}`,
  });
  assert.ok([200, 201].includes(b.status), `org B signup failed: ${b.status}`);

  const camp = await orgA.api('POST', '/campaigns', { name: 'Sequence Builder Test' });
  campaignId = camp.json.data.id;
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

describe('sequence steps + variants (§9-§10)', () => {
  test('creates a sequence with variants totaling 100%', async () => {
    const res = await orgA.api('POST', `/campaigns/${campaignId}/sequences`, {
      name: 'Outreach v1',
      steps: [{
        name: 'Email 1',
        subjectTemplate: 'Hi {{first_name}}',
        bodyTemplate: 'fallback body',
        delayMinutes: 0,
        variants: [
          { variantName: 'Variant A', subject: 'Hi {{first_name}}', bodyHtml: '<p>A: intro for {{company_name}}</p>', weight: 60 },
          { variantName: 'Variant B', subject: 'Quick note', bodyHtml: '<p>B: intro for {{company_name}}</p>', weight: 40 },
        ],
      }],
    });
    assert.ok([200, 201].includes(res.status), `create failed: ${res.status} ${JSON.stringify(res.json)}`);
    sequenceId = res.json.data.id;
    assert.ok(sequenceId);
  });

  test('listing returns steps WITH their variants', async () => {
    const res = await orgA.api('GET', `/campaigns/${campaignId}/sequences`);
    assert.strictEqual(res.status, 200);
    const seq = res.json.data.find((s) => s.id === sequenceId);
    assert.ok(seq, 'sequence listed');
    assert.strictEqual(seq.steps.length, 1);
    assert.strictEqual(seq.steps[0].variants.length, 2);
    assert.strictEqual(seq.steps[0].variants[0].weight, 60);
    assert.strictEqual(seq.steps[0].delayMinutes, 0);
    stepId = seq.steps[0].id;
  });

  test('PUT rejects a variant distribution that does not total 100% (§10)', async () => {
    const res = await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{
        name: 'Email 1',
        subjectTemplate: 's', bodyTemplate: 'b',
        variants: [
          { variantName: 'A', subject: 's', bodyHtml: '<p>a</p>', weight: 60 },
          { variantName: 'B', subject: 's', bodyHtml: '<p>b</p>', weight: 30 },
        ],
      }],
    });
    assert.strictEqual(res.status, 422);
    assert.match(res.json.error, /100%/);
  });

  test('PUT persists corrected weights and wait minutes', async () => {
    const res = await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [
        {
          name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: 'x', delayMinutes: 0,
          variants: [
            { variantName: 'Variant A', subject: 'Hi {{first_name}}', bodyHtml: '<p>A for {{company_name}}</p>', weight: 50 },
            { variantName: 'Variant B', subject: 'Quick note', bodyHtml: '<p>B for {{company_name}}</p>', weight: 50 },
          ],
        },
        {
          name: 'Email 2', subjectTemplate: '', bodyTemplate: '<p>Follow-up for {{first_name}}</p>',
          delayDays: 2, delayHours: 3, delayMinutes: 45,
        },
      ],
    });
    assert.strictEqual(res.status, 200, `PUT failed: ${JSON.stringify(res.json)}`);
    assert.strictEqual(res.json.data.steps.length, 2);
    const followUp = res.json.data.steps[1];
    assert.strictEqual(followUp.delayMinutes, 45);
    assert.strictEqual(followUp.delayHours, 3);
    await refreshStepId();
  });
});

describe('preview (§33-§34, §53-§55)', () => {
  test('enrolls a real recipient and previews with REAL data', async () => {
    const rec = await orgA.api('POST', `/campaigns/${campaignId}/recipients`, {
      recipients: [{ email: 'ada@realcorp.io', firstName: 'Ada', lastName: 'Real', companyName: 'RealCorp', jobTitle: 'CTO' }],
    });
    assert.ok([200, 201].includes(rec.status), `recipients enroll failed: ${rec.status}`);
    recipientId = rec.json.data?.created?.[0]?.id;

    const list = await orgA.api('GET', `/campaigns/${campaignId}/recipients`);
    if (!recipientId && list.json.data?.length) recipientId = list.json.data[0].id;
    assert.ok(recipientId, 'recipient id available for preview');

    const preview = await orgA.api('POST', `/campaigns/${campaignId}/preview`, { stepId, recipientId });
    assert.strictEqual(preview.status, 200, `preview failed: ${JSON.stringify(preview.json)}`);
    assert.ok(preview.json.data.subject.includes('Ada'), `subject: ${preview.json.data.subject}`);
    assert.ok(preview.json.data.html.includes('RealCorp'), `html: ${preview.json.data.html}`);
    assert.strictEqual(preview.json.data.isSampleRecipient, false);
  });

  test('falls back to clearly-labeled sample data when no recipient is given', async () => {
    const preview = await orgA.api('POST', `/campaigns/${campaignId}/preview`, { stepId });
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(preview.json.data.isSampleRecipient, Boolean(!recipientId));
    assert.ok(preview.json.data.to.email, 'preview has a to address');
  });

  test('sanitizes XSS out of the rendered preview (§45, §53)', async () => {
    const put = await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{
        name: 'Email 1',
        subjectTemplate: 'Hi {{first_name}}',
        bodyTemplate: '<p onclick="evil()">Hi <script>alert(1)</script><a href="javascript:bad()">bad</a><a href="https://good.com">good</a>{{first_name}}</p>',
        delayMinutes: 0,
      }],
    });
    assert.ok([200, 201].includes(put.status), `PUT failed: ${JSON.stringify(put.json)}`);
    await refreshStepId(); // steps are recreated on every PUT
    const preview = await orgA.api('POST', `/campaigns/${campaignId}/preview`, { stepId });
    assert.strictEqual(preview.status, 200);
    const html = preview.json.data.html;
    assert.ok(!html.includes('<script'), 'script tags stripped');
    assert.ok(!html.includes('onclick'), 'event handlers stripped');
    assert.ok(!html.includes('javascript:'), 'javascript: URLs stripped');
    assert.ok(html.includes('https://good.com'), 'safe links kept');
    await refreshStepId();
  });

  test('IDOR: another organization cannot preview this campaign\'s steps (§54)', async () => {
    const res = await orgB.api('POST', `/campaigns/${campaignId}/preview`, { stepId });
    assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
  });

  test('IDOR: another organization cannot even load the campaign', async () => {
    const res = await orgB.api('GET', `/campaigns/${campaignId}/sequences`);
    // Either an explicit 403/404 or an empty tenant-filtered list — never data.
    if ([200, 201].includes(res.status)) {
      assert.ok((res.json.data || []).length === 0, 'org B sees none of org A\'s sequences');
    } else {
      assert.ok([403, 404].includes(res.status));
    }
  });
});

describe('validation (§39-§41) — structured, click-to-field issues', () => {
  test('flags undefined variables, malformed spintax and conditionals with codes', async () => {
    await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{
        name: 'Email 1',
        subjectTemplate: 'Hey {{unknown_var}} {{RANDOM | broken',
        bodyTemplate: '<p>{% if x == "y" %}unclosed</p>',
        delayMinutes: 0,
      }],
    });
    await refreshStepId(); // issues must reference the fresh step id
    const res = await orgA.api('GET', `/campaigns/${campaignId}/validate`);
    assert.strictEqual(res.status, 200);
    const { issues, ready, knownVariables } = res.json.data;
    assert.strictEqual(ready, false);
    assert.ok(Array.isArray(knownVariables) && knownVariables.includes('first_name'), 'knownVariables returned');
    assert.ok(issues.some((i) => i.code === 'undefined_variable' && i.variable === 'unknown_var' && i.field === 'subject'), 'undefined variable issue');
    assert.ok(issues.some((i) => i.code === 'malformed_spintax' && i.field === 'subject'), 'malformed spintax issue');
    assert.ok(issues.some((i) => i.code === 'malformed_conditional' && i.field === 'body'), 'malformed conditional issue');
    assert.ok(issues.every((i) => i.stepId === stepId), 'issues carry stepId for click-to-field');
  });

  test('the API rejects storing an invalid distribution; stored state stays valid', async () => {
    // Start from a clean, valid sequence.
    await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{
        name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: '<p>ok</p>', delayMinutes: 0,
        variants: [
          { variantName: 'A', subject: 's', bodyHtml: '<p>a</p>', weight: 60 },
          { variantName: 'B', subject: 's', bodyHtml: '<p>b</p>', weight: 40 },
        ],
      }],
    });
    // An invalid distribution (80/10) is refused — nothing invalid is stored.
    const bad = await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{
        name: 'Email 1', subjectTemplate: 's', bodyTemplate: 'b', delayMinutes: 0,
        variants: [
          { variantName: 'A', subject: 's', bodyHtml: '<p>a</p>', weight: 80 },
          { variantName: 'B', subject: 's', bodyHtml: '<p>b</p>', weight: 10 },
        ],
      }],
    });
    assert.strictEqual(bad.status, 422);
    await refreshStepId();
    const res = await orgA.api('GET', `/campaigns/${campaignId}/validate`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.ready, true, `stored state must stay valid: ${JSON.stringify(res.json.data.issues)}`);
  });

  test('passes on a clean sequence', async () => {
    await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [
        { name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: '<p>Intro for {{company_name}}</p>', delayMinutes: 0 },
        { name: 'Email 2', subjectTemplate: '', bodyTemplate: '<p>Bump for {{first_name}}</p>', delayDays: 3 },
      ],
    });
    const res = await orgA.api('GET', `/campaigns/${campaignId}/validate`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.ready, true, `expected clean: ${JSON.stringify(res.json.data.issues)}`);
    assert.strictEqual(res.json.data.issues.length, 0);
    await refreshStepId();
  });

  test('launch problems list stays string[] and includes content issues', async () => {
    await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{ name: 'Email 1', subjectTemplate: 'Hi {{not_a_var}}', bodyTemplate: '<p>ok</p>', delayMinutes: 0 }],
    });
    const launch = await orgA.api('POST', `/campaigns/${campaignId}/launch`);
    assert.strictEqual(launch.status, 422);
    assert.ok(Array.isArray(launch.json.problems));
    assert.ok(launch.json.problems.every((p) => typeof p === 'string'), 'problems remain strings');
    assert.ok(launch.json.problems.some((p) => /not_a_var/.test(p)), 'content issue surfaced in problems');
    assert.ok(Array.isArray(launch.json.issues), 'structured issues returned alongside');
    // restore a clean sequence for the test-email suite
    await orgA.api('PUT', `/campaigns/${campaignId}/sequences/${sequenceId}`, {
      name: 'Outreach v1',
      steps: [{ name: 'Email 1', subjectTemplate: 'Hi {{first_name}}', bodyTemplate: '<p>Intro</p>', delayMinutes: 0 }],
    });
    await refreshStepId();
  });
});

describe('test email (§35) — honest SMTP behavior', () => {
  test('requires recipients', async () => {
    const res = await orgA.api('POST', `/campaigns/${campaignId}/test-email`, { stepId });
    assert.strictEqual(res.status, 422);
  });

  test('requires a sending account', async () => {
    const res = await orgA.api('POST', `/campaigns/${campaignId}/test-email`, { stepId, recipients: ['t@example.com'] });
    assert.strictEqual(res.status, 422);
    assert.match(res.json.error, /sending account/i);
  });

  test('reports a REAL SMTP failure instead of pretending success', async () => {
    // Point at an unroutable SMTP port — the send must fail with 502, never 200.
    const acc = await orgA.api('POST', '/email-sending/accounts', {
      name: 'Broken SMTP', smtpHost: '127.0.0.1', smtpPort: 1,
      fromEmail: 'sender@test.io', fromName: 'Test Sender',
      smtpUsername: 'u', smtpPassword: 'p', security: 'none',
    });
    assert.ok([200, 201].includes(acc.status), `sending account create failed: ${acc.status}`);
    const upd = await orgA.api('PUT', `/campaigns/${campaignId}`, { sendingAccountId: acc.json.data.id });
    assert.ok([200, 201].includes(upd.status), `campaign update failed: ${upd.status} ${JSON.stringify(upd.json)}`);

    const res = await orgA.api('POST', `/campaigns/${campaignId}/test-email`, { stepId, recipients: ['t@example.com'] });
    assert.strictEqual(res.status, 502, `expected honest 502, got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.ok(res.json.error, 'real error surfaced');
    assert.ok(!res.json.data?.sent, 'never claims sent on failure');
  });

  test('IDOR: another organization cannot send a test email for this campaign', async () => {
    const res = await orgB.api('POST', `/campaigns/${campaignId}/test-email`, { stepId, recipients: ['t@example.com'] });
    assert.ok([403, 404].includes(res.status));
  });
});
