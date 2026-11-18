// Lead import pipeline — Node.js only (§16-17, §23-30, §37).
// Parsing: SheetJS for .xlsx, csv-parse for .csv (proper quoted-value handling).
// No naive split(","). No Python. Files never executed; filenames never used
// to build filesystem paths.
const XLSX = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const { Op } = require('sequelize');
const models = require('../models');
const { Lead, ImportJob, Suppression, CampaignLead, sequelize } = models;

// Configured limits (surfaced to the UI — do not invent numbers elsewhere, §14)
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 10000;
const TEMPLATE_FILENAME = 'AI_Sales_Intelligence_Lead_Import_Template.xlsx';

// Canonical import fields (§37 template column order)
const IMPORT_FIELDS = [
  'firstName', 'lastName', 'companyName', 'jobTitle', 'email', 'phone',
  'website', 'linkedin', 'location', 'industry', 'companySize', 'personalization',
];
const EMAIL_FIELD = 'email';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CUSTOM_RE = /^[a-z0-9_]{1,40}$/; // custom variable slugs: {{recent_funding}}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// ---------------------------------------------------------------------------
// File parsing → { headers, rows, format }
// ---------------------------------------------------------------------------
function parseUpload(buffer, filename, mimeType) {
  const lower = String(filename || '').toLowerCase();
  const isXlsxExt = lower.endsWith('.xlsx');
  const isCsvExt = lower.endsWith('.csv');

  // Extension + signature checks — never trust the extension alone (§15, §39).
  const sig = buffer.length >= 4 ? buffer.subarray(0, 4) : Buffer.alloc(0);
  const looksZip = sig[0] === 0x50 && sig[1] === 0x4b; // "PK" — xlsx is a zip
  if (isXlsxExt && !looksZip) {
    const e = new Error('File is not a valid .xlsx workbook (corrupted or misnamed).');
    e.statusCode = 422;
    throw e;
  }
  if (!isXlsxExt && !isCsvExt) {
    const e = new Error('Unsupported file type. Upload .xlsx or .csv.');
    e.statusCode = 422;
    throw e;
  }

  let headers, rows;
  if (isXlsxExt) {
    let wb;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    } catch {
      const e = new Error('Could not read the .xlsx file (corrupted workbook).');
      e.statusCode = 422;
      throw e;
    }
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    if (!matrix.length) {
      const e = new Error('The file is empty.');
      e.statusCode = 422;
      throw e;
    }
    headers = matrix[0].map(cellText);
    rows = matrix.slice(1).filter((r) => r.some((c) => cellText(c) !== ''));
  } else {
    // Proper RFC 4180-ish CSV parsing: quotes, escaped quotes, commas and
    // line breaks inside quoted values, BOM, whitespace trimming.
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    let records;
    try {
      records = parseCsv(text, { columns: false, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    } catch {
      const e = new Error('Could not parse the CSV file.');
      e.statusCode = 422;
      throw e;
    }
    if (!records.length) {
      const e = new Error('The file is empty.');
      e.statusCode = 422;
      throw e;
    }
    headers = records[0].map(cellText);
    rows = records.slice(1).filter((r) => r.some((c) => cellText(c) !== ''));
  }

  if (!rows.length) {
    const e = new Error('The file has headers but no data rows.');
    e.statusCode = 422;
    throw e;
  }
  if (rows.length > MAX_ROWS) {
    const e = new Error(`Too many rows (${rows.length}). Maximum is ${MAX_ROWS} rows per import.`);
    e.statusCode = 422;
    throw e;
  }
  return { headers, rows, format: isXlsxExt ? 'xlsx' : 'csv' };
}

// ---------------------------------------------------------------------------
// Automatic column mapping (§19) — normalized header matching with variations.
// ---------------------------------------------------------------------------
const HEADER_MATCHERS = [
  { field: 'firstName', re: /^(first[\s_.-]*name|fname|^first$|given[\s_.-]*name)$/i },
  { field: 'lastName', re: /^(last[\s_.-]*name|lname|^last$|surname|family[\s_.-]*name)$/i },
  { field: 'companyName', re: /^(company[\s_.-]*name|company|organization|org[\s_.-]*name|account[\s_.-]*name)$/i },
  { field: 'jobTitle', re: /^(job[\s_.-]*title|title|jobtitle|position|role)$/i },
  { field: EMAIL_FIELD, re: /^(e-?mail([\s_.-]*address)?|work[\s_.-]*email|business[\s_.-]*email)$/i },
  { field: 'phone', re: /^(phone|phone[\s_.-]*number|mobile|cell|tel(ephone)?|work[\s_.-]*phone)$/i },
  { field: 'website', re: /^(website|web[\s_.-]*site|url|domain|company[\s_.-]*url|site)$/i },
  { field: 'linkedin', re: /^(linkedin|linkedin[\s_.-]*url|linkedin[\s_.-]*profile)$/i },
  { field: 'location', re: /^(location|country|city|region|geo([\s_.-]*location)?|country[\s_.-]*region)$/i },
  { field: 'industry', re: /^(industry|vertical|sector)$/i },
  { field: 'companySize', re: /^(company[\s_.-]*size|employees|employee[\s_.-]*count|headcount)$/i },
  { field: 'personalization', re: /^(personalization|personalization[\s_.-]*note|custom[\s_.-]*note|note)$/i },
];

function slugifyHeader(h) {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function suggestMapping(headers) {
  const mapping = {};
  const used = new Set();
  headers.forEach((h, i) => {
    const name = cellText(h);
    if (!name) { mapping[i] = 'skip'; return; }
    const match = HEADER_MATCHERS.find((m) => m.re.test(name) && !used.has(m.field));
    if (match) {
      mapping[i] = match.field;
      used.add(match.field);
    } else {
      // Free header becomes a Custom Variable candidate: custom:<slug> (§21)
      const slug = slugifyHeader(name);
      mapping[i] = slug && CUSTOM_RE.test(slug) ? `custom:${slug}` : 'skip';
    }
  });
  return mapping;
}

function buildPreview(buffer, filename, mimeType) {
  const { headers, rows, format } = parseUpload(buffer, filename, mimeType);
  const columns = headers.map((h, i) => ({
    index: i,
    header: cellText(h) || `Column ${i + 1}`,
    samples: rows.slice(0, 5).map((r) => cellText(r[i])).filter(Boolean).slice(0, 4),
    suggested: suggestMapping([h])[i],
  }));
  return { headers: headers.map(cellText), rows, format, columns, mapping: suggestMapping(headers) };
}

// ---------------------------------------------------------------------------
// Validation — REAL counts against file + org leads + suppressions (§23-26).
// ---------------------------------------------------------------------------
function validEmail(v) {
  const e = normalizeEmail(v);
  return EMAIL_RE.test(e) ? e : null;
}

async function validateImport(rows, mapping, duplicateStrategy, organizationId, campaignId) {
  // Resolve the email column index — required (§20).
  const emailIdx = Object.keys(mapping).find((i) => mapping[i] === EMAIL_FIELD);
  if (emailIdx === undefined) {
    const e = new Error('Map the Email column — it is required.');
    e.statusCode = 422;
    throw e;
  }

  const counts = { total: rows.length, valid: 0, invalidEmail: 0, missingEmail: 0, duplicateInFile: 0, duplicateExisting: 0, campaignEnrolled: 0, suppressed: 0 };
  const seen = new Set();
  const candidates = []; // { rowIndex, email, data }
  const rowErrors = [];

  rows.forEach((r, idx) => {
    const rawEmail = cellText(r[emailIdx]);
    if (!rawEmail) {
      counts.missingEmail++;
      rowErrors.push({ row: idx + 2, email: '', reason: 'Missing email' });
      return;
    }
    const email = validEmail(rawEmail);
    if (!email) {
      counts.invalidEmail++;
      rowErrors.push({ row: idx + 2, email: rawEmail.slice(0, 60), reason: 'Invalid email format' });
      return;
    }
    if (seen.has(email)) {
      counts.duplicateInFile++;
      rowErrors.push({ row: idx + 2, email, reason: 'Duplicate within the uploaded file' });
      return;
    }
    seen.add(email);
    candidates.push({ rowIndex: idx + 2, email, data: r });
  });

  // Existing leads + suppressions for this org, for the candidate set only.
  const emails = candidates.map((c) => c.email);
  let existing = new Set();
  let suppressed = new Set();
  let enrolled = new Set();
  if (emails.length) {
    const chunk = 500;
    for (let i = 0; i < emails.length; i += chunk) {
      const slice = emails.slice(i, i + chunk);
      const found = await Lead.findAll({ where: { organizationId, email: { [Op.in]: slice } }, attributes: ['email'] });
      found.forEach((l) => existing.add(l.email));
      const sup = await Suppression.findAll({ where: { organizationId, email: { [Op.in]: slice } }, attributes: ['email'] });
      sup.forEach((s) => suppressed.add(s.email));
      // When enrolling into a campaign: leads already enrolled in THIS campaign
      // are excluded — duplicates everywhere else are still counted as such.
      if (campaignId) {
        const inCampaign = await models.CampaignLead.findAll({
          where: { campaignId, organizationId, email: { [Op.in]: slice } },
          attributes: ['email'],
        });
        inCampaign.forEach((l) => enrolled.add(l.email));
      }
    }
  }

  const finalRows = [];
  for (const c of candidates) {
    if (suppressed.has(c.email)) {
      counts.suppressed++;
      rowErrors.push({ row: c.rowIndex, email: c.email, reason: 'Suppressed (unsubscribe / bounced / blocked)' });
      continue;
    }
    if (enrolled.has(c.email)) {
      counts.campaignEnrolled++;
      rowErrors.push({ row: c.rowIndex, email: c.email, reason: 'Already enrolled in this campaign' });
      continue;
    }
    if (existing.has(c.email)) {
      counts.duplicateExisting++;
      if (duplicateStrategy === 'skip') {
        rowErrors.push({ row: c.rowIndex, email: c.email, reason: 'Duplicate lead (already exists)' });
        continue;
      }
      // 'update' — the existing lead will be refreshed during import.
    }
    counts.valid++;
    finalRows.push(c);
  }

  return { counts, finalRows, rowErrors };
}

// Map one uploaded row → lead attributes per the mapping (§20-21).
function mapRow(rowValues, mapping, organizationId) {
  const lead = { organizationId, customFields: undefined };
  const custom = {};
  for (const [idxStr, field] of Object.entries(mapping)) {
    const idx = Number(idxStr);
    const value = cellText(rowValues[idx]);
    if (!value) continue;
    if (field === 'skip') continue;
    if (field.startsWith('custom:')) {
      const slug = field.slice(7);
      // Slug already validated against CUSTOM_RE at mapping time; re-validate
      // defensively — no arbitrary keys, no code execution (§21, §39).
      if (CUSTOM_RE.test(slug)) custom[slug] = value.slice(0, 500);
      continue;
    }
    if (field === EMAIL_FIELD) {
      lead.email = normalizeEmail(value);
    } else if (IMPORT_FIELDS.includes(field)) {
      lead[field] = value.slice(0, field === 'personalization' ? 2000 : 255);
    }
  }
  if (Object.keys(custom).length) lead.customFields = custom;
  return lead;
}

// ---------------------------------------------------------------------------
// Batched import with REAL progress persisted on the job row (§28).
// ---------------------------------------------------------------------------
async function processImportJob(jobId) {
  const job = await ImportJob.findByPk(jobId);
  if (!job || job.status === 'processing' || job.status === 'completed') return;
  await job.update({ status: 'processing' });

  try {
    const mapping = job.mapping;
    const { counts, finalRows, rowErrors } = await validateImport(job.rows, mapping, job.duplicateStrategy, job.organizationId, job.campaignId || null);
    await job.update({
      totalRows: counts.total,
      skipped: counts.total - counts.valid,
      errorReport: rowErrors.slice(0, 1000),
    });

    const emailIdx = Number(Object.keys(mapping).find((i) => mapping[i] === EMAIL_FIELD));
    const BATCH = 100;
    for (let i = 0; i < finalRows.length; i += BATCH) {
      const batch = finalRows.slice(i, i + BATCH);
      // Sequential within a batch keeps dedupe/update semantics predictable
      // even when two imports race (unique index is the final guard).
      for (const c of batch) {
        try {
          const attrs = mapRow(c.data, mapping, job.organizationId);
          attrs.createdBy = job.createdBy;
          attrs.source = 'import';
          attrs.emailStatus = 'syntax_valid';
          const existing = await Lead.findOne({ where: { organizationId: job.organizationId, email: c.email } });
          if (existing) {
            await existing.update(attrs);
          } else {
            await Lead.create(attrs);
          }
          job.imported += 1;
        } catch (err) {
          job.failed += 1;
          // Clone before mutating — Sequelize does not detect in-place JSON
          // edits (same array reference ⇒ column treated as unchanged).
          const report = Array.isArray(job.errorReport) ? job.errorReport.slice() : [];
          if (report.length < 1000) {
            report.push({ row: c.rowIndex, email: c.email, reason: err.message?.slice(0, 120) || 'Import failed' });
            job.errorReport = report;
          }
        }
      }
      // Persist real progress after every batch (§28 — no fake timers).
      job.processed = Math.min(finalRows.length, i + BATCH);
      await job.update({ processed: job.processed, imported: job.imported, failed: job.failed, errorReport: job.errorReport });
    }

    // Optional campaign enrollment: rows imported (or updated) are enrolled.
    if (job.campaignId) {
      const emails = finalRows.map((c) => c.email);
      const leads = await Lead.findAll({ where: { organizationId: job.organizationId, email: { [Op.in]: emails } }, attributes: ['id'] });
      const campaign = await models.Campaign.findOne({ where: { id: job.campaignId, organizationId: job.organizationId } });
      if (campaign && leads.length) {
        for (const lead of leads) {
          const full = await Lead.findByPk(lead.id);
          const exists = await CampaignLead.findOne({ where: { campaignId: campaign.id, email: full.email } });
          if (!exists) {
            await CampaignLead.create({
              campaignId: campaign.id,
              organizationId: job.organizationId,
              leadId: full.id,
              status: 'pending',
              email: full.email,
              firstName: full.firstName,
              lastName: full.lastName,
              companyName: full.companyName,
              jobTitle: full.jobTitle,
            });
          }
        }
      }
    }

    await job.update({ status: 'completed', processed: counts.total });
  } catch (err) {
    await job.update({ status: 'failed', errorMessage: String(err.message || 'Import failed').slice(0, 480) });
  }
}

// ---------------------------------------------------------------------------
// Excel template (§37-38) — exact column structure.
// ---------------------------------------------------------------------------
function templateWorkbook() {
  const header = ['First Name', 'Last Name', 'Company Name', 'Job Title', 'Email', 'Phone', 'Website', 'LinkedIn', 'Location', 'Industry', 'Company Size', 'Personalization'];
  const example = [
    ['John', 'Doe', 'Acme Corp', 'CTO', 'john@example.com', '+1 555 010 1234', 'https://acme.example', 'https://linkedin.com/in/johndoe', 'United States', 'Software', '50-200', 'Mention their new product launch'],
    ['Jane', 'Smith', 'FinTech Co', 'CEO', 'jane@example.com', '+1 555 010 5678', 'https://fintech.example', 'https://linkedin.com/in/janesmith', 'United Kingdom', 'Financial Services', '200-1000', 'Reference their Series B announcement'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([header, ...example]);
  const instructions = XLSX.utils.aoa_to_sheet([
    ['AI Sales Intelligence — Lead Import Template'],
    [''],
    ['1. Keep the header row exactly as provided; column order does not matter.'],
    ['2. Email is required for every lead you want to import.'],
    ['3. Delete the example rows before importing real data.'],
    ['4. Extra columns become custom personalization variables, e.g. {{recent_funding}}.'],
    ['5. Supported formats: .xlsx and .csv.'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), filename: TEMPLATE_FILENAME };
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_ROWS,
  TEMPLATE_FILENAME,
  EMAIL_FIELD,
  IMPORT_FIELDS,
  CUSTOM_RE,
  normalizeEmail,
  validEmail,
  parseUpload,
  suggestMapping,
  buildPreview,
  validateImport,
  mapRow,
  processImportJob,
  templateWorkbook,
};
