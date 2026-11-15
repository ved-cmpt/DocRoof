# Status

Last updated: 2026-11-15 — **all three phases implemented, verified locally and on GitHub Actions. Published at
https://github.com/ved-cmpt/DocRoof (release v1.0.0). Hosted deployment: NOT COMPLETE** (needs the owner's Render
and Azure accounts; see [OWNER_TODO.md](OWNER_TODO.md)).

## Phase checklist

- [x] **Phase 1 — Foundation + vertical slice** (commits `acf63a6`, `4cfd2c6`, `23e731b`)
- [x] **Phase 2 — Domain workflows** (commits `46a1f2c`, `e2ef1dd`)
- [x] **Phase 3 — Hardening, presentation, deployment readiness** (this commit set)
- [ ] Hosted deployment — **not done**: no cloud accounts were available. Image, `infra/render.yaml`,
  `infra/azure/sql-free.bicep`, docs/DEPLOYMENT.md and smoke scripts are ready.
- [x] Published on GitHub — public repository https://github.com/ved-cmpt/DocRoof, CI green on `main`, branch
  protection on `main`, release [v1.0.0](https://github.com/ved-cmpt/DocRoof/releases/tag/v1.0.0).
- [x] **UI redesign** (branch `redesign`) — new brand, sidebar app shell and consistent screens; see below.

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

## UI redesign (2026-11-15, branch `redesign`)

The owner rejected the first UI. Everything visual was redesigned; backend behaviour, routes and business rules are
unchanged (ADR-024). New: brand tokens (warm neutrals, one teal brand colour, status tints), Plus Jakarta Sans / Inter /
JetBrains Mono, a generated Lucide icon set, a new logo, favicon PNGs and social image; a collapsible sidebar shell
with project switcher, profile menu (persona, notifications, tour, reset, sign out), slim top bar and dismissible demo
pill; grid tables with filter chips; record pages with properties panels and sentence-style activity; dialogs for
upload, new RFI, assign, return/reopen reasons, decision and resubmit; compact insights; a review-queue page; split
sign-in; a stepped demo start screen with an offline state; a new landing page (HTML/CSS live product preview,
3-step "how it works", product tour tabs with 2x crops, trust strip) and a ~40 % shorter case study with redrawn
diagrams. The guided task is now opt-in (profile menu → Take the tour, plus a one-time welcome toast).

| Command | Result |
| --- | --- |
| `npx playwright test --project=review` (captures every public page, app screen, dialog, profile menu and drawer at 1440×900 and 390×844 into `.local/review/`) | 3 capture → review → fix passes. Fixed: dialog title styling, login overflow at 390 px (13 px), stretched form rows in mobile sheets, duplicate “Sign in” link, unaligned numeric columns, fractional chart axis, duplicate headings on error pages and the review queue. Last pass: 4 passed, no horizontal page overflow reported |
| `dotnet format api/DocRoof.slnx --verify-no-changes` | exit 0 |
| `dotnet build api/DocRoof.slnx` | 0 warnings, 0 errors |
| `dotnet test api/DocRoof.slnx` | Unit **121 passed**, integration **57 passed** (Testcontainers SQL Server 2022) |
| `npm run lint` · `npm run format:check` | all files pass · Prettier clean |
| `npm test -- --watch=false` | 10 files, **37 tests passed** (new: activity sentences, chips/relative time, demo offline detection, opt-in tour) |
| `npm run build` | bundle generated, no budget warnings (initial 465 kB raw / 113 kB transfer) |
| `npx playwright test --project=chromium` | **13 passed**; then `--repeat-each=2`: 26 passed. Covers guided scenario (with the opt-in tour), reset, axe on landing, sign-in, register, RFI detail, insights and the New RFI dialog (0 violations), mobile 390 px + drawer, dialogs fitting 390 px, keyboard-only, review queue, extraction |
| `npx playwright test --project=screenshots` | regenerated 2x README screenshots, four 1184×660 product-tour crops, `og-image.png`, `favicon-32.png`, `apple-touch-icon.png` |
| `npm audit --omit=dev` · `dotnet list … --vulnerable --include-transitive` | 0 vulnerabilities · no vulnerable packages (5 projects) |
| `docker compose --profile app up -d --build` + `./scripts/smoke.sh http://localhost:5180` | image built, container ready, smoke test passed |
| `npx lighthouse@12.8.2 http://localhost:5180/` (production container) | mobile: Performance **84**, Accessibility **100**, Best Practices **100**, SEO **100** (LCP 3.7 s, CLS 0.002) · `--preset=desktop`: **99 / 100 / 100 / 100** (LCP 0.8 s, CLS 0.003) |

Problems found by the tests during the redesign: axe flagged text in `--text-3` (decoration grey, below AA) on
superseded revision tags and contrast measured mid-animation on the hero and dialogs → tags use the secondary text
colour, the hero no longer fades in, and the dialog axe check waits for the open animation. The keyboard test flaked
once (Enter pressed before the landing page settled) → it now waits for network idle and asserts focus first.

## GitHub publication (2026-11-15)

| Command | Result |
| --- | --- |
| `gh search repos docroof` | no repositories found, so no name conflict |
| `gh repo create ved-cmpt/DocRoof --public --source . --remote origin --push` | repository created, `main` pushed |
| `gh repo edit … --homepage "" --add-topic …` | About description and 10 topics set, homepage empty |
| `gh run watch 43702227377` (first CI run, `main` at `b67f927`) | **failed**: backend and Docker jobs hit `CS0234 … 'Data' does not exist in the namespace 'DocRoof.Infrastructure'`; frontend passed; e2e skipped |
| clean clone of the fix branch: `dotnet format --verify-no-changes`, `dotnet build -c Release` | exit 0; 0 warnings, 0 errors |
| PR [#4](https://github.com/ved-cmpt/DocRoof/pull/4) `ci-and-links`, run [43702543181](https://github.com/ved-cmpt/DocRoof/actions/runs/43702543181) | all jobs passed, `ci-ok` green; squash-merged, branch deleted |
| `main` CI after merge, run [43702943687](https://github.com/ved-cmpt/DocRoof/actions/runs/43702943687) (`5ba6f16`) | all jobs passed: unit **121**, integration **57**, Angular **23**, Playwright **9**, Docker image build + smoke passed, `ci-ok` green |
| `gh api -X PUT repos/ved-cmpt/DocRoof/branches/main/protection` | PR required (0 approvals), required check `ci-ok`, force-push and deletion blocked (read back with `gh api`) |
| `gh release create v1.0.0 --target 5ba6f16` | https://github.com/ved-cmpt/DocRoof/releases/tag/v1.0.0 |

**Cause of the first failure:** the unanchored `data/` rule in `.gitignore` also matched
`api/src/DocRoof.Infrastructure/Data/` on Windows (case-insensitive), so the DbContext, interceptors and migrations had
never been committed. The rule is now `/data/` (ADR-023). Earlier local results were real, but they came from a
working tree that held those files.

Dependabot opened PRs #1 (docker), #2 (actions) and #3 (npm) on first push. They are left for the owner to review.

## Earlier phase runs (for history)

- Phase 2 (2026-11-15): unit 104, integration 38, Angular 20, Playwright 3 — all passed. First e2e attempt hit the
  5-per-hour demo quota from repeated local runs (development quota raised, ADR-016).
- Phase 1 (2026-11-15): unit 45, integration 20, Angular 9, Playwright 1 — all passed.

## Known issues and limitations

- Hosted deployment not done (owner accounts: Render + Azure SQL free offer).
- Mobile Lighthouse performance (84 after the redesign; LCP 3.7 s) is limited by client-side rendering of the landing
  page; prerendering `/` and `/case-study` would be the next step.
- No malware scanning, no OCR, heuristic PDF active-content detection, in-app notifications only (see SECURITY.md).
- Rules-based extraction targets title-block conventions like the seeded documents'.
- Rate limiting is in-memory per instance.

## Owner actions needed

See [OWNER_TODO.md](OWNER_TODO.md): deploy (Azure SQL free offer + Render free web service), record the real smoke
output here, and review the open Dependabot PRs.

## Next steps (optional)

Prerender public pages for mobile performance; email notifications; OCR as an explicit, labelled add-on; distributed
rate limiting for multi-instance hosting.
