// SendingAccountAllocator — PROMPT 9.1 §25/§53/§54/§55.
//
// Responsibilities:
//   1. Load the campaign's sending-account pool (org-scoped, enabled rows).
//   2. Filter by account status / health / schedule (account timezone aware).
//   3. Filter by remaining daily + hourly quota (atomic DB reservation).
//   4. Apply the campaign's distribution strategy
//      (round_robin | weighted | availability_based).
//   5. Reserve capacity atomically (sending_account_usage, conditional UPDATE).
//
// Quota reservation is DATABASE-LEVEL atomic: the increment happens with
//   UPDATE sending_account_usage SET used = used + 1
//   WHERE smtp_account_id = :id AND period_type = :type AND period_key = :key
//     AND used < :limit
// Exactly one concurrent worker wins per unit of capacity. No counters in
// application memory, no read-then-write races.
const { sequelize } = require('../db');
const models = require('../models');
const { Op } = require('sequelize');

// ---------------------------------------------------------------------------
// Period keys (UTC) — quota periods are global regardless of account timezone,
// matching how users reason about "per day" caps from a single worker pool.
// ---------------------------------------------------------------------------
function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function utcHourKey(d = new Date()) {
  return d.toISOString().slice(0, 13);
}

// ---------------------------------------------------------------------------
// Timezone helpers — account schedules are IANA-timezone aware; we never
// store fixed offsets (DST-safe via Intl).
// ---------------------------------------------------------------------------
const tzFormatters = new Map();
function tzFormatter(tz) {
  let fmt = tzFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    tzFormatters.set(tz, fmt);
  }
  return fmt;
}

