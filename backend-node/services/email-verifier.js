// Email Verifier — REAL pipeline for deliverability pre-flight (Prompt 8).
//
// Stages: syntax -> domain syntax -> DNS/MX lookup (real resolver) ->
// disposable-domain blocklist -> role-based local part -> risk score ->
// status. No stage is allowed to invent results: when DNS is unreachable the
// result is `unknown`, never `valid`.
const dns = require('dns').promises;

// Common disposable email providers (blocklist for obvious throwaway domains).
// This is deliberately conservative — a missed disposable domain just lowers
// confidence instead of blocking a lead.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'sharklasers.com', '10minutemail.com', '10minutemail.net', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'yopmail.com', 'yopmail.fr', 'tempr.email', 'fakeinbox.com',
  'spamgourmet.com', 'trashmail.com', 'trashmail.net', 'mailnesia.com',
  'mintemail.com', 'emailondeck.com', 'moakt.com', 'tmpmail.org',
  'getairmail.com', 'burnermail.io', 'discard.email', 'mailcatch.com',
  'inboxbear.com', 'emailfake.com', 'mailpoof.com', 'tempinbox.com',
]);

// Role-based local parts — high bounce/complaint risk for cold outreach.
const ROLE_LOCAL_PARTS = new Set([
  'admin', 'support', 'info', 'sales', 'hello', 'help', 'contact', 'team',
  'office', 'service', 'billing', 'accounts', 'marketing', 'careers', 'jobs',
  'hr', 'recruit', 'recruiting', 'noreply', 'no-reply', 'donotreply',
  'postmaster', 'abuse', 'security', 'bot', 'webmaster', 'demo', 'enquiry',
]);

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
// Pragmatic RFC-ish address check — local part may include quotes/dots/pluses.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[A-Za-z0-9.-]{1,255}$/;
const LOCAL_BAD_DOT = /(^|\.)\.(?=$|\.)|\.\./; // empty dot segment or double dots

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function parseEmail(email) {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  if (at <= 0) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return { local, domain, email: e };
}

// ---------------------------------------------------------------------------
// Static analysis (no network) — deterministic, unit-testable.
// ---------------------------------------------------------------------------
function analyzeSyntax(email) {
  const reasons = [];
  const parsed = parseEmail(email);
  if (!parsed) {
    return { valid: false, reasons: ['missing_at', 'empty_local_or_domain'], parsed: null };
  }
  const { local, domain } = parsed;
  if (!EMAIL_RE.test(parsed.email)) reasons.push('invalid_characters');
  if (LOCAL_BAD_DOT.test(local) || local.length === 0 || domain.length === 0) {
    reasons.push('invalid_dots');
  }
  if (local.startsWith('.') || local.endsWith('.') || domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-') || domain.endsWith('-')) {
    reasons.push('leading_or_trailing_dot_or_dash');
  }
  if (!DOMAIN_RE.test(domain)) reasons.push('invalid_domain_syntax');
  if (/^\d+$/.test(local)) reasons.push('numeric_local_part'); // weak but real signal
  if (local.length > 64) reasons.push('local_part_too_long');
  return { valid: reasons.length === 0, reasons, parsed };
}

function analyzeLocalPart(local) {
  const l = local.toLowerCase().split('+')[0]; // strip tag
  const bare = l.split('.')[0];
  return {
    roleBased: ROLE_LOCAL_PARTS.has(l) || ROLE_LOCAL_PARTS.has(bare),
    hasPlusTag: local.includes('+'),
  };
}

function analyzeDomain(domain) {
  const d = domain.toLowerCase();
  const tld = d.split('.').pop() || '';
  const disposable = DISPOSABLE_DOMAINS.has(d);
  return { disposable, tld };
}

/**
 * Full verification. Returns a structured result with a `status` that the
 * caller can trust — DNS failures yield `unknown`, never a fake `valid`.
 */
async function verifyEmail(email, { resolveMx = dns.resolveMx, timeoutMs = 5000 } = {}) {
  const started = Date.now();
  const result = {
    email: normalizeEmail(email),
    syntaxValid: false,
    domainValid: false,
    hasMx: false,
    mxRecords: [],
    isDisposable: false,
    isRoleBased: false,
    riskScore: 100,
    status: 'invalid', // invalid | risky | unknown | valid
    reasons: [],
    durationMs: 0,
  };

  const syntax = analyzeSyntax(email);
  result.syntaxValid = syntax.valid;
  if (!syntax.valid) {
    result.reasons = syntax.reasons;
    result.status = 'invalid';
    result.durationMs = Date.now() - started;
    return result;
  }
  result.reasons.push(...syntax.reasons);

  const { local, domain } = syntax.parsed;
  const domainInfo = analyzeDomain(domain);
  result.isDisposable = domainInfo.disposable;
  const localInfo = analyzeLocalPart(local);
  result.isRoleBased = localInfo.roleBased;

  result.domainValid = DOMAIN_RE.test(domain);
  if (!result.domainValid) {
    result.reasons.push('invalid_domain_syntax');
    result.status = 'invalid';
    result.durationMs = Date.now() - started;
    return result;
  }

  // Real MX/A lookup — this is the strongest free signal we have.
  try {
    const mx = await Promise.race([
      resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('mx_timeout'), { code: 'MX_TIMEOUT' })), timeoutMs)),
    ]);
    result.mxRecords = (mx || []).map((r) => ({ exchange: r.exchange, priority: r.priority }));
    result.hasMx = result.mxRecords.length > 0;
    // RFC 7505 null MX (".") or empty exchange means the domain explicitly
    // refuses mail. A non-empty MX set is NOT proof the domain accepts mail.
    if (result.mxRecords.length > 0 && result.mxRecords.every((r) => !r.exchange || r.exchange === '.')) {
      result.reasons.push('null_mx_record');
      result.hasMx = false;
      result.isNullMx = true;
      result.status = 'invalid';
      result.riskScore = 100;
      result.durationMs = Date.now() - started;
      return result;
    }
    if (!result.hasMx) {
      result.reasons.push('no_mx_records');
      result.status = 'invalid'; // domain cannot receive mail at all
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      result.reasons.push('domain_does_not_exist');
      result.status = 'invalid'; // genuinely dead domain
      result.durationMs = Date.now() - started;
      return result;
    }
    // DNS unreachable/timeout — do not guess.
    result.reasons.push('dns_check_unavailable');
    result.status = 'unknown';
    result.durationMs = Date.now() - started;
    return result;
  }

  // ---- Risk scoring (0 = safe … 100 = reject) ---------------------------
  let risk = 5;
  if (result.isDisposable) risk += 60;
  if (result.isRoleBased) risk += 30;
  if (/^\d/.test(local)) risk += 10;
  if (localInfo.hasPlusTag) risk += 5;
  result.riskScore = Math.min(risk, 100);

  if (result.isDisposable) {
    result.reasons.push('disposable_domain');
    result.status = 'invalid'; // disposable inboxes burn sender reputation
  } else if (!result.hasMx) {
    result.status = 'invalid'; // domain cannot receive mail at all
  } else if (result.isRoleBased) {
    result.reasons.push('role_based_local_part');
    result.status = 'risky';
  } else if (result.riskScore >= 50) {
    result.status = 'risky';
  } else {
    result.status = 'valid';
  }
  result.durationMs = Date.now() - started;
  return result;
}

module.exports = {
  DISPOSABLE_DOMAINS,
  ROLE_LOCAL_PARTS,
  normalizeEmail,
  parseEmail,
  analyzeSyntax,
  analyzeLocalPart,
  analyzeDomain,
  verifyEmail,
};
