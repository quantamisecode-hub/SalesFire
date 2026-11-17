// Warm-up tests (Prompt 8) — ramp math, UTC day rollover, health scoring.
// SMTP sending is never exercised here (it needs a real account); the pure
// plan logic is what production correctness depends on.
const { test, describe } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-warmup-database.sqlite';

const { rampVolume, dayIndexSince, healthScore } = require('../services/warmup');

describe('warm-up ramp (Prompt 8)', () => {
  const plan = { startVolume: 2, rampStep: 3, targetVolume: 20 };

  test('day 0 starts at startVolume and ramps linearly to the target', () => {
    assert.strictEqual(rampVolume(plan, 0), 2);
    assert.strictEqual(rampVolume(plan, 1), 5);
    assert.strictEqual(rampVolume(plan, 2), 8);
    assert.strictEqual(rampVolume(plan, 3), 11);
  });

  test('ramp saturates at targetVolume and never exceeds it', () => {
    assert.strictEqual(rampVolume(plan, 7), 20);   // 2 + 7*3 = 23 → capped
    assert.strictEqual(rampVolume(plan, 100), 20);
  });

  test('degenerate plans fall back to a minimum viable ramp', () => {
    assert.strictEqual(rampVolume({ startVolume: 0, rampStep: 0, targetVolume: 0 }, 5), 0); // nothing sends
    assert.strictEqual(rampVolume({}, 0), 0);
  });

  test('startVolume above target is clamped sanely (no negative ramp)', () => {
    assert.strictEqual(rampVolume({ startVolume: 50, rampStep: 5, targetVolume: 10 }, 0), 10);
  });

  test('day index counts whole UTC days since the plan started', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    assert.strictEqual(dayIndexSince(yesterday), 1);
    const today = new Date().toISOString().slice(0, 10);
    assert.strictEqual(dayIndexSince(today), 0);
  });

  test('health score needs at least 10 real attempts before it is meaningful', () => {
    assert.strictEqual(healthScore({ totalSent: 0, totalFailed: 0 }), null);
    assert.strictEqual(healthScore({ totalSent: 5, totalFailed: 4 }), null); // 9 attempts — not enough
    assert.strictEqual(healthScore({ totalSent: 9, totalFailed: 1 }), 90);
    assert.strictEqual(healthScore({ totalSent: 10, totalFailed: 0 }), 100);
    assert.strictEqual(healthScore({ totalSent: 5, totalFailed: 15 }), 25);
  });
});
