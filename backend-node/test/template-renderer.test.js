// TemplateRenderer unit tests — variables + fallbacks, spintax (nested,
// deterministic, malformed), sandboxed conditionals, sanitization, analyze.
// Run: node --test test/template-renderer.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert');
const renderer = require('../services/template-renderer');

const VARS = {
  first_name: 'Ada', firstName: 'Ada',
  last_name: 'Lovelace', lastName: 'Lovelace',
  company_name: 'Analytical Engines', companyName: 'Analytical Engines',
  email: 'ada@calc.io',
  industry: 'SaaS',
  empty_field: '',
};

describe('variables (§12, §15, §17)', () => {
  test('substitutes known variables', () => {
    const { text } = renderer.renderTemplate('Hi {{firstName}} at {{company_name}}!', VARS);
    assert.strictEqual(text, 'Hi Ada at Analytical Engines!');
  });

  test('known but empty variable renders empty (matches engine contract)', () => {
    const { text } = renderer.renderTemplate('x{{empty_field}}y', VARS);
    assert.strictEqual(text, 'xy');
  });

  test('fallback applies when the value is missing or empty (§17)', () => {
    const { text } = renderer.renderTemplate('{{last_name | there}} / {{nope | fallback}}', VARS);
    assert.strictEqual(text, 'Lovelace / fallback');
  });

  test('unknown variable without fallback stays literal and is reported (§40)', () => {
    const { text, unresolved } = renderer.renderTemplate('Hi {{adminVar}}', VARS);
    assert.strictEqual(text, 'Hi {{adminVar}}');
    assert.deepStrictEqual(unresolved, ['adminVar']);
  });

  test('unknown variable WITH fallback uses the fallback silently', () => {
    const { text, unresolved } = renderer.renderTemplate('{{secret | safe}}', VARS);
    assert.strictEqual(text, 'safe');
    assert.strictEqual(unresolved.length, 0);
  });
});

describe('spintax (§19-§22)', () => {
  const spin = '{{RANDOM | Hi | Hello | Hey}} {{firstName}}';

  test('resolves to exactly one of the options', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { text } = renderer.renderTemplate(spin, VARS, { seed });
      assert.match(text, /^(Hi|Hello|Hey) Ada$/);
    }
  });

  test('is deterministic for the same seed (§21)', () => {
    const a = renderer.renderTemplate(spin, VARS, { seed: 'seed-1' }).text;
    const b = renderer.renderTemplate(spin, VARS, { seed: 'seed-1' }).text;
    assert.strictEqual(a, b);
  });

  test('varies across seeds', () => {
    const picks = new Set(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((s) => renderer.renderTemplate(spin, VARS, { seed: s }).text));
    assert.ok(picks.size > 1, 'expected more than one outcome across seeds');
  });

  test('supports variables inside options (§22)', () => {
    const { text } = renderer.renderTemplate('{{RANDOM | Hi {{firstName}} | Yo {{firstName}} }}', VARS, { seed: 'v' });
    assert.match(text, /^(Hi|Yo) Ada$/);
  });

  test('supports nested spintax', () => {
    const { text } = renderer.renderTemplate('{{RANDOM | {{RANDOM | A1 | A2}} | B }}', VARS, { seed: 'n' });
    assert.match(text, /^(A1|A2|B)$/);
  });

  test('malformed spintax is left literal and reported exactly once (§41)', () => {
    const { text, malformed } = renderer.renderTemplate('start {{RANDOM | Hi | Hello', VARS);
    assert.ok(text.includes('{{RANDOM | Hi | Hello'));
    assert.strictEqual(malformed.length, 1);
    assert.match(malformed[0].reason, /missing closing/);
  });

  test('single-option spintax is malformed', () => {
    const { malformed } = renderer.renderTemplate('{{RANDOM | only}}', VARS);
    assert.strictEqual(malformed.length, 1);
  });
});

