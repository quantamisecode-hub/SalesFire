# Architecture - B2B Lead Intelligence Platform

## System Overview

The B2B Lead Intelligence Platform is a security-first, AI-powered B2B lead
intelligence and sales platform. The architecture follows a strict
frontend/backend security boundary where the frontend is an untrusted client
and all sensitive operations happen on the backend.

## High-Level Architecture

```
React Frontend (Untrusted)
      ↓ HTTPS (HttpOnly cookies)
FastAPI Backend
      ↓
Service Layer (Authentication, Authorization, Validation, Rate Limiting)
      ↓
Repository Layer (Parameterized SQL queries)
      ↓
MySQL 8 (Backend only)

AI Providers (Backend only)
- Ollama (Primary)
- Groq, OpenRouter, Gemini (Optional fallbacks)

Crawler (Backend only)
- httpx + BeautifulSoup + lxml
- SSRF protection
- robots.txt awareness
```

## Security Boundaries

### Frontend/Backend Boundary
- Frontend has ZERO database credentials
- Frontend has ZERO AI provider API keys
- Frontend communicates ONLY with backend API via HTTPS
- Authentication tokens in HttpOnly, SameSite cookies
- Frontend JavaScript cannot read authentication cookies

### Backend/Database Boundary
- MySQL credentials exist only on backend
- Least-privilege database user (not root)
- Migration credentials separate from runtime credentials
- Parameterized queries only (no string concatenation)

### Backend/AI Provider Boundary
- AI API keys backend-only
- Frontend never communicates directly with AI providers
- AI output validated with Pydantic schemas

### Backend/Crawler Boundary
- SSRF protection on all URLs
- robots.txt awareness
- Rate limiting and timeouts
- No JavaScript execution

## Module Architecture

### Authentication Module
- Argon2id password hashing
- JWT access tokens (15 min) + refresh tokens (7 days)
- Refresh token rotation with family detection
- Token revocation
- Rate limiting on login/register (5/min, 3/min)
- Generic error messages (no user enumeration)

### Authorization Module
- RBAC: OWNER, ADMIN, MEMBER, VIEWER
- Tenant isolation via organization_id
- Every endpoint verifies: authenticated → organization → permission → resource

### Multi-Tenancy
- Organizations are top-level tenant boundary
- Every tenant-owned resource has organization_id
- Repository layer enforces organization_id filtering
- Cross-organization access returns 404 (no enumeration)

### Crawler Module
- SSRF protection on all URLs
- robots.txt awareness
- Rate limiting, timeouts, max pages/depth
- No JavaScript execution
- Content-type validation

### AI Module
- Provider abstraction (Ollama, Groq, OpenRouter, Gemini)
- Provider selection backend-only
- Structured output validation with Pydantic
- Prompt injection defense (SYSTEM PROMPT separated from untrusted content)
- Fallback only for connection failure/timeout

### Lead Discovery Module
- Company discovery from public sources
- Company normalization and deduplication
- Company qualification against ICP
- Decision-maker discovery
- Public business email discovery
- Email validation
- Suppression checking
- ICP scoring with explainable breakdown
- Lead creation with audit logging

## Security Headers

- Content-Security-Policy (restrictive)
- Strict-Transport-Security (production)
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- X-Frame-Options: DENY
- Permissions-Policy (restricted features)

## Error Handling

- Generic error responses (no stack traces)
- No SQL query exposure
- No filesystem path exposure
- Consistent error format with request ID
- Development may log detailed diagnostics locally

## Audit Logging

Security-sensitive events logged:
- Login success/failure
- Password change/reset
- Role/permission changes
- Lead export/bulk deletion
- Campaign actions

## Prompt 6 — Campaign & Outreach Engine (Node.js + self-hosted SMTP)

Detailed docs:

- [Campaign engine](./campaign-engine.md) — lifecycle, queue/worker, suppression, unsubscribe, AI personalization
- [Email sending](./email-sending.md) — SMTP account management, credential encryption, tests
- [Self-hosted SMTP](./smtp.md) — Postfix setup, deliverability, testing
- Migration: `backend-node/migrations/001-prompt6-campaign-engine.sql` (MySQL 8)
- Security failures

Fields: timestamp, organization_id, user_id, action, resource_type,
resource_id, IP, request_id, result

## Encryption

- Passwords: Argon2id hashed (never encrypted)
- Sensitive recoverable data: AES-256-GCM encrypted
- Encryption keys stored separately from encrypted data

## Rate Limiting

- Login: 5/minute
- Register: 3/minute
- Forgot password: 3/minute
- Authenticated: 120/minute
- AI: 30/minute
- Crawler: 10/minute
- Export: 5/minute

## CORS

- Allowed origins from configuration only
- No wildcard origins with credentials
- No arbitrary Origin reflection

## Dependencies

Backend:
- FastAPI 0.115.0
- SQLAlchemy 2.0.36
- Pydantic 2.9.2
- passlib[bcrypt] 1.7.4
- PyJWT 2.9.0
- cryptography 43.0.0
- httpx 0.27.0
- alembic 1.13.2
- asyncmy 0.2.10

Frontend:
- React 18.3.1
- TypeScript 5.6.3
- Vite 5.4.11
- React Router 6.27.0
- TanStack Query 5.62.0
- React Hook Form 7.53.0
- Zod 3.24.0
- Lucide React 0.468.0

## Testing

Backend:
- pytest, pytest-asyncio, pytest-cov
- Unit, integration, security tests
- 90%+ coverage target

Frontend:
- Vitest, React Testing Library
- Unit, integration tests
- 80%+ coverage target

E2E:
- Playwright

Security Scanning:
- Bandit (Python)
- pip-audit (Python dependencies)
- npm audit (Frontend dependencies)
- Ruff (Python linting)
- mypy (Python type checking)
- ESLint (Frontend linting)
- TypeScript strict mode
