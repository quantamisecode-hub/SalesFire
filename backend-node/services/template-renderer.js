// TemplateRenderer — Sequence Builder rendering pipeline (§43).
//
//   Raw Email
//      ↓  Conditional evaluation   {% if industry == "SaaS" %}…{% endif %}
//      ↓  Spintax resolution       {{RANDOM | Hi | Hello | Hey}} (nested-aware,
//      |                            deterministic via seed, §19-§22)
//      ↓  Variable resolution      {{firstName}} {{first_name}} {{firstName | there}}
//      ↓  HTML sanitization        strip scripts/handlers/unsafe URLs (§32, §45)
//   Final Email
//
// Security model (§44, §45):
//   * Conditionals are a tiny hand-rolled evaluator — NO eval, NO template
//     engine, only literal string comparisons against provided values.
//   * AI/editor content is untrusted input; the sanitizer strips executable or
//     dangerous constructs before anything is stored or sent.
//   * Unknown variables are never silently emptied: they stay literal and are
//     reported via analyze()/unresolved so validation can block the launch (§40).
//
// Every function is deterministic when given a seed (§21) — used by preview
// variation cycling and tests.

// ---------------------------------------------------------------------------
// Deterministic RNG (xmur3 hash + mulberry32)
// ---------------------------------------------------------------------------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic RNG from a string seed. */
function makeRng(seed) {
  return mulberry32(xmur3(String(seed || 'default'))());
}

/**
 * Weighted variant pick (§10). Deterministic given the same rng state.
 * variants: [{ weight, ... }]; returns one element.
 */
function pickWeighted(variants, rng) {
  const usable = (variants || []).filter((v) => (Number(v.weight) || 0) > 0);
  if (!usable.length) return variants && variants[0];
  const total = usable.reduce((s, v) => s + (Number(v.weight) || 0), 0);
  let roll = rng() * total;
  for (const v of usable) {
    roll -= Number(v.weight) || 0;
    if (roll < 0) return v;
  }
  return usable[usable.length - 1];
}

// ---------------------------------------------------------------------------
// Spintax — {{RANDOM | opt1 | opt2 | ...}} with nesting (§19, §22)
// ---------------------------------------------------------------------------
const SPINTAX_OPEN = '{{RANDOM';

/**
 * Find the matching close for a spintax block opened at `start` (index of
 * `{{RANDOM`), by scanning `{{` / `}}` tokens — so options may themselves
 * contain nested {{variables}} or {{RANDOM ...}} blocks.
 * Returns { end } (index after `}}`) or null when malformed/unclosed.
 */
function findSpintaxClose(template, start) {
  let depth = 0;
  let i = start;
  while (i < template.length) {
    if (template.startsWith('{{', i)) { depth++; i += 2; continue; }
    if (template.startsWith('}}', i)) {
      depth--;
      i += 2;
      if (depth === 0) return { end: i };
      continue;
    }
    i++;
  }
  return null;
}

/** True when the block content contains no further spintax openers (innermost). */
function isInnermostSpintax(content) {
  return !content.includes(SPINTAX_OPEN);
}

/**
 * Resolve ONE pass: every spintax block found is either resolved (innermost)
 * or recursed into (nested — inner blocks resolve first, then the outer block
 * becomes innermost on a later pass). Returns { text, malformed }.
 */
function resolveSpintaxPass(template, rng, malformed) {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf(SPINTAX_OPEN, i);
    if (open === -1) { out += template.slice(i); break; }
    out += template.slice(i, open);
    const close = findSpintaxClose(template, open);
    if (!close) {
      // Unclosed block — malformed (§41), reported once, left literal for the UI.
      malformed.push({
        snippet: template.slice(open, open + 60),
        reason: 'Invalid Spintax — missing closing braces.',
      });
      out += template.slice(open);
      i = template.length;
      continue;
    }
    const block = template.slice(open, close.end);
    // Content between the keyword and the closing braces; the first pipe after
    // the keyword is its separator, not an option delimiter.
    const inner = block.slice(SPINTAX_OPEN.length, block.length - 2);
    if (!isInnermostSpintax(inner)) {
      // Nested (§22): resolve inner blocks first, rebuild the outer block.
      const recursed = resolveSpintaxPass(inner, rng, malformed);
      out += SPINTAX_OPEN + recursed.text + '}}';
      i = close.end;
      continue;
    }
    // Strip the keyword separator, then split options on top-level pipes.
    const body = inner.replace(/^\s*\|/, '');
    const options = [];
    let depth = 0;
    let current = '';
    for (let j = 0; j < body.length; j++) {
      if (body.startsWith('{{', j)) { depth++; current += '{{'; j++; continue; }
      if (body.startsWith('}}', j)) { depth--; current += '}}'; j++; continue; }
      if (body[j] === '|' && depth === 0) { options.push(current); current = ''; continue; }
      current += body[j];
    }
    options.push(current);
    const trimmed = options.map((o) => o.trim());
    if (trimmed.length < 2 || trimmed.some((o) => o === '')) {
      malformed.push({
        snippet: block.slice(0, 60),
        reason: 'Invalid Spintax — needs at least two non-empty options.',
      });
      out += block; // leave literal; validation blocks launch
    } else {
      out += trimmed[Math.floor(rng() * trimmed.length) % trimmed.length];
    }
    i = close.end;
  }
  return { text: out, malformed };
}

