// Crypto service tests - Prompt 6 §31, §36 (node:test, no external deps).
// Run: node --test test/crypto.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';

const {
  encryptSecret,
  decryptSecret,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../services/crypto');

describe('AES-256-GCM secret encryption', () => {
  test('roundtrips a password', () => {
    const secret = 's3cure-SMTP-passw0rd!';
    const encrypted = encryptSecret(secret);
    assert.ok(encrypted.startsWith('v1.'), 'uses versioned format');
    assert.notStrictEqual(encrypted, secret, 'ciphertext differs from plaintext');
    assert.strictEqual(decryptSecret(encrypted), secret);
  });

  test('produces unique ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptSecret('same-password');
    const b = encryptSecret('same-password');
    assert.notStrictEqual(a, b);
    assert.strictEqual(decryptSecret(a), 'same-password');
    assert.strictEqual(decryptSecret(b), 'same-password');
  });

  test('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('do-not-touch');
    const parts = encrypted.split('.');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0x01; // flip one bit
    parts[3] = ct.toString('base64');
    assert.throws(() => decryptSecret(parts.join('.')));
  });

  test('rejects tampered auth tag', () => {
    const encrypted = encryptSecret('do-not-touch');
    const parts = encrypted.split('.');
    const tag = Buffer.from(parts[2], 'base64');
    tag[0] ^= 0xff;
    parts[2] = tag.toString('base64');
    assert.throws(() => decryptSecret(parts.join('.')));
  });

  test('rejects unrecognized format', () => {
    assert.throws(() => decryptSecret('plaintext-password'));
  });

  test('handles null/empty safely', () => {
    assert.strictEqual(encryptSecret(null), null);
    assert.strictEqual(decryptSecret(null), null);
  });
});

describe('HMAC unsubscribe tokens', () => {
  const payload = {
    organizationId: 'org-123',
    campaignId: 'camp-456',
    recipientId: 'rec-789',
    email: 'person@example.com',
  };

  test('signs and verifies', () => {
    const token = signUnsubscribeToken(payload);
    assert.ok(token.includes('.'));
    const decoded = verifyUnsubscribeToken(token);
    assert.strictEqual(decoded.organizationId, payload.organizationId);
    assert.strictEqual(decoded.campaignId, payload.campaignId);
    assert.strictEqual(decoded.recipientId, payload.recipientId);
    assert.strictEqual(decoded.email, payload.email);
  });

  test('rejects tampered payload', () => {
    const token = signUnsubscribeToken(payload);
    const [payloadB64, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({
      ...payload,
      email: 'attacker@evil.com',
    })).toString('base64url');
    assert.strictEqual(verifyUnsubscribeToken(`${forged}.${sig}`), null);
  });

  test('rejects tampered signature', () => {
    const token = signUnsubscribeToken(payload);
    const [payloadB64] = token.split('.');
    const badSig = Buffer.alloc(43, 'A').toString();
    assert.strictEqual(verifyUnsubscribeToken(`${payloadB64}.${badSig}`), null);
  });

  test('rejects garbage tokens', () => {
    assert.strictEqual(verifyUnsubscribeToken(''), null);
    assert.strictEqual(verifyUnsubscribeToken('not-a-token'), null);
    assert.strictEqual(verifyUnsubscribeToken('a.b.c'), null);
  });
});
