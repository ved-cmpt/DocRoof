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
