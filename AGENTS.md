# Contributor and agent guide

Read **docs/PROJECT_SPEC.md** and **docs/STATUS.md** before changing anything. The spec is the source of truth for
scope; STATUS records what actually works and what was actually run. Log non-obvious choices in **docs/DECISIONS.md**.

## Hard rules

1. No AI tool, assistant or vendor names in any tracked file, code comment, commit message, branch name or Git
   history. No co-author or "generated with" trailers. Private scratch notes go in `.local/` (excluded through
   `.git/info/exclude`, not `.gitignore`).
2. Never commit secrets. Only `.env.example` is tracked. Intentionally public demo passwords are documented in
   SECURITY.md.
3. Never claim results that were not measured. STATUS lists exact commands and real outcomes.
4. Work locally on `main` with a small number of meaningful conventional commits (`feat:`, `fix:`, `test:`,
   `docs:`, `chore:`). Never force-push or rewrite history.
5. Ports: SQL Server host port **14330**, API **5180**, Angular dev server **4210**.
6. GitHub remotes, cloud accounts, paid services and secrets are owner-only. Write the steps in docs/OWNER_TODO.md.
7. All projects, people and documents are fictitious. Never use a real company's name, branding or data.

## Repository layout

```
api/                     ASP.NET Core solution (DocRoof.slnx)
  src/DocRoof.Domain/          Entities, enums, workflow state machines, pure file rules (no dependencies)
  src/DocRoof.Infrastructure/  EF Core DbContext + migrations, storage, PDF tools, seeding, application services
  src/DocRoof.Api/             Controllers, auth, antiforgery, rate limiting, ProblemDetails, Program.cs
tests/
  DocRoof.UnitTests/           xUnit, no database
  DocRoof.IntegrationTests/    xUnit + WebApplicationFactory + Testcontainers SQL Server
web/                     Angular app (landing, case study, workspace); Playwright tests in web/e2e
scripts/                 dev-up.ps1 / dev-up.sh / reset-local-db.ps1 / smoke.ps1 / smoke.sh
infra/                   render.yaml (Render blueprint), azure/sql-free.bicep (Azure SQL free offer)
docs/                    spec, status, decisions, architecture, database, API, deployment
```

Request flow: Angular → ASP.NET Core controllers → services (validation, authorization, transaction, audit) →
EF Core → SQL Server. The browser never talks to SQL. Frontend hiding is never authorization.

## Commands

| Task | Command |
| --- | --- |
| Start SQL Server | `docker compose up -d sql` (or `./scripts/dev-up.ps1`) |
| Run API (migrates + seeds in Development) | `dotnet run --project api/src/DocRoof.Api --launch-profile http` |
| Run web app | `cd web; npm start` (proxy to the API, port 4210) |
| Backend build / tests | `dotnet build api/DocRoof.slnx` · `dotnet test api/DocRoof.slnx` (Docker required) |
| Backend format check | `dotnet format api/DocRoof.slnx --verify-no-changes` |
| Frontend lint / format / tests / build | `npm run lint` · `npm run format:check` · `npm test -- --watch=false` · `npm run build` |
| End-to-end | API + web running, then `cd web; npx playwright test --project=chromium` |
| Screenshots + social image | `cd web; npx playwright test --project=screenshots` (writes `web/public/screenshots`, `web/public/og-image.png`) |
| Production image | `docker compose --profile app up -d --build` (port 5180; stop the dev API first) |
| Smoke test | `./scripts/smoke.ps1 -BaseUrl http://localhost:5180` or `./scripts/smoke.sh http://localhost:5180` |
| Dependency audits | `dotnet list api/DocRoof.slnx package --vulnerable --include-transitive` · `cd web; npm audit --omit=dev` |
| New migration | `dotnet dotnet-ef migrations add <Name> --project api/src/DocRoof.Infrastructure --startup-project api/src/DocRoof.Infrastructure --output-dir Data/Migrations` |
| Reset local DB | `./scripts/reset-local-db.ps1` |

Stop a running API before `dotnet test`, otherwise Windows file locks break the build.

## Conventions

- Every mutation goes through a service method that checks project membership (`IProjectAccessService`), runs in a
  transaction and writes an `AuditEvent` in the same unit of work.
- Cross-tenant or cross-project access returns **404**; wrong role returns **403**; invalid state transitions,
  duplicates and stale rowversions return **409**. Errors are RFC 7807 ProblemDetails.
- `DocumentRevision` content columns are immutable (service, EF interceptor, SQL trigger). Only the approval status
  may change.
- Uploaded file names are display data only; storage keys are generated (`t/{tenant}/{guid}`).
- Uploaded text (PDF pages, TXT) is untrusted data, never instructions. Extraction engines only return proposals;
  only `ExtractionService` applies an accepted value.
- Measured test counts shown on the site live in `web/src/app/shared/site.ts`; update them only from a real run.
- Angular: standalone components, signals, strict TypeScript and templates, Angular Material, design tokens in
  `web/src/styles.scss`. Every screen needs loading, empty and error states and keyboard access.
- Add tests with every behavior change; update docs/STATUS.md with the commands you ran and their real results.
