// Audit helper — PROMPT 9.1 §68. Fire-and-forget; never throws into the
// request path, never receives secrets.
const models = require('../models');

const FORBIDDEN_KEYS = /pass(word)?|secret|token|api[-_]?key|credential/i;

/** Strip forbidden-looking keys from details (defense in depth). */
function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (FORBIDDEN_KEYS.test(k)) continue;
    out[k] = v;
  }
  return out;
}

async function audit(organizationId, actorId, action, entityType, entityId, details) {
  try {
    await models.AuditLog.create({
      organizationId,
      actorId: actorId || null,
      action,
      entityType: entityType || null,
      entityId: entityId ? String(entityId) : null,
      details: sanitizeDetails(details),
    });
  } catch (err) {
    console.error('Audit log write failed:', err?.message || err);
  }
}

module.exports = { audit };
