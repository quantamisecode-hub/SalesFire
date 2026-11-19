// Email-sending accounts — reply-sync (IMAP) settings (create/PATCH/serialize).
// Covers: IMAP fields saved on create, 422 when enabled-but-incomplete,
// PATCH merge + validation, write-only passwords (never serialized).
// Run: node --test test/email-sending-imap.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-imap-database.sqlite';
process.env.PORT = '8921';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8921/api/v1';

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
const PASS = 'ImapTest123!';
let cookie, models;

const baseAccount = (over = {}) => ({
  name: `IMAP Box ${ts}`,
  smtpHost: 'smtp.example.test', smtpPort: 587, security: 'tls',
  smtpUsername: 'sender@example.test', smtpPassword: 'smtp-secret-1',
  fromEmail: `imap-${ts}@example.test`, fromName: 'IMAP Tester',
  ...over,
});

before(async () => {
  const { sequelize } = require('../db');
  models = require('../models');
  await sequelize.sync();
  require('../server');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const res = await fetch('http://localhost:8921/health'); if (res.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const reg = await request(null, 'POST', '/auth/register', {
    email: `owner-${ts}@imap.test`, password: PASS, full_name: 'IMAP Owner', organization_name: `IMAP Org ${ts}`,
  });
  assert.ok([200, 201].includes(reg.status), `signup failed ${reg.status}`);
  cookie = await login(`owner-${ts}@imap.test`, PASS);
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

describe('email-sending accounts — IMAP reply sync', () => {
  test('create saves IMAP settings and serializes them without the password', async () => {
    const { status, json } = await request(cookie, 'POST', '/email-sending/accounts', baseAccount({
      imapEnabled: true,
      imapHost: 'imap.example.test',
      imapPort: 993,
      imapSecure: true,
      imapUsername: 'sender@example.test',
      imapPassword: 'imap-secret-1',
    }));
    assert.strictEqual(status, 201, JSON.stringify(json));
    const data = json.data;
    assert.strictEqual(data.imapEnabled, true);
    assert.strictEqual(data.imapHost, 'imap.example.test');
    assert.strictEqual(data.imapPort, 993);
    assert.strictEqual(data.imapSecure, true);
    assert.strictEqual(data.imapUsername, 'sender@example.test');
    assert.strictEqual(data.hasImapPassword, true);
    // never the secrets themselves
    assert.strictEqual(data.imapPassword, undefined);
    assert.strictEqual(data.imapPasswordEncrypted, undefined);
    assert.strictEqual(data.smtpPassword, undefined);

    // stored encrypted at rest (ciphertext, not plaintext)
    const row = await models.SmtpAccount.findByPk(data.id);
    assert.ok(row.imapPasswordEncrypted && row.imapPasswordEncrypted !== 'imap-secret-1',
      'imap password must be encrypted at rest');
    assert.ok(!JSON.stringify(data).includes('imap-secret-1'), 'response must not leak imap password');
    assert.ok(!JSON.stringify(data).includes('smtp-secret-1'), 'response must not leak smtp password');
  });

  test('create with imapEnabled but missing credentials is 422', async () => {
    const { status, json } = await request(cookie, 'POST', '/email-sending/accounts', baseAccount({
      imapEnabled: true,
      imapHost: 'imap.example.test',
      imapUsername: 'sender@example.test',
      // no imapPassword
    }));
    assert.strictEqual(status, 422);
    assert.match(json.error, /imapPassword/);
  });

  test('create with imapEnabled but no host is 422', async () => {
    const { status, json } = await request(cookie, 'POST', '/email-sending/accounts', baseAccount({
      imapEnabled: true,
      imapUsername: 'sender@example.test',
      imapPassword: 'x',
    }));
    assert.strictEqual(status, 422);
    assert.match(json.error, /imapHost/);
  });

  test('create without IMAP defaults to disabled', async () => {
    const { status, json } = await request(cookie, 'POST', '/email-sending/accounts', baseAccount());
    assert.strictEqual(status, 201, JSON.stringify(json));
    assert.strictEqual(json.data.imapEnabled, false);
    assert.strictEqual(json.data.hasImapPassword, false);
  });

  test('PATCH can enable IMAP on an existing account', async () => {
    const created = await request(cookie, 'POST', '/email-sending/accounts', baseAccount());
    assert.strictEqual(created.status, 201);
    const id = created.json.data.id;

    const { status, json } = await request(cookie, 'PATCH', `/email-sending/accounts/${id}`, {
      imapEnabled: true,
      imapHost: 'imap.example.test',
      imapPort: 143,
      imapSecure: false,
      imapUsername: 'other@example.test',
      imapPassword: 'imap-secret-2',
    });
    assert.strictEqual(status, 200, JSON.stringify(json));
    assert.strictEqual(json.data.imapEnabled, true);
    assert.strictEqual(json.data.imapHost, 'imap.example.test');
    assert.strictEqual(json.data.imapPort, 143);
    assert.strictEqual(json.data.imapSecure, false);
    assert.strictEqual(json.data.imapUsername, 'other@example.test');
    assert.strictEqual(json.data.hasImapPassword, true);
    assert.strictEqual(json.data.imapPassword, undefined);
    // unrelated fields untouched by the partial update
    assert.strictEqual(json.data.smtpHost, 'smtp.example.test');
  });

  test('PATCH enabling IMAP without a stored password is 422', async () => {
    const created = await request(cookie, 'POST', '/email-sending/accounts', baseAccount());
    assert.strictEqual(created.status, 201);
    const id = created.json.data.id;

    const { status, json } = await request(cookie, 'PATCH', `/email-sending/accounts/${id}`, {
      imapEnabled: true,
      imapHost: 'imap.example.test',
      imapUsername: 'sender@example.test',
    });
    assert.strictEqual(status, 422);
    assert.match(json.error, /imapPassword/);
  });

  test('PATCH can disable IMAP without touching credentials', async () => {
    const created = await request(cookie, 'POST', '/email-sending/accounts', baseAccount({
      imapEnabled: true, imapHost: 'imap.example.test',
      imapUsername: 'sender@example.test', imapPassword: 'imap-secret-1',
    }));
    assert.strictEqual(created.status, 201);
    const id = created.json.data.id;

    const { status, json } = await request(cookie, 'PATCH', `/email-sending/accounts/${id}`, { imapEnabled: false });
    assert.strictEqual(status, 200, JSON.stringify(json));
    assert.strictEqual(json.data.imapEnabled, false);
  });

  test('GET list includes IMAP fields, never secrets', async () => {
    const { status, json } = await request(cookie, 'GET', '/email-sending/accounts');
    assert.strictEqual(status, 200);
    const serialized = JSON.stringify(json);
    assert.ok(serialized.includes('imapEnabled'), 'list should expose imapEnabled');
    assert.ok(serialized.includes('hasImapPassword'), 'list should expose hasImapPassword');
    assert.ok(!serialized.includes('imap-secret'), 'list must not leak imap password');
    assert.ok(!serialized.includes('smtp-secret'), 'list must not leak smtp password');
    assert.ok(!serialized.includes('imapPasswordEncrypted'), 'list must not leak ciphertext');
  });

  test('tenant isolation — another org cannot PATCH IMAP settings', async () => {
    const created = await request(cookie, 'POST', '/email-sending/accounts', baseAccount());
    const id = created.json.data.id;

    const reg = await request(null, 'POST', '/auth/register', {
      email: `owner-b-${ts}@imap.test`, password: PASS, full_name: 'B', organization_name: `IMAP Org B ${ts}`,
    });
    assert.ok([200, 201].includes(reg.status));
    const cookieB = await login(`owner-b-${ts}@imap.test`, PASS);

    const { status } = await request(cookieB, 'PATCH', `/email-sending/accounts/${id}`, { imapEnabled: false });
    assert.ok(status === 404 || status === 403, `expected 404/403 for cross-tenant PATCH, got ${status}`);
  });

  // Regression: a blank SMTP username means "use the from address" — without
  // resolving that fallback, nodemailer sent NO AUTH and transport.verify()
  // reported success against any server without ever checking the password.
  test('blank smtpUsername resolves to fromEmail so AUTH is actually attempted', async () => {
    const { status, json } = await request(cookie, 'POST', '/email-sending/accounts', baseAccount({
      smtpUsername: '', // wizard: "Leave blank to use your from email address."
    }));
    assert.strictEqual(status, 201, JSON.stringify(json));
    const data = json.data;
    assert.strictEqual(data.fromEmail, `imap-${ts}@example.test`);
    // persisted resolved value — what we will authenticate with
    const row = await models.SmtpAccount.findByPk(data.id);
    assert.strictEqual(row.smtpUsername, `imap-${ts}@example.test`);

    // buildTransport must include auth for this account (never auth: undefined)
    const emailService = require('../services/email');
    const transport = await emailService.buildTransport(row);
    assert.ok(transport.options.auth, 'transport must authenticate when a from-email exists');
    assert.strictEqual(transport.options.auth.user, `imap-${ts}@example.test`);
    assert.ok(transport.options.auth.pass, 'transport must carry the stored password');
  });

  test('buildTransport falls back to fromEmail for legacy rows with null username', async () => {
    const created = await request(cookie, 'POST', '/email-sending/accounts', baseAccount());
    assert.strictEqual(created.status, 201);
    const row = await models.SmtpAccount.findByPk(created.json.data.id);
    // simulate a row created before the fallback existed
    await row.update({ smtpUsername: null });

    const emailService = require('../services/email');
    const transport = await emailService.buildTransport(row);
    assert.ok(transport.options.auth, 'legacy null-username rows must still authenticate');
    assert.strictEqual(transport.options.auth.user, row.fromEmail);
  });
});
