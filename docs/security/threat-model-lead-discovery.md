# Security Threat Model - Lead Discovery

## Overview

This document describes the threat model for the Lead Discovery feature
of the B2B Lead Intelligence Platform.

## Threat Model Methodology

STRIDE-style analysis:
- Spoofing
- Tampering
- Repudiation
- Information Disclosure
- Denial of Service
- Elevation of Privilege

## Threats

### 1. SSRF (Server-Side Request Forgery)

**Threat:** User submits a URL that points to internal infrastructure
(localhost, private IPs, cloud metadata endpoints).

**Impact:** Information disclosure, internal network reconnaissance,
potential credential theft from metadata endpoints.

**Mitigation:**
- SSRF validation on all URLs (scheme, hostname, resolved IP)
- Block private IP ranges (RFC 1918, loopback, link-local)
- Block cloud metadata endpoints
- Validate redirect destinations
- DNS resolution checked against private ranges
- Timeout and response size limits

**Severity:** Critical

### 2. IDOR/BOLA (Broken Object Level Authorization)

**Threat:** User A accesses Organization B's lead search, company, contact,
or lead data by manipulating resource IDs.

**Impact:** Information disclosure, unauthorized data modification.

**Mitigation:**
- Every query filters by organization_id derived from authenticated session
- organization_id from frontend is never trusted
- 404 returned for unauthorized resources (no enumeration)
- Repository layer enforces tenant isolation

**Severity:** Critical

### 3. Mass Assignment

**Threat:** User submits unexpected fields (organization_id, role, is_admin)
to modify data they shouldn't have access to.

**Impact:** Privilege escalation, data modification.

**Mitigation:**
- Explicit Pydantic request schemas
- Only allowed fields accepted
- Extra fields ignored/rejected

**Severity:** High

### 4. SQL Injection

**Threat:** User submits malicious SQL in search parameters, company names,
or other input fields.

**Impact:** Data disclosure, data modification, potential remote code execution.

**Mitigation:**
- SQLAlchemy parameterized queries only
- No string concatenation in SQL
- Pydantic input validation

**Severity:** Critical

### 5. Rate Abuse

**Threat:** User sends excessive requests to discovery endpoints,
consuming resources and potentially causing denial of service.

**Impact:** Service degradation, resource exhaustion.

**Mitigation:**
- Rate limiting per IP (authenticated: 120/min, AI: 30/min)
- Response size limits (5 MB)
- Request timeout (15 seconds)
- Redirect limits (5)

**Severity:** Medium

### 6. Authentication Bypass

**Threat:** User accesses protected endpoints without valid authentication.

**Impact:** Unauthorized data access.

**Mitigation:**
- JWT access tokens via HttpOnly cookies
- Token validation on every protected endpoint
- 401 returned for unauthenticated requests

**Severity:** Critical

### 7. Prompt Injection

**Threat:** Crawled website content contains malicious instructions that
could influence AI analysis.

**Impact:** Incorrect business intelligence, data corruption.

**Mitigation:**
- SYSTEM PROMPT separated from untrusted web content
- AI output validated with Pydantic schemas
- Website content treated as untrusted data only

**Severity:** Medium

### 8. Data Enumeration

**Threat:** User discovers whether resources exist by observing different
error messages.

**Impact:** Information disclosure about data existence.

**Mitigation:**
- Generic error messages (404 for both existing and non-existing resources)
- Same error for wrong password vs non-existent account
- Consistent error responses

**Severity:** Low

## Security Requirements

| Requirement | Description | Priority |
|-------------|-------------|----------|
| SSRF protection | Block internal URLs and metadata endpoints | Critical |
| Tenant isolation | Enforce organization_id on all queries | Critical |
| SQL injection prevention | Parameterized queries only | Critical |
| Rate limiting | Protect against abuse | High |
| Authentication | Server-controlled sessions | Critical |
| Authorization | RBAC enforcement | High |
| Audit logging | Log security events | High |
| Input validation | Pydantic schemas for all input | High |
| Output sanitization | No sensitive data in responses | Medium |

## Security Testing

### SSRF Tests
- localhost blocked
- 127.0.0.1 blocked
- ::1 blocked
- Private IPv4 ranges blocked
- Private IPv6 ranges blocked
- Cloud metadata endpoints blocked
- Redirect to private IP blocked
- Invalid URLs rejected

### IDOR/BOLA Tests
- User A cannot access Organization B's resources
- 404 returned for cross-org access
- No resource existence enumeration

### Authentication Tests
- Unauthenticated requests rejected (401)
- Expired tokens rejected (401)
- Revoked tokens rejected (401)

### Authorization Tests
- Wrong role rejected (403)
- Wrong organization rejected (403/404)

### Mass Assignment Tests
- organization_id field ignored
- is_admin field ignored
- role field ignored
