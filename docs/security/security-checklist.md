# Security Checklist - Feature Completion

## Pre-Feature Checklist

Before implementing any feature:

- [ ] Threat model documented (STRIDE analysis)
- [ ] Security requirements identified
- [ ] Authentication requirements defined
- [ ] Authorization requirements defined
- [ ] Multi-tenant isolation requirements defined
- [ ] Input validation requirements defined
- [ ] Output handling requirements defined
- [ ] Audit logging requirements defined
- [ ] Rate limiting requirements defined
- [ ] Error handling requirements defined

## Implementation Checklist

During implementation:

- [ ] Authentication verified (server-controlled session/token)
- [ ] Authorization verified (RBAC + tenant isolation)
- [ ] Input validation verified (Pydantic schemas)
- [ ] Output handling verified (no sensitive data exposure)
- [ ] SQL injection checked (parameterized queries only)
- [ ] XSS checked (no dangerous HTML rendering)
- [ ] CSRF checked (SameSite cookies + CSRF tokens)
- [ ] SSRF checked (URL validation, private IP blocking)
- [ ] Rate limiting checked (per endpoint limits)
- [ ] Sensitive information exposure checked (no secrets in responses)
- [ ] Audit logging checked (security events logged)

## Testing Checklist

- [ ] Unit tests written (positive, negative, edge cases)
- [ ] Integration tests written (full API flows)
- [ ] Security tests written (auth, authorization, IDOR, SQLi, SSRF, XSS, CSRF)
- [ ] E2E tests written (critical user flows)
- [ ] Coverage meets threshold (backend 90%, frontend 80%, security 95%+)
- [ ] Regression tests added

## Pre-Commit Checklist

- [ ] No secrets in code (DATABASE_URL, JWT_SECRET, API keys, etc.)
- [ ] No frontend database credentials
- [ ] No frontend AI API keys
- [ ] No frontend localStorage tokens
- [ ] All environment variables documented in .env.example
- [ ] .gitignore excludes .env files
- [ ] Linting passes
- [ ] Type checking passes
- [ ] Security scanning passes (bandit, pip-audit, npm audit)
- [ ] Tests pass
- [ ] Coverage meets threshold

## Feature Completion Checklist

Before marking any feature COMPLETE:

- [ ] Authentication verified
- [ ] Authorization verified
- [ ] Tenant isolation verified
- [ ] Input validation verified
- [ ] Output handling verified
- [ ] SQL injection checked
- [ ] XSS checked
- [ ] CSRF checked where applicable
- [ ] SSRF checked where applicable
- [ ] Rate limiting checked
- [ ] Sensitive information exposure checked
- [ ] Audit logging checked
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] Security tests written
- [ ] E2E tests written where applicable
- [ ] Coverage meets threshold
- [ ] Regression tests added
- [ ] Documentation updated

## Security Testing Checklist

- [ ] Authentication tests (valid, invalid, rate limit, session expiration)
- [ ] Authorization tests (RBAC, tenant isolation, resource access)
- [ ] IDOR/BOLA tests (cross-user resource access)
- [ ] SQL injection tests (search, filters, sort, pagination, IDs)
- [ ] XSS tests (stored, reflected, DOM)
- [ ] CSRF tests (cross-site POST, PUT, PATCH, DELETE)
- [ ] SSRF tests (localhost, private IPs, metadata endpoints, redirects)
- [ ] CORS tests (wildcard, credentials, origins)
- [ ] Rate limit tests (login, register, AI, crawler, export)
- [ ] Session tests (expiration, revocation, rotation)
- [ ] Password tests (strength, reset, single-use tokens)
- [ ] Secret exposure tests (no secrets in frontend/bundle)
- [ ] File upload tests (extension, MIME, magic bytes, path traversal)
- [ ] AI prompt injection tests (system prompt separation)
- [ ] Tenant isolation tests (cross-organization access)
