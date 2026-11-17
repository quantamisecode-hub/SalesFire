// Leads routes — table-first lead management + import workflow (§36).
// Tenancy derived from the authenticated token only (§40). File uploads are
// validated (extension + MIME + size + content), never executed, and filenames
// are never used to build filesystem paths (§39).
const express = require('express');
const multer = require('multer');
const { Op } = require('sequelize');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const leadImport = require('../services/lead-import');
const { Suppression, CampaignLead, EmailEvent } = models;

const router = express.Router();

function authenticate(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles || [] };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
router.use(authenticate);

// Org-member gate: org identity comes from the signed token only (§40).
// OWNER/ADMIN get broader bulk permissions (§41).
function checkOrgMembership(req, res, next) {
  if (!req.user.org) return res.status(403).json({ error: 'No organization membership' });
  req.isPrivileged = ['owner', 'admin'].includes(String(req.user.roles?.[0] || '').toLowerCase());
  next();
}
router.use(checkOrgMembership);

function canWrite(req) {
  return req.isPrivileged || ['member', 'editor', 'manager'].includes(String(req.user.roles?.[0] || '').toLowerCase());
}

// Upload handling: memory storage, hard size cap, no files written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: leadImport.MAX_FILE_BYTES, files: 1 },
});
const uploadSingle = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large. Maximum is ${Math.round(leadImport.MAX_FILE_BYTES / (1024 * 1024))} MB.`
        : 'Upload rejected.';
      return res.status(422).json({ error: msg });
    }
    next();
  });
};

function assertUploadFile(req) {
  if (!req.file) {
    const e = new Error('No file uploaded.');
    e.statusCode = 422;
    throw e;
  }
  const allowed = ['xlsx', 'csv'];
  const ext = req.file.originalname.toLowerCase().split('.').pop();
  if (!allowed.includes(ext)) {
    const e = new Error('Unsupported file type. Upload .xlsx or .csv.');
    e.statusCode = 422;
    throw e;
  }
  // MIME where the client provided it (never trusted alone — content checked in parser)
  if (req.file.mimetype && !/^(application\/(vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream|excel|vnd\.ms-excel)|text\/(csv|plain))/.test(req.file.mimetype)) {
    const e = new Error('Unsupported file content type.');
    e.statusCode = 422;
    throw e;
  }
  // Display-only sanitized filename (§39)
  req.file.safeName = String(req.file.originalname || 'upload')
    .replace(/[/\\]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 100) || 'upload';
}

function serialize(l) {
  return {
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    companyName: l.companyName,
    jobTitle: l.jobTitle,
    email: l.email,
    phone: l.phone,
    website: l.website,
    linkedin: l.linkedin,
    location: l.location,
    industry: l.industry,
    companySize: l.companySize,
    personalization: l.personalization,
    customFields: l.customFields || null,
    status: l.status,
    emailStatus: l.emailStatus,
    leadScore: l.leadScore,
    source: l.source,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/leads — server-side pagination, search, sort, filters (§4, §10-11)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 25));
    const where = { organizationId: req.user.org };

    const search = (req.query.search || '').trim();
    if (search) {
      const like = { [Op.like]: `%${search}%` };
      where[Op.or] = [
        { firstName: like }, { lastName: like }, { companyName: like },
        { jobTitle: like }, { email: like }, { website: like },
      ];
    }
    const { status, emailStatus, industry, companySize, location } = req.query;
    if (status && status !== 'all') where.status = status;
    if (emailStatus && emailStatus !== 'all') where.emailStatus = emailStatus;
    if (industry) where.industry = { [Op.like]: `%${industry}%` };
    if (companySize) where.companySize = companySize;
    if (location) where.location = { [Op.like]: `%${location}%` };
    if (req.query.minScore || req.query.maxScore) {
      where.leadScore = {};
      if (req.query.minScore) where.leadScore[Op.gte] = parseInt(req.query.minScore) || 0;
      if (req.query.maxScore) where.leadScore[Op.lte] = parseInt(req.query.maxScore) || 100;
    }
    if (req.query.createdAfter || req.query.createdBefore) {
      where.createdAt = {};
      if (req.query.createdAfter) where.createdAt[Op.gte] = new Date(req.query.createdAfter);
      if (req.query.createdBefore) where.createdAt[Op.lte] = new Date(req.query.createdBefore);
    }

    const sortable = ['firstName', 'lastName', 'companyName', 'jobTitle', 'email', 'status', 'emailStatus', 'leadScore', 'createdAt', 'updatedAt'];
    const sortBy = sortable.includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const { count, rows } = await models.Lead.findAndCountAll({
      where,
      order: [[sortBy, sortDir]],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    // Which of these leads are already recipients of the queried campaign?
    let enrolledEmails = new Set();
    if (req.query.campaignId) {
      const recips = await CampaignLead.findAll({
        where: { campaignId: req.query.campaignId, organizationId: req.user.org },
        attributes: ['email'],
      });
      enrolledEmails = new Set(recips.map((r) => r.email));
    }

    res.json({
      success: true,
      data: rows.map((l) => ({ ...serialize(l), enrolledInCampaign: enrolledEmails.has(l.email) })),
      pagination: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) || 1 },
    });
  } catch (error) {
    console.error('List leads error:', error);
    res.status(500).json({ error: 'Failed to list leads' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/leads — manual add (§31). Email required.
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission to create leads' });
    const b = req.body || {};
    const email = leadImport.normalizeEmail(b.email);
    if (!email || !leadImport.validEmail(email)) return res.status(422).json({ error: 'A valid email is required' });
    const exists = await models.Lead.findOne({ where: { organizationId: req.user.org, email } });
    if (exists) return res.status(409).json({ error: `Lead already exists: ${email}` });
    const lead = await models.Lead.create({
      organizationId: req.user.org,
      createdBy: req.user.id,
      email,
      firstName: (b.firstName || '').slice(0, 100),
      lastName: (b.lastName || '').slice(0, 100),
      companyName: (b.companyName || '').slice(0, 255),
      jobTitle: (b.jobTitle || '').slice(0, 255),
      phone: (b.phone || '').slice(0, 50),
      website: (b.website || '').slice(0, 255),
      linkedin: (b.linkedin || '').slice(0, 255),
      location: (b.location || '').slice(0, 255),
      industry: (b.industry || '').slice(0, 255),
      companySize: (b.companySize || '').slice(0, 50),
      personalization: (b.personalization || '').slice(0, 2000),
      source: 'manual',
      emailStatus: 'syntax_valid',
    });
    res.status(201).json({ success: true, data: serialize(lead) });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/leads/template — Excel template download (§37-38)
// ---------------------------------------------------------------------------
router.get('/template', (req, res) => {
  const { buffer, filename } = leadImport.templateWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

// ---------------------------------------------------------------------------
// Import workflow: preview → validate → import (job) → status → errors
// ---------------------------------------------------------------------------
router.post('/import/preview', uploadSingle, async (req, res) => {
  try {
    assertUploadFile(req);
    const preview = leadImport.buildPreview(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ success: true, data: { ...preview, maxRows: leadImport.MAX_ROWS, maxFileBytes: leadImport.MAX_FILE_BYTES, filename: req.file.safeName } });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to preview the file' });
  }
});

// Validate with the user's mapping → real counts + error rows (§23-27).
router.post('/import/validate', express.json({ limit: '12mb' }), async (req, res) => {
  try {
    const { headers, rows, mapping, duplicateStrategy } = req.body || {};
    if (!Array.isArray(rows) || !Array.isArray(headers)) return res.status(422).json({ error: 'Missing parsed rows — upload the file first' });
    if (rows.length > leadImport.MAX_ROWS) return res.status(422).json({ error: 'Too many rows' });
    if (!mapping || !(Object.values(mapping)).includes(leadImport.EMAIL_FIELD)) {
      return res.status(422).json({ error: 'Map the Email column — it is required.' });
    }
    for (const [k, v] of Object.entries(mapping)) {
      if (String(v).startsWith('custom:') && !leadImport.CUSTOM_RE.test(String(v).slice(7))) {
        return res.status(422).json({ error: `Invalid custom variable name: ${v}` });
      }
    }
    const result = await leadImport.validateImport(rows, mapping, duplicateStrategy === 'update' ? 'update' : 'skip', req.user.org);
    res.json({
      success: true,
      data: {
        counts: {
          totalRows: result.counts.total,
          valid: result.counts.valid,
          invalidEmail: result.counts.invalidEmail,
          missingEmail: result.counts.missingEmail,
          duplicateInFile: result.counts.duplicateInFile,
          duplicateExisting: result.counts.duplicateExisting,
          suppressed: result.counts.suppressed,
        },
        errors: result.rowErrors.slice(0, 50),
      },
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Validation failed' });
  }
});

// Create the import job and process it asynchronously in batches (§28, §42).
router.post('/import', express.json({ limit: '12mb' }), async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission to import leads' });
    const { headers, rows, mapping, duplicateStrategy, campaignId, filename } = req.body || {};
    if (!Array.isArray(rows) || !Array.isArray(headers) || !mapping) return res.status(422).json({ error: 'Missing parsed rows — upload the file first' });
    if (rows.length > leadImport.MAX_ROWS) return res.status(422).json({ error: 'Too many rows' });
    if (!(Object.values(mapping)).includes(leadImport.EMAIL_FIELD)) {
      return res.status(422).json({ error: 'Map the Email column — it is required.' });
    }
    if (campaignId) {
      const campaign = await models.Campaign.findOne({ where: { id: campaignId, organizationId: req.user.org } });
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    }
    const job = await models.ImportJob.create({
      organizationId: req.user.org,
      createdBy: req.user.id,
      status: 'pending',
      filename: String(filename || 'upload').slice(0, 250),
      format: 'xlsx/csv',
      mapping,
      duplicateStrategy: duplicateStrategy === 'update' ? 'update' : 'skip',
      campaignId: campaignId || null,
      rows,
      totalRows: rows.length,
    });
    // Asynchronous batch processing — progress is real and pollable (§28).
    setImmediate(() => { leadImport.processImportJob(job.id).catch((e) => console.error('Import job error:', e)); });
    res.status(202).json({ success: true, data: { jobId: job.id } });
  } catch (error) {
    console.error('Import create error:', error);
    res.status(500).json({ error: 'Failed to start the import' });
  }
});

router.get('/import/:jobId', async (req, res) => {
  try {
    const job = await models.ImportJob.findOne({ where: { id: req.params.jobId, organizationId: req.user.org } });
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    res.json({
      success: true,
      data: {
        jobId: job.id, status: job.status, filename: job.filename,
        totalRows: job.totalRows, processed: job.processed,
        imported: job.imported, skipped: job.skipped, failed: job.failed,
        errorMessage: job.errorMessage || null,
      },
    });
  } catch (error) {
    console.error('Import status error:', error);
    res.status(500).json({ error: 'Failed to load import status' });
  }
});

router.get('/import/:jobId/errors', async (req, res) => {
  try {
    const job = await models.ImportJob.findOne({ where: { id: req.params.jobId, organizationId: req.user.org } });
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    res.json({ success: true, data: job.errorReport || [] });
  } catch (error) {
    console.error('Import errors error:', error);
    res.status(500).json({ error: 'Failed to load import errors' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/leads/:id — detail incl. campaign activity (§32)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const lead = await models.Lead.findOne({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const campaignLeads = await CampaignLead.findAll({
      where: { organizationId: req.user.org, email: lead.email },
      attributes: ['id', 'campaignId', 'status', 'currentStep', 'lastSentAt', 'repliedAt', 'unsubscribedAt', 'bouncedAt'],
    });
    const campaignIds = [...new Set(campaignLeads.map((c) => c.campaignId))];
    const campaigns = campaignIds.length
      ? await models.Campaign.findAll({ where: { id: { [Op.in]: campaignIds } }, attributes: ['id', 'name', 'status'] })
      : [];
    const events = campaignIds.length
      ? await EmailEvent.findAll({
          where: { organizationId: req.user.org, campaignRecipientId: { [Op.in]: campaignLeads.map((c) => c.id) } },
          order: [['eventTimestamp', 'DESC']], limit: 20,
        })
      : [];
    res.json({
      success: true,
      data: {
        ...serialize(lead),
        campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
        campaignLeads: campaignLeads.map((c) => c.toJSON()),
        events: events.map((e) => ({ id: e.id, eventType: e.eventType, eventTimestamp: e.eventTimestamp, campaignId: e.campaignId })),
      },
    });
  } catch (error) {
    console.error('Lead detail error:', error);
    res.status(500).json({ error: 'Failed to load lead' });
  }
});

// PATCH /api/v1/leads/:id
router.patch('/:id', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission to edit leads' });
    const lead = await models.Lead.findOne({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const allowed = ['firstName', 'lastName', 'companyName', 'jobTitle', 'phone', 'website', 'linkedin', 'location', 'industry', 'companySize', 'personalization', 'status'];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) lead[key] = key === 'status' ? String(req.body[key]).toLowerCase() : String(req.body[key]).slice(0, 255);
    }
    if (req.body?.leadScore !== undefined) {
      const n = parseInt(req.body.leadScore, 10);
      lead.leadScore = Number.isNaN(n) ? null : Math.max(0, Math.min(100, n));
    }
    await lead.save();
    res.json({ success: true, data: serialize(lead) });
  } catch (error) {
    console.error('Lead update error:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// DELETE /api/v1/leads/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!req.isPrivileged) return res.status(403).json({ error: 'Only owners and admins can delete leads' });
    const deleted = await models.Lead.destroy({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!deleted) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Lead delete error:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ---------------------------------------------------------------------------
// Bulk actions (§5) — only implemented ones.
// ---------------------------------------------------------------------------
// POST /bulk/add-to-campaign — enroll leads as campaign recipients
router.post('/bulk/add-to-campaign', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const { leadIds, campaignId } = req.body || {};
    if (!Array.isArray(leadIds) || !leadIds.length) return res.status(422).json({ error: 'Select at least one lead' });
    if (!campaignId) return res.status(422).json({ error: 'Campaign is required' });
    const campaign = await models.Campaign.findOne({ where: { id: campaignId, organizationId: req.user.org } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const leads = await models.Lead.findAll({ where: { id: { [Op.in]: leadIds }, organizationId: req.user.org } });
    const suppressed = await Suppression.findAll({ where: { organizationId: req.user.org, email: { [Op.in]: leads.map((l) => l.email) } } });
    const suppressedEmails = new Set(suppressed.map((s) => s.email));
    const enrolledEmails = new Set((await CampaignLead.findAll({ where: { campaignId: campaign.id, organizationId: req.user.org }, attributes: ['email'] })).map((r) => r.email));

    let created = 0; const rejected = [];
    for (const lead of leads) {
      if (suppressedEmails.has(lead.email)) { rejected.push({ email: lead.email, reason: 'suppressed' }); continue; }
      if (enrolledEmails.has(lead.email)) { rejected.push({ email: lead.email, reason: 'already enrolled' }); continue; }
      await CampaignLead.create({
        campaignId: campaign.id, organizationId: req.user.org, leadId: lead.id, status: 'pending',
        email: lead.email, firstName: lead.firstName, lastName: lead.lastName,
        companyName: lead.companyName, jobTitle: lead.jobTitle,
      });
      enrolledEmails.add(lead.email);
      created++;
    }
    res.json({ success: true, counts: { created, rejected: rejected.length }, data: { rejected } });
  } catch (error) {
    console.error('Bulk add-to-campaign error:', error);
    res.status(500).json({ error: 'Failed to add leads to campaign' });
  }
});

// POST /bulk/suppress — org-wide suppression (§5, §26)
router.post('/bulk/suppress', async (req, res) => {
  try {
    const { leadIds, reason } = req.body || {};
    if (!Array.isArray(leadIds) || !leadIds.length) return res.status(422).json({ error: 'Select at least one lead' });
    if (!req.isPrivileged && !canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const leads = await models.Lead.findAll({ where: { id: { [Op.in]: leadIds }, organizationId: req.user.org } });
    let count = 0;
    for (const lead of leads) {
      const [, created] = await Suppression.findOrCreate({
        where: { organizationId: req.user.org, email: lead.email },
        defaults: { organizationId: req.user.org, email: lead.email, reason: ['unsubscribed', 'bounced', 'blocked', 'invalid'].includes(reason) ? reason : 'blocked' },
      });
      if (created) count++;
      await lead.update({ status: 'suppressed' });
    }
    res.json({ success: true, counts: { suppressed: count, leads: leads.length } });
  } catch (error) {
    console.error('Bulk suppress error:', error);
    res.status(500).json({ error: 'Failed to suppress leads' });
  }
});

// POST /bulk/delete
router.post('/bulk/delete', async (req, res) => {
  try {
    if (!req.isPrivileged) return res.status(403).json({ error: 'Only owners and admins can delete leads' });
    const { leadIds } = req.body || {};
    if (!Array.isArray(leadIds) || !leadIds.length) return res.status(422).json({ error: 'Select at least one lead' });
    const deleted = await models.Lead.destroy({ where: { id: { [Op.in]: leadIds }, organizationId: req.user.org } });
    res.json({ success: true, counts: { deleted } });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to delete leads' });
  }
});

// GET /bulk/export?ids=a,b,c — CSV export of selected leads (§5)
router.get('/bulk/export', async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    if (!ids.length) return res.status(422).json({ error: 'Select at least one lead' });
    const leads = await models.Lead.findAll({ where: { id: { [Op.in]: ids }, organizationId: req.user.org } });
    const header = ['First Name', 'Last Name', 'Company Name', 'Job Title', 'Email', 'Phone', 'Website', 'LinkedIn', 'Location', 'Industry', 'Company Size', 'Status', 'Email Status', 'Lead Score'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header.join(','), ...leads.map((l) => [
      l.firstName, l.lastName, l.companyName, l.jobTitle, l.email, l.phone, l.website,
      l.linkedin, l.location, l.industry, l.companySize, l.status, l.emailStatus, l.leadScore,
    ].map(esc).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-sales-intelligence-leads.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Bulk export error:', error);
    res.status(500).json({ error: 'Failed to export leads' });
  }
});

module.exports = router;
