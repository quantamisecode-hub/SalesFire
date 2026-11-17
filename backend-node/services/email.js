// Email Service - SMTP transport abstraction (Prompt 6 §26).
// EmailProvider -> SMTPProvider -> EmailService.
// Nodemailer is the transport; credentials come decrypted from SmtpAccount.
// Errors are sanitized: auth/host failures are classified, never echoed raw.

const nodemailer = require('nodemailer');
const { decryptSecret } = require('./crypto');

// Build a nodemailer transport from an SmtpAccount model instance.
async function buildTransport(account) {
  const plain = account.smtpPasswordEncrypted
    ? decryptSecret(account.smtpPasswordEncrypted)
    : null;

  const secure = account.security === 'ssl';
  const requireTls = account.security === 'tls' && !secure;

  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure, // implicit TLS on connect (usually 465)
    requireTls, // STARTTLS required (usually 587)
    auth: account.smtpUsername
      ? { user: account.smtpUsername, pass: plain || undefined }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { rejectUnauthorized: true },
  });
}

// Classify SMTP errors: 'auth' | 'dns' | 'tls' | 'timeout' | 'permanent' | 'transient'
function classifyError(err) {
  const code = err?.code || '';
  const cmd = err?.command || '';
  const responseCode = err?.responseCode || 0;
  const msg = String(err?.message || '').toLowerCase();

  if (code === 'EAUTH' || cmd === 'AUTH' || responseCode === 535 || responseCode === 530) {
    return { class: 'auth', message: 'SMTP authentication failed.' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { class: 'dns', message: 'SMTP host not found.' };
  }
  if (code === 'ECONNREFUSED') {
    return { class: 'transient', message: 'SMTP connection refused.' };
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || msg.includes('timeout')) {
    return { class: 'timeout', message: 'SMTP connection timed out.' };
  }
  if (msg.includes('certificate') || msg.includes('tls') || code === 'EPROTO') {
    return { class: 'tls', message: 'SMTP TLS negotiation failed.' };
  }
  if (responseCode >= 500) {
    return { class: 'permanent', message: 'SMTP rejected the message permanently.' };
  }
  return { class: 'transient', message: 'SMTP delivery failed.' };
}

// Verify connectivity/credentials. Returns { ok, class?, message, latencyMs }.
async function testConnection(account) {
  const started = Date.now();
  try {
    const transport = await buildTransport(account);
    await transport.verify();
    transport.close();
    return { ok: true, message: 'SMTP connection successful.', latencyMs: Date.now() - started };
  } catch (err) {
    const { class: klass, message } = classifyError(err);
    return { ok: false, class: klass, message, latencyMs: Date.now() - started };
  }
}

// Send a message. Returns { ok, messageId?, failureClass?, error? }.
async function sendEmail(account, message) {
  try {
    const transport = await buildTransport(account);
    const info = await transport.sendMail({
      from: account.fromName
        ? `"${account.fromName}" <${account.fromEmail}>`
        : account.fromEmail,
      replyTo: account.replyToEmail || undefined,
      ...message,
    });
    transport.close();
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const { class: klass, message } = classifyError(err);
    return { ok: false, failureClass: klass, error: message };
  }
}

module.exports = {
  buildTransport,
  testConnection,
  sendEmail,
  classifyError,
};
