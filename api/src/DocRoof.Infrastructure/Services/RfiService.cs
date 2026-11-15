using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Domain.Workflows;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Infrastructure.Services;

/// <summary>Adds notification rows to the current unit of work.</summary>
public sealed class Notifier(DocRoofDbContext db, TimeProvider clock)
{
    public void Notify(Guid recipientId, Guid projectId, NotificationKind kind, ResourceType resource, Guid resourceId, string message, Guid? exceptUserId = null)
    {
        if (recipientId == exceptUserId)
        {
            return;
        }

        db.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            RecipientId = recipientId,
            ProjectId = projectId,
            Kind = kind,
            Resource = resource,
            ResourceId = resourceId,
            Message = message.Length > 500 ? message[..500] : message,
            CreatedAt = clock.GetUtcNow().UtcDateTime,
        });
    }

    public async Task NotifyRoleAsync(Guid projectId, ProjectRole role, NotificationKind kind, ResourceType resource, Guid resourceId, string message, Guid? exceptUserId, CancellationToken ct)
    {
        var recipients = await db.ProjectMemberships.Where(m => m.ProjectId == projectId && m.Role == role).Select(m => m.UserId).ToListAsync(ct);
        foreach (var r in recipients)
        {
            Notify(r, projectId, kind, resource, resourceId, message, exceptUserId);
        }
    }
}

/// <summary>Shared helpers for workflow services.</summary>
public static class WorkflowGuard
{
    public static void Enforce<TState>(TransitionResult<TState> result)
        where TState : struct, Enum
    {
        if (result.Allowed)
        {
            return;
        }

        throw result.Failure == TransitionFailure.Forbidden
            ? new ForbiddenException(result.Message)
            : new ConflictException(result.Message);
    }

    /// <summary>Optimistic concurrency: the client must send the rowversion it last saw.</summary>
    public static void CheckRowVersion<T>(DocRoofDbContext db, T entity, byte[] current, string? clientRowVersion)
        where T : class
    {
        byte[] expected;
        try
        {
            expected = Convert.FromBase64String(clientRowVersion ?? "");
        }
        catch (FormatException)
        {
            throw new RequestValidationException("rowVersion", "rowVersion is not valid base64.");
        }

        if (!expected.AsSpan().SequenceEqual(current))
        {
            throw new ConflictException("This record was changed by someone else. Reload it and try again.");
        }

        db.Entry(entity).Property("RowVersion").OriginalValue = expected;
    }

    public static async Task<TResult> InTransactionAsync<TResult>(DocRoofDbContext db, Func<Task<TResult>> work, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var result = await work();
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return result;
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None);
            db.ChangeTracker.Clear();
            throw;
        }
    }
}

