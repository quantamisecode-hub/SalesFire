// SpamAssassin-style heuristic checker for the Sequence Builder (§29).
// Deterministic rule engine — no AI dependency, always available, and strictly
// ADVISORY: a high score never blocks saving or launching, it only warns.
//
// Score model (0-100, where anything ≥ 60 is "likely to be filtered"):
//   * ALL-CAPS words in subject/body
//   * classic trigger phrases (guarantee, act now, risk-free, …)
//   * excessive exclamation/question marks
//   * money symbols and inflated numbers
//   * urgent-pressure language (today, deadline, limited)
//   * link density and suspicious link text
//   * spammy formatting (ALL-CAPS sentences, long subject, no plain-text)

const TRIGGER_PHRASES = [
  'act now', 'apply now', 'avoid bankruptcy', 'bargain', 'best price',
  'big money', 'cash bonus', 'cheap', 'click here', 'congratulations',
  'credit card', 'dear friend', 'discount', 'double your', 'earn money',
  'earn per week', 'exclusive deal', 'extra income', 'fast cash',
  'financial freedom', 'free', 'free gift', 'free trial', 'guarantee',
  'guaranteed', 'incredible deal', 'instant income', 'limited time',
  'lowest price', 'make money', 'million dollars', 'miracle',
  'no cost', 'no credit check', 'no fees', 'no obligation', 'no risk',
  'offer expires', 'one time', 'pre-approved', 'pure profit',
  'risk free', 'risk-free', 'satisfaction guaranteed', 'save big',
  'special promotion', 'this isn\'t spam', 'urgent', 'while supplies last',
  'winner', 'work from home', '100% free', '100% satisfied',
];

const URGENT_WORDS = [
  'today', 'immediately', 'hurry', 'deadline', 'expires', 'last chance',
  'don\'t delay', 'final notice', 'time sensitive', 'act fast',
];

const MONEY_RE = /[\$€£¥]\s?\d|(\d{1,3}(,\d{3})+)|\b\d+\s?(percent|%)\s?(off|return|roi)\b/gi;

function countMatches(text, phrases) {
  const hits = [];
  for (const phrase of phrases) {
    let idx = text.indexOf(phrase);
    while (idx !== -1) {
      hits.push(phrase);
      idx = text.indexOf(phrase, idx + phrase.length);
    }
  }
  return hits;
}

function allCapsWords(text) {
  return (text.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !['SMTP', 'HTML', 'SAAS', 'CEO', 'CTO', 'B2B', 'ROI', 'LLC', 'INC'].includes(w));
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a subject+body pair. Returns { score, grade, warnings[], stats }.
 * `score` 0-100, `grade` one of excellent|good|warning|poor.
 */
function checkSpam({ subject = '', bodyHtml = '', bodyText = '' }) {
  const warnings = [];
  let score = 0;
  const body = stripHtml(bodyHtml) || String(bodyText || '');
  const combined = `${subject}\n${body}`.toLowerCase();

  // 1. Trigger phrases (heaviest signal).
  const phraseHits = countMatches(combined, TRIGGER_PHRASES);
  if (phraseHits.length) {
    score += Math.min(35, phraseHits.length * 7);
    warnings.push({
      rule: 'TRIGGER_PHRASES',
      message: `Spam-trigger phrase${phraseHits.length > 1 ? 's' : ''} found: ${[...new Set(phraseHits)].slice(0, 5).map((p) => `"${p}"`).join(', ')}.`,
      score: Math.min(35, phraseHits.length * 7),
    });
  }

  // 2. ALL-CAPS words.
  const capsSubject = allCapsWords(subject);
  const capsBody = allCapsWords(body);
  if (capsSubject.length) {
    score += Math.min(15, capsSubject.length * 5);
    warnings.push({ rule: 'CAPS_SUBJECT', message: `Subject uses ALL-CAPS words (${[...new Set(capsSubject)].slice(0, 4).join(', ')}).`, score: Math.min(15, capsSubject.length * 5) });
  }
  if (capsBody.length >= 2) {
    score += Math.min(10, capsBody.length * 2);
    warnings.push({ rule: 'CAPS_BODY', message: `Body uses ${capsBody.length} ALL-CAPS words — keep shouting to a minimum.`, score: Math.min(10, capsBody.length * 2) });
  }

  // 3. Excessive punctuation.
  const bangs = (combined.match(/!/g) || []).length;
  if (bangs >= 2) {
    const s = Math.min(12, bangs * 3);
    score += s;
    warnings.push({ rule: 'EXCLAMATION', message: `${bangs} exclamation marks — one at most is credible in B2B outreach.`, score: s });
  }

  // 4. Urgent pressure language.
  const urgentHits = countMatches(combined, URGENT_WORDS);
  if (urgentHits.length >= 2) {
    const s = Math.min(12, urgentHits.length * 3);
    score += s;
    warnings.push({ rule: 'URGENT_LANGUAGE', message: `Urgency language (${[...new Set(urgentHits)].slice(0, 4).join(', ')}) reads as pressure when repeated.`, score: s });
  }

  // 5. Money / inflated numbers.
  const moneyHits = (combined.match(MONEY_RE) || []).length;
  if (moneyHits >= 1) {
    const s = Math.min(10, moneyHits * 4);
    score += s;
    warnings.push({ rule: 'MONEY_SYMBOLS', message: 'Money amounts or inflated claims in the copy can trigger filters.', score: s });
  }

  // 6. Link density + suspicious link text.
  const links = (String(bodyHtml || '').match(/<a\s/gi) || []).length;
  const words = body ? body.split(/\s+/).length : 0;
  if (words > 0 && links / Math.max(words, 1) > 0.05 && links > 2) {
    score += 8;
    warnings.push({ rule: 'LINK_DENSITY', message: `${links} links in a ${words}-word email is link-heavy.`, score: 8 });
  }

  // 7. Subject length + spammy subject shapes.
  const subjectTrim = subject.trim();
  if (subjectTrim.length > 80) {
    score += 6;
    warnings.push({ rule: 'LONG_SUBJECT', message: `Subject is ${subjectTrim.length} characters — filters truncate around 80.`, score: 6 });
  }
  if (/^(re:|fwd:)\s*/i.test(subjectTrim) && subjectTrim.length < 12) {
    score += 10;
    warnings.push({ rule: 'FAKE_THREAD', message: 'A bare "Re:"/"Fwd:" prefix on a first email is a deceptive-subject signal.', score: 10 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 60 ? 'poor' : score >= 35 ? 'warning' : score >= 15 ? 'good' : 'excellent';
  return {
    score,
    grade,
    warnings,
    stats: {
      subjectLength: subjectTrim.length,
      wordCount: words,
      linkCount: links,
      exclamationCount: bangs,
    },
  };
}

module.exports = { checkSpam };
