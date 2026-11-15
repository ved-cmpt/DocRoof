# DocRoof — Project Specification

> Durable specification for all three phases. This file is the source of truth; read it together with docs/STATUS.md before changing anything.

DocRoof is an independent public portfolio project: an enterprise construction **document control** system for versioned project documents, RFIs, submittals, review assignments, approval histories and optional evidence-linked extraction.

Tagline: "Every document, decision, and revision stays traceable."

It is NOT affiliated with, endorsed by, or a recreation of any real company's systems. No real company names, logos, branding, project data, documents or employee identities are used. All people, projects and documents are fictitious.

## Hard rules (every file, commit and phase)
1. No AI tool, assistant or vendor names in any tracked file, code comment, commit message, branch name or Git history. No co-author or "generated with" trailers. Private notes live in `.local/` (excluded via `.git/info/exclude`).
2. Never commit secrets. Ship `.env.example` only. Intentionally public demo passwords are documented in SECURITY.md.
3. Never claim results that were not measured. docs/STATUS.md reports only what was actually run, with exact commands and real outcomes.
4. Few pull requests: work locally on `main` with meaningful conventional commits. Never force-push or rewrite history.
5. Ports: SQL Server host port 14330, API 5180, Angular dev server 4210.
6. GitHub remote, cloud accounts, paid services and secrets are owner-only; document steps in docs/OWNER_TODO.md.

## Product boundary
DocRoof owns DOCUMENT GOVERNANCE: controlled documents and revisions, RFIs, submittals, review decisions, approval traceability, audit. It does NOT do field work orders, procurement, scheduling or cost analytics.

## Roles (per project membership)
- **Document Controller** — uploads, organizes, versions and distributes records.
- **Project Manager** — creates projects, approves RFI answers, resolves escalations.
- **Reviewer** — comments on and decides assigned submittals; answers assigned RFIs.
- **Requester** — creates RFIs and sees responses.
- **Guest Demo** — an isolated, seeded, per-visitor workspace where all four roles are represented by fictional personas the visitor can switch between. Persona switching only works inside the visitor's own sandbox tenant and every API action is still authorized server-side by the active persona's role.

## End-to-end story
A fictitious commercial building team notices ambiguity in the latest HVAC specification. The requester opens an RFI citing the uploaded document revision and page. A reviewer posts a clarification, the manager approves the answer, the RFI closes, and the controlled document register records the updated revision with a complete audit trail.

## Modules
- Controlled document library: searchable metadata, categories, disciplines, revision labels, SHA-256 checksums, immutable previous revisions, safe downloads, access rights.
- RFI lifecycle: Draft → Submitted → Assigned → Answered → Closed, with Closed → Reopened → Assigned allowed; attachments (links to document revisions), due dates, manager approval of the answer before close.
- Submittal lifecycle: Submitted → InReview → (Approved | ApprovedWithComments | ReviseAndResubmit) → Final; ReviseAndResubmit requires a new revision and returns to Submitted. Approver assignment and timestamps.
- Extraction assist: for text-based PDFs, suggest title, discipline, document number, key dates and spec section references, each with source page and a confidence label; a human must accept or reject each suggestion. Default engine is a clearly labeled **deterministic rules-based extractor** (regex/heuristics over extracted page text). An optional LLM provider may be enabled only via environment key with quotas; it must never be required and must never be labeled "AI" when the rules engine is used. No OCR claims; scanned/image-only PDFs show a transparent "no text layer — extraction unavailable" message.
- Review workspace: document metadata side-by-side with comments, page-cited references, timeline, deadlines, notifications.
- Search/filter by project, revision, status, discipline, assigned reviewer, due date; server-side pagination.
- Small automation: background job for overdue review/RFI reminders (creates Notification rows, idempotent per item per day), activity/audit feed, revision comparison metadata (size, checksum, uploader, date, metadata diff).
- Uploaded text is untrusted data, never instructions to the application or any model.

