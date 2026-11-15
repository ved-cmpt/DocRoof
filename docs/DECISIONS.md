# Decision log

Short ADR-style entries. Newest last.

## ADR-001 — Three backend projects instead of four
**Decision:** `DocRoof.Domain` (entities, enums, state machines, pure file rules), `DocRoof.Infrastructure` (EF Core,
storage, PDF tools, seeding **and** application services), `DocRoof.Api` (HTTP concerns).
**Why:** the spec allows "Domain/Application" as one layer. Application services are thin orchestration over EF
Core; a separate Application project with repository interfaces would add indirection without testability gains,
because integration tests run against real SQL Server anyway. Pure rules stay in Domain and are unit tested.

## ADR-002 — PdfPig for both generation and extraction
**Decision:** synthetic seed PDFs are written with PdfPig's `PdfDocumentBuilder` (Apache-2.0) using standard-14
fonts; text is extracted with the same library.
**Why:** one permissively licensed dependency, no font files needed on Linux containers, deterministic output. The
builder writes a random trailer `/ID`; `SyntheticPdf` replaces it with a content hash so checksums are stable across
seeds. The "scanned" drawing is a PNG produced by a tiny built-in encoder and embedded as an image-only page.
**Alternatives:** PDFsharp (MIT) needs a font resolver on Linux; QuestPDF's community licence is not OSI-permissive.

## ADR-003 — Guest workspaces are built from a code-defined seed template
**Decision:** the "template" is `SeedLibrary` + `WorkflowSeed` (code). Every tenant — the persistent sample
workspace and each guest workspace — is created by running the same deterministic seeding into a new tenant inside
one transaction; generated file bytes are cached per process and copied per tenant.
**Why:** identical data for every visitor without row-copy code that must track every table, and no shared rows or
files between tenants. Timestamps are relative to "now" so the three overdue items stay overdue.

## ADR-004 — Users belong to one tenant; roles come from project memberships
ASP.NET Core Identity users carry `TenantId`; there are no global roles. `ProjectAccessService` checks membership
inside the caller's tenant on every request: non-members get 404, members with the wrong role get 403.

## ADR-005 — Antiforgery via cookie + header, validated by a global filter
`GET /api/auth/antiforgery` returns the request token and sets a readable `XSRF-TOKEN` cookie; Angular's built-in
XSRF support echoes it in `X-XSRF-TOKEN`. A global MVC filter validates every unsafe method (including login, to
prevent login CSRF). Tokens are identity-bound, so the client refreshes after login, logout and persona switches.

## ADR-006 — Revision immutability enforced three times
Service layer (no update paths), `ImmutabilityInterceptor` (EF), and `trg_DocumentRevisions_Immutable` (SQL). The
trigger is declared with `HasTrigger` so EF Core does not use `OUTPUT` clauses that conflict with triggers.
Approval status is the single mutable column group, changed only by the submittal workflow with an audit event.

## ADR-007 — Same-origin production hosting
The production image serves the Angular build from `wwwroot` with the API, so cookies are first-party
(`SameSite=Strict`, `Secure`, `HttpOnly`) and CORS is not needed. Development uses the Angular proxy on port 4210.

## ADR-008 — Connection strings use 127.0.0.1
`localhost` resolved to IPv6 first on the development machine and timed out against Docker's IPv4-only loopback
binding, so local connection strings use `127.0.0.1,14330`.

## ADR-009 — In-app PDF preview with pdf.js instead of the browser plug-in
Chrome's built-in PDF viewer does not render inside sandboxed frames, so previews fetch the bytes (authorized, served
with a `sandbox` CSP) and render pages to a canvas with pdf.js (`pdfjs-dist` legacy build). The document's own
JavaScript is never executed; PDFs flagged with active content are download-only.

## ADR-010 — No retry-on-failure execution strategy
Services use explicit transactions; SQL Server's retrying execution strategy would require wrapping each in a
replayable delegate (and local-disk file writes are not replayable). Azure SQL serverless cold starts are handled
with a longer connection timeout in the deployment connection string instead (see docs/DEPLOYMENT.md, Phase 3).

## ADR-011 — The guided task includes an explicit "assign" step
The spec's walkthrough goes "create RFI → switch to Reviewer and answer". The RFI state machine (also in the spec)
only lets a Project Manager or Document Controller move Submitted → Assigned, so the guided task adds "switch to the
Project Manager and assign". The state machine wins; the walkthrough follows it.

## ADR-012 — Rowversion is required on every workflow transition
Transition endpoints require the `rowVersion` the client last saw. The service compares it before doing any work
(clear 409 message) and also sets it as the EF original value, so a race between two requests that both passed the
early check is still caught by SQL Server (DbUpdateConcurrencyException → 409). Deadlock victims (error 1205) also
map to 409 "try again".

## ADR-013 — Draft RFIs are private to their author
A Draft is a personal note until submitted; other members get 404 for it and it is excluded from lists, the review
queue and insights.

## ADR-014 — Reference numbers are allocated under an update lock
`RFI-###` / `SUB-###` numbers are computed inside the creating transaction with `UPDLOCK, HOLDLOCK` on the project's
rows; the unique index `(ProjectId, ReferenceNumber)` remains the final guard.

## ADR-015 — Reminder idempotency in the database
`Notifications.DedupeKey` (`overdue:{resource}:{item}:{recipient}:{yyyyMMdd}`) has a filtered unique index. The job
skips keys that already exist and treats a unique-violation on insert as success, so retries and concurrent runs can
never create duplicates.

## ADR-016 — Development-only demo quota
`appsettings.Development.json` raises the per-IP guest-workspace quota (500/hour) so local and CI end-to-end runs
are not blocked; the production default remains 5 per hour per address.

## ADR-017 — Extraction behind `IExtractionEngine`; rules by default
The deterministic rules engine needs no keys, costs nothing and is honest about what it is. A language-model adapter
can be plugged in through configuration, but it is optional, quota-limited, validated against the page text and
falls back to rules. Accepted values are applied by `ExtractionService` only, with an audit event.

## ADR-018 — `Document.IssueDate` and `Document.SpecSection` added in Phase 3
Accepting date and spec-section suggestions needs somewhere to store them. A small additive migration
(`DocumentIssueDateAndSpecSection`) was preferred over a free-form metadata table.

## ADR-019 — pdf.js upgraded to 6.x
`npm audit --omit=dev` reported GHSA-hq66-cqwq-w95j for pdfjs-dist 5.x (high). Version 6.5.438 fixes it. In 6.x the
document proxy no longer has `destroy()`; the preview now keeps and destroys the loading task (the regression was
caught by the Playwright guided scenario).

## ADR-020 — Critical-CSS inlining disabled in production builds
Angular inlines critical CSS with an `onload` handler that the strict `script-src 'self'` CSP blocks, which would
leave the main stylesheet in `media="print"`. Found by Lighthouse ("errors in console") on the production image;
`inlineCritical: false` keeps the CSP strict.

## ADR-021 — Response compression for static assets only
Brotli/Gzip apply to HTML, CSS, JS and SVG. API JSON is not compressed because some responses carry antiforgery
tokens (BREACH-style attacks rely on compressing secrets next to attacker-controlled input).

## ADR-022 — Guest upload quota
Each guest workspace may upload at most 30 files / 60 MB (configurable) on top of the seed data, so one visitor
cannot exhaust a free database.
