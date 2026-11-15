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

## ADR-023 — Root-anchored ignore rules
The first GitHub CI run failed to compile: the unanchored `data/` rule in `.gitignore` (meant for local file
storage) also matched `api/src/DocRoof.Infrastructure/Data/` because Git on Windows ignores case, so the DbContext,
interceptors and migrations were never committed. Local builds passed because the files existed on disk. The rule
is now `/data/`; a clean clone is built before pushing CI fixes.

## ADR-024 — Design system: warm neutrals, one brand colour, sidebar shell
The first UI (orange/navy, hazard stripes, blueprint grid, coloured card bars, dense marketing text) was rejected as
generic and noisy. The redesign follows app-grid clarity for the workspace and a calm, product-first marketing page:

- **Tokens only.** Every colour, radius, shadow and type size is a CSS variable in `web/src/styles.scss`, mirrored into
  the Angular Material theme. Paper-white background `#FAFAF7`, ink text `#14201C`, one brand colour (teal-green
  `#0F6E5C`) used only for primary actions, selection and links. Status colours appear only as a soft tint with darker
  text, through one `<app-status>` chip (radius 6) — no mixed circle/square chips, no coloured top bars.
- **Type.** Plus Jakarta Sans (headings), Inter (UI, 14 px app body), JetBrains Mono (document numbers and revision
  labels only), self-hosted latin subsets via @fontsource with `font-display: swap`.
- **One icon set.** Lucide outlines at 1.5 stroke, generated into `icons.generated.ts` by `web/scripts/generate-icons.mjs`
  so only used icons ship (no icon font, no runtime dependency).
- **Shell.** A 240 px collapsible (64 px) sidebar that becomes a drawer below 900 px, with the profile menu bottom-left
  (persona switch, notifications, tour, reset, sign out) and a slim per-page top bar (breadcrumb, title, search, page
  action, bell). The guided task became an opt-in popover; the demo banner became a dismissible pill.
- **Records.** Detail pages use a two-column layout with a properties panel. Activity is rendered as sentences from the
  audit vocabulary (`shared/activity.ts`) instead of raw field dumps.
- **Forms and dialogs.** Native inputs styled by tokens (labels above, helper text below) instead of floating-label form
  fields; dialogs share one anatomy (560 px, full-screen sheet below 600 px, scrolling body, right-aligned footer).
  Assign, reason, decision and resubmit actions moved from inline forms into dialogs.
- **Charts.** HTML bars with a stretched SVG line, so text stays crisp at any width; brand + neutral greys, status
  colour only for overdue; every chart has a data-table toggle.
- **Review loop.** `web/e2e/review.spec.ts` (Playwright project `review`) captures every screen at 1440 and 390 px into
  `.local/review/` for visual review; it is not part of CI.

## ADR-025 — Terracotta colour theme
The owner replaced the teal-green brand with a warm terracotta theme. Only colour changed; layout, components, fonts
and behaviour are as in ADR-024, and every colour is still a token in `web/src/styles.scss`.

- **Palette.** Brand `#A84A28` (hover `#8E3D20`, tint `#F8E9E1`) on paper `#FBF6EF`, surfaces `#FFFFFF` / `#F4ECE2`,
  border `#EADFD2`, text `#2B1F1A` / `#6B5A50`, muted `#9A8A80` (icons and decoration only). Every neutral, shadow,
  scrim and the Material theme (`$orange-palette` plus overrides) is warm-tinted; no cool greys remain.
- **Status.** Success, warning, info and neutral keep soft tints with darker text. Danger is crimson `#A61E3A` on
  `#FBE8EC` (error toast `#6E1427`) so it never reads as the terracotta brand.
- **Charts.** Terracotta, sand `#D9C3AE` and brown `#6E4B3A`: opened/closed bars are terracotta/sand, the open-items
  line is brown, document statuses are terracotta, brown, sand and light sand with a 1 px separator between stacked
  segments. Overdue keeps the danger colour. Each chart still has a data-table toggle, which is the text alternative
  for the light sand fills (under 3:1 against white, as the grey fills were before).
- **Deviations from the requested values, for WCAG AA.** Success text `#2E7D4F` measured 4.44:1 on `#E8F3EC`, so it is
  `#2B7A4C` (4.63:1). Placeholders got their own token `#76665C` (≥ 4.69:1 on every surface) because muted `#9A8A80`
  is about 3:1. Terracotta is only 2.79:1 against body text, so links inside paragraphs and list items are underlined
  (axe `link-in-text-block`, WCAG 1.4.1); this also failed under the teal theme but no test covered the case study.
- **Assets.** Logo mark, favicon SVG/PNG, touch icon, social image, README screenshots and product-tour crops were
  regenerated from the running app; the landing preview and case-study diagrams follow the tokens.