## Stack (non-negotiable)
- Frontend: latest stable Angular, standalone components, TypeScript strict, SCSS, Angular Material (or equally accessible library), responsive, an intentional construction-inspired design system (not a Bootstrap starter).
- Backend: C# on the newest .NET LTS (.NET 10 if available) ASP.NET Core Web API, REST, DI, typed validation (FluentValidation or DataAnnotations), controller → service → EF Core data access, OpenAPI docs, RFC 7807 ProblemDetails error envelope, structured logging, health check at `/health`.
- Database: Microsoft SQL Server 2022 (Developer edition container `mcr.microsoft.com/mssql/server:2022-latest` for local), EF Core migrations, foreign keys, unique constraints, check constraints on state columns, indexes for list/filter queries, rowversion concurrency tokens on mutable aggregates. At least one documented T-SQL view or optimized query (e.g. review-queue/overdue view) with the reasoning in docs/DATABASE.md. Dependent changes use transactions.
- Auth: ASP.NET Core Identity with cookie auth + antiforgery (CSRF) tokens; same-origin deployment by default (the API serves the built Angular app in production) so cookies stay first-party. Role and project/tenant authorization enforced server-side via policies + object-level checks in services. Frontend hiding is never authorization.
- File storage: an `IFileStorage` abstraction with two implementations: local disk (storage keys are generated GUID paths, never user filenames) and SQL `varbinary(max)` table (for free hosting). Selected by config `Storage__Mode`.
- PDFs: generate synthetic seed PDFs with a permissively licensed .NET library (e.g. PDFsharp/MigraDoc MIT, or QuestPDF Community licence — record the choice and licence). Extract text per page with UglyToad.PdfPig.
- Tests: xUnit unit tests, integration tests with WebApplicationFactory + Testcontainers SQL Server, Angular component/service tests, Playwright e2e smoke.
- Tooling: Git, GitHub Actions (build, lint/format check, tests), Docker Compose for SQL Server (+ optional API), `.editorconfig`, `dotnet format`, ESLint/Prettier.
- Repo layout: `/web` (Angular marketing + app), `/api` (ASP.NET Core solution: Api, Domain/Application, Infrastructure), `/tests` (backend tests; e2e under `/tests/e2e` or `/web/e2e`), `/scripts`, `/infra`, `/docs`, README.md, AGENTS.md, `.github/workflows`. Modular monolith; no extra services unless truly needed.
- Request flow: Angular → HTTPS ASP.NET Core API → SQL Server. The browser never touches SQL. All mutations go through service-layer validation, authorization, transaction and audit.

## Entities and invariants
- Tenant(id, name, is_guest, expires_at); Project(id, tenant_id, code, title); User(id, tenant_id, display_name); ProjectMembership(project_id, user_id, role) unique per (project,user).
- Document(id, project_id, document_number, category, discipline, title, current_revision_id, status) — document_number unique per project.
- DocumentRevision(id, document_id, version_label, storage_key, sha256, file_name, mime_type, byte_size, uploaded_by, uploaded_at, approval_status, supersedes_revision_id) — rows immutable after insert (enforce in the service layer AND with a DB trigger or EF interceptor that rejects updates to content columns); version_label unique per document.
- Rfi(id, project_id, reference_number, subject, question, source_revision_id, source_page, state, assignee_id, due_at, created_by) — reference_number unique per project (e.g. RFI-012); source_page must be within the revision's page count; source revision must belong to the same project.
- RfiResponse(id, rfi_id, author_id, answer, created_at, approved_by, approved_at).
- Submittal(id, project_id, number, revision_id, status, assigned_reviewer_id, due_at).
- ReviewDecision(id, submittal_id, reviewer_id, decision, comments, created_at) — only the assigned reviewer can decide; one decision per review cycle (duplicate attempts rejected with 409).
- ExtractionSuggestion(id, revision_id, field, proposed_value, page, confidence_label, engine, status, decided_by, decided_at).
- Comment(id, project_id, resource, resource_id, author_id, body, page, created_at).
- AuditEvent(id, tenant_id, project_id, actor_id, resource, resource_id, action, change_json, timestamp) — append-only.
- Notification(id, recipient_id, project_id, kind, resource, resource_id, created_at, viewed_at).
- Cross-tenant/project access returns 404 (do not leak existence). Uploaded filenames are sanitized for display/download and never used as disk paths.

