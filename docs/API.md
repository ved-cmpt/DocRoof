# REST API

Base path `/api`. JSON uses camelCase; enums are strings. Errors are RFC 7807 `application/problem+json` with
`title`, `status`, `detail`, `traceId` and, for validation, `errors`.

**Authentication:** cookie (`docroof.auth`, HttpOnly, SameSite=Strict, Secure outside development).
**CSRF:** every `POST/PUT/PATCH/DELETE` needs the `X-XSRF-TOKEN` header from `GET /api/auth/antiforgery` (also set
as the readable `XSRF-TOKEN` cookie). Refresh it after sign-in, sign-out and persona switches.
**Authorization:** all endpoints require a signed-in user except those marked *anonymous*. Project-scoped endpoints
check membership in the caller's tenant: non-members get **404**, members with the wrong role **403**.
The OpenAPI document is served at `/openapi/v1.json` in Development only.

| Status | Meaning |
| --- | --- |
| 400 | validation failed, bad antiforgery token, disallowed file type |
| 401 | not signed in / session expired |
| 403 | project role does not allow the action |
| 404 | not found **or** not visible to you (other tenant/project) |
| 409 | conflict: duplicate number/label, invalid transition, stale rowversion |
| 413 | upload exceeds `Storage:MaxUploadBytes` (25 MB default) |
| 429 | rate limit or demo quota |
| 503 | demo capacity reached |

## Auth

| Method & path | Notes |
| --- | --- |
| `GET /api/auth/antiforgery` | *anonymous*; returns `{ token, headerName }` and sets cookies |
| `POST /api/auth/login` | *anonymous*, rate-limited; `{ email, password }`; generic 401 on any failure; lockout after 5 failures |
| `POST /api/auth/logout` | clears the cookie |
| `GET /api/auth/me` | *anonymous*; 401 when not signed in; otherwise user, tenant, guest expiry, persona and project roles |

## Guest demo

| Method & path | Notes |
| --- | --- |
| `POST /api/demo/start` | *anonymous*, rate-limited; creates an isolated guest tenant (24 h) and signs in as the requester persona; reuses the caller's active guest workspace |
| `POST /api/demo/reset` | guest only; rebuilds only the caller's tenant and keeps the current persona |
| `GET /api/demo/personas` | guest only; personas of the caller's tenant |
| `POST /api/demo/persona` | guest only; `{ persona: "manager" }`; signs in as that persona of the same tenant |

## Projects

| Method & path | Notes |
| --- | --- |
| `GET /api/projects` | projects the caller belongs to, with role and open/overdue counts |
| `POST /api/projects` | `{ code, title, description, location }`; caller becomes Project Manager |
| `GET /api/projects/{id}` | details + members |
| `GET /api/projects/{id}/members` | members and roles |

## Documents and revisions

| Method & path | Notes |
| --- | --- |
| `GET /api/projects/{id}/documents` | filters: `search`, `discipline`, `status`, `category`, `approvalStatus`, `revision`; `sort` (`number`, `-number`, `title`, `-title`, `updated`, `-updated`); `page`, `pageSize` (max 100). Returns `{ items, page, pageSize, totalCount, totalPages }` |
| `POST /api/projects/{id}/documents` | Document Controller / Project Manager; multipart: `documentNumber`, `title`, `discipline`, `category`, optional `versionLabel` (default `R0`), `changeNote`, `file` |
| `GET /api/documents/{id}` | metadata, all revisions (newest first), caller role, `canUpload` |
| `GET /api/documents/{id}/history` | revisions + audit events for the document and its revisions |
| `GET /api/documents/{id}/compare?from=&to=` | metadata diff between two revisions (size, checksum, pages, uploader, date, notes) |
| `POST /api/documents/{id}/revisions` | Document Controller / Project Manager; multipart `file`, optional `versionLabel` (default next `R{n}`), `changeNote`. Creates a new immutable row; 409 on duplicate label |
| `GET /api/document-revisions/{id}/download` | streamed attachment, sanitized `Content-Disposition`, `X-Content-Type-Options: nosniff`, sandbox CSP, `ETag` = SHA-256 |
| `GET /api/document-revisions/{id}/preview` | inline bytes for the in-app viewer; 409 for PDFs flagged with active content |

### Upload rules

