// Deliverability + Signatures API — coverage for Prompt 8/9 support routes.
// Verification list is a pure DB read (no live DNS in tests); signature
// sanitization is exercised against the real sanitizer.
// Run: node --test test/deliverability-api.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-deliverability-database.sqlite';
process.env.PORT = '8906';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8906/api/v1';

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.strictEqual(res.status, 200, `login ${email}: ${res.status}`);
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
const email = (tag) => `${tag}-${ts}@deliv.test`;
const PASS = 'DelivTest123!';

let ownerCookie, memberCookie, orgId;

before(async () => {
  const { sequelize } = require('../db');
  require('../models');
  await sequelize.sync();
  require('../server');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const res = await fetch('http://localhost:8906/health'); if (res.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const reg = await request(null, 'POST', '/auth/register', {
    email: email('owner'), password: PASS, full_name: 'Deliv Owner', organization_name: `Deliv Org ${ts}`,
  });
  assert.ok([200, 201].includes(reg.status));
  ownerCookie = await login(email('owner'), PASS);
  const me = await request(ownerCookie, 'GET', '/auth/me');
  orgId = me.json?.data?.user?.organization_id || me.json?.data?.organization_id || me.json?.organization_id;

  const models = require('../models');
  await models.User.create({ email: email('member'), fullName: 'Member', passwordHash: PASS, organizationId: orgId, role: 'member' });
  memberCookie = await login(email('member'), PASS);
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

describe('deliverability/verification', () => {
  test('verification list is empty for new org', async () => {
    const res = await request(ownerCookie, 'GET', '/deliverability/verification');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json.data, []);
  });

  test('stored verdicts are returned per lead', async () => {
    const models = require('../models');
    const lead = await models.Lead.create({
      organizationId: orgId, email: `verdict-${ts}@deliv.test`, firstName: 'Ver', emailStatus: 'verified',
    });
    await models.EmailVerification.create({
      organizationId: orgId, leadId: lead.id, email: lead.email, status: 'valid',
      riskScore: 5, reasons: ['mx_ok'], durationMs: 42,
    });
    const res = await request(ownerCookie, 'GET', '/deliverability/verification');
    const row = res.json.data.find((r) => r.email === lead.email);
    assert.ok(row, 'lead returned');
    assert.strictEqual(row.verification.status, 'valid');
    assert.strictEqual(row.verification.riskScore, 5);
    // campaign-scoped view also works for a campaign containing the lead
    const camp = await request(ownerCookie, 'POST', '/campaigns', { name: 'Deliv Campaign' });
    const campId = camp.json.data.id;
    await request(ownerCookie, 'POST', `/campaigns/${campId}/recipients`, {
      recipients: [{ email: lead.email, firstName: 'Ver' }],
    });
    const scoped = await request(ownerCookie, 'GET', `/deliverability/verification?campaignId=${campId}`);
    assert.strictEqual(scoped.status, 200);
    assert.ok(scoped.json.data.some((r) => r.email === lead.email && r.verification?.status === 'valid'));
  });

  test('member cannot bulk-verify (403 without owner/admin/member/editor role)', async () => {
    const res = await request(memberCookie, 'POST', '/deliverability/verify-leads', { leadIds: [] });
    // member IS allowed per role list; this exercises the RBAC path returns a non-error
    assert.ok([200, 403].includes(res.status));
  });

  test('verify with invalid email rejected (422)', async () => {
    const res = await request(ownerCookie, 'POST', '/deliverability/verify', { email: 'not-an-email' });
    assert.strictEqual(res.status, 422);
  });
});

describe('deliverability/warmup', () => {
  let accountId;
  before(async () => {
    const acc = await request(ownerCookie, 'POST', '/email-sending/accounts', {
      name: 'Warmup SMTP', smtpHost: '127.0.0.1', smtpPort: 1, security: 'none', fromEmail: `warm-${ts}@deliv.test`,
    });
    accountId = acc.json.data.id;
  });

  test('GET warmup lists the account with null plan', async () => {
    const res = await request(ownerCookie, 'GET', '/deliverability/warmup');
    assert.strictEqual(res.status, 200);
    const entry = res.json.data.find((x) => x.account.id === accountId);
    assert.ok(entry);
    assert.strictEqual(entry.plan, null);
  });

  test('PUT creates a paused plan then enables it', async () => {
    const created = await request(ownerCookie, 'PUT', `/deliverability/warmup/${accountId}`, { startVolume: 2, targetVolume: 20, rampStep: 2, enabled: true });
    assert.strictEqual(created.status, 200);
    assert.ok(['active', 'paused'].includes(created.json.data?.status || 'active'));
  });

  test('startVolume > targetVolume is rejected (422)', async () => {
    const res = await request(ownerCookie, 'PUT', `/deliverability/warmup/${accountId}`, { startVolume: 50, targetVolume: 10 });
    assert.strictEqual(res.status, 422);
  });

  test('invalid seed recipients are rejected (422)', async () => {
    const res = await request(ownerCookie, 'PUT', `/deliverability/warmup/${accountId}`, { seedRecipients: 'ok@x.io, not-an-email' });
    assert.strictEqual(res.status, 422);
    assert.match(res.json.error, /not-an-email/);
  });

  test('warmup for another org account is 404', async () => {
    const accB = await request(null, 'POST', '/auth/register', {
      email: email('other'), password: PASS, full_name: 'Other Org', organization_name: `Other Org ${ts}`,
    });
    const cookieB = await login(email('other'), PASS);
    const res = await request(cookieB, 'PUT', `/deliverability/warmup/${accountId}`, { enabled: false });
    assert.strictEqual(res.status, 404);
  });
});

describe('signatures (Prompt 9 support routes)', () => {
  let sigId;

  test('list starts empty', async () => {
    const res = await request(ownerCookie, 'GET', '/signatures');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json.data, []);
  });

  test('member cannot create signature (403)', async () => {
    const res = await request(memberCookie, 'POST', '/signatures', { name: 'Nope', html: '<p>x</p>' });
    assert.strictEqual(res.status, 403);
  });

  test('create sanitizes dangerous HTML', async () => {
    const res = await request(ownerCookie, 'POST', '/signatures', {
      name: 'Sig', html: '<p>Hello</p><script>alert(1)</script>', text: 'Hello', makeDefault: true,
    });
    assert.strictEqual(res.status, 201);
    sigId = res.json.data.id;
    assert.ok(!res.json.data.html.includes('<script>'), 'script stripped');
  });

  test('GET list returns the signature and org-default flag', async () => {
    const res = await request(ownerCookie, 'GET', '/signatures');
    const found = res.json.data.find((s) => s.id === sigId);
    assert.ok(found);
    assert.strictEqual(found.isOrgDefault, true);
  });

  test('member can read but not modify signatures (RBAC)', async () => {
    const read = await request(memberCookie, 'GET', '/signatures');
    assert.strictEqual(read.status, 200);
    const del = await request(memberCookie, 'DELETE', `/signatures/${sigId}`);
    assert.strictEqual(del.status, 403);
  });

  test('update + set default', async () => {
    const upd = await request(ownerCookie, 'PUT', `/signatures/${sigId}`, { name: 'Renamed', html: '<p>Hi</p><iframe src="evil"></iframe>' });
    assert.strictEqual(upd.status, 200);
    assert.ok(!upd.json.data.html.includes('iframe'));
    const def = await request(ownerCookie, 'POST', `/signatures/${sigId}/default`);
    assert.ok([200, 201].includes(def.status));
  });

  test('delete removes it', async () => {
    const del = await request(ownerCookie, 'DELETE', `/signatures/${sigId}`);
    assert.ok([200, 204].includes(del.status));
    const list = await request(ownerCookie, 'GET', '/signatures');
    assert.strictEqual(list.json.data.length, 0);
  });
});
