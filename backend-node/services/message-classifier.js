// MessageClassifier — deterministic inbound message classification (Unified Inbox).
// NO AI for security-critical decisions (campaign stopping, suppression).
// Every decision returns the signal that triggered it, for auditability.
//
// Categories:
//   HUMAN_REPLY | AUTO_REPLY | BOUNCE | OUT_OF_OFFICE | SYSTEM_MESSAGE | UNKNOWN
//
// Bounce severity: 'hard' (permanent — suppress) vs 'soft' (temporary — log only).

const BOUNCE_FROM = /^(mailer-daemon|postmaster|mail delivery|auto-reply)@/i;
const DSN_REPORT_TYPE = /report-type=delivery-status/i;
const SUBJ_OOO = /(out of (the )?office|away from my desk|on vacation|on holiday|on leave|maternity|paternity|OOO|auto[- ]?reply|automatic(ally)? generated)/i;
const SUBJ_BOUNCE = /(undeliverable|delivery status notification|delivery incomplete|mail delivery failed|returned mail|bounce|failure notice|undelivered)/i;
const UNSUBSCRIBE_TEXT = /\b(unsubscribe|remove me( from)?|stop (sending|emailing)|do not (contact|email)|opt[\s-]?out|take me off|delete my (data|details))\b/i;

/** Normalize text for matching: lowercase, collapse non-word chars into single spaces. */
function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Classify a parsed message. Returns { type, bounceSeverity?, unsubscribe?, signals: string[] }.
 * signals is an ordered list of the exact rules that fired.
 */
function classify({ subject = '', from = '', headers = {}, textBody = '', htmlBody = '' } = {}) {
  const signals = [];
  const headerValue = (name) => {
    const v = headers[name.toLowerCase()] ?? headers[name] ?? headers[name.toUpperCase()];
    return Array.isArray(v) ? v.join(', ') : String(v || '');
  };
  const contentType = headerValue('content-type');
  const autoSubmitted = headerValue('auto-submitted').toLowerCase();
  const normalizedSubject = normalizeForMatch(subject);
  const normalizedBody = normalizeForMatch(textBody || htmlBody.replace(/<[^>]+>/g, ' '));

  // --- DSN (RFC 3464) is the only hard bounce signal we trust unconditionally ---
  if (DSN_REPORT_TYPE.test(contentType) || DSN_REPORT_TYPE.test(headerValue('report-type'))) {
    signals.push('dsn_report_type');
    // Permanent vs temporary: scan body/subject for 5xx (hard) vs 4xx (soft) status codes.
    const hard = /\b5\.[0-9]\.[0-9]\b/.test(normalizedBody) || /\b(5\d\d)\b/.test(normalizedBody + ' ' + normalizedSubject);
    const soft = /\b4\.[0-9]\.[0-9]\b/.test(normalizedBody) || /\b(4\d\d)\b/.test(normalizedBody + ' ' + normalizedSubject);
    if (hard && !soft) return { type: 'BOUNCE', bounceSeverity: 'hard', signals };
    if (soft && !hard) return { type: 'BOUNCE', bounceSeverity: 'soft', signals };
    // DSN without a status hint: treat as hard (mail did not arrive) — the honest default.
    return { type: 'BOUNCE', bounceSeverity: 'hard', signals };
  }

  // --- Mailer-daemon with delivery-failure language: hard bounce ---
  if (BOUNCE_FROM.test(String(from).trim().toLowerCase())) {
    if (SUBJ_BOUNCE.test(normalizedSubject) || /\b(5\.[0-9]\.[0-9]|undeliverable|permanent( error)?|recipient (rejected|unknown|does not exist))\b/i.test(normalizedBody)) {
      signals.push('mailer_daemon_bounce');
      return { type: 'BOUNCE', bounceSeverity: 'hard', signals };
    }
    if (SUBJ_OOO.test(normalizedSubject)) {
      signals.push('auto_submitted_ooo');
      return { type: 'OUT_OF_OFFICE', signals };
    }
    signals.push('mailer_daemon_unspecified');
    return { type: 'SYSTEM_MESSAGE', signals };
  }

  // --- auto-submitted header (RFC 3834) ---
  if (autoSubmitted && autoSubmitted !== 'no') {
    if (SUBJ_OOO.test(normalizedSubject) || /vacation|out of office|away/i.test(normalizedBody)) {
      signals.push('auto_submitted_ooo');
      return { type: 'OUT_OF_OFFICE', signals };
    }
    signals.push('auto_submitted_auto');
    return { type: 'AUTO_REPLY', signals };
  }

  // --- Subject-based auto reply / OOO ---
  if (SUBJ_OOO.test(normalizedSubject)) {
    signals.push('subject_ooo');
    return { type: 'OUT_OF_OFFICE', signals };
  }
  if (SUBJ_BOUNCE.test(normalizedSubject) && /\b(5\d\d|undeliverable|failure|rejected)\b/i.test(normalizedBody)) {
    signals.push('subject_bounce_with_5xx');
    return { type: 'BOUNCE', bounceSeverity: 'hard', signals };
  }

  // --- Unsubscribe signals (deterministic patterns) ---
  const unsubscribe = UNSUBSCRIBE_TEXT.test(normalizedBody) || UNSUBSCRIBE_TEXT.test(normalizedSubject);
  if (unsubscribe) signals.push('unsubscribe_text');

  // --- Human reply: everything else with real content ---
  if ((textBody || '').trim() || (htmlBody || '').trim()) {
    return { type: 'HUMAN_REPLY', unsubscribe, signals };
  }
  return { type: 'UNKNOWN', unsubscribe, signals };
}

/** True when the text contains an unsubscribe signal (used for the suppression path). */
function containsUnsubscribe(text) {
  return UNSUBSCRIBE_TEXT.test(normalizeForMatch(text));
}

module.exports = { classify, containsUnsubscribe, normalizeForMatch, SUBJ_OOO, UNSUBSCRIBE_TEXT };
