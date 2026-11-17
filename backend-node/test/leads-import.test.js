// Leads + import workflow tests - Prompt 6 §44 (node:test).
// Real HTTP server on an isolated test DB. Covers upload, mapping, validation,
// import (real job), security (tenant isolation, spoofing, traversal, XSS) and
// concurrency. Run: node --test test/leads-import.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const XLSX = require('xlsx');

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-node-test-32b!';
process.env.JWT_SECRET = 'test-jwt-secret-for-node-test';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-node-test';
process.env.DATABASE_URL = 'sqlite:./test-leads-database.sqlite';
process.env.PORT = '8902';
process.env.ENVIRONMENT = 'test';

const BASE = 'http://localhost:8902/api/v1';

let cookie = null; // org A session
let cookieB = null; // org B session (tenant isolation tests)

async function raw(method, path, body, which = 'a') {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: which === 'a' ? cookie : cookieB },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function api(method, path, body, which = 'a') {
  const res = await raw(method, path, body, which);
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function upload(path, filename, buffer, which = 'a') {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Cookie: which === 'a' ? cookie : cookieB }, body: form });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const CSV_GOOD = [
  'First Name,Last Name,Company Name,Job Title,Email,Phone',
  'Dana,Reed,Orbital Labs,Head of Sales,dana@orbital.test,+1 555 0001',
  'Evan,Fox,Quanta,Founder,not-an-email,',
  'Fiona,Hill,Zenith,COO,FIONA@zenith.test,',
  'Fiona,Hill,Zenith,COO,fiona@zenith.test,', // duplicate within the file
  'Gary,Oldman,Omni,VP,,', // has data but no email
].join('\n');

function xlsxBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function waitForJob(jobId, which = 'a') {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const { status, json } = await api('GET', `/leads/import/${jobId}`, undefined, which);
    if (status === 200 && (json.data.status === 'completed' || json.data.status === 'failed')) return { status, json };
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('import job did not finish in time');
}

before(async () => {
  // Fresh DB every run — the suite asserts exact counts, so stale data from a
  // previous run would break determinism.
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`./test-leads-database.sqlite${suffix}`, { force: true });
  }
  const { sequelize } = require('../db');
  require('../models');
  await sequelize.sync();
  require('../server');

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:8902/health');
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Register two orgs and capture both session cookies.
  for (const which of ['a', 'b']) {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `leads-${which}-${Date.now()}@test.io`,
        password: 'LeadsTest123!',
        full_name: 'Leads Tester',
        organization_name: `Leads Org ${which} ${Date.now()}`,
      }),
    });
    const setCookie = res.headers.get('set-cookie');
    const sess = setCookie.split(';')[0];
    if (which === 'a') cookie = sess; else cookieB = sess;
  }
});

after(async () => {
  const { sequelize } = require('../db');
  await sequelize.close();
  process.exit(0);
});

// ---------------------------------------------------------------------------
describe('upload (§44 upload)', () => {
  test('valid CSV parses with auto-mapping and samples', async () => {
    const { status, json } = await upload('/leads/import/preview', 'leads.csv', Buffer.from(CSV_GOOD));
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.format, 'csv');
    assert.strictEqual(json.data.rows.length, 5, 'empty rows dropped');
    assert.strictEqual(json.data.mapping['4'], 'email');
    assert.ok(json.data.columns[0].samples.includes('Dana'), 'samples returned');
  });

  test('valid XLSX parses', async () => {
    const buf = xlsxBuffer([
      ['First Name', 'Email'],
      ['Gina', 'gina@xlsx.test'],
    ]);
    const { status, json } = await upload('/leads/import/preview', 'leads.xlsx', buf);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.format, 'xlsx');
    assert.strictEqual(json.data.rows[0][1], 'gina@xlsx.test');
  });

  test('unsupported extension is rejected', async () => {
    const { status } = await upload('/leads/import/preview', 'leads.exe', Buffer.from('MZ%%%'));
    assert.strictEqual(status, 422);
  });

  test('corrupted XLSX is rejected (PK prefix, garbage body)', async () => {
    const garbage = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('not really a zip at all')]);
    const { status } = await upload('/leads/import/preview', 'corrupt.xlsx', garbage);
    assert.strictEqual(status, 422);
  });

  test('file-type spoofing: CSV bytes named .xlsx are rejected', async () => {
    const { status } = await upload('/leads/import/preview', 'spoofed.xlsx', Buffer.from(CSV_GOOD));
    assert.strictEqual(status, 422);
  });

  test('empty file is rejected', async () => {
    const { status } = await upload('/leads/import/preview', 'empty.csv', Buffer.from(''));
    assert.strictEqual(status, 422);
  });

  test('headers-only file is rejected', async () => {
    const { status } = await upload('/leads/import/preview', 'headeronly.csv', Buffer.from('First Name,Email\n'));
    assert.strictEqual(status, 422);
  });

  test('oversized file is rejected at the configured 5 MB cap', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1000, 0x61);
    const { status, json } = await upload('/leads/import/preview', 'big.csv', big);
    assert.strictEqual(status, 422);
    assert.ok(/too large/i.test(json.error));
  });

  test('malicious / traversal filename is sanitized, never used as a path', async () => {
    const evil = '..%2F..%2F..%2Ftmp%2Fevil<script>.csv'.replace(/%2F/g, '/');
    const { status, json } = await upload('/leads/import/preview', evil, Buffer.from('First Name,Email\nOk,ok@traversal.test\n'));
    assert.strictEqual(status, 200);
    assert.ok(!/[\\/<>]/.test(json.data.filename), `filename sanitized, got: ${json.data.filename}`);
  });

  test('requests without a session are rejected (§41)', async () => {
    const saved = cookie;
    cookie = null;
    const { status } = await upload('/leads/import/preview', 'x.csv', Buffer.from(CSV_GOOD));
    assert.strictEqual(status, 401);
    cookie = saved;
  });
});

