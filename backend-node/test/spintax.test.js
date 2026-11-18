// generateSpintax — HTML-preserving prompt contract; no network (fetch stubbed).
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite::memory:';
process.env.KIMI_API_KEY = 'test-key';

const ai = require('../services/ai');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('generateSpintax', () => {
  test('system prompt demands HTML/variable preservation and short phrases', async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<p>{{RANDOM | Hi | Hello}} {{first_name}}</p>' } }] }),
      };
    };
    const out = await ai.generateSpintax({ text: '<p>Hi {{first_name}}, thanks for your time.</p>' });
    assert.strictEqual(out, '<p>{{RANDOM | Hi | Hello}} {{first_name}}</p>');
    const system = calls[0].body.messages[0].content;
    assert.match(system, /Preserve every HTML tag/i);
    assert.match(system, /{{variable}}/);
    assert.match(system, /short phrases only|SHORT optional phrases/i);
    // Full body goes to the model, not a truncated plain-text version
    assert.match(calls[0].body.messages[1].content, /first_name/);
  });
});
