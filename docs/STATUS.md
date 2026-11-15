# Status

Last updated: 2026-11-15 — **all three phases implemented and verified locally. Hosted deployment: NOT COMPLETE**
(needs the owner's accounts; see [OWNER_TODO.md](OWNER_TODO.md)).

## Phase checklist

- [x] **Phase 1 — Foundation + vertical slice** (commits `acf63a6`, `4cfd2c6`, `23e731b`)
- [x] **Phase 2 — Domain workflows** (commits `46a1f2c`, `e2ef1dd`)
- [x] **Phase 3 — Hardening, presentation, deployment readiness** (this commit set)
- [ ] Hosted deployment — **not done**: no cloud accounts were available. Image, `infra/render.yaml`,
  `infra/azure/sql-free.bicep`, docs/DEPLOYMENT.md and smoke scripts are ready.
- [ ] CI on GitHub — **never run**: no remote exists yet. The workflow was written and its steps were run locally.

## Toolchain (inspected 2026-11-15)

| Tool | Version found |
| --- | --- |
| .NET SDK | 10.0.300 (runtime 10.0.8) |
| Node.js / npm | 24.18.0 / 11.16.0 |
| Angular CLI | 22.2.7 |
| Docker | 29.6.2 (Docker Desktop running) |
| Git | 2.55.0.windows.2 |

No tools had to be installed with winget. Playwright Chromium (`npx playwright install chromium`), Lighthouse 12.8.2
(`npx`) and the `dotnet-ef` local tool were fetched by their package managers.

## What works (verified)

**Documents (Phase 1).** SQL Server 2022 via Docker Compose (`127.0.0.1:14330`); EF Core model for every spec entity
with FKs, unique/check constraints, rowversion, list indexes, immutability and append-only triggers and the
documented `vw_ReviewQueue` view; idempotent seeding (2 fictional projects, 5 personas, 15 synthetic documents with
17 revisions incl. a superseded HVAC spec, an image-only scan and a prompt-injection PDF; 12 RFIs, 8 submittals, 3
overdue items); Identity cookie auth + antiforgery, per-project role checks with 404 for non-members, ProblemDetails,
rate limiting, structured logging, OpenAPI (dev), `/health` and `/health/ready`; local-disk and SQL `varbinary`
storage; upload/version/search/compare/download/preview APIs; guest demo (isolated tenant, personas, reset, quotas,
cleanup); Angular landing, case study, login, demo, register, document detail (pdf.js preview), 403/404 pages.

**Workflows (Phase 2).** RFI and submittal state machines through one audited transition path each (404/403/409,
rowversion), pinned page citations with "newer revision exists", one decision per submittal cycle, Revise & Resubmit
with a newer revision, comments with page citations, audit endpoint and per-resource timelines, review queue from the
SQL view, idempotent overdue reminders with bounded retries, notification bell, live insights charts with data
tables, guided walkthrough banner, RFI/submittal/insights/audit screens.

**Hardening and presentation (Phase 3).** Rules-based extraction (page, snippet, rule, confidence) with human
accept/reject that updates metadata through an audited path; "No text layer detected — extraction unavailable (no OCR
configured)" for scans; optional language-model adapter behind `IExtractionEngine` (disabled; validated, quota-limited,
falls back to rules); prompt-injection test on the seeded PDF; active-content PDFs download-only; HSTS; guest upload
quota; antiforgery verified on every unsafe route; rate-limit, lockout, header and path-traversal tests; pdf.js
upgraded for a security advisory; CSP-compatible production build; static-asset compression; production Docker image
(non-root, HEALTHCHECK) serving API + Angular from one origin; Render blueprint, Azure SQL free-offer Bicep, deployment
guide, smoke scripts; CI with path filters, Docker job and `ci-ok`; Dependabot; polished landing with real
screenshots and social image; complete case study.

## Commands run and real results — final run (2026-11-15, Windows 11)

