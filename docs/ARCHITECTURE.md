# Architecture

DocRoof is a modular monolith: one ASP.NET Core process, one SQL Server database, one Angular single-page app.

```mermaid
flowchart LR
  subgraph Browser
    SPA["Angular SPA<br/>standalone components, signals,<br/>Angular Material, pdf.js preview"]
  end
  subgraph API["ASP.NET Core API (.NET 10)"]
    MW["Middleware<br/>security headers · auth cookie ·<br/>rate limiter · ProblemDetails"]
    C["Controllers<br/>Auth · Demo · Projects · Documents"]
    AF["Antiforgery filter<br/>(all unsafe methods)"]
    S["Services<br/>ProjectAccess (membership + role) ·<br/>Documents · Projects · Demo · AuditWriter"]
    BG["Hosted services<br/>DatabaseInitializer · GuestCleanup"]
    EF["EF Core DbContext<br/>+ ImmutabilityInterceptor"]
    FS["IFileStorage<br/>LocalDisk | Database"]
  end
  DB[("SQL Server 2022<br/>tables, constraints, triggers,<br/>vw_ReviewQueue")]
  DISK[("Local disk<br/>t/{tenant}/{guid}")]

  SPA -- "HTTPS /api (cookie + X-XSRF-TOKEN)" --> MW --> AF --> C --> S --> EF --> DB
  S --> FS
  FS --> DISK
  FS -. "Storage:Mode=Database" .-> DB
  BG --> EF
```

## Layers

| Project | Responsibility | Depends on |
| --- | --- | --- |
| `DocRoof.Domain` | Entities, enums, `RfiWorkflow`/`SubmittalWorkflow` state machines, `DueDates`, file rules (`FileSignatures`, `UploadRules`, `FileNameSanitizer`, `StorageKeys`, `Checksums`) | nothing |
| `DocRoof.Infrastructure` | `DocRoofDbContext`, migrations and hand-written SQL objects, storage implementations, PDF inspection/generation, seeding, application services, background services | Domain, EF Core, Identity, PdfPig |
| `DocRoof.Api` | Controllers, cookie auth, antiforgery filter, rate limiting, security headers, ProblemDetails mapping, health checks, static SPA hosting | Infrastructure |

## Request lifecycle (example: upload a new revision)

1. Angular posts `multipart/form-data` to `POST /api/documents/{id}/revisions` with the auth cookie and
   `X-XSRF-TOKEN` header.
2. The rate limiter (`upload` policy, per user) and the antiforgery filter run before the controller.
3. `DocumentService.AddRevisionAsync` asks `ProjectAccessService` for the document's project membership inside the
   caller's tenant (404 if none, 403 unless Document Controller or Project Manager).
4. `UploadRules` sniffs magic bytes, checks extension and size; PdfPig reads page count, text layer and active
   content markers.
5. Inside one transaction: bytes are written under a generated key, a new `DocumentRevision` row is inserted,
   the document's `CurrentRevisionId` moves forward (rowversion-checked) and an `AuditEvent` is added.
6. Failures roll back the transaction and remove any local-disk bytes; exceptions become ProblemDetails.

## Tenancy and the guest demo

- Every `Project` and Identity user belongs to one `Tenant`. Every other row hangs off a project.
- `POST /api/demo/start` creates a guest tenant (24 h TTL) from the seed template and signs the visitor in as the
  requester persona. Persona switching signs in another user of the **same** guest tenant only.
- `GuestCleanupService` deletes expired guest tenants (rows in dependency order, then files).
- Per-IP quotas use a salted hash of the client address stored on the tenant row; a global cap limits active
  workspaces.

## Frontend

- Routes: `/` landing, `/case-study`, `/login`, `/demo`, `/app/documents`, `/app/documents/:id`, 403/404 pages.
- `SessionService` holds the signed-in identity (signals) and refreshes the antiforgery token whenever the identity
  changes; `authGuard` protects `/app`.
- `errorInterceptor` turns ProblemDetails into toasts unless a call opts out with the `SILENT_ERRORS` context token.
- Previews: PDFs are rendered to a canvas with pdf.js (no document scripts run), TXT is shown as escaped text,
  images via blob URLs.

## Workflows

Both state machines live in `DocRoof.Domain/Workflows/Workflows.cs` as pure functions (`RfiWorkflow.Evaluate`,
`SubmittalWorkflow.Evaluate`) and are unit tested exhaustively (every state × action). Services call them through a
single transition method per aggregate, then check the client's rowversion and write the change, audit event and
notifications in one transaction. `availableActions` in API responses comes from the same functions, so the UI
never guesses — and the server re-checks every call anyway.

### RFI

```mermaid
stateDiagram-v2
  [*] --> Draft: create (Requester / PM / DC)
  Draft --> Submitted: submit (author)
  Submitted --> Assigned: assign reviewer + due (PM / DC)
  Assigned --> Assigned: reassign (PM / DC)
  Assigned --> Answered: answer (assignee)
  Answered --> Answered: approve answer (PM)
  Answered --> Assigned: return answer with reason (PM)
  Answered --> Closed: close (PM, answer approved)
  Closed --> Reopened: reopen with reason (PM / author)
  Reopened --> Assigned: assign (PM / DC)
```

### Submittal

```mermaid
stateDiagram-v2
  [*] --> Submitted: create with revision + reviewer (PM / DC)
  Submitted --> InReview: start review (assigned reviewer)
  InReview --> Approved: decide (assigned reviewer)
  InReview --> ApprovedWithComments: decide (assigned reviewer)
  InReview --> ReviseAndResubmit: decide (assigned reviewer)
  Approved --> Final: finalize (PM / DC)
  ApprovedWithComments --> Final: finalize (PM / DC)
  ReviseAndResubmit --> Submitted: resubmit with newer revision, cycle + 1 (PM / DC)
```

Decisions also update `DocumentRevision.ApprovalStatus` (the one mutable revision column group) with its own audit
event.

## Background services

| Service | Interval | Behaviour |
| --- | --- | --- |
| `DatabaseInitializer` | startup | migrations + idempotent sample seed (when enabled) |
| `GuestCleanupService` | `Demo:CleanupIntervalMinutes` (15) | purges expired guest tenants and their files |
| `OverdueReminderService` | `Reminders:IntervalMinutes` (60) | reads `vw_ReviewQueue`, inserts one `Overdue` notification per item, assignee and UTC day (unique `DedupeKey`), up to `Reminders:MaxAttempts` (3) attempts with exponential back-off, failures logged |

## Guided demo task

`WalkthroughService` (Angular) tracks the guided task per guest workspace in the browser: open the HVAC spec →
inspect version history → raise an RFI on R1 page 3 → (PM) assign → (Reviewer) answer → (PM) approve → close →
audit trail. Steps advance only when the real API call succeeds for the RFI created during the tour.