## REST API (representative; keep consistent)
- GET/POST /api/projects; GET /api/projects/{id}
- GET/POST /api/projects/{id}/documents (filters + paging); GET /api/documents/{id}; POST /api/documents/{id}/revisions (multipart, validated)
- GET /api/documents/{id}/history; GET /api/document-revisions/{id}/download (authorized streamed response, `Content-Disposition` with sanitized name, `X-Content-Type-Options: nosniff`)
- GET/POST /api/projects/{id}/rfis; GET /api/rfis/{id}; POST /api/rfis/{id}/submit|assign|answer|approve-answer|close|reopen
- GET/POST /api/projects/{id}/submittals; POST /api/submittals/{id}/start-review; POST /api/submittals/{id}/decisions; POST /api/submittals/{id}/finalize
- POST /api/document-revisions/{id}/extract-suggestions; POST /api/extraction-suggestions/{id}/accept|reject
- GET /api/projects/{id}/review-queue; GET /api/projects/{id}/audit; GET /api/projects/{id}/insights; GET /api/notifications
- POST /api/demo/start (creates an isolated guest workspace + signs in); POST /api/demo/reset; POST /api/demo/persona
- POST /api/auth/login|logout; GET /api/auth/me; GET /api/auth/antiforgery

## Screens
- `/` polished landing page; `/case-study`; `/login`; `/demo` (one click → guest workspace)
- `/app/documents` register with filters, upload/new-revision action, revision chips
- `/app/documents/:id` history, preview where supported (PDF via sandboxed iframe/pdf viewer, TXT as escaped text), download, extraction suggestions with page citations
- `/app/rfis` list + detail, assignments, transitions
- `/app/submittals` review queue, decision form, timeline, overdue status
- `/app/insights` turnaround times, overdue reviews, document volumes, trend charts (live from API)
- `/app/audit`, notifications bell, 403/404 pages, persona switcher in guest mode

## Seed data
Fictional projects **Midtown Community Clinic** and **Westpark Office Retrofit**; 15 synthetic PDF/TXT documents generated for the portfolio with document numbers (e.g. MCC-M-23 05 00), versions and varied disciplines (Architectural, Structural, Mechanical/HVAC, Electrical, Plumbing, Fire Protection, Civil). Include an HVAC specification with a text layer and multiple pages, one image-only PDF (to demonstrate the no-text-layer limitation), one PDF containing a prompt-injection-style sentence (to prove it is treated as data). 12 RFIs across states, 8 submittals across states, 3 overdue items, one revision superseded by an updated revision, traceable approval histories. Seeding is idempotent and per-tenant; guest workspaces are cloned from a template so one visitor never affects another.

## Guest demo isolation
`/demo` creates a short-lived guest tenant (24 h TTL) cloned from the seed template, signs the visitor in as a persona, rate-limited per IP (e.g. max 5 workspaces/hour) and capped globally; a hosted BackgroundService deletes expired guest tenants and their files; "Reset my demo" rebuilds only the caller's tenant. No shared mutable database for visitors, no live admin credentials on the site.

## Guided demo task
Open HVAC specification → inspect version history → create RFI citing revision + page → switch to Reviewer and answer → switch to Project Manager and approve → close → verify audit trail.

## Phases
- **Phase 1 — Foundation + vertical slice:** auth, schema/migrations, synthetic document generation, storage abstraction, upload/version/search/download APIs, Angular document register + detail, landing page, case-study scaffold, guest demo start, first tests, Docker Compose, CI.
- **Phase 2 — Domain workflows:** full RFI and submittal state machines, approvals, assignments, comments, timeline/audit, safe previews/downloads, insights dashboard, overdue reminders job, notifications, authorization test suite.
- **Phase 3 — Hardening + presentation + deploy readiness:** extraction with page citations and human confirmation UI, upload security hardening, comprehensive unit/integration/e2e tests, Docker/CI/deployment config, polished landing + case study, truthful limitations, deployment (only if owner provides accounts).