| Command | Result |
| --- | --- |
| `dotnet format api/DocRoof.slnx --verify-no-changes` | exit 0 |
| `dotnet build api/DocRoof.slnx` | 0 warnings, 0 errors |
| `dotnet test api/DocRoof.slnx` | Unit: **121 passed**, 0 failed. Integration (Testcontainers SQL Server 2022): **57 passed**, 0 failed |
| `dotnet list api/DocRoof.slnx package --vulnerable --include-transitive` | no vulnerable packages (all 5 projects) |
| `npm run lint` | All files pass linting |
| `npm run format:check` | All matched files use Prettier code style |
| `npm test -- --watch=false` | 6 files, **23 tests passed** |
| `npm run build` | bundle generated, no budget errors |
| `npm audit --omit=dev` | first run: 1 high (pdfjs-dist 5.7.284, GHSA-hq66-cqwq-w95j) → upgraded to 6.5.438 → **0 vulnerabilities** |
| `npx playwright test --project=chromium` | **9 passed** in two consecutive runs: smoke; full guided scenario (HVAC spec → history → RFI on R1 p.3 → assign → answer → approve → close → audit); Reset my demo; axe WCAG 2.1 A/AA on landing, register and RFI detail (0 violations); mobile 390 px (no horizontal scroll); keyboard-only; extraction (view on page, accept, scan limitation) |
| `npx playwright test --project=screenshots` | regenerated 5 screenshots and `og-image.png` |
| `docker build -t docroof:local .` and `docker compose --profile app up -d --build` | image built (471 MB); container reported `healthy` |
| `./scripts/smoke.ps1 -BaseUrl http://localhost:5180` and `./scripts/smoke.sh http://localhost:5180` | both passed against the production container (health, readiness, landing, demo start, 9 documents) |
| `npx lighthouse@12.8.2 http://localhost:5180/` (production container, mobile preset) | Performance **72**, Accessibility **100**, Best Practices **100**, SEO **100** (LCP 5.2 s, CLS 0.097) |
| same with `--preset=desktop` | Performance **97**, Accessibility **100**, Best Practices **100**, SEO **100** (LCP 1.1 s) |

The Lighthouse runs were made on the production image before the final two UI tweaks (panel order on the document
page, test hardening); the landing page itself was unchanged afterwards.

### Problems found and fixed during Phase 3 runs

- `npm audit` found GHSA-hq66-cqwq-w95j in pdf.js 5 → upgraded to 6.5.438; the guided e2e test then caught that
  `PDFDocumentProxy.destroy()` no longer exists → the preview destroys the loading task instead.
- Lighthouse reported a CSP console error on the production build: Angular's critical-CSS `onload` script was blocked,
  leaving the stylesheet as `media="print"` → `inlineCritical: false` (Best Practices 93 → 100).
- The mobile test found 195 px horizontal overflow from visually-hidden labels escaping the table scroll box → scroll
  containers are positioned.
- The keyboard test flaked once (tabbing before the lazy page rendered) → it now waits for content.

## Earlier phase runs (for history)

- Phase 2 (2026-11-15): unit 104, integration 38, Angular 20, Playwright 3 — all passed. First e2e attempt hit the
  5-per-hour demo quota from repeated local runs (development quota raised, ADR-016).
- Phase 1 (2026-11-15): unit 45, integration 20, Angular 9, Playwright 1 — all passed.

## Known issues and limitations

- Hosted deployment not done (owner accounts). CI never executed on GitHub.
- Mobile Lighthouse performance (72) is limited by client-side rendering of the landing page; prerendering `/` and
  `/case-study` would be the next step.
- No malware scanning, no OCR, heuristic PDF active-content detection, in-app notifications only (see SECURITY.md).
- Rules-based extraction targets title-block conventions like the seeded documents'.
- Rate limiting is in-memory per instance.

## Owner actions needed

See [OWNER_TODO.md](OWNER_TODO.md): push to GitHub, set `GITHUB_URL`, optionally deploy (Azure SQL free offer +
Render free web service) and record the real smoke output here.

## Next steps (optional)

Prerender public pages for mobile performance; email notifications; OCR as an explicit, labelled add-on; distributed
rate limiting for multi-instance hosting.