const WEEKDAY_TO_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// ---------------------------------------------------------------------------
// SQLite dev/test cannot execute concurrent write transactions on the same
// file (SQLITE_BUSY) — unlike MySQL, where the conditional UPDATE takes row
// locks and serializes capacity atomically. When running on SQLite, serialize
// reservations through a process-local promise chain. The underlying
// database-level conditional UPDATE is identical either way, so the MySQL
// path is unchanged and still fully atomic across workers.
// ---------------------------------------------------------------------------
let writeChain = Promise.resolve();
const isSqlite = () => sequelize.getDialect() === 'sqlite';
function withWriteLock(fn) {
  if (!isSqlite()) return fn();
  const next = writeChain.then(fn, fn);
  // Keep the chain alive regardless of individual failures.
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

/** { isoDay: 1..7, hhmm: "HH:MM" } in the given IANA timezone. */
function tzParts(tz, when = new Date()) {
  let parts;
  try {
    parts = tzFormatter(tz).formatToParts(when);
  } catch {
    parts = tzFormatter('UTC').formatToParts(when); // invalid tz → UTC, never crash
  }
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return { isoDay: WEEKDAY_TO_ISO[get('weekday')] || 1, hhmm: `${hour}:${get('minute')}` };
}

/** Is `when` inside the account's per-day sending window? NULL schedule → allowed. */
function accountInSchedule(account, when = new Date()) {
  const schedule = account && account.sendingSchedule;
  if (!schedule || typeof schedule !== 'object') return true;
  const { isoDay, hhmm } = tzParts(account.timezone || 'UTC', when);
  const day = schedule[String(isoDay)];
  if (!day || day.enabled === false) return false;
  const start = String(day.start || '00:00');
  const end = String(day.end || '23:59');
  return hhmm >= start && hhmm < end;
}

/** Is `when` inside the campaign's sending window? (account-agnostic) */
function campaignInSchedule(campaign, when = new Date()) {
  const days = Array.isArray(campaign.sendDaysOfWeek) && campaign.sendDaysOfWeek.length
    ? campaign.sendDaysOfWeek.map(Number)
    : [1, 2, 3, 4, 5];
  const { isoDay, hhmm } = tzParts(campaign.timezone || 'UTC', when);
  if (!days.includes(isoDay)) return false;
  const start = String(campaign.sendBetweenStartHour ?? 9).padStart(2, '0') + ':00';
  const end = String(campaign.sendBetweenEndHour ?? 17).padStart(2, '0') + ':00';
  return hhmm >= start && hhmm < end;
}

// ---------------------------------------------------------------------------
// Effective limits — global account limits are ALWAYS authoritative; a campaign
// cap can only tighten, never loosen (§37/38/39).
// ---------------------------------------------------------------------------
function effectiveDayLimit(account, campaign) {
  const accountCap = account.dailyLimit ?? Infinity;
  const campaignCap = campaign.maxEmailsPerDay ?? Infinity;
  return Math.min(accountCap, campaignCap);
}
function effectiveHourLimit(account, campaign) {
  const accountCap = account.hourlyLimit ?? Infinity;
  const campaignCap = campaign.hourlyLimit ?? Infinity;
  return Math.min(accountCap, campaignCap);
}

// ---------------------------------------------------------------------------
// Usage peek / atomic reservation
// ---------------------------------------------------------------------------
async function peekUsage(accountId, now = new Date()) {
  const rows = await models.SendingAccountUsage.findAll({
    where: {
      smtpAccountId: accountId,
      [Op.or]: [
        { periodType: 'day', periodKey: utcDayKey(now) },
        { periodType: 'hour', periodKey: utcHourKey(now) },
      ],
    },
  });
  const byType = { day: 0, hour: 0 };
  for (const r of rows) byType[r.periodType] = r.used;
  return { dayUsed: byType.day, hourUsed: byType.hour };
}

async function ensureUsageRow(accountId, periodType, periodKey, transaction) {
  const dialect = sequelize.getDialect();
  const now = new Date();
  const id = require('crypto').randomUUID();
  if (dialect === 'mysql') {
    await sequelize.query(
      `INSERT IGNORE INTO sending_account_usage (id, smtp_account_id, period_type, period_key, used, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      { replacements: [id, accountId, periodType, periodKey, now, now], transaction }
    );
  } else {
    await sequelize.query(
      `INSERT OR IGNORE INTO sending_account_usage (id, smtp_account_id, period_type, period_key, used, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      { replacements: [id, accountId, periodType, periodKey, now, now], transaction }
    );
  }
}

/**
 * Atomically reserve one unit of day+hour capacity. Returns { ok, reason }.
 * When no transaction is supplied one is created internally, so a failed
 * hour-reservation rolls back the day increment (no quota leaks).
 */
async function reserveUsage(accountId, dayLimit, hourLimit, now = new Date(), transaction) {
  const run = async (t) => {
    await ensureUsageRow(accountId, 'day', utcDayKey(now), t);
    await ensureUsageRow(accountId, 'hour', utcHourKey(now), t);

    const inc = async (periodType, periodKey, limit) => {
      const [, affected] = await sequelize.query(
        `UPDATE sending_account_usage
            SET used = used + 1, updated_at = ?
          WHERE smtp_account_id = ? AND period_type = ? AND period_key = ? AND used < ?`,
        {
          replacements: [new Date(), accountId, periodType, periodKey, limit],
          type: sequelize.QueryTypes.UPDATE,
          transaction: t,
        }
      );
      return Number(affected) || 0;
    };

    const dayLimitCap = dayLimit === Infinity ? 2147483647 : dayLimit;
    const hourLimitCap = hourLimit === Infinity ? 2147483647 : hourLimit;

    const dayAffected = await inc('day', utcDayKey(now), dayLimitCap);
    if (dayAffected < 1) return { ok: false, reason: `daily limit reached (${dayLimit})` };
    const hourAffected = await inc('hour', utcHourKey(now), hourLimitCap);
    if (hourAffected < 1) {
      const err = new Error('hour_limit');
      err.result = { ok: false, reason: `hourly limit reached (${hourLimit})` };
      throw err;
    }
    return { ok: true };
  };

  if (transaction) {
    try {
      return await run(transaction);
    } catch (err) {
      if (err && err.result) return err.result;
      throw err;
    }
  }
  return withWriteLock(async () => {
    const t = await sequelize.transaction();
    try {
      const result = await run(t);
      if (!result.ok) {
        await t.rollback(); // no partial consumption on failure
      } else {
        await t.commit();
      }
      return result;
    } catch (err) {
      await t.rollback().catch(() => {});
      if (err && err.result) return err.result;
      throw err;
    }
  });
}

/** Give back one unit of reserved capacity (e.g. after an SMTP failure). */
async function releaseUsage(accountId, now = new Date()) {
  const run = () => sequelize.query(
    `UPDATE sending_account_usage
        SET used = CASE WHEN used > 0 THEN used - 1 ELSE 0 END, updated_at = ?
      WHERE smtp_account_id = ? AND (
        (period_type = 'day' AND period_key = ?) OR (period_type = 'hour' AND period_key = ?))`,
    { replacements: [new Date(), accountId, utcDayKey(now), utcHourKey(now)] }
  );
  return withWriteLock(run);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
const BLOCKED_HEALTH = new Set(['critical']);
// 'disabled' is the hard stop; 'error' means the last SMTP health check failed
// (bad credentials/TLS) and retries won't fix it — block sending until retested.
const BLOCKED_STATUS = new Set(['disabled', 'error']);

/**
 * Pool rows for a campaign, joined with their org accounts.
 * Belongs-to check is applied twice (pool row AND account org) — defense in
 * depth against cross-tenant assignment (IDOR).
 */
async function getPoolWithAccounts(campaign, { transaction } = {}) {
  const pool = await models.CampaignSendingAccount.findAll({
    where: { campaignId: campaign.id, organizationId: campaign.organizationId, enabled: true },
    include: [{ model: models.SmtpAccount, as: 'account' }],
    transaction,
  });
  return pool.filter(
    (row) => row.account && row.account.organizationId === campaign.organizationId
  );
}

/** Health/status/schedule eligibility (no quota side effects). */
function isAccountEligible(account, when = new Date()) {
  if (!account || !account.isEnabled) return { eligible: false, reason: 'account disabled' };
  if (BLOCKED_STATUS.has(String(account.status || '').toLowerCase())) {
    return { eligible: false, reason: 'account failed last SMTP test' };
  }
  // Instantly-style "Minimum wait time": never send from the same account twice
  // within the configured gap — holds across every campaign it's pooled into.
  const minWait = account.minimumWaitMinutes ?? 0;
  if (minWait > 0 && account.lastSentAt) {
    const elapsedMs = new Date(when).getTime() - new Date(account.lastSentAt).getTime();
    if (elapsedMs < minWait * 60 * 1000) {
      return { eligible: false, reason: `minimum wait time (${minWait} min) not elapsed` };
    }
  }
  if (BLOCKED_HEALTH.has(String(account.healthStatus || 'unknown').toLowerCase())) {
    return { eligible: false, reason: 'account health critical' };
  }
  if (!accountInSchedule(account, when)) {
    return { eligible: false, reason: 'outside account schedule' };
  }
  return { eligible: true };
}

/**
 * Rank eligible accounts by the campaign's distribution strategy.
 * Deterministic — never naive random (§55). `dayUsedById` maps id → today's usage.
 */
function rankAccounts(strategy, candidates, dayUsedById) {
  const byWeight = [...candidates].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  if (strategy === 'weighted') {
    // Minimize (reserved + 1) / weight — converges to configured weights while
    // respecting whichever account still has quota (§55/56).
    return [...candidates].sort((a, b) => {
      const sa = ((dayUsedById.get(a.id) || 0) + 1) / Math.max(1, a.weight);
      const sb = ((dayUsedById.get(b.id) || 0) + 1) / Math.max(1, b.weight);
      if (sa === sb) return (b.weight || 0) - (a.weight || 0);
      return sa - sb;
    });
  }
  if (strategy === 'availability_based') {
    // Most remaining quota first.
    return [...candidates].sort((a, b) => {
      const ra = remainingRatio(a, dayUsedById) - remainingRatio(b, dayUsedById);
      return -ra || (b.weight || 0) - (a.weight || 0);
    });
  }
  // round_robin — fewest sends today first, then least recently sent.
  return [...candidates].sort((a, b) => {
    const ua = dayUsedById.get(a.id) || 0;
    const ub = dayUsedById.get(b.id) || 0;
    if (ua !== ub) return ua - ub;
    const ta = a.lastSentAt ? new Date(a.lastSentAt).getTime() : 0;
    const tb = b.lastSentAt ? new Date(b.lastSentAt).getTime() : 0;
    return ta - tb;
  });
}

function remainingRatio(entry, dayUsedById) {
  const limit = entry.dayLimit === Infinity ? 1e9 : Math.max(1, entry.dayLimit);
  const used = dayUsedById.get(entry.accountId) || 0;
  return Math.max(0, 1 - used / limit);
}

/**
 * Select one account for a recipient and atomically reserve day+hour capacity.
 *
 * @param {object} campaign       Campaign model instance (org-scoped already)
 * @param {object} recipient      CampaignLead instance (may carry sendingAccountId)
 * @param {Date}   now
 * @param {object} [transaction]  optional sequelize transaction
 * @returns {{ ok: boolean, account?: object, method?: string, reason?: string }}
 */
async function allocateAndReserve(campaign, recipient, now = new Date(), transaction) {
  const strategy = campaign.accountDistribution || 'round_robin';
  const stickiness = campaign.accountStickiness || 'rotate';
  const fallback = campaign.fallbackPolicy || 'reassign';

  let pool = await getPoolWithAccounts(campaign, { transaction });
  // Backwards compatibility: legacy single-account campaigns (pre-9.1) get a
  // synthetic pool of one so they keep working until an explicit pool is set.
  if (pool.length === 0 && campaign.sendingAccountId) {
    const legacy = await models.SmtpAccount.findOne({
      where: { id: campaign.sendingAccountId, organizationId: campaign.organizationId },
      transaction,
    });
    if (legacy) {
      pool = [{ account: legacy, weight: 100, enabled: true, id: 'legacy', smtpAccountId: legacy.id }];
    }
  }
  if (pool.length === 0) return { ok: false, reason: 'campaign has no sending accounts' };

  // Enrich with effective limits + today's usage (one batched query).
  const enriched = [];
  for (const row of pool) {
    const account = row.account;
    const dayLimit = effectiveDayLimit(account, campaign);
    const hourLimit = effectiveHourLimit(account, campaign);
    const { dayUsed, hourUsed } = await peekUsage(account.id, now);
    enriched.push({ row, account, accountId: account.id, weight: row.weight, dayLimit, hourLimit, dayUsed, hourUsed });
  }
  const dayUsedById = new Map(enriched.map((e) => [e.accountId, e.dayUsed]));

  // ---- Sticky path: reuse the recipient's assigned account if eligible ----
  if (stickiness === 'sticky' && recipient && recipient.sendingAccountId) {
    const assigned = enriched.find((e) => e.accountId === recipient.sendingAccountId);
    if (assigned) {
      const elig = isAccountEligible(assigned.account, now);
      const fits = assigned.dayUsed < assigned.dayLimit && assigned.hourUsed < assigned.hourLimit;
      if (elig.eligible && fits) {
        const res = await reserveUsage(assigned.accountId, assigned.dayLimit, assigned.hourLimit, now, transaction);
        if (res.ok) {
          return { ok: true, account: assigned.account, method: 'sticky' };
        }
      }
      // Assigned account unavailable → fallback policy (§78/79).
      if (fallback === 'pause') {
        return { ok: false, reason: 'assigned account unavailable; recipient paused by campaign policy', paused: true };
      }
      // else fall through to reassign below
    }
  }

  // ---- Fresh allocation from eligible pool ----
  const dayKeys = enriched.map((e) => [e.accountId, e.dayUsed]);
  void dayKeys;
  const candidates = enriched.filter((e) => {
    const elig = isAccountEligible(e.account, now);
    return elig.eligible && e.dayUsed < e.dayLimit && e.hourUsed < e.hourLimit;
  });
  if (candidates.length === 0) {
    return { ok: false, reason: 'no eligible account with remaining capacity' };
  }

  const ranked = rankAccounts(strategy, candidates.map((e) => ({
    id: e.accountId, accountId: e.accountId, weight: e.weight, dayLimit: e.dayLimit,
    lastSentAt: e.account.lastSentAt,
  })), dayUsedById);

  // Try in ranked order; the conditional UPDATE is the source of truth, so a
  // race on this worker's favourite simply falls through to the next account.
  for (const pick of ranked) {
    const entry = candidates.find((e) => e.accountId === pick.accountId);
    const res = await reserveUsage(entry.accountId, entry.dayLimit, entry.hourLimit, now, transaction);
    if (res.ok) {
      return {
        ok: true,
        account: entry.account,
        method: stickiness === 'sticky' ? 'reassigned' : strategy,
      };
    }
  }
  return { ok: false, reason: 'capacity exhausted across pool during send' };
}

/** Pool summary with live usage — for UI tables (§20/45/73/74). */
async function poolSummary(campaign, now = new Date()) {
  let pool = await getPoolWithAccounts(campaign);
  if (pool.length === 0 && campaign.sendingAccountId) {
    const legacy = await models.SmtpAccount.findOne({
      where: { id: campaign.sendingAccountId, organizationId: campaign.organizationId },
    });
    if (legacy) pool = [{ account: legacy, weight: 100, id: 'legacy' }];
  }
  const out = [];
  for (const row of pool) {
    const account = row.account;
    const { dayUsed, hourUsed } = await peekUsage(account.id, now);
    const activeCampaigns = await models.CampaignSendingAccount.count({
      where: { smtpAccountId: account.id, enabled: true },
    });
    out.push({
      poolId: row.id,
      accountId: account.id,
      email: account.fromEmail,
      name: account.name,
      fromName: account.fromName,
      status: account.status,
      healthStatus: account.healthStatus || 'unknown',
      warmupStatus: account.warmupStatus || 'not_started',
      isEnabled: account.isEnabled,
      dailyLimit: effectiveDayLimit(account, campaign),
      hourlyLimit: effectiveHourLimit(account, campaign),
      sentToday: dayUsed,
      sentThisHour: hourUsed,
      remainingToday: Math.max(0, effectiveDayLimit(account, campaign) - dayUsed),
      remainingThisHour: Math.max(0, effectiveHourLimit(account, campaign) - hourUsed),
      weight: row.weight,
      lastSentAt: account.lastSentAt,
      activeCampaigns,
      timezone: account.timezone || 'UTC',
    });
  }
  return out;
}

module.exports = {
  utcDayKey,
  utcHourKey,
  tzParts,
  accountInSchedule,
  campaignInSchedule,
  effectiveDayLimit,
  effectiveHourLimit,
  peekUsage,
  reserveUsage,
  releaseUsage,
  getPoolWithAccounts,
  isAccountEligible,
  rankAccounts,
  allocateAndReserve,
  poolSummary,
};
