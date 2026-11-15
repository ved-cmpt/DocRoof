# Status

Last updated: 2026-11-15 (Phase 2 complete).

## Phase checklist

- [x] **Phase 1 — Foundation + vertical slice**
- [x] **Phase 2 — Domain workflows** (RFIs, submittals, comments, audit, insights, reminders, notifications)
- [ ] Phase 3 — Extraction, hardening, presentation, deployment readiness

## Toolchain (inspected 2026-11-15)

| Tool | Version found |
| --- | --- |
| .NET SDK | 10.0.300 (runtime 10.0.8) |
| Node.js / npm | 24.18.0 / 11.16.0 |
| Angular CLI | 22.2.7 |
| Docker | 29.6.2 (Docker Desktop running) |
| Git | 2.55.0.windows.2 |

No tools had to be installed. Playwright's Chromium was installed with `npx playwright install chromium`.

## What works (Phase 2, verified)

- Phase 2 baseline: the Phase 1 suite (45 unit, 20 integration, 9 Angular, 1 e2e) was green on the Phase 1 commit;
  nothing was marked broken.
- RFI state machine (Draft → Submitted → Assigned → Answered → Closed → Reopened → Assigned, reject answer →
  Assigned) in one pure domain function and one service transition path: membership 404, role 403, invalid
  state/duplicate approval 409, stale rowversion 409, then change + audit (before/after JSON) + notifications in one
  transaction. Citations validated (same project, page in range) and pinned; "newer revision exists" flag.
- Submittal state machine with one decision per cycle (also a unique index), comments required unless Approved,
  finalize, Revise & Resubmit with a newer revision (cycle + 1); revision approval status updated through an audited
  path.
- Comments with optional page citations on documents, RFIs and submittals; project audit endpoint with filters and
  paging; per-resource timelines.
- Review queue endpoint reading `vw_ReviewQueue`; `OverdueReminderService` with configurable interval, bounded
  retries and DB-enforced idempotency; notification bell with unread count, mark-read and mark-all.
- Live insights endpoint + `/app/insights` SVG charts with data-table text alternatives.
- Angular: RFI list (state, assignee, due, discipline, search filters) and detail (citation card, answers, role-aware
  action forms, comments, timeline); submittal queue + list + detail with decision form; insights; audit; bell;
  "Raise RFI on this page" from the document preview; guided walkthrough banner for guest workspaces.

## What works (Phase 1, verified)

- SQL Server 2022 container via `docker compose up -d sql` on `127.0.0.1:14330` with a health check.
- EF Core model for **all** spec entities (tenants, projects, memberships, documents, revisions, stored files, RFIs,
  responses, submittals, review decisions, extraction suggestions, comments, audit events, notifications) in one
  initial migration with FKs, unique and check constraints, rowversion columns, list/filter indexes, the
  revision-immutability and audit append-only triggers, and the documented `vw_ReviewQueue` view.
- Startup migration + idempotent seeding of the persistent sample workspace: 2 fictional projects, 5 personas,
  15 synthetic documents (17 revisions, one superseded HVAC spec, one image-only PDF, one PDF with a
  prompt-injection-style sentence), 12 RFIs and 8 submittals across all states with audit histories, exactly 3
  overdue items. (RFI/submittal **screens and APIs** are Phase 2; the rows are seeded now.)
- Identity cookie auth, antiforgery on all unsafe methods, generic login errors + lockout, per-project role checks
  with 404 for non-members, ProblemDetails errors, rate limiting, security headers, JSON logging outside
  development, OpenAPI in development, `/health` and `/health/ready`.
- Storage abstraction with local-disk and SQL `varbinary(max)` implementations (`Storage:Mode`).
- Document APIs: list with filters + server paging, create with first revision, upload new revision (magic bytes,
  size limit, SHA-256, generated key, transaction + audit), history, metadata comparison, authorized streamed
  download and inline preview.
- Guest demo: `/api/demo/start` creates an isolated tenant from the seed template in ~0.3 s locally (measured once
  with curl: `real 0m0.289s`), persona switching within the tenant, reset, hourly per-IP quota, global cap, cleanup
  service for expired tenants.
