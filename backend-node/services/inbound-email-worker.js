// Inbound email worker — polls every IMAP-enabled account on a fixed interval.
// Real connections only; no fake polling. Disabled with INBOX_SYNC_INTERVAL_MS=0.
// Mirrors the campaign/warmup workers: unref'd interval, per-account isolation,
// consecutive failure tracking on mailbox_sync_states.
const models = require('../models');
const { syncAllAccounts } = require('./inbound-email-sync');

let handle = null;

async function tick() {
  try {
    const orgs = await models.Organization.findAll({ attributes: ['id'] });
    for (const org of orgs) {
      try {
        await syncAllAccounts(org.id);
      } catch (err) {
        console.error(`[inbox-sync] org ${org.id} failed:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('[inbox-sync] tick failed:', err?.message || err);
  }
}

function startInboundSyncWorker(intervalMs = Number(process.env.INBOX_SYNC_INTERVAL_MS || 30000)) {
  if (handle) return handle;
  if (!intervalMs || intervalMs <= 0) return null;
  handle = setInterval(tick, intervalMs);
  handle.unref?.();
  console.log(`📥 Inbound sync worker started (every ${intervalMs}ms)`);
  return handle;
}

module.exports = { startInboundSyncWorker, tick };