public sealed class RfiService(
    DocRoofDbContext db,
    IProjectAccessService access,
    AuditWriter audit,
    Notifier notifier,
    UserDirectory directory,
    TimeProvider clock)
{
    private static readonly RfiState[] OpenStates = [RfiState.Submitted, RfiState.Assigned, RfiState.Answered, RfiState.Reopened];

    public async Task<PagedResult<RfiListItemDto>> ListAsync(Guid projectId, RfiQuery query, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct);
        var (page, pageSize) = Paging.Normalize(query.Page, query.PageSize);
        var now = clock.GetUtcNow().UtcDateTime;
        var q = db.Rfis.AsNoTracking().Where(r => r.ProjectId == projectId);

        // Drafts are private to their author.
        q = q.Where(r => r.State != RfiState.Draft || r.CreatedById == acc.UserId);
        if (query.State is { } state)
        {
            q = q.Where(r => r.State == state);
        }

        if (!string.IsNullOrWhiteSpace(query.Assignee))
        {
            var assignee = query.Assignee == "me" ? acc.UserId : Guid.TryParse(query.Assignee, out var g) ? g : Guid.Empty;
            q = q.Where(r => r.AssigneeId == assignee);
        }

        if (query.Due == "overdue")
        {
            q = q.Where(r => OpenStates.Contains(r.State) && r.DueAt < now);
        }
        else if (query.Due == "week")
        {
            var weekEnd = now.AddDays(7);
            q = q.Where(r => OpenStates.Contains(r.State) && r.DueAt >= now && r.DueAt <= weekEnd);
        }

        if (query.Discipline is { } discipline)
        {
            q = q.Where(r => r.SourceRevision!.Document!.Discipline == discipline);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            q = q.Where(r => r.ReferenceNumber.Contains(term) || r.Subject.Contains(term));
        }

        var total = await q.CountAsync(ct);
        var rows = await q.OrderByDescending(r => r.UpdatedAt).ThenBy(r => r.ReferenceNumber)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(r => new
            {
                Rfi = r,
                Rev = r.SourceRevision!,
                Doc = r.SourceRevision!.Document!,
                CurrentLabel = r.SourceRevision!.Document!.CurrentRevision!.VersionLabel,
            })
            .ToListAsync(ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var items = rows.Select(x => new RfiListItemDto(
            x.Rfi.Id, x.Rfi.ReferenceNumber, x.Rfi.Subject, x.Rfi.State, x.Doc.Discipline, Ref(x.Rfi.AssigneeId, names), x.Rfi.DueAt,
            DueDates.IsOverdue(x.Rfi.DueAt, now, OpenStates.Contains(x.Rfi.State)), DueDates.DaysOverdue(x.Rfi.DueAt, now),
            Ref(x.Rfi.CreatedById, names)!, x.Rfi.CreatedAt,
            Citation(x.Doc, x.Rev, x.Rfi.SourcePage, x.CurrentLabel))).ToList();
        return new PagedResult<RfiListItemDto>(items, page, pageSize, total);
    }

    public async Task<RfiDetailDto> GetAsync(Guid id, CancellationToken ct)
    {
        var (rfi, acc) = await LoadAsync(id, ct);
        return await ToDetailAsync(rfi, acc, ct);
    }

    public async Task<RfiDetailDto> CreateAsync(Guid projectId, CreateRfiRequest req, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct, RfiWorkflow.CreatorRoles);
        var revision = await db.DocumentRevisions.AsNoTracking().Include(r => r.Document)
            .FirstOrDefaultAsync(r => r.Id == req.SourceRevisionId, ct);

        // The cited revision must belong to the same project; otherwise report it as missing (no existence leak).
        if (revision is null || revision.Document!.ProjectId != projectId)
        {
            throw new RequestValidationException("sourceRevisionId", "The cited revision was not found in this project.");
        }

        var page = req.SourcePage!.Value;
        var pageCount = revision.PageCount ?? 1;
        if (page < 1 || page > pageCount)
        {
            throw new RequestValidationException("sourcePage", $"Page {page} is outside the cited revision (1-{pageCount}).");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var created = await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            var next = await NextReferenceAsync(projectId, ct);
            var rfi = new Rfi
            {
                Id = Guid.NewGuid(),
                ProjectId = projectId,
                ReferenceNumber = next,
                Subject = req.Subject.Trim(),
                Question = req.Question.Trim(),
                SourceRevisionId = revision.Id,
                SourcePage = page,
                State = RfiState.Draft,
                CreatedById = acc.UserId,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Rfis.Add(rfi);
            audit.Add(acc, ResourceType.Rfi, rfi.Id, "rfi.created",
                after: new { rfi.ReferenceNumber, rfi.Subject, Revision = revision.VersionLabel, SourcePage = page, State = RfiState.Draft });
            if (req.Submit)
            {
                rfi.State = RfiState.Submitted;
                rfi.SubmittedAt = now;
                audit.Add(acc, ResourceType.Rfi, rfi.Id, "rfi.submitted", new { State = RfiState.Draft }, new { State = RfiState.Submitted });
                await NotifySubmittedAsync(rfi, acc, ct);
            }

            return rfi;
        }, ct);
        return await GetAsync(created.Id, ct);
    }

    public Task<RfiDetailDto> SubmitAsync(Guid id, RowVersionRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.Submit, req.RowVersion, async (rfi, acc, now) =>
        {
            rfi.SubmittedAt = now;
            await NotifySubmittedAsync(rfi, acc, ct);
            return new { State = RfiState.Submitted };
        }, ct);

    public Task<RfiDetailDto> AssignAsync(Guid id, AssignRfiRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.Assign, req.RowVersion, async (rfi, acc, now) =>
        {
            var assignee = req.AssigneeId!.Value;
            var isReviewer = await db.ProjectMemberships.AnyAsync(m => m.ProjectId == rfi.ProjectId && m.UserId == assignee && m.Role == ProjectRole.Reviewer, ct);
            if (!isReviewer)
            {
                throw new RequestValidationException("assigneeId", "The assignee must be a reviewer on this project.");
            }

            var due = DateTime.SpecifyKind(req.DueAt!.Value, DateTimeKind.Utc);
            if (due <= now)
            {
                throw new RequestValidationException("dueAt", "The due date must be in the future.");
            }

            rfi.AssigneeId = assignee;
            rfi.DueAt = due;
            notifier.Notify(assignee, rfi.ProjectId, NotificationKind.Assigned, ResourceType.Rfi, rfi.Id,
                $"{rfi.ReferenceNumber} was assigned to you (due {due:yyyy-MM-dd}).", acc.UserId);
            var names = await directory.NamesAsync(acc.TenantId, ct);
            return new { State = RfiState.Assigned, Assignee = names.GetValueOrDefault(assignee), DueAt = due };
        }, ct);

    public Task<RfiDetailDto> AnswerAsync(Guid id, AnswerRfiRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.Answer, req.RowVersion, async (rfi, acc, now) =>
        {
            var response = new RfiResponse
            {
                Id = Guid.NewGuid(),
                RfiId = rfi.Id,
                AuthorId = acc.UserId,
                Answer = req.Answer.Trim(),
                CreatedAt = now,
                Status = RfiResponseStatus.Pending,
            };
            db.RfiResponses.Add(response);
            rfi.AnsweredAt = now;
            await notifier.NotifyRoleAsync(rfi.ProjectId, ProjectRole.ProjectManager, NotificationKind.Answered, ResourceType.Rfi, rfi.Id,
                $"{rfi.ReferenceNumber} has an answer awaiting approval.", acc.UserId, ct);
            return new { State = RfiState.Answered, ResponseId = response.Id };
        }, ct);

    public Task<RfiDetailDto> ApproveAnswerAsync(Guid id, RowVersionRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.ApproveAnswer, req.RowVersion, async (rfi, acc, now) =>
        {
            var response = await PendingResponseAsync(rfi.Id, ct);
            response.Status = RfiResponseStatus.Approved;
            response.ApprovedById = acc.UserId;
            response.ApprovedAt = now;
            rfi.ApprovedResponseId = response.Id;
            notifier.Notify(rfi.CreatedById, rfi.ProjectId, NotificationKind.AnswerApproved, ResourceType.Rfi, rfi.Id,
                $"The answer to {rfi.ReferenceNumber} was approved.", acc.UserId);
            return new { ApprovedResponseId = response.Id };
        }, ct, auditAction: "rfi.answer-approved");

    public Task<RfiDetailDto> RejectAnswerAsync(Guid id, ReasonRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.RejectAnswer, req.RowVersion, async (rfi, acc, now) =>
        {
            var response = await PendingResponseAsync(rfi.Id, ct);
            response.Status = RfiResponseStatus.Rejected;
            response.RejectedById = acc.UserId;
            response.RejectedAt = now;
            response.RejectionReason = req.Reason.Trim();
            if (rfi.AssigneeId is { } assignee)
            {
                notifier.Notify(assignee, rfi.ProjectId, NotificationKind.AnswerRejected, ResourceType.Rfi, rfi.Id,
                    $"The answer to {rfi.ReferenceNumber} was returned: {response.RejectionReason}", acc.UserId);
            }

            return new { State = RfiState.Assigned, Reason = response.RejectionReason };
        }, ct, auditAction: "rfi.answer-rejected");

    public Task<RfiDetailDto> CloseAsync(Guid id, RowVersionRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.Close, req.RowVersion, (rfi, acc, now) =>
        {
            rfi.ClosedAt = now;
            notifier.Notify(rfi.CreatedById, rfi.ProjectId, NotificationKind.Closed, ResourceType.Rfi, rfi.Id, $"{rfi.ReferenceNumber} was closed.", acc.UserId);
            return Task.FromResult<object>(new { State = RfiState.Closed });
        }, ct);

    public Task<RfiDetailDto> ReopenAsync(Guid id, ReasonRequest req, CancellationToken ct) =>
        TransitionAsync(id, RfiAction.Reopen, req.RowVersion, async (rfi, acc, now) =>
        {
            rfi.ReopenReason = req.Reason.Trim();
            rfi.ApprovedResponseId = null;
            rfi.AssigneeId = null;
            rfi.DueAt = null;
            rfi.ClosedAt = null;
            await notifier.NotifyRoleAsync(rfi.ProjectId, ProjectRole.ProjectManager, NotificationKind.Reopened, ResourceType.Rfi, rfi.Id,
                $"{rfi.ReferenceNumber} was reopened: {rfi.ReopenReason}", acc.UserId, ct);
            return new { State = RfiState.Reopened, Reason = rfi.ReopenReason };
        }, ct);

    /// <summary>
    /// The single transition path: authorize (404/403), evaluate the state machine (403/409), check rowversion (409),
    /// then apply the change, audit event and notifications in one transaction.
    /// </summary>
    private async Task<RfiDetailDto> TransitionAsync(Guid id, RfiAction action, string rowVersion,
        Func<Rfi, ProjectAccess, DateTime, Task<object>> apply, CancellationToken ct, string? auditAction = null)
    {
        var (rfi, acc) = await LoadAsync(id, ct);
        var facts = await AnswerFactsAsync(rfi, ct);
        var result = RfiWorkflow.Evaluate(rfi.State, action, Actor(rfi, acc), facts);
        WorkflowGuard.Enforce(result);
        WorkflowGuard.CheckRowVersion(db, rfi, rfi.RowVersion, rowVersion);

        var now = clock.GetUtcNow().UtcDateTime;
        await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            var before = new { rfi.State };
            var after = await apply(rfi, acc, now);
            rfi.State = result.To!.Value;
            rfi.UpdatedAt = now;
            audit.Add(acc, ResourceType.Rfi, rfi.Id, auditAction ?? "rfi." + ActionName(action), before, after);
            return true;
        }, ct);
        db.ChangeTracker.Clear();
        return await GetAsync(id, ct);
    }

    private static string ActionName(RfiAction action) => action switch
    {
        RfiAction.Submit => "submitted",
        RfiAction.Assign => "assigned",
        RfiAction.Answer => "answered",
        RfiAction.Close => "closed",
        RfiAction.Reopen => "reopened",
        _ => action.ToString().ToLowerInvariant(),
    };

    private async Task<(Rfi Rfi, ProjectAccess Access)> LoadAsync(Guid id, CancellationToken ct)
    {
        var projectId = await db.Rfis.AsNoTracking().Where(r => r.Id == id).Select(r => (Guid?)r.ProjectId).FirstOrDefaultAsync(ct)
                        ?? throw new NotFoundException("RFI");
        ProjectAccess acc;
        try
        {
            acc = await access.RequireProjectAsync(projectId, ct);
        }
        catch (NotFoundException)
        {
            throw new NotFoundException("RFI");
        }

        var rfi = await db.Rfis.FirstAsync(r => r.Id == id, ct);
        if (rfi.State == RfiState.Draft && rfi.CreatedById != acc.UserId)
        {
            throw new NotFoundException("RFI");
        }

        return (rfi, acc);
    }

    private static RfiActor Actor(Rfi rfi, ProjectAccess acc) =>
        new(acc.Role, rfi.CreatedById == acc.UserId, rfi.AssigneeId == acc.UserId);

    private async Task<RfiAnswerFacts> AnswerFactsAsync(Rfi rfi, CancellationToken ct) => new(
        await db.RfiResponses.AnyAsync(r => r.RfiId == rfi.Id && r.Status == RfiResponseStatus.Pending, ct),
        rfi.ApprovedResponseId is not null);

    private async Task<RfiResponse> PendingResponseAsync(Guid rfiId, CancellationToken ct) =>
        await db.RfiResponses.Where(r => r.RfiId == rfiId && r.Status == RfiResponseStatus.Pending)
            .OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync(ct)
        ?? throw new ConflictException("There is no pending answer.");

    private async Task NotifySubmittedAsync(Rfi rfi, ProjectAccess acc, CancellationToken ct)
    {
        await notifier.NotifyRoleAsync(rfi.ProjectId, ProjectRole.ProjectManager, NotificationKind.ReviewRequested, ResourceType.Rfi, rfi.Id,
            $"{rfi.ReferenceNumber} was submitted and needs a reviewer.", acc.UserId, ct);
        await notifier.NotifyRoleAsync(rfi.ProjectId, ProjectRole.DocumentController, NotificationKind.ReviewRequested, ResourceType.Rfi, rfi.Id,
            $"{rfi.ReferenceNumber} was submitted and needs a reviewer.", acc.UserId, ct);
    }

    private async Task<string> NextReferenceAsync(Guid projectId, CancellationToken ct)
    {
        // Serialize numbering per project inside the transaction; the unique index is the final guard.
        var refs = await db.Rfis.FromSqlInterpolated($"SELECT * FROM Rfis WITH (UPDLOCK, HOLDLOCK) WHERE ProjectId = {projectId}")
            .Select(r => r.ReferenceNumber).ToListAsync(ct);
        var max = refs.Select(r => int.TryParse(r.Replace("RFI-", ""), out var n) ? n : 0).DefaultIfEmpty(0).Max();
        return $"RFI-{max + 1:000}";
    }

    private async Task<RfiDetailDto> ToDetailAsync(Rfi rfi, ProjectAccess acc, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var rev = await db.DocumentRevisions.AsNoTracking().Include(r => r.Document).ThenInclude(d => d!.CurrentRevision)
            .FirstAsync(r => r.Id == rfi.SourceRevisionId, ct);
        var project = await db.Projects.AsNoTracking().FirstAsync(p => p.Id == rfi.ProjectId, ct);
        var responses = await db.RfiResponses.AsNoTracking().Where(r => r.RfiId == rfi.Id).OrderBy(r => r.CreatedAt).ToListAsync(ct);
        var timeline = await TimelineAsync(db, ResourceType.Rfi, rfi.Id, names, rfi.ReferenceNumber, ct);
        var comments = await CommentService.ListCoreAsync(db, ResourceType.Rfi, rfi.Id, names, ct);
        var facts = await AnswerFactsAsync(rfi, ct);
        var actions = RfiWorkflow.AvailableActions(rfi.State, Actor(rfi, acc), facts);
        return new RfiDetailDto(rfi.Id, rfi.ProjectId, project.Code, rfi.ReferenceNumber, rfi.Subject, rfi.Question, rfi.State,
            rev.Document!.Discipline, Ref(rfi.AssigneeId, names), rfi.DueAt, DueDates.IsOverdue(rfi.DueAt, now, OpenStates.Contains(rfi.State)),
            Ref(rfi.CreatedById, names)!, rfi.CreatedAt, rfi.SubmittedAt, rfi.AnsweredAt, rfi.ClosedAt, rfi.ReopenReason, rfi.ApprovedResponseId,
            Citation(rev.Document!, rev, rfi.SourcePage, rev.Document!.CurrentRevision?.VersionLabel),
            responses.Select(r => new RfiResponseDto(r.Id, Ref(r.AuthorId, names)!, r.Answer, r.CreatedAt, r.Status, Ref(r.ApprovedById, names),
                r.ApprovedAt, Ref(r.RejectedById, names), r.RejectedAt, r.RejectionReason)).ToList(),
            timeline, comments, actions, acc.Role, Convert.ToBase64String(rfi.RowVersion));
    }

    internal static async Task<IReadOnlyList<AuditEventDto>> TimelineAsync(DocRoofDbContext db, ResourceType resource, Guid id,
        IReadOnlyDictionary<Guid, string> names, string reference, CancellationToken ct)
    {
        var events = await db.AuditEvents.AsNoTracking().Where(a => a.Resource == resource && a.ResourceId == id)
            .OrderBy(a => a.Timestamp).ThenBy(a => a.Id).ToListAsync(ct);
        return events.Select(e => DocumentService.ToDto(e, names, reference)).ToList();
    }

    private static CitationDto Citation(Document doc, DocumentRevision rev, int page, string? currentLabel) =>
        new(doc.Id, doc.DocumentNumber, doc.Title, rev.Id, rev.VersionLabel, page, rev.PageCount,
            doc.CurrentRevisionId is { } cur && cur != rev.Id, currentLabel);

    internal static UserRef? Ref(Guid? id, IReadOnlyDictionary<Guid, string> names) =>
        id is { } v ? new UserRef(v, names.GetValueOrDefault(v, "Unknown user")) : null;
}
