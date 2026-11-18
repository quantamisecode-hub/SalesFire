// AI Personalization Service - Prompt 6 §14-16.
// Kimi/Moonshot is OpenAI-compatible; the API key never leaves the backend.
// The model may ONLY use the verified recipient data passed in context.
// If KIMI_API_KEY is absent the service reports it honestly — never fabricates.

const ALLOWED_CONTEXT_FIELDS = [
  'firstName', 'lastName', 'companyName', 'jobTitle', 'email',
];

function buildPrompt(template, vars, depth) {
  const verified = Object.entries(vars)
    .filter(([k]) => ALLOWED_CONTEXT_FIELDS.includes(k))
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (no verified data available)';

  const depthInstructions = {
    light: 'Change as little as possible: at most adjust the greeting.',
    standard: 'Personalize the opening line and keep the rest of the body intact.',
    deep: 'Rewrite the opening paragraph using only the verified data; keep the rest intact and preserve the call to action.',
  }[depth] || 'Personalize the opening line and keep the rest of the body intact.';

  return [
    'You personalize a B2B outreach email.',
    '',
    'STRICT RULES:',
    '- Use ONLY the verified data below. Do not invent or assume company facts, funding, customers, technologies, achievements, or personal details.',
    '- If verified data is insufficient, keep the template as close to original as possible.',
    '- Do not add facts about the sender company.',
    '- Output ONLY the personalized email body, no commentary, no quotes.',
    '',
    `VERIFIED DATA:\n${verified}`,
    '',
    depthInstructions,
    '',
    `ORIGINAL EMAIL:\n${template}`,
  ].join('\n');
}

async function personalizeText({ template, vars, depth, campaignAiProvider }) {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI provider not configured. Set KIMI_API_KEY on the backend to enable AI personalization.');
    err.statusCode = 501;
    throw err;
  }

  const baseUrl = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
  const model = process.env.KIMI_MODEL || 'moonshot-v1-8k';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: buildPrompt(template, vars, depth) },
        ],
        temperature: 0.4,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = new Error('AI provider rejected the request.');
      err.statusCode = 502;
      throw err;
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning;
    if (!text) {
      const err = new Error('AI provider returned an empty response.');
      err.statusCode = 502;
      throw err;
    }
    return text.trim();
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('AI provider timed out.');
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { personalizeText, buildPrompt };

// ---------------------------------------------------------------------------
// Sequence Builder AI tools (§25-§28). Same honest contract as above: without
// KIMI_API_KEY every AI endpoint reports 501 — nothing is ever labeled
// "AI Generated" unless the model really ran. AI OUTPUT IS UNTRUSTED INPUT:
// callers must run it through the same sanitization/validation as user input,
// and the UI only ever applies it behind an explicit "Accept" action.
// ---------------------------------------------------------------------------

/** Generic Kimi chat call with the shared timeout/error contract. */
async function callKimi({ system, user, temperature = 0.5, maxTokens = 1200 }) {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI provider not configured. Set KIMI_API_KEY on the backend to enable AI generation.');
    err.statusCode = 501;
    throw err;
  }
  const baseUrl = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
  const model = process.env.KIMI_MODEL || 'moonshot-v1-8k';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = new Error('AI provider rejected the request.');
      err.statusCode = 502;
      throw err;
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning;
    if (!text) {
      const err = new Error('AI provider returned an empty response.');
      err.statusCode = 502;
      throw err;
    }
    return text.trim();
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('AI provider timed out.');
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Extract the first JSON object/array from a model response (strips code fences). */
function parseJsonLoose(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start !== -1 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  const err = new Error('AI response was not valid JSON.');
  err.statusCode = 502;
  throw err;
}

const SEQUENCE_STEPS_SCHEMA_NOTE = [
  'Return ONLY a JSON array. Each element is one email step:',
  '{ "subject": string (may be "" for follow-ups), "bodyHtml": string (simple HTML: <p>, <br>, <strong>, <em>, <a>, <ul>/<li>), "delayAmount": positive integer, "delayUnit": "minutes"|"hours"|"days" }.',
  'Step 1 must have a subject. Follow-up steps SHOULD have an empty subject (thread continuation).',
  'Bodies must be 60-140 words, plain professional language, one clear call to action.',
  'Do not include unsubscribe footers, legal text, or image tags.',
].join('\n');

