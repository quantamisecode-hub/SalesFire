// Conversations folder counts — Smartlead-style mailbox sidebar badges.
// Verifies GET /api/v1/conversations/counts: per-folder counts mirror the
// list filters exactly, tenancy is enforced, auth is required.
// Run: node --test test/conversations-counts.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-counts-database.sqlite';
process.env.PORT = '8920';
process.env.ENVIRONMENT = 'test';
process.env.INBOX_SYNC_INTERVAL_MS = '0';

const BASE = 'http://localhost:8920/api/v1';

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
const PASS = 'CountsTest123!';
let cookie, models, org, ownerId;

before(async () => {
  const { sequelize } = require('../db');
  models = require('../models');
  await sequelize.sync();
  require('../server');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const res = await fetch('http://localhost:8920/health'); if (res.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const reg = await api(null, 'POST', '/auth/register', {
    email: `owner-${ts}@counts.test`, password: PASS, full_name: 'Counts Owner', organization_name: `Counts Org ${ts}`,
  });
  assert.ok([200, 201].includes(reg.status));
  ownerId = reg.json.user.id;
  cookie = await login(`owner-${ts}@counts.test`, PASS);
  org = await models.Organization.findOne({ where: { name: `Counts Org ${ts}` } });

  const now = new Date();
  const future = new Date(now.getTime() + 24 * 3600 * 1000);

  // c1: default folder + unread inbound message + needs_reply status
  const c1 = await models.Conversation.create({ organizationId: org.id, subject: 'Counts C1', status: 'needs_reply', lastMessageAt: now });
  await models.EmailMessage.create({
    organizationId: org.id, conversationId: c1.id, messageId: `<c1-${ts}@counts.test>`,
    direction: 'inbound', fromEmail: 'lead@prospect.test', toEmails: ['me@myco.test'],
    subject: 'Re: hello', textBody: 'Interested!', snippet: 'Interested!',
    receivedAt: now, status: 'received', isRead: false, messageType: 'HUMAN_REPLY',
  });

  // c2: starred + sent (waiting_for_reply)
  await models.Conversation.create({ organizationId: org.id, subject: 'Counts C2', status: 'waiting_for_reply', isStarred: true, lastMessageAt: now });

  // c3: archived (excluded from Inbox/all)
  await models.Conversation.create({ organizationId: org.id, subject: 'Counts C3', status: 'closed', isArchived: true, lastMessageAt: now });

  // c4: actively snoozed (excluded from Inbox/all)
  await models.Conversation.create({ organizationId: org.id, subject: 'Counts C4', status: 'needs_reply', snoozedUntil: future, lastMessageAt: now });

  // c5: assigned to me (mine + assigned views)
  await models.Conversation.create({ organizationId: org.id, subject: 'Counts C5', status: 'open', assignedUserId: ownerId, lastMessageAt: now });

  // c6: closed (also in all)
  await models.Conversation.create({ organizationId: org.id, subject: 'Counts C6', status: 'closed', lastMessageAt: now });
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

describe('GET /conversations/counts', () => {
  test('requires authentication', async () => {
    const res = await fetch(`${BASE}/conversations/counts`);
    assert.strictEqual(res.status, 401);
  });

  test('returns per-folder counts matching the list filters', async () => {
    const { status, json } = await api(cookie, 'GET', '/conversations/counts');
    assert.strictEqual(status, 200);
    assert.strictEqual(json.success, true);
    const c = json.data;
    // Inbox: c1, c2, c5, c6 — c3 archived, c4 actively snoozed
    assert.strictEqual(c.all, 4, `all=${c.all}`);
    // only c1 has an unread inbound message
    assert.strictEqual(c.unread, 1, `unread=${c.unread}`);
    assert.strictEqual(c.starred, 1, `starred=${c.starred}`);
    assert.strictEqual(c.replied, 1, `replied=${c.replied}`);
    assert.strictEqual(c.snoozed, 1, `snoozed=${c.snoozed}`);
    assert.strictEqual(c.archived, 1, `archived=${c.archived}`);
    assert.strictEqual(c.mine, 1, `mine=${c.mine}`);
    assert.strictEqual(c.needs_reply, 2, `needs_reply=${c.needs_reply}`);
    assert.strictEqual(c.assigned, 1, `assigned=${c.assigned}`);
    assert.strictEqual(c.closed, 2, `closed=${c.closed}`);
  });

  test('counts agree with what GET /conversations returns per filter', async () => {
    for (const filter of ['all', 'unread', 'starred', 'replied', 'snoozed', 'archived', 'mine', 'needs_reply', 'assigned', 'closed']) {
      const counts = await api(cookie, 'GET', '/conversations/counts');
      const list = await api(cookie, 'GET', `/conversations?filter=${filter}&pageSize=100`);
      assert.strictEqual(
        list.json.pagination.total, counts.json.data[filter],
        `filter=${filter}: list total=${list.json.pagination.total} vs counts=${counts.json.data[filter]}`,
      );
    }
  });

  test('is tenant-scoped — a fresh organization sees only its own counts', async () => {
    const reg = await api(null, 'POST', '/auth/register', {
      email: `owner-b-${ts}@counts.test`, password: PASS, full_name: 'B', organization_name: `Counts Org B ${ts}`,
    });
    assert.ok([200, 201].includes(reg.status));
    const cookieB = await login(`owner-b-${ts}@counts.test`, PASS);
    const { status, json } = await api(cookieB, 'GET', '/conversations/counts');
    assert.strictEqual(status, 200);
    for (const [folder, value] of Object.entries(json.data)) {
      assert.strictEqual(value, 0, `${folder} should be 0 for tenant B, got ${value}`);
    }
  });
});