- Allowed by content (magic bytes), not by client MIME type: PDF (`%PDF-`), PNG, JPEG, and UTF-8 text without NUL
  or control characters. Executables (PE, ELF, Mach-O, shebang) are rejected explicitly.
- The file extension must match the detected type (`.pdf`, `.png`, `.jpg/.jpeg`, `.txt`).
- Unreadable or encrypted PDFs are rejected. PDFs containing `/JavaScript`, `/JS`, `/Launch`, embedded files and
  similar markers (also inside compressed object streams and hex-escaped names) are stored but marked download-only.

## Health

| Path | Notes |
| --- | --- |
| `GET /health` | *anonymous* liveness (no dependencies) |
| `GET /health/ready` | *anonymous* readiness (database reachable) |

## RFIs

All transitions take a JSON body with `rowVersion` (base64, from the last GET). A stale value returns **409**.
Every transition runs through one service path: membership (404) → state machine (403 wrong role / 409 invalid
state) → rowversion (409) → change + audit event + notifications in one transaction.

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /api/projects/{id}/rfis` | members | filters `state`, `assignee` (`me` or user id), `due` (`overdue`, `week`), `discipline`, `search`, paging. Drafts are visible to their author only |
| `POST /api/projects/{id}/rfis` | Requester, PM, DC | `{ subject, question, sourceRevisionId, sourcePage, submit }`; revision must be in the same project and the page within its page count (400 otherwise) |
| `GET /api/rfis/{id}` | members | detail with pinned citation (`newerRevisionExists`), responses, timeline, comments, `availableActions` for the caller |
| `POST /api/rfis/{id}/submit` | author | Draft → Submitted |
| `POST /api/rfis/{id}/assign` | PM, DC | `{ rowVersion, assigneeId, dueAt }` → Assigned (assignee must be a project Reviewer; due date in the future) |
| `POST /api/rfis/{id}/answer` | assignee | `{ rowVersion, answer }` → Answered |
| `POST /api/rfis/{id}/approve-answer` | PM | approves the pending answer; a second approval → 409 |
| `POST /api/rfis/{id}/reject-answer` | PM | `{ rowVersion, reason }` → back to Assigned |
| `POST /api/rfis/{id}/close` | PM | requires an approved answer → Closed |
| `POST /api/rfis/{id}/reopen` | PM or original requester | `{ rowVersion, reason }` → Reopened (then Assign again) |

## Submittals

| Method & path | Who | Notes |
| --- | --- | --- |
| `GET /api/projects/{id}/submittals` | members | filters `status`, `reviewer`, `due`, `discipline`, paging |
| `POST /api/projects/{id}/submittals` | PM, DC | `{ title, specSection, documentId, revisionId?, reviewerId, dueAt }` → Submitted (cycle 1); revision approval status → Pending |
| `GET /api/submittals/{id}` | members | detail with decisions per cycle, newer revisions, timeline, comments, `availableActions` |
| `POST /api/submittals/{id}/start-review` | assigned reviewer | Submitted → InReview |
| `POST /api/submittals/{id}/decisions` | assigned reviewer | `{ rowVersion, decision, comments }`; comments required unless `Approved`; one decision per cycle (409); updates the revision approval status through an audited path |
| `POST /api/submittals/{id}/finalize` | PM, DC | Approved / ApprovedWithComments → Final |
| `POST /api/submittals/{id}/resubmit` | PM, DC | `{ rowVersion, revisionId, dueAt? }`; ReviseAndResubmit → Submitted with a **newer** revision of the same document (cycle + 1) |

## Activity

| Method & path | Notes |
| --- | --- |
| `GET/POST /api/{documents\|rfis\|submittals}/{id}/comments` | `{ body, page?, revisionId? }`; the page must exist in the cited revision of the same project |
| `GET /api/projects/{id}/audit` | filters `resource`, `action` (prefix), `actorId`, `from`, `to`; paging (max 200) |
| `GET /api/projects/{id}/review-queue` | from `vw_ReviewQueue`; `assignee=me|{userId}`, `overdueOnly=true` |
| `GET /api/projects/{id}/insights` | live metrics: RFI turnaround median, submittal review median, open vs closed per week (12 weeks), overdue by discipline, document volume by discipline/status, state counts |
| `GET /api/notifications` | caller's unread count and latest 30 |
| `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all` | only the recipient can mark a notification (404 otherwise) |

Extraction endpoints are added in Phase 3.
