# B2B Lead Intelligence Platform - Lead Discovery Documentation

## Overview

The Lead Discovery engine allows users to discover, qualify, and score leads
matching their Ideal Customer Profile (ICP). This document describes the
architecture, data models, APIs, and security controls for the lead discovery
feature.

## Architecture

```
Lead Finder UI
      ↓
FastAPI Backend
      ↓
LeadDiscoveryService
      ↓
DiscoveryProvider (Public Website / User Provided)
      ↓
Company Discovery → Normalization → Deduplication → Qualification
      ↓
Decision-Maker Discovery → Email Discovery → Email Validation
      ↓
Suppression Check → ICP Scoring → Lead Creation
      ↓
SQLAlchemy → MySQL 8
```

## Database Models

### ResearchJob
Tracks research/crawl jobs with status, progress, and results.

### ResearchSource
Tracks source URLs discovered during research with crawl status.

### ResearchPage
Stores extracted page content (title, headings, paragraphs, raw text).

### ResearchEvidence
Stores evidence extracted from pages supporting Business Brain facts.

### BusinessBrain / BusinessBrainVersion / BusinessBrainFact
Persistent structured business intelligence with versioning and evidence.

### ICP / ICPVersion / ICPLeadScore
Ideal Customer Profiles with versioning and historical lead score preservation.

### Lead / Company / Contact / LeadList / LeadListItem / Suppression
Core lead intelligence data models with full tenant isolation.

## API Endpoints

### Lead Search Management

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/v1/lead-discovery/searches | Create a lead search | Yes |
| GET | /api/v1/lead-discovery/searches | List lead searches | Yes |
| GET | /api/v1/lead-discovery/searches/{id} | Get a lead search | Yes |
| POST | /api/v1/lead-discovery/searches/{id}/start | Start discovery pipeline | Yes |
| GET | /api/v1/lead-discovery/searches/{id}/progress | Get search progress | Yes |
| DELETE | /api/v1/lead-discovery/searches/{id} | Delete a lead search | Yes |

### Companies

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/v1/lead-discovery/companies | List companies | Yes |
| GET | /api/v1/lead-discovery/companies/{id} | Get a company | Yes |

### Contacts

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/v1/lead-discovery/contacts | List contacts | Yes |
| GET | /api/v1/lead-discovery/contacts/{id} | Get a contact | Yes |

### Leads

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/v1/lead-discovery/leads | List leads | Yes |
| GET | /api/v1/lead-discovery/leads/{id} | Get a lead | Yes |

### ICP Scoring

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/v1/icps/{icp_id}/score | Score a lead against ICP | Yes |
| POST | /api/v1/icps/{icp_id}/score-lead/{lead_id} | Score and save lead | Yes |
| GET | /api/v1/icps/{icp_id}/weights | Get ICP scoring weights | Yes |

### Discovery Providers

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/v1/lead-discovery/providers | List available providers | Yes |

## Security Controls

### Tenant Isolation
Every query filters by `organization_id` derived from the authenticated
session/token. Organization_id from the frontend is never trusted.

### SSRF Protection
All URLs submitted for crawling are validated against SSRF rules:
- Only HTTP/HTTPS schemes allowed
- Private IP ranges blocked (RFC 1918, loopback, link-local)
- Cloud metadata endpoints blocked
- Redirect destinations validated
- DNS resolution checked against private ranges

### Rate Limiting
Rate limits applied per IP and per user:
- Authenticated endpoints: 120 requests/minute
- AI/research endpoints: 30 requests/minute

### Input Validation
All input validated via Pydantic schemas. Mass assignment prevented by
using explicit field lists.

### Authentication & Authorization
- JWT access tokens (15 min expiry) via HttpOnly cookies
- JWT refresh tokens (7 day expiry) with rotation
- Token family detection for theft prevention
- RBAC: OWNER, ADMIN, MEMBER, VIEWER roles

### Audit Logging
All security-sensitive events logged with:
- Timestamp, organization_id, user_id
- Action, resource_type, resource_id
- IP address, request_id, result (success/failure)

## ICP Scoring Algorithm

Scoring weights (must sum to 100):
- Industry: 20
- Geography: 15
- Company Size: 15
- Job Title: 20
- Service Relevance: 20
- Buying Signals: 10

Each criterion is scored independently (0 to weight) with match level
(full/partial/unknown/none) and confidence score.

## Data Flow

1. User creates a lead search with ICP and filters
2. System discovers companies from public sources
3. Companies are normalized and deduplicated
4. Companies are qualified against ICP criteria
5. Decision-makers are discovered for qualified companies
6. Emails are discovered and validated
7. Suppressions are checked
8. Leads are scored against ICP
9. Leads are created in the database
10. User reviews and approves leads
11. Leads are added to lead lists for campaigns

## Concurrency

- Optimistic locking not yet implemented (future enhancement)
- Database transactions used for multi-table operations
- Race conditions handled via database constraints
