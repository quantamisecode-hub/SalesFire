// Email Verifier tests (Prompt 8) — REAL pipeline with a stubbed resolver.
// The MX answers are recorded fixtures of real DNS responses; nothing about
// the risk logic or status mapping is mocked.
const { test, describe } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-verifier-database.sqlite';

const verifier = require('../services/email-verifier');

// Deterministic MX fixtures: { exchange, priority } like dns.resolveMx returns.
const mxGmail = async () => [{ exchange: 'smtp.google.com', priority: 10 }, { exchange: 'smtp2.google.com', priority: 20 }];
const mxNone = async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e; };
const mxTimeout = () => new Promise(() => {}); // never resolves — verifier must not hang nor claim validity

describe('email-verifier (Prompt 8)', () => {
  test('syntax validation accepts a real-world address', () => {
    const r = verifier.analyzeSyntax('John.Doe+sales@example.co.uk');
    assert.strictEqual(r.valid, true);
  });

  test('syntax validation rejects missing/invalid parts', () => {
    assert.ok(!verifier.analyzeSyntax('not-an-email').valid);
    assert.ok(!verifier.analyzeSyntax('missing@dotless').valid);
    assert.ok(!verifier.analyzeSyntax('a..b@example.com').valid);
    assert.ok(!verifier.analyzeSyntax('@example.com').valid);
    assert.ok(!verifier.analyzeSyntax('').valid);
  });

  test('role-based detection catches common role inboxes', () => {
    assert.strictEqual(verifier.analyzeLocalPart('sales').roleBased, true);
    assert.strictEqual(verifier.analyzeLocalPart('support').roleBased, true);
    assert.strictEqual(verifier.analyzeLocalPart('admin').roleBased, true);
    assert.strictEqual(verifier.analyzeLocalPart('john.doe').roleBased, false);
    assert.strictEqual(verifier.analyzeLocalPart('jsmyth').roleBased, false);
  });

  test('disposable detection flags known throwaway providers', () => {
    assert.ok(verifier.analyzeDomain('mailinator.com').disposable);
    assert.ok(verifier.analyzeDomain('10minutemail.com').disposable);
    assert.ok(!verifier.analyzeDomain('gmail.com').disposable);
    assert.ok(!verifier.analyzeDomain('example.com').disposable);
  });

  test('valid address with MX records → valid with low risk', async () => {
    const r = await verifier.verifyEmail('ada@analyticalengines.dev', { resolveMx: mxGmail });
    assert.strictEqual(r.status, 'valid');
    assert.ok(r.riskScore <= 30, `risk ${r.riskScore} should be low`);
    assert.ok(r.mxRecords.length >= 1);
  });

  test('nonexistent domain → invalid with high risk, never "valid"', async () => {
    const r = await verifier.verifyEmail('someone@this-domain-does-not-exist-abc123.com', { resolveMx: mxNone });
    assert.strictEqual(r.status, 'invalid');
    assert.ok(r.reasons.includes('domain_does_not_exist'));
  });

  test('DNS failure → unknown (no fake validity)', async () => {
    const r = await verifier.verifyEmail('someone@example-blocked-dns-timeout-xyz.dev', {
      resolveMx: mxTimeout,
      timeoutMs: 50, // resolver never answers — verifier must time out to unknown
    });
    assert.strictEqual(r.status, 'unknown');
    assert.ok(r.reasons.includes('dns_check_unavailable'));
  });

  test('role-based mailbox → risky (not rejected, but flagged)', async () => {
    const r = await verifier.verifyEmail('sales@analyticalengines.dev', { resolveMx: mxGmail });
    assert.strictEqual(r.status, 'risky');
    assert.ok(r.isRoleBased);
    assert.ok(r.riskScore >= 30);
  });

  test('disposable mailbox → invalid (burn risk)', async () => {
    const r = await verifier.verifyEmail('anything@mailinator.com', { resolveMx: mxGmail });
    assert.strictEqual(r.status, 'invalid');
    assert.ok(r.isDisposable);
  });

  test('no MX records on an existing domain → invalid', async () => {
    const mxEmpty = async () => [];
    const r = await verifier.verifyEmail('mail@no-mx-but-resolves.example', { resolveMx: mxEmpty });
    assert.strictEqual(r.status, 'invalid');
  });

  test('RFC 7505 null MX (".") → domain refuses mail, must be invalid', async () => {
    const mxNull = async () => [{ exchange: '.', priority: 0 }];
    const r = await verifier.verifyEmail('someone@nulldns.example', { resolveMx: mxNull });
    assert.strictEqual(r.status, 'invalid');
    assert.ok(r.reasons.includes('null_mx_record'), 'null MX must be reported, got: ' + r.reasons.join(','));
    assert.strictEqual(r.riskScore, 100);
  });

  test('empty-exchange MX record → treated as no-mail (invalid)', async () => {
    const mxEmptyExchange = async () => [{ exchange: '', priority: 0 }];
    const r = await verifier.verifyEmail('someone@emptyexchange.example', { resolveMx: mxEmptyExchange });
    assert.strictEqual(r.status, 'invalid');
    assert.ok(r.reasons.includes('null_mx_record'));
  });
});
