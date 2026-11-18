// LeadFilter — Instantly-style "Data fields" filtering (§ Instantly lead parity).
//
// Filters leads by builtin columns or by a customFields slug, with operators:
//   eq | neq | contains | not_contains | is_empty | is_not_empty | gt | lt
//
// Security model:
//   * Custom slugs are validated ^[a-z0-9_]{1,40}$ — they are interpolated into a
//     JSON path, never raw SQL.
//   * All runtime values bind as replacements — nothing from the request is
//     concatenated into SQL text.
//   * Builtin columns go through Sequelize's parameterized where clauses.
const { Op } = require('sequelize');
const { sequelize } = require('../db');
const models = require('../models');

// Builtin filterable fields → Lead attributes (both snake_case and camelCase keys accepted).
const FIELD_MAP = {
  first_name: 'firstName', firstname: 'firstName',
  last_name: 'lastName', lastname: 'lastName',
  company_name: 'companyName', companyname: 'companyName', company: 'companyName',
  job_title: 'jobTitle', jobtitle: 'jobTitle',
  email: 'email',
  website: 'website',
  phone: 'phone',
  linkedin: 'linkedin',
  location: 'location',
  industry: 'industry',
  company_size: 'companySize', companysize: 'companySize',
  personalization: 'personalization',
  status: 'status',
  email_status: 'emailStatus', emailstatus: 'emailStatus',
  assigned_to: 'assignedTo', assignedto: 'assignedTo', owner: 'assignedTo',
  lead_score: 'leadScore', leadscore: 'leadScore',
  source: 'source',
};

const OPS = new Set(['eq', 'neq', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'gt', 'lt']);

/** Escape LIKE wildcards so user input can't widen the pattern. */
function escapeLike(v) {
  return String(v).replace(/[\\%_]/g, (c) => '\\' + c);
}

function builtinCondition(col, op, rawValue) {
  let value = rawValue == null ? '' : String(rawValue);
  // lead_score is numeric — bind as number so SQLite/MySQL compare correctly.
  if (col === 'leadScore') value = String(Number(value) || 0) === value ? Number(value) : 0;
  switch (op) {
    case 'eq': return { [col]: value };
    case 'neq': return { [col]: { [Op.ne]: value } };
    case 'contains': return { [col]: { [Op.like]: `%${escapeLike(value)}%` } };
    case 'not_contains': return { [col]: { [Op.notLike]: `%${escapeLike(value)}%` } };
    case 'is_empty': return { [Op.or]: [{ [col]: null }, { [col]: '' }] };
    case 'is_not_empty': return { [col]: { [Op.notIn]: [null, ''] } };
    case 'gt': return { [col]: { [Op.gt]: value } };
    case 'lt': return { [col]: { [Op.lt]: value } };
    default: return null;
  }
}

// JSON_UNQUOTE is MySQL-only; SQLite's JSON_EXTRACT already returns text unquoted.
const EXTRACT = sequelize.getDialect() === 'sqlite'
  ? 'JSON_EXTRACT(custom_fields, :jsonPath)'
  : 'JSON_UNQUOTE(JSON_EXTRACT(custom_fields, :jsonPath))';

function customConditionSql(op) {
  const PATH = ':jsonPath';
  switch (op) {
    case 'eq': return `${EXTRACT} = :value`;
    case 'neq': return `(JSON_EXTRACT(custom_fields, ${PATH}) IS NULL OR ${EXTRACT} <> :value)`;
    case 'contains': return `${EXTRACT} LIKE :like ESCAPE '\\'`;
    case 'not_contains': return `(JSON_EXTRACT(custom_fields, ${PATH}) IS NULL OR ${EXTRACT} NOT LIKE :like ESCAPE '\\')`;
    case 'is_empty': return `(JSON_EXTRACT(custom_fields, ${PATH}) IS NULL OR ${EXTRACT} = '')`;
    case 'is_not_empty': return `(JSON_EXTRACT(custom_fields, ${PATH}) IS NOT NULL AND ${EXTRACT} <> '')`;
    case 'gt': return `CAST(${EXTRACT} AS REAL) > :num`;
    case 'lt': return `CAST(${EXTRACT} AS REAL) < :num`;
    default: return null;
  }
}

/**
 * Matching leads (ids + lowercased emails) for { field, op, value }, or null
 * when the filter params are absent/invalid. Shared by /leads and the
 * campaign recipients endpoint.
 */
async function matchingLeads(organizationId, query) {
  const field = (query.field || '').toString().trim().toLowerCase();
  const op = (query.op || '').toString().trim().toLowerCase();
  const value = query.value == null ? '' : String(query.value);
  if (!field || !OPS.has(op)) return null;

  const col = FIELD_MAP[field];
  if (col) {
    const cond = builtinCondition(col, op, value);
    if (!cond) return null;
    const rows = await models.Lead.findAll({
      where: { organizationId, ...cond },
      attributes: ['id', 'email'],
    });
    return {
      ids: rows.map((r) => r.id),
      emails: rows.map((r) => String(r.email || '').toLowerCase()),
    };
  }

  // Custom variable — strict slug validation before touching SQL text.
  const slug = field.replace(/[^a-z0-9_]/g, '').slice(0, 40);
  if (!slug) return { ids: [], emails: [] };
  const cond = customConditionSql(op);
  if (!cond) return null;

  const sql = `SELECT id, email FROM leads
               WHERE organization_id = :org AND ${cond}`;
  const replacements = { org: organizationId, jsonPath: `$."${slug}"`, value, like: `%${escapeLike(value)}%`, num: Number(value) || 0 };
  const [rows] = await sequelize.query(sql, { replacements });
  return {
    ids: rows.map((r) => r.id),
    emails: rows.map((r) => String(r.email || '').toLowerCase()),
  };
}

/** Ids only — convenience wrapper. */
async function matchingLeadIds(organizationId, query) {
  const m = await matchingLeads(organizationId, query);
  return m ? m.ids : null;
}

/** True when the request carries an active variable filter. */
function hasFieldFilter(query) {
  return Boolean((query.field || '').toString().trim()) && OPS.has((query.op || '').toString().trim().toLowerCase());
}

module.exports = { matchingLeadIds, hasFieldFilter, escapeLike, FIELD_MAP, OPS };