// AI sequence writer (§25-26). The prompt may mention an industry/goal/tone;
// the model may only reference the variables whitelisted by the org.
async function generateSequence({ prompt, industry, tone, stepsCount, knownVariables }) {
  const known = [...(knownVariables || [])].slice(0, 80).sort();
  const whitelist = known.map((v) => `  • {{${v}}}`).join('\n');
  const system = [
    'You write cold-outreach email sequences for a B2B sales tool.',
    'CRITICAL — VARIABLE WHITELIST (memorize exactly; no other token is valid):',
    whitelist || '  (no variables available)',
    'STRICT RULES:',
    '- Use ONLY variables from that whitelist. Never invent a variable, never guess a name — not even a plausible one like sendingAccountLastName.',
    `- If a needed personal detail is not in the whitelist or the verified data, write plain text instead of {{...}}.`,
    '- Never invent facts about the recipient or the sender.',
    '- Never include scripts, event handlers, javascript: URLs, iframes or forms.',
    SEQUENCE_STEPS_SCHEMA_NOTE,
  ].join('\n');
  const user = [
    `Write a sequence of ${Math.min(Math.max(parseInt(stepsCount, 10) || 3, 1), 7)} emails.`,
    industry ? `Industry: ${industry}.` : '',
    tone ? `Tone: ${tone}.` : 'Tone: professional, concise.',
    `Goal: ${prompt || 'book an introductory call'}.`,
  ].filter(Boolean).join('\n');

  const raw = await callKimi({ system, user, temperature: 0.6, maxTokens: 2200 });
  const parsed = parseJsonLoose(raw);
  if (!Array.isArray(parsed)) {
    const err = new Error('AI sequence response was not a list of steps.');
    err.statusCode = 502;
    throw err;
  }
  // Post-generation whitelist enforcement: any {{token}} the model invented
  // gets named in the error, instead of poisoning the saved sequence.
  const knownSet = new Set(known);
  const VAR_TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*\|[^}]*)?\s*\}\}/g;
  const checkText = (text, field) => {
    const out = [];
    for (const m of String(text || '').matchAll(VAR_TOKEN)) {
      const name = m[1];
      if (!knownSet.has(name)) out.push(`${name} (in ${field})`);
    }
    return out;
  };
  const violations = [
    ...parsed.flatMap((s, i) => [
      ...checkText(s?.subject, `subject of email ${i + 1}`),
      ...checkText(s?.bodyHtml || s?.body, `body of email ${i + 1}`),
    ]),
  ];
  if (violations.length) {
    const err = new Error(`AI invented these invalid variables — try again: ${[...new Set(violations)].join(', ')}`);
    err.statusCode = 502;
    throw err;
  }
  // Shape + safety-check every step server-side before it reaches the client.
  return parsed.slice(0, 7).map((s, i) => ({
    subject: String(s.subject || '').slice(0, 500),
    bodyHtml: String(s.bodyHtml || s.body || '').slice(0, 20000),
    delayAmount: Math.max(1, parseInt(s.delayAmount, 10) || 2),
    delayUnit: ['minutes', 'hours', 'days'].includes(s.delayUnit) ? s.delayUnit : 'days',
    stepNumber: i + 1,
  }));
}

