# Status

Last updated: 2026-11-15 (Phase 1 complete).

## Phase checklist

- [x] **Phase 1 — Foundation + vertical slice**
- [ ] Phase 2 — Domain workflows (RFIs, submittals, comments, audit, insights, reminders, notifications)
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

## Commands run and real results (2026-11-15, Windows 11)

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

- RFI, submittal, insights, audit, notification and extraction screens/APIs are not built yet (Phases 2–3); the
  landing page labels those capabilities "In progress".
- The CI workflow has never run on GitHub (no remote configured).
- `docker build` of the production image has not been run yet (Phase 3).
- The OG image referenced in `index.html` (`/og-image.png`) is not generated yet (Phase 3).
- `Dockerfile`/compose `app` profile exist but are untested.

## Owner actions needed

See [OWNER_TODO.md](OWNER_TODO.md): create the GitHub repository and push; set the GitHub link in the footer.

## Next steps

Phase 2: RFI and submittal state machines and APIs, comments, audit endpoint, review queue, reminders job,
notifications, insights, Angular workflow screens, guided walkthrough, authorization test suite.
