# Security

DocRoof is a portfolio project. It is built with production-style controls, but it has not been audited or
penetration tested. Please report issues through the repository's issue tracker.

## Intentionally public demo credentials

These values exist only for local development and are **not secrets**:

| Value | Where | Purpose |
| --- | --- | --- |
| `DocRoof_Local_Dev_2026!` | `docker-compose.yml`, `appsettings.Development.json`, `.env.example` | SA password of the local SQL Server container bound to `127.0.0.1:14330` |
| `DocRoofDemo2026` | `appsettings.Development.json` (`Database:SampleUserPassword`) | Password of the five fictional sample-workspace accounts (`controller.sample@docroof.test`, `manager.sample@…`, `reviewer.sample@…`, `reviewer2.sample@…`, `requester.sample@…`) |

Production deployments must not set `Database:SampleUserPassword`; hosted visitors use the guest demo, which has
no passwords at all. Real secrets (connection strings, salts) are supplied through environment variables.

## Controls in place (Phase 1)

- **Authentication:** ASP.NET Core Identity, cookie `HttpOnly`, `SameSite=Strict`, `Secure` outside development,
  8 h sliding expiry; lockout after 5 failed attempts for 15 minutes; login responses are identical for unknown
  accounts and wrong passwords, and unknown accounts still run a password hash to equalize timing.
- **CSRF:** antiforgery token required on every unsafe API method (header `X-XSRF-TOKEN`), including login.
- **Authorization:** fallback policy requires authentication; every project-scoped service call checks membership
  in the caller's tenant and the required project role. Cross-tenant/cross-project IDs return 404.
- **Guest isolation:** each visitor gets a separate tenant; persona switching is limited to the caller's guest
  tenant; expired tenants and their files are deleted; per-IP quota (5/hour, stored as a salted hash) and a global
  cap on active workspaces.
- **Uploads:** magic-byte allow-list (PDF/TXT/PNG/JPG), explicit executable rejection, extension must match content,
  25 MB limit, SHA-256 checksum, generated storage keys (`t/{tenant}/{guid}`) with path-containment checks, sanitized
  display names (path segments, control and bidi characters, reserved device names removed).
- **Files out:** downloads are streamed as attachments with `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`; PDFs with active content are download-only; previews are
  rendered by pdf.js without executing document scripts.
- **Integrity:** immutable revisions (service + EF interceptor + SQL trigger); append-only audit events (SQL
  trigger); rowversion concurrency on mutable aggregates.
- **Headers:** CSP for the app (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`),
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`, `Cache-Control: no-store` on API responses, HSTS outside development.
- **Abuse:** rate limits for login, demo creation, uploads, extraction and a global per-IP ceiling.
- **Errors:** ProblemDetails without stack traces or SQL text; unexpected errors are logged server-side.
- **Untrusted content:** uploaded text is treated as data only. Nothing in a document can trigger an action.

## Threat model and known gaps

The full threat model and dependency-audit results are added in Phase 3. Known gaps today:

- No malware/antivirus scanning of uploads.
- No OCR; image-only PDFs cannot be searched or extracted.
- Style CSP allows `'unsafe-inline'` because Angular injects component styles at runtime.
- Active-content detection is heuristic (name-token scan of raw and Flate-decoded streams); it is a safety net, not
  a PDF sanitizer.
