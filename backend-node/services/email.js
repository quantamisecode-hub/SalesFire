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

// Classify SMTP errors into PROMPT 9.1 failure classes. Never echoes raw
// SMTP responses (which may contain credentials or internal hostnames).
// Classes: AUTHENTICATION_ERROR | CONNECTION_ERROR | TLS_ERROR | RATE_LIMIT
//        | TEMPORARY_FAILURE | PERMANENT_FAILURE | MAILBOX_UNAVAILABLE | UNKNOWN
function classifyError(err) {
  const code = err?.code || '';
  const cmd = err?.command || '';
  const responseCode = Number(err?.responseCode || 0);
  const msg = String(err?.message || '').toLowerCase();

  if (code === 'EAUTH' || cmd === 'AUTH' || responseCode === 535 || responseCode === 530) {
    return { class: 'AUTHENTICATION_ERROR', message: 'SMTP authentication failed.' };
  }
  if (responseCode === 429 || responseCode === 421) {
    return { class: 'RATE_LIMIT', message: 'SMTP rate limit reached.' };
  }
  if (responseCode === 450 || responseCode === 451 || responseCode === 452) {
    return { class: 'TEMPORARY_FAILURE', message: 'SMTP temporary failure; recipient may be temporarily unavailable.' };
  }
  if ([550, 551, 553].includes(responseCode) && /mailbox|user|recipient/.test(msg)) {
    return { class: 'MAILBOX_UNAVAILABLE', message: 'Recipient mailbox unavailable.' };
  }
  if (responseCode >= 500) {
    return { class: 'PERMANENT_FAILURE', message: 'SMTP rejected the message permanently.' };
  }
  if (responseCode >= 400) {
    return { class: 'TEMPORARY_FAILURE', message: 'SMTP temporary failure.' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { class: 'CONNECTION_ERROR', message: 'SMTP host not found.' };
  }
  if (code === 'ECONNREFUSED') {
    return { class: 'CONNECTION_ERROR', message: 'SMTP connection refused.' };
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || msg.includes('timeout')) {
    return { class: 'CONNECTION_ERROR', message: 'SMTP connection timed out.' };
  }
  if (msg.includes('certificate') || msg.includes('tls') || code === 'EPROTO') {
    return { class: 'TLS_ERROR', message: 'SMTP TLS negotiation failed.' };
  }
  return { class: 'UNKNOWN', message: 'SMTP delivery failed.' };
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
