using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Domain.Workflows;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Infrastructure.Services;

public sealed class SubmittalService(
    DocRoofDbContext db,
    IProjectAccessService access,
    AuditWriter audit,
    Notifier notifier,
    UserDirectory directory,
    TimeProvider clock)
{
    private static readonly SubmittalStatus[] OpenStatuses = [SubmittalStatus.Submitted, SubmittalStatus.InReview];

    public async Task<PagedResult<SubmittalListItemDto>> ListAsync(Guid projectId, SubmittalQuery query, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct);
        var (page, pageSize) = Paging.Normalize(query.Page, query.PageSize);
        var now = clock.GetUtcNow().UtcDateTime;
        var q = db.Submittals.AsNoTracking().Where(s => s.ProjectId == projectId);
        if (query.Status is { } status)
        {
            q = q.Where(s => s.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(query.Reviewer))
        {
            var reviewer = query.Reviewer == "me" ? acc.UserId : Guid.TryParse(query.Reviewer, out var g) ? g : Guid.Empty;
            q = q.Where(s => s.AssignedReviewerId == reviewer);
        }

        if (query.Due == "overdue")
        {
            q = q.Where(s => OpenStatuses.Contains(s.Status) && s.DueAt < now);
        }
        else if (query.Due == "week")
        {
            var weekEnd = now.AddDays(7);
            q = q.Where(s => OpenStatuses.Contains(s.Status) && s.DueAt >= now && s.DueAt <= weekEnd);
        }

        if (query.Discipline is { } discipline)
        {
            q = q.Where(s => s.Document!.Discipline == discipline);
        }

        var total = await q.CountAsync(ct);
        var rows = await q.OrderBy(s => OpenStatuses.Contains(s.Status) ? 0 : 1).ThenBy(s => s.DueAt).ThenBy(s => s.Number)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(s => new { S = s, s.Document!.Discipline, s.Document.DocumentNumber, s.Revision!.VersionLabel })
            .ToListAsync(ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var items = rows.Select(x => new SubmittalListItemDto(x.S.Id, x.S.Number, x.S.Title, x.S.SpecSection, x.S.Status, x.S.Cycle,
            x.Discipline, RfiService.Ref(x.S.AssignedReviewerId, names)!, x.S.DueAt,
            DueDates.IsOverdue(x.S.DueAt, now, OpenStatuses.Contains(x.S.Status)), DueDates.DaysOverdue(x.S.DueAt, now),
            x.S.DocumentId, x.DocumentNumber, x.VersionLabel, x.S.SubmittedAt)).ToList();
        return new PagedResult<SubmittalListItemDto>(items, page, pageSize, total);
    }

    public async Task<SubmittalDetailDto> GetAsync(Guid id, CancellationToken ct)
    {
        var (s, acc) = await LoadAsync(id, ct);
        return await ToDetailAsync(s, acc, ct);
    }

    public async Task<SubmittalDetailDto> CreateAsync(Guid projectId, CreateSubmittalRequest req, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct, SubmittalWorkflow.CoordinatorRoles);
        var doc = await db.Documents.FirstOrDefaultAsync(d => d.Id == req.DocumentId && d.ProjectId == projectId, ct)
                  ?? throw new RequestValidationException("documentId", "The document was not found in this project.");
        var revisionId = req.RevisionId ?? doc.CurrentRevisionId ?? throw new RequestValidationException("revisionId", "The document has no revision.");
        var revision = await db.DocumentRevisions.FirstOrDefaultAsync(r => r.Id == revisionId && r.DocumentId == doc.Id, ct)
                       ?? throw new RequestValidationException("revisionId", "The revision does not belong to this document.");
        await RequireReviewerAsync(projectId, req.ReviewerId!.Value, ct);
        var now = clock.GetUtcNow().UtcDateTime;
        var due = FutureDue(req.DueAt!.Value, now);

        var created = await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            var numbers = await db.Submittals.FromSqlInterpolated($"SELECT * FROM Submittals WITH (UPDLOCK, HOLDLOCK) WHERE ProjectId = {projectId}")
                .Select(s => s.Number).ToListAsync(ct);
            var max = numbers.Select(n => int.TryParse(n.Replace("SUB-", ""), out var v) ? v : 0).DefaultIfEmpty(0).Max();
            var s = new Submittal
            {
                Id = Guid.NewGuid(),
                ProjectId = projectId,
                Number = $"SUB-{max + 1:000}",
                Title = req.Title.Trim(),
                SpecSection = req.SpecSection.Trim(),
                DocumentId = doc.Id,
                RevisionId = revision.Id,
                Status = SubmittalStatus.Submitted,
                Cycle = 1,
                AssignedReviewerId = req.ReviewerId!.Value,
                DueAt = due,
                SubmittedById = acc.UserId,
                SubmittedAt = now,
                UpdatedAt = now,
            };
            db.Submittals.Add(s);
            SetRevisionStatus(acc, revision, RevisionApprovalStatus.Pending, now);
            audit.Add(acc, ResourceType.Submittal, s.Id, "submittal.submitted", null,
                new { s.Number, Status = SubmittalStatus.Submitted, Cycle = 1, Revision = revision.VersionLabel, DueAt = due });
            notifier.Notify(s.AssignedReviewerId, projectId, NotificationKind.ReviewRequested, ResourceType.Submittal, s.Id,
                $"{s.Number} ({s.Title}) is ready for your review.", acc.UserId);
            return s;
        }, ct);
        return await GetAsync(created.Id, ct);
    }

    public Task<SubmittalDetailDto> StartReviewAsync(Guid id, RowVersionRequest req, CancellationToken ct) =>
        TransitionAsync(id, SubmittalAction.StartReview, req.RowVersion, null, (s, acc, now) =>
        {
            s.ReviewStartedAt = now;
            return Task.FromResult<object>(new { Status = SubmittalStatus.InReview, s.Cycle });
        }, ct, "submittal.review-started");

    public Task<SubmittalDetailDto> DecideAsync(Guid id, DecisionRequest req, CancellationToken ct) =>
        TransitionAsync(id, SubmittalAction.Decide, req.RowVersion, req.Decision, async (s, acc, now) =>
        {
            var decision = req.Decision!.Value;
            if (decision != ReviewDecisionType.Approved && string.IsNullOrWhiteSpace(req.Comments))
            {
                throw new RequestValidationException("comments", "Comments are required unless the submittal is approved as submitted.");
            }

            if (await db.ReviewDecisions.AnyAsync(d => d.SubmittalId == s.Id && d.Cycle == s.Cycle, ct))
            {
                throw new ConflictException("A decision has already been recorded for this review cycle.");
            }

            db.ReviewDecisions.Add(new ReviewDecision
            {
                Id = Guid.NewGuid(),
                SubmittalId = s.Id,
                Cycle = s.Cycle,
                RevisionId = s.RevisionId,
                ReviewerId = acc.UserId,
                Decision = decision,
                Comments = req.Comments.Trim(),
                CreatedAt = now,
            });
            s.DecidedAt = now;
            var revision = await db.DocumentRevisions.FirstAsync(r => r.Id == s.RevisionId, ct);
            SetRevisionStatus(acc, revision, SubmittalWorkflow.ToRevisionStatus(decision), now);
            notifier.Notify(s.SubmittedById, s.ProjectId, NotificationKind.DecisionRecorded, ResourceType.Submittal, s.Id,
                $"{s.Number}: {decision} (cycle {s.Cycle}).", acc.UserId);
            await notifier.NotifyRoleAsync(s.ProjectId, ProjectRole.ProjectManager, NotificationKind.DecisionRecorded, ResourceType.Submittal, s.Id,
                $"{s.Number}: {decision} (cycle {s.Cycle}).", acc.UserId, ct);
            return new { Status = decision.ToString(), s.Cycle, Comments = req.Comments.Trim() };
        }, ct, "submittal.decided");

    public Task<SubmittalDetailDto> FinalizeAsync(Guid id, RowVersionRequest req, CancellationToken ct) =>
        TransitionAsync(id, SubmittalAction.Finalize, req.RowVersion, null, (s, acc, now) =>
        {
            s.FinalizedAt = now;
            s.FinalizedById = acc.UserId;
            notifier.Notify(s.AssignedReviewerId, s.ProjectId, NotificationKind.Finalized, ResourceType.Submittal, s.Id, $"{s.Number} was finalized.", acc.UserId);
            return Task.FromResult<object>(new { Status = SubmittalStatus.Final });
        }, ct, "submittal.finalized");

    /// <summary>ReviseAndResubmit → Submitted with a new revision of the same document (a new review cycle).</summary>
    public Task<SubmittalDetailDto> ResubmitAsync(Guid id, ResubmitRequest req, CancellationToken ct) =>
        TransitionAsync(id, SubmittalAction.Resubmit, req.RowVersion, null, async (s, acc, now) =>
        {
            var current = await db.DocumentRevisions.AsNoTracking().FirstAsync(r => r.Id == s.RevisionId, ct);
            var revision = await db.DocumentRevisions.FirstOrDefaultAsync(r => r.Id == req.RevisionId && r.DocumentId == s.DocumentId, ct)
                           ?? throw new RequestValidationException("revisionId", "The revision does not belong to this submittal's document.");
            if (revision.Id == current.Id || revision.UploadedAt <= current.UploadedAt)
            {
                throw new ConflictException("Resubmission requires a newer revision. Upload a new revision first.");
            }

            s.Cycle += 1;
            s.RevisionId = revision.Id;
            s.SubmittedAt = now;
            s.ReviewStartedAt = null;
            s.DecidedAt = null;
            s.DueAt = req.DueAt is { } due ? FutureDue(due, now) : now.AddDays(10);
            SetRevisionStatus(acc, revision, RevisionApprovalStatus.Pending, now);
            notifier.Notify(s.AssignedReviewerId, s.ProjectId, NotificationKind.ReviewRequested, ResourceType.Submittal, s.Id,
                $"{s.Number} was resubmitted with {revision.VersionLabel} (cycle {s.Cycle}).", acc.UserId);
            return new { Status = SubmittalStatus.Submitted, s.Cycle, Revision = revision.VersionLabel, s.DueAt };
        }, ct, "submittal.resubmitted");

    private async Task<SubmittalDetailDto> TransitionAsync(Guid id, SubmittalAction action, string rowVersion, ReviewDecisionType? decision,
        Func<Submittal, ProjectAccess, DateTime, Task<object>> apply, CancellationToken ct, string auditAction)
    {
        var (s, acc) = await LoadAsync(id, ct);
        var result = SubmittalWorkflow.Evaluate(s.Status, action, new SubmittalActor(acc.Role, s.AssignedReviewerId == acc.UserId), decision);
        WorkflowGuard.Enforce(result);
        WorkflowGuard.CheckRowVersion(db, s, s.RowVersion, rowVersion);
        var now = clock.GetUtcNow().UtcDateTime;
        await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            var before = new { s.Status, s.Cycle };
            var after = await apply(s, acc, now);
            s.Status = result.To!.Value;
            s.UpdatedAt = now;
            audit.Add(acc, ResourceType.Submittal, s.Id, auditAction, before, after);
            return true;
        }, ct);
        db.ChangeTracker.Clear();
        return await GetAsync(id, ct);
    }

    /// <summary>The audited path for the one mutable revision column group (approval status).</summary>
    private void SetRevisionStatus(ProjectAccess acc, DocumentRevision revision, RevisionApprovalStatus status, DateTime now)
    {
        var before = revision.ApprovalStatus;
        revision.ApprovalStatus = status;
        revision.ApprovalUpdatedAt = now;
        audit.Add(acc, ResourceType.DocumentRevision, revision.Id, "revision.approval-status", new { ApprovalStatus = before }, new { ApprovalStatus = status });
    }

    private async Task RequireReviewerAsync(Guid projectId, Guid userId, CancellationToken ct)
    {
        if (!await db.ProjectMemberships.AnyAsync(m => m.ProjectId == projectId && m.UserId == userId && m.Role == ProjectRole.Reviewer, ct))
        {
            throw new RequestValidationException("reviewerId", "The reviewer must be a reviewer on this project.");
        }
    }

    private static DateTime FutureDue(DateTime due, DateTime now)
    {
        var utc = DateTime.SpecifyKind(due, DateTimeKind.Utc);
        return utc <= now ? throw new RequestValidationException("dueAt", "The due date must be in the future.") : utc;
    }

    private async Task<(Submittal Submittal, ProjectAccess Access)> LoadAsync(Guid id, CancellationToken ct)
    {
        var projectId = await db.Submittals.AsNoTracking().Where(s => s.Id == id).Select(s => (Guid?)s.ProjectId).FirstOrDefaultAsync(ct)
                        ?? throw new NotFoundException("Submittal");
        try
        {
            var acc = await access.RequireProjectAsync(projectId, ct);
            return (await db.Submittals.FirstAsync(s => s.Id == id, ct), acc);
        }
        catch (NotFoundException)
        {
            throw new NotFoundException("Submittal");
        }
    }

    private async Task<SubmittalDetailDto> ToDetailAsync(Submittal s, ProjectAccess acc, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var doc = await db.Documents.AsNoTracking().FirstAsync(d => d.Id == s.DocumentId, ct);
        var project = await db.Projects.AsNoTracking().FirstAsync(p => p.Id == s.ProjectId, ct);
        var revisions = await db.DocumentRevisions.AsNoTracking().Where(r => r.DocumentId == s.DocumentId).ToListAsync(ct);
        var current = revisions.First(r => r.Id == s.RevisionId);
        var newer = revisions.Where(r => r.UploadedAt > current.UploadedAt).OrderBy(r => r.UploadedAt)
            .Select(r => new RevisionChipDto(r.Id, r.VersionLabel, r.Id == doc.CurrentRevisionId, r.ApprovalStatus)).ToList();
        var labels = revisions.ToDictionary(r => r.Id, r => r.VersionLabel);
        var decisions = await db.ReviewDecisions.AsNoTracking().Where(d => d.SubmittalId == s.Id).OrderBy(d => d.Cycle).ToListAsync(ct);
        var timeline = await RfiService.TimelineAsync(db, ResourceType.Submittal, s.Id, names, s.Number, ct);
        var comments = await CommentService.ListCoreAsync(db, ResourceType.Submittal, s.Id, names, ct);
        var actions = SubmittalWorkflow.AvailableActions(s.Status, new SubmittalActor(acc.Role, s.AssignedReviewerId == acc.UserId))
            .Where(a => a != SubmittalAction.Resubmit || newer.Count > 0).ToList();
        return new SubmittalDetailDto(s.Id, s.ProjectId, project.Code, s.Number, s.Title, s.SpecSection, s.Status, s.Cycle, doc.Discipline,
            RfiService.Ref(s.AssignedReviewerId, names)!, s.DueAt, DueDates.IsOverdue(s.DueAt, now, OpenStatuses.Contains(s.Status)),
            RfiService.Ref(s.SubmittedById, names)!, s.SubmittedAt, s.ReviewStartedAt, s.DecidedAt, s.FinalizedAt, doc.Id, doc.DocumentNumber,
            doc.Title, current.Id, current.VersionLabel, current.ApprovalStatus, newer,
            decisions.Select(d => new DecisionDto(d.Id, d.Cycle, d.RevisionId, labels.GetValueOrDefault(d.RevisionId, "?"),
                RfiService.Ref(d.ReviewerId, names)!, d.Decision, d.Comments, d.CreatedAt)).ToList(),
            timeline, comments, actions, acc.Role, Convert.ToBase64String(s.RowVersion));
    }
}