describe('conditionals (§24, sandboxed)', () => {
  test('renders the truthy branch on equality', () => {
    const { text } = renderer.renderTemplate('{% if industry == "SaaS" %}SaaS{% else %}other{% endif %}', VARS);
    assert.strictEqual(text, 'SaaS');
  });

  test('renders the else branch on inequality', () => {
    const { text } = renderer.renderTemplate('{% if industry == "Retail" %}retail{% else %}other{% endif %}', VARS);
    assert.strictEqual(text, 'other');
  });

  test('supports != and and/or chains', () => {
    const { text } = renderer.renderTemplate('{% if industry != "Retail" and first_name == "Ada" %}yes{% endif %}', VARS);
    assert.strictEqual(text, 'yes');
  });

  test('unknown variables compare as empty — nothing executes', () => {
    const { text } = renderer.renderTemplate('{% if unknownVar == "" %}empty{% else %}nope{% endif %}', VARS);
    assert.strictEqual(text, 'empty');
  });

  test('injection attempts are inert (no eval, no expression evaluation)', () => {
    const evil = '{% if industry == "SaaS") ; process.exit(1); ("x" == "x" %}pwned{% else %}safe{% endif %}';
    const { text } = renderer.renderTemplate(evil, VARS);
    assert.ok(!text.includes('pwned'));
  });

  test('unclosed conditional is malformed (§41)', () => {
    const { malformed } = renderer.renderTemplate('{% if industry == "SaaS" %}no close', VARS);
    assert.strictEqual(malformed.length, 1);
    assert.match(malformed[0].reason, /endif/);
  });
});

describe('sanitization (§32, §45)', () => {
  test('strips scripts, handlers, unsafe URLs; keeps normal content', () => {
    const dirty = '<p onclick="evil()">Hi<script>steal()</script><a href="javascript:bad()">c</a><a href="https://ok.com">ok</a><img src="https://img.svg"></p>';
    const clean = renderer.sanitizeHtml(dirty);
    assert.ok(!clean.includes('script'));
    assert.ok(!clean.includes('onclick'));
    assert.ok(!clean.includes('javascript:'));
    assert.ok(clean.includes('https://ok.com'));
    assert.ok(clean.includes('https://img.svg'));
    assert.ok(clean.includes('Hi'));
  });

  test('renderTemplate sanitizes when asked', () => {
    const { text } = renderer.renderTemplate('<p onclick="x()">hi</p>', VARS, { sanitize: true });
    assert.ok(!text.includes('onclick'));
  });
});

describe('renderEmail (§8, §43)', () => {
  test('renders subject + html + text and merges unresolved', () => {
    const email = renderer.renderEmail({
      subject: 'Hi {{firstName}}',
      bodyHtml: '<p>Body for {{companyName}} with {{missingVar}}</p>',
      vars: VARS,
      seed: 'x',
    });
    assert.strictEqual(email.subject, 'Hi Ada');
    assert.ok(email.html.includes('Analytical Engines'));
    assert.ok(email.text.includes('Body for'));
    assert.ok(email.unresolved.includes('missingVar'));
  });

  test('empty follow-up subject continues the previous subject (§8)', () => {
    const email = renderer.renderEmail({
      subject: '',
      bodyHtml: '<p>bump</p>',
      vars: VARS,
      seed: 'x',
      prevSubject: 'Original thread',
    });
    assert.strictEqual(email.subject, 'Original thread');
  });
});

describe('analyze (§39-§41)', () => {
  test('collects used vars, undefined vars and malformed blocks', () => {
    const a = renderer.analyze(
      'Hi {{firstName}} {{custom_thing}} {{RANDOM | a | b}} {% if x == "y" %}ok{% endif %} {{RANDOM | broken',
      new Set(['firstName', 'custom_thing']),
    );
    assert.ok(a.usedVars.includes('firstName'));
    assert.ok(a.usedVars.includes('custom_thing'));
    assert.strictEqual(a.malformedSpintax.length, 1);
    assert.strictEqual(a.malformedConditionals.length, 0);
  });

  test('platform variables are never flagged as undefined', () => {
    const a = renderer.analyze('Unsub: {{unsubscribeUrl}} sig: {{accountSignature}}', new Set(['firstName']));
    assert.strictEqual(a.undefinedVars.length, 0);
  });

  test('nested braces inside spintax do not confuse the close-scan', () => {
    const a = renderer.analyze('{{RANDOM | Hi {{firstName}} | Yo }} fine', null);
    assert.strictEqual(a.malformedSpintax.length, 0);
  });
});

describe('weighted variant pick (§10)', () => {
  test('weight-0 variants are never picked', () => {
    const variants = [{ weight: 100, id: 'a' }, { weight: 0, id: 'b' }];
    for (const seed of ['1', '2', '3', '4', '5']) {
      assert.strictEqual(renderer.pickWeighted(variants, renderer.makeRng(seed)).id, 'a');
    }
  });

  test('respects relative weights across many picks', () => {
    const variants = [{ weight: 80, id: 'a' }, { weight: 20, id: 'b' }];
    let a = 0;
    for (let i = 0; i < 1000; i++) {
      if (renderer.pickWeighted(variants, renderer.makeRng(`seed-${i}`)).id === 'a') a++;
    }
    assert.ok(a > 700 && a < 900, `expected ~80% for a, got ${a / 10}%`);
  });
});
