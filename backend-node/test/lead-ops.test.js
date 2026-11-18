// Instantly lead-parity ops — variable data-field filters, owner assignment,
// move/copy recipients between campaigns, CRM holding lists.
// Run: node --test test/lead-ops.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-lead-ops-database.sqlite';
process.env.PORT = '8909';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8909/api/v1';

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
const PASS = 'LeadOpsTest123!';
const ORG_NAME = `LeadOps Org ${ts}`;
const eq = (s) => String(s || '').toLowerCase();

let cookie, campaignA, campaignB, campaignC;
let ownerId, miaId;
let L1, L2, L3;      // lead ids
let rA1, rA2;        // recipient ids in A (L1, L2)
let rA3;             // recipient id in A (L3, with send history)
let miaCookie;

before(async () => {
  const { sequelize } = require('../db');
  const models = require('../models');
  await sequelize.sync();
  require('../server');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const res = await fetch('http://localhost:8909/health'); if (res.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Owner registers the org
  const reg = await api(null, 'POST', '/auth/register', {
    email: `owner-${ts}@leadops.test`, password: PASS, full_name: 'Ops Owner', organization_name: ORG_NAME,
  });
  assert.ok([200, 201].includes(reg.status));
  cookie = await login(`owner-${ts}@leadops.test`, PASS);

  // Second org member (Mia) seeded directly; password via User.beforeCreate hash
  const org = await models.Organization.findOne({ where: { name: ORG_NAME } });
  const mia = await models.User.create({
    email: `mia-${ts}@leadops.test`, fullName: 'Mia Member', passwordHash: PASS,
    organizationId: org.id, role: 'member',
  });
  await models.OrganizationMembership.create({ userId: mia.id, organizationId: org.id, role: 'member', isActive: true });
  miaId = mia.id;

  // Org member listing used for owner pickers
  const members = await api(cookie, 'GET', '/members');
  assert.strictEqual(members.status, 200);
  ownerId = (members.json.data.find((m) => eq(m.email).includes('owner-')) || {}).id;
  assert.ok(ownerId, 'owner member listed');

  // Campaigns
  campaignA = (await api(cookie, 'POST', '/campaigns', { name: `A ${ts}` })).json.data.id;
  campaignB = (await api(cookie, 'POST', '/campaigns', { name: `B ${ts}` })).json.data.id;
  campaignC = (await api(cookie, 'POST', '/campaigns', { name: `C ${ts}` })).json.data.id;

  // Leads (L1 SaaS, L2 FinTech) created via API; L3 with a custom field via model
  L1 = (await api(cookie, 'POST', '/leads', { firstName: 'Ann', email: `l1-${ts}@leadops.test`, industry: 'SaaS' })).json.data.id;
  L2 = (await api(cookie, 'POST', '/leads', { firstName: 'Ben', email: `l2-${ts}@leadops.test`, industry: 'FinTech' })).json.data.id;
  const l3 = await models.Lead.create({
    organizationId: org.id, createdBy: ownerId, firstName: 'Cid',
    email: `l3-${ts}@leadops.test`, industry: 'SaaS',
    customFields: { funding: '$40M' }, status: 'interested',
  });
  L3 = l3.id;

  // Enroll L1, L2, L3 into campaign A
  const enroll = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients`, {
    recipients: [
      { email: `l1-${ts}@leadops.test`, firstName: 'Ann' },
      { email: `l2-${ts}@leadops.test`, firstName: 'Ben' },
      { email: `l3-${ts}@leadops.test`, firstName: 'Cid' },
    ],
  });
  assert.strictEqual(enroll.status, 201);

  const recips = await api(cookie, 'GET', `/campaigns/${campaignA}/recipients?pageSize=100`);
  const byEmail = new Map(recips.json.data.map((r) => [eq(r.email), r.id]));
  rA1 = byEmail.get(eq(`l1-${ts}@leadops.test`));
  rA2 = byEmail.get(eq(`l2-${ts}@leadops.test`));
  rA3 = byEmail.get(eq(`l3-${ts}@leadops.test`));
  assert.ok(rA1 && rA2 && rA3, 'all enrolled');

  // L3 gets a send event → move (not copy) must be blocked
  await models.EmailEvent.create({
    organizationId: org.id, campaignId: campaignA, campaignRecipientId: rA3, eventType: 'SENT',
  });

  miaCookie = await login(`mia-${ts}@leadops.test`, PASS);
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  // server.js keeps an HTTP listener alive — exit explicitly like the other API suites.
  process.exit(0);
});

describe('variable data-field filters', () => {
  test('builtin eq filter matches only matching leads', async () => {
    const r = await api(cookie, 'GET', '/leads?field=industry&op=eq&value=SaaS&pageSize=100');
    assert.strictEqual(r.status, 200);
    const industries = r.json.data.map((l) => l.industry);
    assert.ok(industries.length >= 2);
    assert.ok(industries.every((i) => i === 'SaaS'));
  });

  test('contains filter on builtin field', async () => {
    const r = await api(cookie, 'GET', '/leads?field=industry&op=contains&value=fin&pageSize=100');
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.data.some((l) => l.industry === 'FinTech'));
  });

  test('custom variable filter via JSON extraction', async () => {
    const r = await api(cookie, 'GET', '/leads?field=funding&op=contains&value=40&pageSize=100');
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.data.some((l) => l.id === L3));
  });

  test('SQL injection attempt in field is ignored safely', async () => {
    const r = await api(cookie, 'GET', '/leads?field=industry%22%29%20OR%20%20%22%31%22%3D%221&op=eq&value=SaaS');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.length, 0); // slug sanitized → no matches, no error
  });

  test('is_empty / is_not_empty work on custom variables', async () => {
    const empty = await api(cookie, 'GET', '/leads?field=funding&op=is_empty&value=&pageSize=100');
    assert.strictEqual(empty.status, 200);
    assert.ok(empty.json.data.some((l) => l.id === L1));
    assert.ok(!empty.json.data.some((l) => l.id === L3));
    const notEmpty = await api(cookie, 'GET', '/leads?field=funding&op=is_not_empty&value=&pageSize=100');
    assert.ok(notEmpty.json.data.some((l) => l.id === L3));
  });
});

describe('owner assignment', () => {
  test('round-robin distributes leads across members', async () => {
    const r = await api(cookie, 'POST', '/leads/bulk/assign', {
      leadIds: [L1, L2, L3], memberIds: [ownerId, miaId],
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.assigned, 3);
    const per = r.json.data.perMember;
    assert.strictEqual(Object.values(per).reduce((a, b) => a + b, 0), 3);
    assert.ok(per[ownerId] >= 1 && per[miaId] >= 1, 'both members got leads');
  });

  test('assign by campaignId assigns enrolled leads', async () => {
    const r = await api(cookie, 'POST', '/leads/bulk/assign', {
      campaignId: campaignA, memberIds: [ownerId],
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.assigned, 3);
  });

  test('unknown members are rejected', async () => {
    const r = await api(cookie, 'POST', '/leads/bulk/assign', {
      leadIds: [L1], memberIds: ['00000000-0000-0000-0000-000000000000'],
    });
    assert.strictEqual(r.status, 422);
  });

  test('owner filter returns assigned leads only', async () => {
    await api(cookie, 'POST', '/leads/bulk/assign', { leadIds: [L1], memberIds: [miaId] });
    const r = await api(cookie, 'GET', `/leads?owner=${miaId}&pageSize=100`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.data.some((l) => l.id === L1));
    assert.ok(r.json.data.every((l) => l.assignedTo === miaId));
  });
});

describe('move recipients between campaigns', () => {
  test('move blocked when recipient has send history', async () => {
    const r = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients/move`, {
      recipientIds: [rA3], targetCampaignId: campaignB, copy: false,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.moved, 0);
    assert.strictEqual(r.json.data.skipped[0].reason, 'has_send_history');
  });

  test('move resets interest status and re-enrolls as pending in target', async () => {
    const r = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients/move`, {
      recipientIds: [rA1], targetCampaignId: campaignB, copy: false, resetStatus: true,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.moved, 1);
    const inB = await api(cookie, 'GET', `/campaigns/${campaignB}/recipients?pageSize=100`);
    assert.ok(inB.json.data.some((x) => eq(x.email) === eq(`l1-${ts}@leadops.test`)));
    const inA = await api(cookie, 'GET', `/campaigns/${campaignA}/recipients?pageSize=100`);
    assert.ok(!inA.json.data.some((x) => x.id === rA1), 'source recipient removed');
  });

  test('copy with resetStatus resets manual interest status to new', async () => {
    const beforeLead = await models_lead(`l3-${ts}@leadops.test`);
    assert.strictEqual(beforeLead.status, 'interested');
    const r = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients/move`, {
      recipientIds: [rA3], targetCampaignId: campaignB, copy: true, resetStatus: true, checkDuplicates: false,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.copied, 1);
    const afterLead = await models_lead(`l3-${ts}@leadops.test`);
    assert.strictEqual(afterLead.status, 'new', 'interest status reset to new');
  });

  test('copy keeps the source recipient', async () => {
    // re-enroll L1 into A so we have something to copy
    await api(cookie, 'POST', `/campaigns/${campaignA}/recipients`, {
      recipients: [{ email: `l1-${ts}@leadops.test`, firstName: 'Ann' }],
    });
    const inA = await api(cookie, 'GET', `/campaigns/${campaignA}/recipients?pageSize=100`);
    const rec = inA.json.data.find((x) => eq(x.email) === eq(`l1-${ts}@leadops.test`));
    const r = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients/move`, {
      recipientIds: [rec.id], targetCampaignId: campaignC, copy: true, checkDuplicates: false,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.copied, 1);
    const afterA = await api(cookie, 'GET', `/campaigns/${campaignA}/recipients?pageSize=100`);
    assert.ok(afterA.json.data.some((x) => eq(x.email) === eq(`l1-${ts}@leadops.test`)), 'source kept on copy');
  });

  test('checkDuplicates skips leads enrolled in another campaign', async () => {
    // Enroll L2 in campaign C as well; then move from A → B with checkDuplicates
    await api(cookie, 'POST', `/campaigns/${campaignC}/recipients`, {
      recipients: [{ email: `l2-${ts}@leadops.test`, firstName: 'Ben' }],
    });
    const r = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients/move`, {
      recipientIds: [rA2], targetCampaignId: campaignB, copy: false, checkDuplicates: true,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.moved, 0);
    assert.strictEqual(r.json.data.skipped[0].reason, 'duplicate_other_campaign');
  });

  test('invalid status rejected by PATCH', async () => {
    const r = await api(cookie, 'PATCH', `/leads/${L1}`, { status: 'bogus_status' });
    assert.strictEqual(r.status, 422);
  });
});

