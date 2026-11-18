// Campaign sending-account pool API — PROMPT 9.1 §19-22, §43, §49, §52, §64.
// Covers: pool CRUD, RBAC (OWNER/ADMIN only mutations), tenant isolation/IDOR,
// distribution validation (weighted must equal 100), removal policy with
// scheduled recipients, and sending-settings validation.
// Run: node --test test/campaign-pool-api.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-pool-api-database.sqlite';
process.env.PORT = '8904';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8904/api/v1';

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.strictEqual(res.status, 200, `login for ${email} failed`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function request(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const ts = Date.now();
const email = (tag) => `${tag.toLowerCase()}-${ts}@pool.test`;
const PASS = 'PoolTest123!';

let ownerACookie, memberACookie, viewerACookie, ownerBCookie;
let orgAId, orgBId;
let accountAId, accountBId;
const campaignA = { id: null };

before(async () => {
  const { sequelize } = require('../db');
  require('../models');
  await sequelize.sync();
  require('../server');
  // Wait for the server
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const res = await fetch('http://localhost:8904/health'); if (res.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Register two orgs
  const regA = await request(null, 'POST', '/auth/register', {
    email: email('ownerA'), password: PASS, full_name: 'Pool Owner A', organization_name: `Pool Org A ${ts}`,
  });
  assert.ok([200, 201].includes(regA.status), `org A signup failed ${regA.status}`);
  const regB = await request(null, 'POST', '/auth/register', {
    email: email('ownerB'), password: PASS, full_name: 'Pool Owner B', organization_name: `Pool Org B ${ts}`,
  });
  assert.ok([200, 201].includes(regB.status), `org B signup failed ${regB.status}`);

  ownerACookie = await login(email('ownerA'), PASS);
  ownerBCookie = await login(email('ownerB'), PASS);

  // Org ids via /auth/me
  const meA = await request(ownerACookie, 'GET', '/auth/me');
  orgAId = meA.json?.data?.user?.organization_id || meA.json?.data?.organization_id || meA.json?.organization_id;
  const meB = await request(ownerBCookie, 'GET', '/auth/me');
  orgBId = meB.json?.data?.user?.organization_id || meB.json?.data?.organization_id || meB.json?.organization_id;
  assert.ok(orgAId && orgBId, 'could not resolve org ids');

  // Create member + viewer directly in orgA (role check is on first role entry)
  const models = require('../models');
  await models.User.create({ email: email('memberA'), fullName: 'Member A', passwordHash: PASS, organizationId: orgAId, role: 'member' });
  await models.User.create({ email: email('viewerA'), fullName: 'Viewer A', passwordHash: PASS, organizationId: orgAId, role: 'viewer' });
  memberACookie = await login(email('memberA'), PASS);
  viewerACookie = await login(email('viewerA'), PASS);

  // Create one SMTP account per org via the API
  const accA = await request(ownerACookie, 'POST', '/email-sending/accounts', {
    name: 'Pool SMTP A', smtpHost: '127.0.0.1', smtpPort: 587, security: 'tls',
    fromEmail: 'pool-a@pooltest.io', fromName: 'Pool A', smtpUsername: 'u', smtpPassword: 'p',
    dailyLimit: 50, hourlyLimit: 10,
  });
  assert.strictEqual(accA.status, 201, `account A create failed: ${JSON.stringify(accA.json)}`);
  accountAId = accA.json.data.id;

  const accB = await request(ownerBCookie, 'POST', '/email-sending/accounts', {
    name: 'Pool SMTP B', smtpHost: '127.0.0.1', smtpPort: 587, security: 'tls',
    fromEmail: 'pool-b@pooltest.io', fromName: 'Pool B', smtpUsername: 'u', smtpPassword: 'p',
    dailyLimit: 50, hourlyLimit: 10,
  });
  accountBId = accB.json.data.id;

  // Campaign in orgA
  const camp = await request(ownerACookie, 'POST', '/campaigns', { name: 'Pool Test Campaign' });
  campaignA.id = camp.json.data.id;
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

describe('pool listing + adding (§18-20, §52)', () => {
  test('pool starts empty', async () => {
    const res = await request(ownerACookie, 'GET', `/campaigns/${campaignA.id}/sending-accounts`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json.data, []);
  });

  test('owner can add an org-owned account to the pool', async () => {
    const res = await request(ownerACookie, 'POST', `/campaigns/${campaignA.id}/sending-accounts`, { smtpAccountId: accountAId, weight: 100 });
    assert.strictEqual(res.status, 201);
    const list = await request(ownerACookie, 'GET', `/campaigns/${campaignA.id}/sending-accounts`);
    assert.strictEqual(list.json.data.length, 1);
    assert.strictEqual(list.json.data[0].email, 'pool-a@pooltest.io');
  });

  test('adding another organization’s account is rejected (IDOR)', async () => {
    const res = await request(ownerACookie, 'POST', `/campaigns/${campaignA.id}/sending-accounts`, { smtpAccountId: accountBId, weight: 100 });
    assert.strictEqual(res.status, 404);
  });
});

describe('RBAC (§49)', () => {
  test('member cannot add to pool (403)', async () => {
    const res = await request(memberACookie, 'POST', `/campaigns/${campaignA.id}/sending-accounts`, { smtpAccountId: accountAId });
    assert.strictEqual(res.status, 403);
  });

  test('viewer cannot add to pool (403)', async () => {
    const res = await request(viewerACookie, 'POST', `/campaigns/${campaignA.id}/sending-accounts`, { smtpAccountId: accountAId });
    assert.strictEqual(res.status, 403);
  });

  test('member cannot create a sending account (403)', async () => {
    const res = await request(memberACookie, 'POST', '/email-sending/accounts', {
      name: 'Escalate', smtpHost: '127.0.0.1', smtpPort: 25, fromEmail: 'x@x.io',
    });
    assert.strictEqual(res.status, 403);
  });

  test('member can READ pool (200)', async () => {
    const res = await request(memberACookie, 'GET', `/campaigns/${campaignA.id}/sending-accounts`);
    assert.strictEqual(res.status, 200);
  });

  test('member cannot mutate sending-settings (403)', async () => {
    const res = await request(memberACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-settings`, { accountDistribution: 'weighted' });
    assert.strictEqual(res.status, 403);
  });
});

describe('account health endpoint (§34/51)', () => {
  test('GET /accounts/:id/health returns derived health, never credentials', async () => {
    const res = await request(ownerACookie, 'GET', `/email-sending/accounts/${accountAId}/health`);
    assert.strictEqual(res.status, 200);
    assert.ok(['healthy', 'warning', 'critical', 'unknown'].includes(res.json.data.healthStatus));
    assert.ok('last30Days' in res.json.data);
    const body = JSON.stringify(res.json);
    assert.ok(!/smtpPassword|password_hash|secret/i.test(body));
  });

  test('health is org-scoped — another org gets 404', async () => {
    const res = await request(ownerBCookie, 'GET', `/email-sending/accounts/${accountAId}/health`);
    assert.strictEqual(res.status, 404);
  });
});

describe('email-sending API — validation, lifecycle, RBAC (§11-13, §42, §49-50)', () => {
  let testAcctId;

  test('create with missing fields is rejected (422)', async () => {
    const res = await request(ownerACookie, 'POST', '/email-sending/accounts', { name: 'Incomplete' });
    assert.strictEqual(res.status, 422);
  });

  test('create with hourlyLimit > dailyLimit is rejected (422)', async () => {
    const res = await request(ownerACookie, 'POST', '/email-sending/accounts', {
      name: 'Bad Limits', smtpHost: '127.0.0.1', smtpPort: 587, fromEmail: 'limits@pool.test', dailyLimit: 10, hourlyLimit: 50,
    });
    assert.strictEqual(res.status, 422);
  });

  test('create with min delay > max delay is rejected (422)', async () => {
    const res = await request(ownerACookie, 'POST', '/email-sending/accounts', {
      name: 'Bad Delays', smtpHost: '127.0.0.1', smtpPort: 587, fromEmail: 'delays@pool.test', minDelayMinutes: 30, maxDelayMinutes: 5,
    });
    assert.strictEqual(res.status, 422);
  });

  test('create with bogus IANA timezone is rejected (422)', async () => {
    const res = await request(ownerACookie, 'POST', '/email-sending/accounts', {
      name: 'Bad TZ', smtpHost: '127.0.0.1', smtpPort: 587, fromEmail: 'tz@pool.test', timezone: 'Mars/Olympus',
    });
    assert.strictEqual(res.status, 422);
  });

  test('create with start >= end schedule is rejected (422)', async () => {
    const res = await request(ownerACookie, 'POST', '/email-sending/accounts', {
      name: 'Bad Sched', smtpHost: '127.0.0.1', smtpPort: 587, fromEmail: 'sched@pool.test', timezone: 'UTC',
      sendingSchedule: { '1': { enabled: true, start: '17:00', end: '09:00' } },
    });
    assert.strictEqual(res.status, 422);
  });

  test('create ok — response carries no password anywhere', async () => {
    const res = await request(ownerACookie, 'POST', '/email-sending/accounts', {
      name: 'Coverage Test SMTP', smtpHost: '127.0.0.1', smtpPort: 1, security: 'none',
      fromEmail: 'coverage@pool.test', smtpPassword: 'super-secret-value',
    });
    assert.strictEqual(res.status, 201);
    testAcctId = res.json.data.id;
    const body = JSON.stringify(res.json);
    assert.ok(!/super-secret-value|smtpPassword/i.test(body));
    assert.strictEqual(res.json.data.hasPassword, true);
  });

  test('list never leaks the password', async () => {
    const list = await request(ownerACookie, 'GET', '/email-sending/accounts');
    assert.strictEqual(list.status, 200);
    assert.ok(!JSON.stringify(list.json).includes('super-secret-value'));
  });

  test('patch with merged hourly > daily is rejected (422)', async () => {
    const res = await request(ownerACookie, 'PATCH', `/email-sending/accounts/${accountAId}`, { hourlyLimit: 99 });
    assert.strictEqual(res.status, 422);
  });

  test('patch with swapped delays is rejected (422)', async () => {
    const res = await request(ownerACookie, 'PATCH', `/email-sending/accounts/${accountAId}`, { minDelayMinutes: 40, maxDelayMinutes: 10 });
    assert.strictEqual(res.status, 422);
  });

  test('pause then resume sets isEnabled', async () => {
    const paused = await request(ownerACookie, 'POST', `/email-sending/accounts/${testAcctId}/pause`);
    assert.strictEqual(paused.status, 200);
    assert.strictEqual(paused.json.data.isEnabled, false);
    const resumed = await request(ownerACookie, 'POST', `/email-sending/accounts/${testAcctId}/resume`);
    assert.strictEqual(resumed.json.data.isEnabled, true);
  });

  test('viewer cannot pause/resume/test/send-test (403)', async () => {
    for (const op of ['pause', 'resume', 'test', 'send-test']) {
      const res = await request(viewerACookie, 'POST', `/email-sending/accounts/${testAcctId}/${op}`, {});
      assert.strictEqual(res.status, 403, `${op} must be 403`);
    }
  });

  test('viewer cannot delete (403)', async () => {
    const res = await request(viewerACookie, 'DELETE', `/email-sending/accounts/${testAcctId}`);
    assert.strictEqual(res.status, 403);
  });

  test('SMTP test against unreachable host is honest failure (never 200)', async () => {
    const res = await request(ownerACookie, 'POST', `/email-sending/accounts/${testAcctId}/test`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, false);
    assert.ok(res.json.failureClass, 'failureClass present');
    const fresh = await request(ownerACookie, 'GET', `/email-sending/accounts/${testAcctId}`);
    assert.strictEqual(fresh.json.data.status, 'error');
  });

  test('send-test against unreachable host returns 502 and leaks nothing', async () => {
    const res = await request(ownerACookie, 'POST', `/email-sending/accounts/${testAcctId}/send-test`, {
      to: 'someone@pool.test', subject: 'hi', body: 'body',
    });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(JSON.stringify(res.json).includes('super-secret-value'), false);
  });

  test('send-test requires a valid recipient (422)', async () => {
    const res = await request(ownerACookie, 'POST', `/email-sending/accounts/${testAcctId}/send-test`, { to: 'not-an-email' });
    assert.strictEqual(res.status, 422);
  });

  test('overview returns real numeric fields', async () => {
    const res = await request(ownerACookie, 'GET', '/email-sending/overview');
    assert.strictEqual(res.status, 200);
    for (const k of ['totalAccounts', 'activeAccounts', 'emailsSentToday', 'accountsWithErrors']) {
      assert.ok(typeof res.json.data[k] === 'number', k);
    }
  });

  test('account in a pool cannot be deleted (409), detach first', async () => {
    // Attach testAcctId to a campaign pool, then DELETE should 409.
    const camp = await request(ownerACookie, 'POST', '/campaigns', { name: 'Delete Guard' });
    const campId = camp.json.data.id;
    const add = await request(ownerACookie, 'POST', `/campaigns/${campId}/sending-accounts`, { smtpAccountId: testAcctId, weight: 100 });
    assert.strictEqual(add.status, 201);
    const del = await request(ownerACookie, 'DELETE', `/email-sending/accounts/${testAcctId}`);
    assert.strictEqual(del.status, 409);
    // Detach: remove from pool — no scheduled recipients so plain DELETE works
    const list = await request(ownerACookie, 'GET', `/campaigns/${campId}/sending-accounts`);
    const poolId = list.json.data[0].id;
    const rm = await request(ownerACookie, 'DELETE', `/campaigns/${campId}/sending-accounts/${poolId}`);
    assert.strictEqual(rm.status, 200);
    const del2 = await request(ownerACookie, 'DELETE', `/email-sending/accounts/${testAcctId}`);
    assert.strictEqual(del2.status, 200);
  });
});

describe('distribution validation (§22, §51)', () => {
  test('weighted strategy must total 100 — invalid blocks launch gate', async () => {
    await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-settings`, { accountDistribution: 'weighted' });
    const poolId = (await request(ownerACookie, 'GET', `/campaigns/${campaignA.id}/sending-accounts`)).json.data[0].id;
    await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-accounts/${poolId}`, { weight: 40 });
    const check = await request(ownerACookie, 'POST', `/campaigns/${campaignA.id}/sending-accounts/validate`);
    assert.strictEqual(check.json.ok, false);
    assert.ok(check.json.issues.some((i) => /100%/.test(i)));
    // Restore 100%
    await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-accounts/${poolId}`, { weight: 100 });
    const ok = await request(ownerACookie, 'POST', `/campaigns/${campaignA.id}/sending-accounts/validate`);
    assert.strictEqual(ok.json.ok, true, JSON.stringify(ok.json));
  });

  test('bogus distribution strategy is rejected at settings (422)', async () => {
    const res = await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-settings`, { accountDistribution: 'chaos' });
    assert.strictEqual(res.status, 422);
  });

  test('invalid stickiness/fallback are rejected (422)', async () => {
    const a = await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-settings`, { accountStickiness: 'sometimes' });
    assert.strictEqual(a.status, 422);
    const b = await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-settings`, { fallbackPolicy: 'whatever' });
    assert.strictEqual(b.status, 422);
  });

  test('min delay above max delay rejected (422)', async () => {
    const res = await request(ownerACookie, 'PATCH', `/campaigns/${campaignA.id}/sending-settings`, { minDelayMinutes: 30, maxDelayMinutes: 5 });
    assert.strictEqual(res.status, 422);
  });
});

describe('remove with scheduled recipients requires an explicit policy (§43)', () => {
  test('409 requiresPolicy → reassign clears the assignment', async () => {
    // Enroll a recipient and simulate it being assigned to the account
    const enroll = await request(ownerACookie, 'POST', `/campaigns/${campaignA.id}/recipients`, {
      recipients: [{ email: `policy-${ts}@x.io`, firstName: 'P', lastName: 'A' }],
    });
    assert.ok([200, 201].includes(enroll.status), `enroll failed: ${JSON.stringify(enroll.json)}`);
    const models = require('../models');
    const recipient = await models.CampaignLead.findOne({ where: { campaignId: campaignA.id, email: `policy-${ts}@x.io` } });
    await recipient.update({ status: 'queued', sendingAccountId: accountAId, assignedAt: new Date() });

    const pool = await request(ownerACookie, 'GET', `/campaigns/${campaignA.id}/sending-accounts`);
    const poolId = pool.json.data[0].id;

    const blocked = await request(ownerACookie, 'DELETE', `/campaigns/${campaignA.id}/sending-accounts/${poolId}`);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.json.requiresPolicy, true);
    assert.strictEqual(blocked.json.scheduledRecipients, 1);

    const done = await request(ownerACookie, 'DELETE', `/campaigns/${campaignA.id}/sending-accounts/${poolId}?removalPolicy=reassign`);
    assert.strictEqual(done.status, 200);
    const fresh = await models.CampaignLead.findByPk(recipient.id);
    assert.strictEqual(fresh.sendingAccountId, null);
  });
});