// ---------------------------------------------------------------------------
describe('mapping (§44 mapping)', () => {
  let preview;

  test('automatic mapping recognizes header variations', async () => {
    const buf = Buffer.from('first_name,Surname,company,Email Address,Recent Funding\nAsh,Ash,Acme,ash@auto.test,Series B\n');
    const { status, json } = await upload('/leads/import/preview', 'variants.csv', buf);
    assert.strictEqual(status, 200);
    preview = json.data;
    assert.strictEqual(preview.mapping['0'], 'firstName');
    assert.strictEqual(preview.mapping['1'], 'lastName');
    assert.strictEqual(preview.mapping['2'], 'companyName');
    assert.strictEqual(preview.mapping['3'], 'email');
    assert.strictEqual(preview.mapping['4'], 'custom:recent_funding', 'free header becomes a custom variable');
  });

  test('missing email mapping fails validation with 422', async () => {
    const { status, json } = await api('POST', '/leads/import/validate', {
      headers: preview.headers,
      rows: preview.rows,
      mapping: { 0: 'firstName', 3: 'skip' },
    });
    assert.strictEqual(status, 422);
    assert.ok(/email/i.test(json.error));
  });

  test('custom variable mapping validates and stores under the slug', async () => {
    const { status, json } = await api('POST', '/leads/import/validate', {
      headers: preview.headers,
      rows: preview.rows,
      mapping: { 0: 'firstName', 1: 'skip', 2: 'skip', 3: 'email', 4: 'custom:recent_funding' },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.counts.valid, 1);
  });

  test('invalid custom variable slugs are rejected (no code execution, §21)', async () => {
    const { status } = await api('POST', '/leads/import/validate', {
      headers: preview.headers,
      rows: preview.rows,
      mapping: { 0: 'firstName', 3: 'email', 4: 'custom:BAD SLUG; DROP TABLE' },
    });
    assert.strictEqual(status, 422);
  });

  test('"do not import" columns are ignored', async () => {
    const { status, json } = await api('POST', '/leads/import/validate', {
      headers: preview.headers,
      rows: preview.rows,
      mapping: { 0: 'firstName', 1: 'skip', 2: 'skip', 3: 'email', 4: 'skip' },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.counts.valid, 1);
  });
});

// ---------------------------------------------------------------------------
describe('validation (§44 validation) — real counts', () => {
  test('invalid email, missing email, in-file duplicate, normalized duplicate', async () => {
    // dana@orbital.test already imported in the upload describe via nothing yet —
    // this org has no leads, so seed one via the import itself below. For the
    // duplicate-existing case we first import Dana, then re-validate the file.
    const seed = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [['Dana', 'dana@orbital.test']],
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'skip',
    });
    assert.strictEqual(seed.status, 202);
    await waitForJob(seed.json.data.jobId);

    const rows = CSV_GOOD.split('\n').slice(1).map((l) => l.split(','));
    const { status, json } = await api('POST', '/leads/import/validate', {
      headers: ['First Name', 'Last Name', 'Company Name', 'Job Title', 'Email', 'Phone'],
      rows,
      mapping: { 0: 'firstName', 1: 'lastName', 2: 'companyName', 3: 'jobTitle', 4: 'email', 5: 'phone' },
      duplicateStrategy: 'skip',
    });
    assert.strictEqual(status, 200);
    const c = json.data.counts;
    assert.strictEqual(c.totalRows, 5);
    assert.strictEqual(c.invalidEmail, 1, 'not-an-email');
    assert.strictEqual(c.missingEmail, 1, 'empty email row');
    assert.strictEqual(c.duplicateInFile, 1, 'fiona twice');
    assert.strictEqual(c.duplicateExisting, 1, 'dana exists (normalized)');
    assert.strictEqual(c.valid, 1, 'only fiona remains valid');
    const reasons = json.data.errors.map((e) => e.reason).join(' ');
    assert.ok(/Invalid email format/.test(reasons));
    assert.ok(/Missing email/.test(reasons));
    assert.ok(/Duplicate within the uploaded file/.test(reasons));
    assert.ok(/already exists/.test(reasons));
  });

  test('suppressed emails are counted separately and never imported (§26)', async () => {
    await api('POST', '/leads', { firstName: 'Sue', email: 'sue@suppressed.test' });
    // suppress Sue via the bulk API
    const list = await api('GET', '/leads?search=sue@suppressed.test');
    const id = list.json.data[0].id;
    await api('POST', '/leads/bulk/suppress', { leadIds: [id], reason: 'blocked' });

    const { status, json } = await api('POST', '/leads/import/validate', {
      headers: ['First Name', 'Email'],
      rows: [['Sue', 'SUE@suppressed.test'], ['New', 'fresh@suppressed.test']], // normalized match
      mapping: { 0: 'firstName', 1: 'email' },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.data.counts.suppressed, 1, 'normalized email matched suppression');
    assert.strictEqual(json.data.counts.valid, 1);
  });
});

// ---------------------------------------------------------------------------
describe('import job (§44 import) — real async processing', () => {
  test('successful import with per-batch progress and error report', async () => {
    const rows = [['Grace', 'grace@import.test'], ['Hopper', 'hopper@import.test'], ['Bad', 'bad-email']];
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows,
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'skip',
    });
    assert.strictEqual(start.status, 202);
    const jobId = start.json.data.jobId;

    const { json } = await waitForJob(jobId);
    assert.strictEqual(json.data.status, 'completed');
    assert.strictEqual(json.data.totalRows, 3);
    assert.strictEqual(json.data.imported, 2);
    assert.strictEqual(json.data.skipped, 1);

    const errs = await api('GET', `/leads/import/${jobId}/errors`);
    assert.strictEqual(errs.status, 200);
    assert.strictEqual(errs.json.data.length, 1);
    assert.strictEqual(errs.json.data[0].email, 'bad-email');
    assert.match(errs.json.data[0].reason, /Invalid email/);

    const list = await api('GET', '/leads?search=import.test');
    assert.strictEqual(list.json.data.length, 2, 'leads persisted');
  });

  test('duplicate strategy "update" refreshes an existing lead', async () => {
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [['Grace-Marian', 'grace@import.test']],
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'update',
    });
    const { json } = await waitForJob(start.json.data.jobId);
    assert.strictEqual(json.data.status, 'completed');
    const list = await api('GET', '/leads?search=grace@import.test');
    assert.strictEqual(list.json.data.length, 1, 'no duplicate row created');
    assert.strictEqual(list.json.data[0].firstName, 'Grace-Marian');
  });

  test('partial failures do not roll back good rows (per-row resilience)', async () => {
    // 'bad..double@' passes the import's syntax gate but fails the model's
    // stricter isEmail validator at insert time → honest failed counter.
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [['Ok', 'ok@partial.test'], ['Bad', 'bad..double@partial.test']],
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'skip',
    });
    const { json } = await waitForJob(start.json.data.jobId);
    assert.strictEqual(json.data.imported, 1);
    assert.strictEqual(json.data.failed, 1);
    assert.strictEqual(json.data.skipped, 0);
    const errs = await api('GET', `/leads/import/${start.json.data.jobId}/errors`);
    assert.strictEqual(errs.json.data.length, 1, 'failure recorded in the error report');
    const list = await api('GET', '/leads?search=ok@partial.test');
    assert.strictEqual(list.json.data.length, 1, 'good row survived');
  });

  test('campaign enrollment: import with campaignId enrolls recipients (§34)', async () => {
    const camp = await api('POST', '/campaigns', { name: 'Import Enroll' });
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [['Enroll', 'enrolled@import.test']],
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'skip',
      campaignId: camp.json.data.id,
    });
    const { json } = await waitForJob(start.json.data.jobId);
    assert.strictEqual(json.data.imported, 1);
    const recipients = await api('GET', `/campaigns/${camp.json.data.id}/recipients`);
    assert.ok(recipients.status === 200, 'recipients endpoint');
    const list = recipients.json.data || recipients.json.data?.data || recipients.json.data?.recipients || [];
    assert.ok((Array.isArray(list) ? list : list.data || []).some((r) => r.email === 'enrolled@import.test'), 'lead enrolled into campaign');
  });

  test('import into another org\'s campaign is 404', async () => {
    const camp = await api('POST', '/campaigns', { name: 'Org A Campaign' });
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [['X', 'x@cross.test']],
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'skip',
      campaignId: camp.json.data.id,
    }, 'b'); // org B posting org A's campaignId
    assert.strictEqual(start.status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('security (§44 security)', () => {
  test('tenant isolation: org B sees zero org A leads', async () => {
    const list = await api('GET', '/leads', undefined, 'b');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.json.pagination.total, 0);
  });

  test('tenant isolation: org B cannot read org A import job or errors', async () => {
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [['Iso', 'iso@import.test']],
      mapping: { 0: 'firstName', 1: 'email' },
    });
    const jobId = start.json.data.jobId;
    await waitForJob(jobId);
    const other = await api('GET', `/leads/import/${jobId}`, undefined, 'b');
    assert.strictEqual(other.status, 404);
    const otherErrs = await api('GET', `/leads/import/${jobId}/errors`, undefined, 'b');
    assert.strictEqual(otherErrs.status, 404);
  });

  test('unauthorized import (no session) is 401', async () => {
    const saved = cookie;
    cookie = null;
    const { status } = await api('POST', '/leads/import', { headers: ['Email'], rows: [['a@b.test']], mapping: { 0: 'email' } });
    assert.strictEqual(status, 401);
    cookie = saved;
  });

  test('XSS content in a spreadsheet is stored as inert text', async () => {
    const xss = '<script>alert(1)</script>';
    const start = await api('POST', '/leads/import', {
      headers: ['First Name', 'Email'],
      rows: [[xss, 'xss@import.test']],
      mapping: { 0: 'firstName', 1: 'email' },
    });
    const { json } = await waitForJob(start.json.data.jobId);
    assert.strictEqual(json.data.imported, 1);
    const list = await api('GET', '/leads?search=xss@import.test');
    assert.strictEqual(list.json.data[0].firstName, xss, 'stored literally — rendering is React-escaped');
  });
});

