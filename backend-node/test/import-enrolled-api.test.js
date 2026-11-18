// Import-time "already enrolled" exclusion (smartlead parity) — verifies that
// validating an import destined for campaign X excludes emails already
// enrolled in X, counted separately from duplicate leads (§26, §35).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-import-enrolled-database.sqlite';
process.env.PORT = '8908';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8908/api/v1';

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.strictEqual(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function api(cookie, method, path, body) {
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
const email = (tag) => `${tag}-${ts}@enrolled.test`;
const PASS = 'EnrollTest123!';

let cookie, campaignId;

before(async () => {
  const { sequelize } = require('../db');
  require('../models');
  await sequelize.sync();
  require('../server');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const res = await fetch('http://localhost:8908/health'); if (res.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const reg = await api(null, 'POST', '/auth/register', {
    email: email('owner'), password: PASS, full_name: 'Enroll Owner', organization_name: `Enroll Org ${ts}`,
  });
  assert.ok([200, 201].includes(reg.status));
  cookie = await login(email('owner'), PASS);
  const camp = await api(cookie, 'POST', '/campaigns', { name: 'Enrolled Guard' });
  campaignId = camp.json.data.id;
  // Seed one lead and enroll it into the campaign
  const lead = await api(cookie, 'POST', '/leads', { firstName: 'Grace', email: `enrolled-${ts}@enrolled.test` });
  assert.strictEqual(lead.status, 201);
  const enroll = await api(cookie, 'POST', `/campaigns/${campaignId}/recipients`, {
    recipients: [{ email: `enrolled-${ts}@enrolled.test`, firstName: 'Grace' }],
  });
  assert.strictEqual(enroll.status, 201);
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

describe('import-time enrollment guard', () => {
  test('enrolled leads in THIS campaign are counted separately', async () => {
    const rows = [['Grace', `enrolled-${ts}@enrolled.test`], ['Fresh', `fresh-${ts}@enrolled.test`]];
    const { status, json } = await api(cookie, 'POST', '/leads/import/validate', {
      headers: ['First Name', 'Email'],
      rows,
      mapping: { 0: 'firstName', 1: 'email' },
      campaignId,
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.counts.campaignEnrolled, 1);
    assert.ok(json.data.errors.some((e) => /Already enrolled in this campaign/.test(e.reason)));
    assert.strictEqual(json.data.counts.valid, 1);
  });

  test('same email for a different campaign is NOT excluded', async () => {
    const other = await api(cookie, 'POST', '/campaigns', { name: 'Other Campaign' });
    const { status, json } = await api(cookie, 'POST', '/leads/import/validate', {
      headers: ['First Name', 'Email'],
      rows: [['Grace', `enrolled-${ts}@enrolled.test`]],
      mapping: { 0: 'firstName', 1: 'email' },
      campaignId: other.json.data.id,
      duplicateStrategy: 'update',
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.counts.campaignEnrolled, 0);
    assert.strictEqual(json.data.counts.valid, 1);
  });

  test('unknown campaignId is 404', async () => {
    const { status } = await api(cookie, 'POST', '/leads/import/validate', {
      headers: ['First Name', 'Email'],
      rows: [['Grace', `enrolled-${ts}@enrolled.test`]],
      mapping: { 0: 'firstName', 1: 'email' },
      campaignId: 'not-a-real-id',
    });
    assert.strictEqual(status, 404);
  });
});