/**
 * Resolve all spintax. Nested blocks resolve inside-out across passes; the
 * loop stops as soon as a pass makes no change (all remaining blocks are
 * malformed literals), so malformed blocks are reported exactly once.
 */
function resolveSpintax(template, rng, malformed = []) {
  let text = template;
  let prev = null;
  for (let pass = 0; pass < 25 && prev !== text; pass++) {
    prev = text;
    text = resolveSpintaxPass(text, rng, malformed).text;
  }
  return { text, malformed };
}

// ---------------------------------------------------------------------------
// Conditionals — {% if x == "y" %}…{% else %}…{% endif %} (§24, sandboxed)
// ---------------------------------------------------------------------------
const IF_TOKEN = /\{%\s*if\s+([^%]+?)\s*%\}/g;

/**
 * Evaluate a condition against vars. Only supports:
 *   <identifier> (== | !=) "<literal>"  chained with `and` / `or`.
 * No function calls, no member access, no dynamic evaluation of any kind.
 */
function evalCondition(condition, vars) {
  const clauses = String(condition).split(/\s+(and|or)\s+/i);
  let result = evalClause(clauses[0], vars);
  for (let i = 1; i < clauses.length; i += 2) {
    const op = clauses[i].toLowerCase();
    const next = evalClause(clauses[i + 1], vars);
    result = op === 'or' ? (result || next) : (result && next);
  }
  return result;
}

function evalClause(clause, vars) {
  const m = String(clause).trim().match(/^([a-zA-Z0-9_]+)\s*(==|!=)\s*"([^"]*)"$/);
  if (!m) return false; // anything unsupported is simply false — never executed
  const [, name, op, literal] = m;
  const value = vars[name] == null ? '' : String(vars[name]);
  return op === '==' ? value === literal : value !== literal;
}

/**
 * Resolve {% if %} blocks innermost-first. Unknown vars compare as empty.
 * Malformed (unclosed) blocks are reported and left literal.
 */
function resolveConditionals(template, vars = {}, malformed = []) {
  let text = template;
  for (let pass = 0; pass < 25; pass++) {
    IF_TOKEN.lastIndex = 0;
    let innermost = null;
    let m;
    while ((m = IF_TOKEN.exec(text)) !== null) {
      const endif = text.indexOf('{% endif %}', m.index);
      const nextIf = text.indexOf('{% if', m.index + m[0].length);
      if (nextIf !== -1 && nextIf < endif) continue; // not innermost
      innermost = { start: m.index, end: m[0].length, condition: m[1], endifOffset: endif };
      break;
    }
    if (!innermost) break;
    const { start, end, condition, endifOffset } = innermost;
    if (endifOffset === -1) {
      malformed.push({
        snippet: text.slice(start, start + 60),
        reason: 'Invalid conditional — missing {% endif %}.',
      });
      // Skip past this {% if token to avoid an infinite loop; leave literal.
      text = text.slice(0, start) + text.slice(start + end);
      continue;
    }
    const body = text.slice(start + end, endifOffset);
    let truthy = body;
    let falsy = '';
    const elseIdx = body.indexOf('{% else %}');
    if (elseIdx !== -1) {
      truthy = body.slice(0, elseIdx);
      falsy = body.slice(elseIdx + '{% else %}'.length);
    }
    const chosen = evalCondition(condition, vars) ? truthy : falsy;
    text = text.slice(0, start) + chosen + text.slice(endifOffset + '{% endif %}'.length);
  }
  return { text, malformed };
}

// ---------------------------------------------------------------------------
// Variables — {{name}} and {{name | fallback}} (§12, §15, §17)
// ---------------------------------------------------------------------------
const VAR_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/**
 * Resolve variables. Resolution rules:
 *   * value present (even empty string) → replaced with the value (fallback
 *     applies when the value is empty/missing AND a fallback was given)
 *   * unknown variable with fallback → fallback (§17)
 *   * unknown variable without fallback → left LITERAL, recorded as unresolved
 *     (§40 — never silently emptied)
 */
function resolveVariables(template, vars, unresolved = []) {
  return String(template || '').replace(VAR_TOKEN, (match, name, fallback) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const value = vars[name];
      if (value == null || value === '') {
        if (fallback !== undefined && fallback !== '') return fallback;
        return ''; // known but empty → empty (matches existing engine behavior)
      }
      return String(value);
    }
    if (fallback !== undefined && fallback !== '') return fallback;
    unresolved.push(name);
    return match; // unknown → literal, reported (§40)
  });
}