## Must-pass domain tests (cumulative; Phase 1 covers the document ones)
- Unauthorized users cannot obtain another project's/tenant's files via guessed IDs or URLs.
- Uploading a new revision creates a new row; old bytes, checksum and historical references stay intact.
- File type (magic-byte sniffing, allow-list PDF/TXT/PNG/JPG) and size limits reject disguised executables and oversize files; download names are sanitized.
- Invalid RFI/submittal transitions and duplicate approvals are rejected safely.
- Extracted facts link to real existing pages; image-only PDFs show a transparent limitation.
- Uploaded text attempting to override instructions does not cause any privileged operation.

## Definition of done (whole project)
Clean install works; migrations + seed run; the end-to-end scenario works on persisted data; unauthorized access rejected; tests actually run; landing page polished; hosted Try Demo works for outsiders without sign-up (if deployment authorized); docs, case study and diagrams match the code; no fake buttons, static dashboards, "coming soon" on required screens or in-memory-only records; responsive and keyboard accessible with labels, focus states, empty/loading/error states, reduced-motion support.

## Phase 1 implementation checklist
1. Scaffold `/api` solution (Api, Application/Domain, Infrastructure, tests) and `/web` Angular app; Docker Compose for SQL Server on 14330 with a health check; `.env.example`; scripts `scripts/dev-up.ps1`, `scripts/dev-up.sh`, `scripts/reset-local-db.ps1`.
2. Full EF Core model for ALL entities above (so later phases do not need disruptive schema rewrites), initial migration, constraints, indexes, immutability guard on DocumentRevision, the documented T-SQL view.
3. Identity + cookie auth + antiforgery, authorization policies, project membership checks in a reusable service, ProblemDetails errors, rate limiting middleware, structured logging, OpenAPI (dev only), `/health`.
4. Synthetic document generator (C# console or seed service) producing the 15 documents deterministically; idempotent seeder for both projects; guest-tenant clone/start/reset/cleanup.
5. Document APIs: list/filter/paginate, create document with first revision, upload new revision (magic-byte check, size limit, SHA-256, storage key), history, authorized streamed download.
6. Angular: app shell with nav, auth guard, HTTP interceptor (antiforgery header, error toasts), login, `/demo` one-click start, document register with filters and revision chips, document detail with history/download/upload-new-revision, persona switcher, loading/empty/error states, 403/404 pages.
7. Landing page `/` (headline, value proposition, real UI preview, problem/solution, three role workflows, capabilities, how the demo works, engineering proof, footer with GitHub placeholder, stack, independent-portfolio disclaimer) and `/case-study` scaffold with truthful "Phase 1 of 3" status. Meta tags, title, social preview image.
8. Tests: unit tests for checksum/storage-key/filename sanitizing/magic-byte validation; integration tests for cross-tenant download denial, new-revision immutability, disguised executable and oversize rejection; Angular tests for the register component and API service; one Playwright smoke (landing → Try Demo → register shows seeded docs).
9. GitHub Actions workflow: backend build + test (Testcontainers works on ubuntu runners), frontend lint + test + build, Playwright smoke job; a final aggregate `ci-ok` job.
10. Run everything locally: `docker compose up -d`, migrations, seed, `dotnet build`, `dotnet test`, `npm ci`, `npm run lint`, `npm test -- --watch=false`, `npm run build`, Playwright. Fix failures until green or until a genuine external blocker remains.
11. README.md quick start (Windows PowerShell first, bash second), docs/ARCHITECTURE.md (SVG/mermaid diagram matching the code), docs/DATABASE.md, docs/API.md, SECURITY.md, LICENSE (MIT).
12. Update docs/STATUS.md with real results and commit locally with clean messages (no AI trailers).

## Phase 2 — detailed requirements
### RFI state machine (server-enforced, single transition service, audited)
Draft → Submitted (requester) → Assigned (PM or document controller assigns a reviewer + due date) → Answered (assignee posts RfiResponse) → answer approved by Project Manager → Closed (PM). Closed → Reopened (PM or original requester, with reason) → Assigned. Rejecting an answer returns Answered → Assigned. Any other transition, wrong role, wrong tenant, stale rowversion, or a second approval returns a ProblemDetails 409/403/404 and changes nothing. RFIs must cite a source revision of the same project and a page within its page count; citations stay pinned to that exact revision even after newer revisions are uploaded (the UI flags "newer revision exists").

### Submittal state machine
Submitted → InReview (assigned reviewer starts) → Approved | ApprovedWithComments | ReviseAndResubmit (ReviewDecision by the assigned reviewer only, one per cycle) → Final (PM or document controller finalizes Approved/ApprovedWithComments). ReviseAndResubmit requires a new DocumentRevision upload, which starts a new cycle back at Submitted. Approval status is reflected on the DocumentRevision approval_status (via a new audit-tracked status field update path, not by mutating immutable content columns).

### Everything else for Phase 2
- Every mutation in a transaction with an AuditEvent (actor, action, before/after JSON). Audit endpoint with filters and paging; per-resource timeline.
- Comments with optional page citation on documents, RFIs and submittals.
- Review queue endpoint (use the documented T-SQL view) showing assigned items, due dates and overdue flags.
- Overdue reminder BackgroundService (configurable interval): creates Notification rows idempotently (one per item per recipient per day), bounded retries, logs failures; notification bell with unread count and mark-as-read.
- Safe previews: PDF in a sandboxed viewer served with correct content type and `Content-Security-Policy` for the preview route; TXT rendered as escaped text; downloads streamed with sanitized names; all behind object-level authorization.
- Revision comparison metadata view (size, checksum, uploader, date, metadata changes).
- `/app/insights`: live charts from a real API (RFI turnaround median, open vs closed over time, overdue reviews by discipline, document volume by discipline/status). Accessible chart colors and text alternatives. No hard-coded numbers.
- Angular screens fully wired: `/app/rfis` list (filters: state, assignee, due, discipline) + detail with timeline, answer form, approve/close/reopen actions shown only when allowed (server still enforces); `/app/submittals` queue + detail + decision form + timeline + overdue badges; RFI creation from the document detail page pre-filling revision + page.
- Update seed: 12 RFIs and 8 submittals across all states, 3 overdue items, one superseded revision, full approval histories with realistic timestamps. Guest clone includes all of it.
- Guided walkthrough banner in guest mode for: open HVAC spec → version history → create RFI with page citation → switch to Reviewer and answer → switch to PM and approve → close → audit trail.

### Tests (actually run them)
- Unit: every allowed and disallowed RFI and submittal transition (table-driven), role checks, due-date/overdue logic, notification idempotency.
- Integration (Testcontainers SQL Server): cross-tenant/cross-project access to RFIs, submittals, files and audit returns 404; wrong role returns 403; duplicate approval/decision returns 409 with no DB change; concurrent update rowversion conflict; transaction rollback leaves no partial rows or audit events; citation page out of range rejected; new revision keeps old bytes and citations intact.
- Angular: RFI detail action visibility, decision form validation, insights service.
- Playwright: the full guided demo scenario end to end in a fresh guest workspace, plus "Reset my demo".

## Phase 3 — detailed requirements
### Extraction with page citations + human confirmation
- PdfPig per-page text extraction; deterministic rules engine (labeled "Rules-based extraction" in UI and docs) proposing title, discipline, document number, dates and spec section references (e.g. "23 05 00"), each with page number, matched text snippet and confidence label (High/Medium/Low with the rule that produced it).
- Optional LLM provider behind an `IExtractionEngine` interface, disabled unless `Extraction__Provider` and a key are set via environment; structured JSON output validated against a schema; only page text as context; strict per-tenant quotas and timeouts; graceful fallback to rules; never available to anonymous guests unless quotas are configured. Label it honestly.
- UI on `/app/documents/:id`: suggestions list with "view on page N" (opens the preview at that page), accept/reject each, accepted values update document metadata through the audited service. Image-only PDFs show "No text layer detected — extraction unavailable (no OCR configured)".
- Prompt-injection defense: page text is treated as data only, never as instructions; extraction can only create ExtractionSuggestion rows and can never change state, roles or approvals. Test with the seeded injection document.

### Security hardening
Magic-byte allow-list, size limits, PDF with embedded JavaScript/launch actions flagged and served download-only, filename sanitization, path-traversal tests, security headers (CSP, HSTS in prod, X-Content-Type-Options, Referrer-Policy, frame-ancestors), rate limits on auth/demo/upload/extraction, lockout, antiforgery on all unsafe methods, login doesn't reveal which accounts exist, guest quotas and cleanup verified, dependency audit (`dotnet list package --vulnerable`, `npm audit --omit=dev`). Write SECURITY.md (threat model, controls, known gaps such as no malware scanning).

### Tests (actually run, record results)
Complete the six must-pass domain tests from the spec with explicit test names, plus extraction tests (citations point to real pages, image-only limitation, injection text causes no privileged operation), header tests and rate-limit tests. Playwright: landing → Try Demo → full guided scenario → audit trail, mobile viewport smoke, keyboard-only navigation smoke, basic axe accessibility check on landing, register and RFI detail.

### Presentation
- `/` industry-grade landing page: product-specific headline and value prop, real screenshots captured from the running app with Playwright (saved in the repo), strong typography, construction-inspired palette, responsive, three role workflows, capability highlights, how the demo works, engineering proof (stack, tests, security), prominent Try Demo, accessible footer with GitHub link, stack, attribution and "independent portfolio project, not affiliated with any company" disclaimer. Reduced-motion support, Lighthouse run locally if available (report real scores only).
- `/case-study`: the construction document-control problem, users, business rules, architecture SVG, data model diagram, why the stack fits a construction-company enterprise developer role, security decisions, testing approach with real counts, known limitations, deployment diagram, demo walkthrough, GitHub link. Measured results ONLY if measured; otherwise state the real status.

### Deployment readiness ($0 preferred)
- Production build: one Docker image where ASP.NET Core serves the built Angular app (same origin, first-party cookies), runs migrations on startup behind a flag, `/health` and `/health/ready`.
- Default free target to document and configure: API container on Render free web service (or Azure App Service / Container Apps if the owner prefers) + **Azure SQL Database free offer** (serverless, General Purpose) with `Storage__Mode=Database` so files live in SQL. Provide `infra/` files (render.yaml and/or Bicep), `docs/DEPLOYMENT.md` with exact click/copy steps, required env vars, CORS (only if a separate frontend origin is used), HTTPS, and a post-deploy smoke script `scripts/smoke.ps1` / `scripts/smoke.sh` (health, landing, demo start, document list).
- CI: GitHub Actions for backend, frontend, e2e and Docker build with path filters and a final `ci-ok` aggregate job; Dependabot grouped per ecosystem, monthly, max 2 open PRs.
- Deploy only if the owner has configured authorized accounts and approved costs; otherwise mark deployment NOT COMPLETE in STATUS.md and leave exact copy-paste steps in docs/OWNER_TODO.md.

### Finish
Run every available check (format, lint, build, unit, integration, Angular tests, Playwright, audits, Docker build), fix findings, regenerate diagrams so they match the code, update README (quick start, demo walkthrough, screenshots, architecture, API, tests, deployment, limitations), docs/STATUS.md with real proof, and make clean local commits (no AI trailers). Final report: what works, exact commands and results, what is NOT complete and why, owner-only steps.