- Angular app: landing page with a real screenshot, case-study scaffold ("Phase 1 of 3"), login, one-click `/demo`,
  app shell with project switcher, persona switcher and guest banner, document register (filters, sort, paging,
  revision chips, loading/empty/error states), document detail (title block, pdf.js/TXT/image preview with page
  navigation, version history, revision comparison, audit trail, upload-new-revision dialog), 403/404 pages.
- GitHub Actions workflow (backend, frontend, e2e, `ci-ok`) — written, **not yet run on GitHub** (no remote; owner
  action).

## Commands run and real results — Phase 2 (2026-11-15, Windows 11)

| Command | Result |
| --- | --- |
| `dotnet format api/DocRoof.slnx --verify-no-changes` | exit 0 |
| `dotnet build api/DocRoof.slnx` | 0 warnings, 0 errors |
| `dotnet test api/DocRoof.slnx` | Unit: **104 passed**, 0 failed. Integration (Testcontainers SQL Server 2022): **38 passed**, 0 failed |
| `npm run lint` | All files pass linting |
| `npm run format:check` | All matched files use Prettier code style |
| `npm test -- --watch=false` | 5 files, **20 tests passed** |
| `npm run build` | bundle generated, no budget errors |
| `npx playwright test --project=chromium` | **3 passed**: smoke, full guided scenario (create RFI on R1 p.3 → assign → answer → approve → close → audit), Reset my demo |
| `npx playwright test --project=screenshots` | wrote register, document-detail, rfi-detail, submittals, insights screenshots |

Notes from the run: the first e2e attempt failed with "Demo limit reached: at most 5 workspaces per hour" — the
per-IP quota working against repeated local runs. Development settings now raise it (production default unchanged,
ADR-016). The persona-menu click was flaky once; the e2e helper now retries with a fresh menu.

## Commands run and real results — Phase 1 (2026-11-15, Windows 11)

| Command | Result |
| --- | --- |
| `docker compose up -d sql` | container `docroof-sql` healthy |
| `dotnet run --project api/src/DocRoof.Api` (Development) | migration `InitialCreate` applied; "Seeded tenant 5a3f0000-… (15 documents)" |
| manual curl checks | login → 200; `/api/projects` counts MCC 9 docs/6 open RFIs/3 open submittals/2 overdue, WOR 6/2/1/1; download headers `attachment`, `nosniff`, sandbox CSP; guest download of another tenant's revision → 404; POST without antiforgery → 400 |
| `dotnet format api/DocRoof.slnx --verify-no-changes` | exit 0 |
| `dotnet build api/DocRoof.slnx` | 0 warnings, 0 errors |
| `dotnet test api/DocRoof.slnx` | Unit: **45 passed**, 0 failed. Integration (Testcontainers SQL Server 2022): **20 passed**, 0 failed |
| `npm run lint` | All files pass linting |
| `npm run format:check` | All matched files use Prettier code style |
| `npm test -- --watch=false` | 2 files, **9 tests passed** |
| `npm run build` | bundle generated, no budget errors |
| `npx playwright test --project=chromium` | **1 passed** (landing → Try the demo → register → detail) |
| `npx playwright test --project=screenshots` | wrote `web/public/screenshots/register.png` and `document-detail.png` |

## Known issues / limitations

- Extraction (rules engine, suggestions UI) is not built yet (Phase 3); the landing page labels it "In progress".
- The CI workflow has never run on GitHub (no remote configured).
- `docker build` of the production image has not been run yet (Phase 3).
- The OG image referenced in `index.html` (`/og-image.png`) is not generated yet (Phase 3).
- `Dockerfile`/compose `app` profile exist but are untested.

## Owner actions needed

See [OWNER_TODO.md](OWNER_TODO.md): create the GitHub repository and push; set the GitHub link in the footer.

## Next steps

Phase 3: rules-based extraction with page citations and human confirmation, upload/security hardening (headers,
rate-limit and path-traversal tests, dependency audits), accessibility and mobile e2e, production Docker image,
deployment configuration and docs, polished landing and case study.