// ---------------------------------------------------------------------------
// HTML sanitization (§32, §45)
// ---------------------------------------------------------------------------
function sanitizeHtml(html) {
  let out = String(html || '');
  // Dangerous elements with content
  out = out.replace(/<(script|iframe|object|embed|form|base|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Dangerous void/self-closing or stray openers
  out = out.replace(/<(script|iframe|object|embed|form|base|meta|link)\b[^>]*\/?>/gi, '');
  // HTML comments (can hide payloads / conditional exploits)
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Event handlers: onclick="…" etc.
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Unsafe URL schemes in href/src/cite/action — allow http(s), mailto, tel, #.
  out = out.replace(/\s(href|src|cite|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, attr, quoted) => {
    const url = quoted.slice(1, -1).trim();
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return match;
    return ` ${attr}="#"`;
  });
  // CSS injection vectors in style attributes/blocks
  out = out.replace(/expression\s*\(/gi, '');
  out = out.replace(/javascript\s*:/gi, '');
  out = out.replace(/@import/gi, '');
  out = out.replace(/position\s*:\s*fixed/gi, '');
  return out;
}

/** Simple HTML → plain text (also used for bodyText + preview fallback). */
function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// analyze — validation support (§39-§41)
// ---------------------------------------------------------------------------
const ACCOUNT_VARIABLES = new Set(['accountSignature', 'sendingAccountName', 'sendingAccountEmail', 'sendingAccountFirstName']);
const PLATFORM_VARIABLES = new Set(['unsubscribeUrl', 'unsubscribe_url', 'personalization', ...ACCOUNT_VARIABLES]);

/**
 * Static analysis of a template (subject or body). Returns used variables,
 * malformed spintax/conditionals with human reasons, and — when `knownVars`
 * is provided — the list of undefined variables (§40).
 */
function analyze(template, knownVars) {
  const t = String(template || '');
  const usedVars = new Set();
  const malformedSpintax = [];
  const malformedConditionals = [];

  // Variables (excluding the spintax keyword itself). Extract from spintax
  // blocks too — nested variables are legal (§22).
  let m;
  VAR_TOKEN.lastIndex = 0;
  while ((m = VAR_TOKEN.exec(t)) !== null) {
    if (m[1] !== 'RANDOM') usedVars.add(m[1]);
  }

  // Malformed spintax: any {{RANDOM whose brace scan never closes.
  let idx = 0;
  while ((idx = t.indexOf(SPINTAX_OPEN, idx)) !== -1) {
    const close = findSpintaxClose(t, idx);
    if (!close) {
      malformedSpintax.push({ snippet: t.slice(idx, idx + 60), reason: 'Invalid Spintax — missing closing braces.' });
      break;
    }
    idx = close.end;
  }

  // Malformed conditionals: {% if without a matching {% endif %}.
  IF_TOKEN.lastIndex = 0;
  while ((m = IF_TOKEN.exec(t)) !== null) {
    if (t.indexOf('{% endif %}', m.index) === -1) {
      malformedConditionals.push({ snippet: t.slice(m.index, m.index + 60), reason: 'Invalid conditional — missing {% endif %}.' });
    }
  }

  let undefinedVars = [];
  if (knownVars) {
    undefinedVars = [...usedVars].filter((v) => !knownVars.has(v) && !PLATFORM_VARIABLES.has(v));
  }

  return { usedVars: [...usedVars], malformedSpintax, malformedConditionals, undefinedVars };
}

// ---------------------------------------------------------------------------
// Full pipeline (§43)
// ---------------------------------------------------------------------------

/**
 * Render one template string (subject or body) through the full pipeline.
 * opts: { vars, seed, sanitize } — sanitize defaults false for plain-text
 * subjects and true for HTML bodies (caller decides).
 */
function renderTemplate(template, vars = {}, opts = {}) {
  const rng = makeRng(opts.seed);
  const malformed = [];
  const unresolved = [];
  let text = resolveConditionals(String(template || ''), vars, malformed).text;
  text = resolveSpintax(text, rng, malformed).text;
  text = resolveVariables(text, vars, unresolved);
  if (opts.sanitize) text = sanitizeHtml(text);
  return { text, malformed, unresolved };
}

/**
 * Render a full email. vars must already include lead fields, custom fields
 * and account variables (the caller merges those — single source of truth).
 * Returns { subject, html, text, unresolved, malformed }.
 */
function renderEmail({ subject, bodyHtml, vars = {}, seed = 'default', prevSubject }) {
  let s = renderTemplate(subject == null ? '' : subject, vars);
  // §8 — follow-up with empty subject continues the previous thread.
  let subjectText = s.text.trim();
  if (!subjectText && prevSubject) subjectText = renderTemplate(prevSubject, vars).text;
  const body = renderTemplate(bodyHtml == null ? '' : bodyHtml, vars, { sanitize: true });
  return {
    subject: subjectText,
    html: body.text,
    text: htmlToPlainText(body.text),
    unresolved: [...new Set([...s.unresolved, ...body.unresolved])],
    malformed: [...s.malformed, ...body.malformed],
  };
}

module.exports = {
  makeRng,
  pickWeighted,
  resolveSpintax,
  resolveConditionals,
  resolveVariables,
  sanitizeHtml,
  htmlToPlainText,
  analyze,
  renderTemplate,
  renderEmail,
  PLATFORM_VARIABLES,
  ACCOUNT_VARIABLES,
};