// ---------------------------------------------------------------------------
describe('concurrency (§44 concurrency)', () => {
  test('two simultaneous imports do not corrupt lead data', async () => {
    const mk = (suffix) => ({
      headers: ['First Name', 'Email'],
      rows: [
        [`Con-A${suffix}`, `cona${suffix}@concurrent.test`],
        [`Con-B${suffix}`, `conb${suffix}@concurrent.test`],
        ['Shared', 'shared@concurrent.test'],
      ],
      mapping: { 0: 'firstName', 1: 'email' },
      duplicateStrategy: 'skip',
    });

    const [r1, r2] = await Promise.all([api('POST', '/leads/import', mk(1)), api('POST', '/leads/import', mk(2))]);
    assert.strictEqual(r1.status, 202);
    assert.strictEqual(r2.status, 202);
    const [j1, j2] = await Promise.all([waitForJob(r1.json.data.jobId), waitForJob(r2.json.data.jobId)]);
    const importedSum = j1.json.data.imported + j2.json.data.imported;
    const failedSum = j1.json.data.failed + j2.json.data.failed;
    // 4 unique suffix rows + the shared row created exactly once. The losing
    // insert hits the unique index and is reported honestly as failed —
    // data stays consistent either way.
    assert.strictEqual(importedSum, 5, `expected 5 imported, got ${importedSum}`);
    assert.strictEqual(failedSum, 1, 'the duplicate shared insert is reported as failed, not silently lost');
    assert.ok(j1.json.data.skipped + j2.json.data.skipped === 0);

    const shared = await api('GET', '/leads?search=shared@concurrent.test');
    assert.strictEqual(shared.json.data.length, 1, 'no duplicate shared lead');
    const all = await api('GET', '/leads?search=concurrent.test&pageSize=100');
    assert.strictEqual(all.json.data.length, 5, 'lead table consistent');
  });
});