// AI single-step writer (§25-26, step-level regeneration). Rewrites ONE email
// in an existing sequence — the neighboring steps are provided as read-only
// context so the voice stays coherent, but the model is told in no uncertain
// terms that only this one step may change. The client keeps identity/delay.
async function regenerateStep({ prompt, industry, tone, current, previous, next, position, totalSteps, knownVariables }) {
  const known = [...(knownVariables || [])].slice(0, 80).sort();
  const whitelist = known.map((v) => `  • {{${v}}}`).join('\n');
  const where = position === 1 ? 'this is the FIRST (initial) email' : `this is follow-up number ${position} of ${totalSteps}`;
  const system = [
    'You rewrite a single email inside an existing B2B cold-outreach sequence.',
    'CRITICAL — VARIABLE WHITELIST (memorize exactly; no other token is valid):',
    whitelist || '  (no variables available)',
    'STRICT RULES:',
    '- Rewrite ONLY the email marked "CURRENT". The previous and next emails stay EXACTLY as written — they are context, not inputs to edit.',
    '- Return ONLY a JSON object: { "subject": string, "bodyHtml": string }.',
    '- If this is a follow-up, keep subject as "" (empty) unless the instruction asks to change it — an empty subject continues the thread.',
    '- Use ONLY variables from that whitelist. Never invent a variable, not even a plausible one like sendingAccountLastName.',
    '- If a needed personal detail is not in the whitelist, write plain text instead of {{...}}.',
    '- Never invent facts about the recipient or the sender.',
    '- Never include scripts, event handlers, javascript: URLs, iframes or forms or unsubscribe footers or image tags.',
    '- Bodies: 60-140 words, plain professional language, one clear call to action. Simple HTML: <p>, <br>, <strong>, <em>, <a>, <ul>/<li>.',
    `- ${where}.`,
    position === 1
      ? '- This is the FIRST email: "subject" is REQUIRED and must be a short, specific subject line — an empty subject is only valid for thread-continuing follow-ups.'
      : '- "subject" may be "" (empty) only to continue the existing thread; keep it empty unless the instruction asks to change it.',
  ].join('\n');
  const context = [];
  if (previous) {
    context.push('PREVIOUS (do not touch):', `subject: ${previous.subject || '(no subject — thread continuation)'}`, `body: ${String(previous.bodyHtml || '').slice(0, 2000)}`);
  }
  context.push('CURRENT (rewrite me):', `subject: ${current.subject || '(no subject — thread continuation)'}`, `body: ${String(current.bodyHtml || '').slice(0, 3000)}`);
  if (next) {
    context.push('NEXT (do not touch):', `subject: ${next.subject || '(no subject — thread continuation)'}`, `body: ${String(next.bodyHtml || '').slice(0, 2000)}`);
  }
  const user = [
    `Rewrite ONLY the CURRENT email as instructed below. Position: ${position} of ${totalSteps}.`,
    industry ? `Industry: ${industry}.` : '',
    tone ? `Tone: ${tone}.` : 'Tone: professional, concise.',
    `Instruction: ${prompt || 'Improve this email while keeping its intent — tighten the copy and keep the same ask.'}`,
    '',
    ...context,
  ].filter(Boolean).join('\n');

  const raw = await callKimi({ system, user, temperature: 0.6, maxTokens: 1400 });
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('AI step response was not a single email object.');
    err.statusCode = 502;
    throw err;
  }
  // Whitelist enforcement: any {{token}} the model invented gets named.
  const knownSet = new Set(known);
  const VAR_TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*\|[^}]*)?\s*\}\}/g;
  const violations = [];
  const checkText = (text, field) => {
    for (const m of String(text || '').matchAll(VAR_TOKEN)) {
      if (!knownSet.has(m[1])) violations.push(`${m[1]} (in ${field})`);
    }
  };
  checkText(parsed?.subject, 'subject');
  checkText(parsed?.bodyHtml || parsed?.body, 'body');
  if (violations.length) {
    const err = new Error(`AI invented these invalid variables — try again: ${[...new Set(violations)].join(', ')}`);
    err.statusCode = 502;
    throw err;
  }
  // Enforcement for step 1: an empty subject for the first email destroys a
  // required field (the send pipeline refuses thread-continuation for the
  // initial email). Keep the previous subject rather than blanking it — the
  // same honest-fallback the sequence validator demands.
  let subjectPreserved = false;
  let subject = String(parsed.subject || '').slice(0, 500);
  if (position === 1 && !subject.trim() && String(current?.subject || '').trim()) {
    subject = String(current.subject).slice(0, 500);
    subjectPreserved = true;
  }
  return {
    subject,
    bodyHtml: String(parsed.bodyHtml || parsed.body || '').slice(0, 20000),
    subjectPreserved,
  };
}

// AI spintax writer (§27): wraps phrases in {{RANDOM | a | b | c}}.
async function generateSpintax({ text }) {
  const system = [
    'You rewrite sentences adding spintax variations.',
    'Spintax syntax: {{RANDOM | option one | option two | option three}}.',
    'Keep the original meaning. Vary greetings, sentence openings and phrasing.',
    'Keep any {{variable}} tokens exactly as they are — never modify variable names.',
    'Produce 2-4 options per spin block and at most 6 spin blocks total.',
    'Return ONLY the rewritten text, no commentary, no code fences.',
  ].join('\n');
  return callKimi({ system, user: String(text || '').slice(0, 6000), temperature: 0.7, maxTokens: 1500 });
}

module.exports.generateSequence = generateSequence;
module.exports.generateSpintax = generateSpintax;
module.exports.regenerateStep = regenerateStep;
module.exports.callKimi = callKimi;
