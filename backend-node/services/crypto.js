// Secret encryption service - AES-256-GCM authenticated encryption (Prompt 6 §31).
// Used for SMTP credentials at rest. The key comes from ENCRYPTION_KEY env
// (32 bytes hex/base64/raw, or any passphrase -> stretched with scrypt).
// Format: v1.<iv_b64>.<authTag_b64>.<ciphertext_b64>

const crypto = require('crypto');

const VERSION = 'v1';

let cachedKey = null;
let keySource = null;

function getKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (cachedKey && keySource === secret) return cachedKey;

  const raw = Buffer.from(secret, 'utf8');
  if (raw.length === 32) {
    cachedKey = raw;
  } else {
    // Stretch non-32-byte keys deterministically
    cachedKey = crypto.scryptSync(secret, 'salesfire.smtp.v1', 32);
  }
  keySource = secret;
  return cachedKey;
}

function encryptSecret(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

function decryptSecret(encoded) {
  if (!encoded) return null;
  const parts = String(encoded).split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognized encrypted secret format');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// HMAC-signed, tamper-resistant unsubscribe token (Prompt 6 §36).
// Payload: base64url(json).hmac  — signature covers org, campaign, recipient, email.
function getSignKey() {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('No signing secret configured');
  return secret;
}

function signUnsubscribeToken({ organizationId, campaignId, recipientId, email }) {
  const payload = Buffer.from(JSON.stringify({
    organizationId, campaignId, recipientId, email,
    iat: Date.now(),
  })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSignKey())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getSignKey())
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  encryptSecret,
  decryptSecret,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
};
