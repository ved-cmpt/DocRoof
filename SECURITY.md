# Security

DocRoof is a portfolio project built with production-style controls. It has **not** been audited or penetration
tested by a third party. Please report issues through the repository's issue tracker.

## Intentionally public demo credentials

These values exist only for local development and are **not secrets**:

| Value | Where | Purpose |
| --- | --- | --- |
| `DocRoof_Local_Dev_2026!` | `docker-compose.yml`, `appsettings.Development.json`, `.env.example` | SA password of the local SQL Server container bound to `127.0.0.1:14330` |
| `DocRoof_CI_Only_2026!` | `.github/workflows/ci.yml` | SA password of the throw-away SQL Server container in CI |
| `DocRoofDemo2026` | `appsettings.Development.json` (`Database:SampleUserPassword`) | Password of the five fictional sample-workspace accounts (`controller.sample@docroof.test`, `manager.sample@…`, `reviewer.sample@…`, `reviewer2.sample@…`, `requester.sample@…`) |

Hosted deployments must not set `Database:SampleUserPassword`; visitors use the guest demo, which has no passwords.
Real secrets (connection string, IP-hash salt, optional extraction key) come from environment variables.

## Threat model (summary)

| Asset | Threat | Controls | Tested by |
| --- | --- | --- | --- |
| Other tenants'/projects' documents | ID guessing, IDOR | Membership check in the caller's tenant on every service call; 404 for non-members; storage keys never derived from input | `MustPass1_*`, `Other_tenants_get_404_*`, `Project_non_member_*` |
| Revision history | Tampering with stored versions | No update path in services; EF interceptor; `trg_DocumentRevisions_Immutable` | `MustPass2_*`, `Database_trigger_*`, `Ef_interceptor_*` |
| Audit trail | Edits to hide actions | Append-only trigger; writes in the same transaction as the change | `Audit_events_cannot_be_updated`, rollback test |
| Server and visitors | Malicious uploads (executables, polyglots, scripts in PDFs, path tricks) | Magic-byte allow-list, extension must match content, size limit, generated keys + path containment, sanitized names, active-content PDFs download-only, `nosniff` + sandbox CSP on files, pdf.js preview without document scripts | `MustPass3_*`, `Pdf_with_embedded_javascript_*`, `Path_traversal_*`, storage unit tests |
| Workflow integrity | Wrong role, replay, races | Pure state machines, role checks, rowversion, unique `(SubmittalId, Cycle)`; 403/409 without side effects | `MustPass4_*`, `Stale_rowversion_*`, `Concurrent_approvals_*` |
| Application logic | Prompt injection via document text | Text is data; extraction can only add suggestions; humans accept values | `MustPass6_*`, extraction unit tests |
| Sessions | CSRF, cookie theft | `HttpOnly`, `Secure`, `SameSite=Strict` cookies; antiforgery header on every unsafe method incl. login | `Every_unsafe_api_endpoint_requires_an_antiforgery_token`, `Production_sends_hsts_*` |
| Accounts | Credential stuffing, enumeration | Rate limit on login, lockout after 5 failures (15 min), identical responses and equalized hashing for unknown accounts | `Login_is_rate_limited_*`, `Accounts_lock_*`, `Login_succeeds_*` |
| Shared hosting | Demo abuse, storage exhaustion | Per-IP (hashed) and global workspace caps, demo rate limit, guest upload quota (30 files / 60 MB), 24 h cleanup | `Guest_workspaces_are_limited_*`, `Guest_upload_quota_*`, `Expired_guest_workspaces_*` |
| Browser | XSS, clickjacking | Angular escaping; CSP `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`; `X-Frame-Options: DENY`; TXT shown as escaped text | `Responses_carry_security_headers` |

## Controls in place

- **Authentication:** ASP.NET Core Identity with cookie auth (8 h sliding); lockout; generic login errors.
- **CSRF:** antiforgery token (`X-XSRF-TOKEN`) required on all POST/PUT/PATCH/DELETE API routes, verified by a test
  that enumerates every route.
- **Authorization:** fallback policy requires authentication; services check membership and project role; frontend
  hiding is only an affordance.
- **Rate limits:** login (10/min per IP), demo creation (10/h per IP + 5 workspaces/h per hashed IP), uploads (30/5 min
  per user), extraction (20/5 min per user), global (600/min per IP). Values are configurable.
- **Headers:** CSP, HSTS (1 year, subdomains) in production, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
  `Cache-Control: no-store` for API responses. Response compression is enabled for static assets only (not API JSON).
- **Errors:** RFC 7807 ProblemDetails without stack traces or SQL text; unexpected errors are logged server-side.
- **Data:** foreign keys, check constraints and unique indexes; transactions around every mutation.

## Dependency audit (2026-11-15)

| Command | Result |
| --- | --- |
| `dotnet list api/DocRoof.slnx package --vulnerable --include-transitive` | no vulnerable packages in any project |
| `npm audit --omit=dev` (before fix) | 1 high: `pdfjs-dist` 5.7.284, GHSA-hq66-cqwq-w95j (arbitrary JavaScript execution when opening a malicious PDF) |
| upgrade to `pdfjs-dist@6.5.438`, then `npm audit --omit=dev` | **0 vulnerabilities** |

The `Microsoft.OpenApi` 2.0.0 package pulled in by the template had a known high-severity advisory; it is pinned to
2.13.0.

## Known gaps

- No malware/antivirus scanning of uploads.
- No OCR; image-only PDFs cannot be searched or extracted.
- Style CSP allows `'unsafe-inline'` because Angular injects component styles at runtime.
- Active-content detection in PDFs is a heuristic name scan of raw and Flate-decoded streams; it is a safety net, not
  a sanitizer. Such PDFs are still stored (download-only).
- The hosted database firewall must accept public TLS connections on Render's free plan (no static egress IPs).
- Rate limits are per process (in-memory); a multi-instance deployment would need a distributed limiter.
- No third-party security review.
