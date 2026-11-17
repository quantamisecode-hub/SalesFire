# Bug Tracking

## Bug Report Template

Each bug should have the following fields:

| Field | Description |
|-------|-------------|
| ID | Unique bug identifier (BUG-YYYY-MM-DD-NNN) |
| Title | Short descriptive title |
| Severity | Critical, High, Medium, Low, Informational |
| Environment | Development, Staging, Production |
| Steps to Reproduce | Numbered steps to reproduce |
| Expected Result | What should happen |
| Actual Result | What actually happens |
| Root Cause | Underlying cause |
| Fix | Description of the fix |
| Regression Test | Test added to prevent recurrence |
| Status | Open, In Progress, Fixed, Verified, Closed |

## Severity Levels

| Severity | Description | Release Blocking |
|----------|-------------|------------------|
| Critical | Security vulnerability, data loss, system crash | Yes |
| High | Major functionality broken, major security issue | Yes |
| Medium | Minor functionality broken, minor security issue | No |
| Low | Cosmetic issue, minor inconvenience | No |
| Informational | Documentation improvement, suggestion | No |

## Bug Lifecycle

1. **Open** - Bug reported and confirmed
2. **In Progress** - Fix being developed
3. **Fixed** - Fix implemented, awaiting verification
4. **Verified** - Fix verified with regression test
5. **Closed** - Bug resolved and released

## Bug Management Rules

- Every bug fix must include a regression test
- Critical/High vulnerabilities must block release unless explicitly accepted
- Do not hide bugs - all bugs must be documented
- Run full regression suite after every fix

## Known Issues

None currently tracked.

## Bug Report Example

```markdown
# BUG-2024-01-15-001: SSRF vulnerability in crawler

## Severity
Critical

## Environment
Development

## Steps to Reproduce
1. Register and login as a user
2. Navigate to AI Sales Agent
3. Enter URL: http://169.254.169.254 in website field
4. Start research
5. Observe internal metadata returned

## Expected Result
URL blocked by SSRF protection

## Actual Result
Cloud metadata returned

## Root Cause
SSRF validation not checking cloud metadata endpoints

## Fix
Added cloud metadata host check to is_url_safe()

## Regression Test
test_ssrf_metadata_endpoint_blocked in test_security.py

## Status
Fixed
```
