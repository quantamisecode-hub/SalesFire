// Known template variables for an organization — shared by validation and the
// AI sequence writer. Contains platform variables, the built-in lead fields
// (snake_case + camelCase) and every imported custom-variable slug (§18).
const models = require('../models');
const templateRenderer = require('./template-renderer');

const BUILTIN_LEAD_FIELDS = [
  'first_name', 'last_name', 'company_name', 'job_title', 'website', 'email',
  'location', 'industry', 'company_size', 'phone', 'linkedin', 'personalization',
];

async function knownVariablesForOrg(organizationId) {
  const known = new Set(templateRenderer.PLATFORM_VARIABLES);
  for (const base of BUILTIN_LEAD_FIELDS) {
    known.add(base);
    known.add(base.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
  }
  const leads = await models.Lead.findAll({
    where: { organizationId },
    attributes: ['customFields'],
  });
  for (const lead of leads) {
    for (const k of Object.keys(lead.customFields || {})) {
      if (/^[a-z0-9_]{1,40}$/.test(k)) known.add(k);
    }
  }
  return known;
}

module.exports = { knownVariablesForOrg, BUILTIN_LEAD_FIELDS };