describe('CRM holding lists', () => {
  let listId;
  test('create + dedupe members', async () => {
    const create = await api(cookie, 'POST', '/lists', { name: `Warm ${ts}` });
    assert.strictEqual(create.status, 201);
    listId = create.json.data.id;
    const add1 = await api(cookie, 'POST', `/lists/${listId}/members`, { leadIds: [L3] });
    assert.strictEqual(add1.json.data.added, 1);
    const add2 = await api(cookie, 'POST', `/lists/${listId}/members`, { leadIds: [L3] });
    assert.strictEqual(add2.json.data.added, 0, 'duplicate add is a no-op');
  });

  test('list members can move to a campaign', async () => {
    const r = await api(cookie, 'POST', `/lists/${listId}/move-to-campaign`, {
      targetCampaignId: campaignC, copy: false, checkDuplicates: false, resetStatus: true,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.moved, 1);
    const detail = await api(cookie, 'GET', `/lists/${listId}`);
    assert.strictEqual(detail.json.data.memberCount, 0, 'list emptied after move (copy=false)');
  });

  test('move-to-list from campaign works with copy=true', async () => {
    const recips = await api(cookie, 'GET', `/campaigns/${campaignA}/recipients?pageSize=100`);
    const rec = recips.json.data.find((x) => eq(x.email) === eq(`l3-${ts}@leadops.test`));
    assert.ok(rec, 'found L3 recipient');
    const r = await api(cookie, 'POST', `/campaigns/${campaignA}/recipients/move-to-list`, {
      recipientIds: [rec.id], targetListId: listId, copy: true,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.copied, 1);
    const stillInA = await api(cookie, 'GET', `/campaigns/${campaignA}/recipients?pageSize=100`);
    assert.ok(stillInA.json.data.some((x) => eq(x.email) === eq(`l3-${ts}@leadops.test`)), 'copy keeps source');
  });

  test('list members are sortable server-side (whitelisted columns only)', async () => {
    // After the previous test the list holds L3; add L1 + L2 for a stable 3-member set.
    await api(cookie, 'POST', `/lists/${listId}/members`, { leadIds: [L1, L2] });
    const asc = await api(cookie, 'GET', `/lists/${listId}?sortBy=email&sortDir=asc&pageSize=25`);
    assert.strictEqual(asc.status, 200);
    assert.strictEqual(asc.json.pagination.total, 3);
    const emails = asc.json.data.members.map((m) => m.lead.email);
    assert.deepStrictEqual(emails, [...emails].sort(), 'members sorted ascending by email');

    const desc = await api(cookie, 'GET', `/lists/${listId}?sortBy=email&sortDir=desc&pageSize=25`);
    const emailsDesc = desc.json.data.members.map((m) => m.lead.email);
    assert.deepStrictEqual(emailsDesc, [...emails].reverse(), 'members sorted descending by email');

    const company = await api(cookie, 'GET', `/lists/${listId}?sortBy=company&sortDir=asc&pageSize=25`);
    assert.strictEqual(company.status, 200);
    assert.strictEqual(company.json.pagination.total, 3);

    const badSort = await api(cookie, 'GET', `/lists/${listId}?sortBy=organization_id&sortDir=asc&pageSize=25`);
    assert.strictEqual(badSort.status, 200, 'unknown sort column falls back to default order, never SQL-error');
    assert.strictEqual(badSort.json.pagination.total, 3);
  });
});

// Helper: direct lead lookup (bypasses API serialization)
async function models_lead(email) {
  const models = require('../models');
  return models.Lead.findOne({ where: { email } });
}
