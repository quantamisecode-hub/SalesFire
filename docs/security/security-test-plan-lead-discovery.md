# Security Test Plan - Lead Discovery

## Overview

This document describes the security testing plan for the Lead Discovery
feature of the B2B Lead Intelligence Platform.

## Test Categories

### 1. Authentication Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| AUTH-01 | Unauthenticated request to search creation | 401 Unauthorized |
| AUTH-02 | Unauthenticated request to lead listing | 401 Unauthorized |
| AUTH-03 | Expired session token | 401 Unauthorized |
| AUTH-04 | Revoked session token | 401 Unauthorized |

### 2. Authorization Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| AUTHZ-01 | User A accesses Organization B's search | 403 or 404 |
| AUTHZ-02 | User A accesses Organization B's company | 403 or 404 |
| AUTHZ-03 | User A accesses Organization B's contact | 403 or 404 |
| AUTHZ-04 | User A accesses Organization B's lead | 403 or 404 |
| AUTHZ-05 | VIEWER role cannot create search | 403 Forbidden |
| AUTHZ-06 | VIEWER role cannot delete search | 403 Forbidden |

### 3. IDOR/BOLA Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| IDOR-01 | GET another org's search by ID | 404 Not Found |
| IDOR-02 | PUT another org's search | 404 Not Found |
| IDOR-03 | DELETE another org's search | 404 Not Found |
| IDOR-04 | GET another org's company | 404 Not Found |
| IDOR-05 | GET another org's contact | 404 Not Found |
| IDOR-06 | GET another org's lead | 404 Not Found |

### 4. SQL Injection Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SQLI-01 | SQL injection in search name | 400/422/401 |
| SQLI-02 | SQL injection in company filters | 400/422/401 |
| SQLI-03 | SQL injection in contact filters | 400/422/401 |
| SQLI-04 | SQL injection in search parameters | 400/422/401 |

### 5. SSRF Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SSRF-01 | URL: http://localhost:80 | Blocked (400/422) |
| SSRF-02 | URL: http://127.0.0.1:80 | Blocked (400/422) |
| SSRF-03 | URL: http://[::1]:80 | Blocked (400/422) |
| SSRF-04 | URL: http://10.0.0.1:80 | Blocked (400/422) |
| SSRF-05 | URL: http://172.16.0.1:80 | Blocked (400/422) |
| SSRF-06 | URL: http://192.168.0.1:80 | Blocked (400/422) |
| SSRF-07 | URL: http://169.254.169.254:80 | Blocked (400/422) |
| SSRF-08 | URL: file:///etc/passwd | Blocked (400/422) |
| SSRF-09 | URL: ftp://internal.server | Blocked (400/422) |
| SSRF-10 | URL: gopher://internal.server | Blocked (400/422) |
| SSRF-11 | Redirect to private IP | Blocked (400/422) |

### 6. Mass Assignment Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| MA-01 | organization_id field in request | Ignored |
| MA-02 | is_admin field in request | Ignored |
| MA-03 | role field in request | Ignored |

### 7. Rate Limiting Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| RL-01 | Multiple rapid search creation requests | 429 after limit |
| RL-02 | Rate limit headers present | Retry-After header |

### 8. Generic Error Tests

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| GE-01 | Wrong password vs missing account | Same error message |
| GE-02 | Forgot password for non-existent account | Generic response |

## Test Execution

### Backend Tests

Run all security tests:
```bash
cd /backend
pytest tests/security/ -v
```

### Frontend Security Tests

Verify no secrets in frontend bundle:
```bash
cd /frontend
npm run build
grep -r "DATABASE_URL\|JWT_SECRET\|API_KEY" dist/ || echo "No secrets found"
```

## Coverage Targets

- Backend: 90%+ coverage
- Security-critical code: 95%+ coverage
- Frontend: 80%+ coverage

## CI/CD Integration

Security tests must run in CI pipeline and fail build on:
- Test failures
- Coverage below threshold
- Critical vulnerability detected
- Secret detected in code
