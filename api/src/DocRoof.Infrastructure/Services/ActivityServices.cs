using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Domain.Workflows;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DocRoof.Infrastructure.Services;

/// <summary>Comments with optional page citations on documents, RFIs and submittals.</summary>
public sealed class CommentService(DocRoofDbContext db, IProjectAccessService access, AuditWriter audit, Notifier notifier, UserDirectory directory, TimeProvider clock)
{
    public static readonly ResourceType[] Commentable = [ResourceType.Document, ResourceType.Rfi, ResourceType.Submittal];

    public async Task<IReadOnlyList<CommentDto>> ListAsync(ResourceType resource, Guid resourceId, CancellationToken ct)
    {
        var (_, acc) = await ResolveAsync(resource, resourceId, ct);
        return await ListCoreAsync(db, resource, resourceId, await directory.NamesAsync(acc.TenantId, ct), ct);
    }

    public async Task<CommentDto> AddAsync(ResourceType resource, Guid resourceId, CreateCommentRequest req, CancellationToken ct)
    {
        var (projectId, acc) = await ResolveAsync(resource, resourceId, ct);
        int? page = req.Page;
        Guid? revisionId = req.RevisionId;
        if (revisionId is { } rid)
        {
            var rev = await db.DocumentRevisions.AsNoTracking().Include(r => r.Document)
                .FirstOrDefaultAsync(r => r.Id == rid && r.Document!.ProjectId == projectId, ct)
                ?? throw new RequestValidationException("revisionId", "The cited revision was not found in this project.");
            if (page is { } p && (p < 1 || p > (rev.PageCount ?? 1)))
            {
                throw new RequestValidationException("page", $"Page {p} is outside the cited revision (1-{rev.PageCount ?? 1}).");
            }
        }
        else if (page is not null && resource != ResourceType.Document)
        {
            throw new RequestValidationException("revisionId", "A page citation needs the revision it refers to.");
        }

        var comment = new Comment
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            Resource = resource,
            ResourceId = resourceId,
            AuthorId = acc.UserId,
            Body = req.Body.Trim(),
            Page = page,
            RevisionId = revisionId,
            CreatedAt = clock.GetUtcNow().UtcDateTime,
        };
        await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            db.Comments.Add(comment);
            audit.Add(acc, resource, resourceId, "comment.added", null, new { CommentId = comment.Id, Page = page });
            if (resource == ResourceType.Rfi)
            {
                var rfi = await db.Rfis.AsNoTracking().FirstAsync(r => r.Id == resourceId, ct);
                foreach (var recipient in new[] { rfi.CreatedById, rfi.AssigneeId }.OfType<Guid>().Distinct())
                {
                    notifier.Notify(recipient, projectId, NotificationKind.Commented, resource, resourceId, $"New comment on {rfi.ReferenceNumber}.", acc.UserId);
                }
            }

            return true;
        }, ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        return (await ListCoreAsync(db, resource, resourceId, names, ct)).First(c => c.Id == comment.Id);
    }

    internal static async Task<IReadOnlyList<CommentDto>> ListCoreAsync(DocRoofDbContext db, ResourceType resource, Guid resourceId,
        IReadOnlyDictionary<Guid, string> names, CancellationToken ct)
    {
        var rows = await (from c in db.Comments.AsNoTracking()
                          where c.Resource == resource && c.ResourceId == resourceId
                          join r in db.DocumentRevisions.AsNoTracking() on c.RevisionId equals r.Id into revs
                          from r in revs.DefaultIfEmpty()
                          orderby c.CreatedAt
                          select new { c, Label = r != null ? r.VersionLabel : null }).ToListAsync(ct);
        return rows.Select(x => new CommentDto(x.c.Id, RfiService.Ref(x.c.AuthorId, names)!, x.c.Body, x.c.Page, x.c.RevisionId, x.Label, x.c.CreatedAt)).ToList();
    }

    private async Task<(Guid ProjectId, ProjectAccess Access)> ResolveAsync(ResourceType resource, Guid id, CancellationToken ct)
    {
        Guid? projectId = resource switch
        {
            ResourceType.Document => await db.Documents.Where(d => d.Id == id).Select(d => (Guid?)d.ProjectId).FirstOrDefaultAsync(ct),
            ResourceType.Rfi => await db.Rfis.Where(r => r.Id == id && r.State != RfiState.Draft).Select(r => (Guid?)r.ProjectId).FirstOrDefaultAsync(ct),
            ResourceType.Submittal => await db.Submittals.Where(s => s.Id == id).Select(s => (Guid?)s.ProjectId).FirstOrDefaultAsync(ct),
            _ => null,
        };
        if (projectId is null)
        {
            throw new NotFoundException(resource.ToString());
        }

        try
        {
            return (projectId.Value, await access.RequireProjectAsync(projectId.Value, ct));
        }
        catch (NotFoundException)
        {
            throw new NotFoundException(resource.ToString());
        }
    }
}

public sealed class AuditService(DocRoofDbContext db, IProjectAccessService access, UserDirectory directory)
{
    public async Task<PagedResult<AuditEventDto>> ListAsync(Guid projectId, AuditQuery query, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct);
        var page = Math.Max(1, query.Page ?? 1);
        var pageSize = Math.Clamp(query.PageSize ?? 50, 1, 200);
        var q = db.AuditEvents.AsNoTracking().Where(a => a.ProjectId == projectId && a.TenantId == acc.TenantId);
        if (query.Resource is { } resource)
        {
            q = q.Where(a => a.Resource == resource);
        }

        if (!string.IsNullOrWhiteSpace(query.Action))
        {
            q = q.Where(a => a.Action.StartsWith(query.Action));
        }

        if (query.ActorId is { } actor)
        {
            q = q.Where(a => a.ActorId == actor);
        }

        if (query.From is { } from)
        {
            q = q.Where(a => a.Timestamp >= from);
        }

        if (query.To is { } to)
        {
            q = q.Where(a => a.Timestamp <= to);
        }

        var total = await q.CountAsync(ct);
        var events = await q.OrderByDescending(a => a.Timestamp).ThenByDescending(a => a.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        var refs = await ReferencesAsync(events, ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        return new PagedResult<AuditEventDto>(events.Select(e => DocumentService.ToDto(e, names, refs.GetValueOrDefault(e.ResourceId))).ToList(), page, pageSize, total);
    }

    /// <summary>Human-readable references (RFI-004, SUB-002, document number + revision) for the listed events.</summary>
    private async Task<Dictionary<Guid, string>> ReferencesAsync(IReadOnlyList<AuditEvent> events, CancellationToken ct)
    {
        var ids = events.Select(e => e.ResourceId).Distinct().ToList();
        var map = new Dictionary<Guid, string>();
        foreach (var x in await db.Rfis.Where(r => ids.Contains(r.Id)).Select(r => new { r.Id, r.ReferenceNumber }).ToListAsync(ct))
        {
            map[x.Id] = x.ReferenceNumber;
        }

        foreach (var x in await db.Submittals.Where(s => ids.Contains(s.Id)).Select(s => new { s.Id, s.Number }).ToListAsync(ct))
        {
            map[x.Id] = x.Number;
        }

        foreach (var x in await db.Documents.Where(d => ids.Contains(d.Id)).Select(d => new { d.Id, d.DocumentNumber }).ToListAsync(ct))
        {
            map[x.Id] = x.DocumentNumber;
        }

        foreach (var x in await db.DocumentRevisions.Where(r => ids.Contains(r.Id)).Select(r => new { r.Id, r.Document!.DocumentNumber, r.VersionLabel }).ToListAsync(ct))
        {
            map[x.Id] = $"{x.DocumentNumber} {x.VersionLabel}";
        }

        foreach (var x in await db.Projects.Where(p => ids.Contains(p.Id)).Select(p => new { p.Id, p.Code }).ToListAsync(ct))
        {
            map[x.Id] = x.Code;
        }

        return map;
    }
}

/// <summary>Reads the documented <c>vw_ReviewQueue</c> view.</summary>
public sealed class ReviewQueueService(DocRoofDbContext db, IProjectAccessService access, UserDirectory directory)
{
    public async Task<IReadOnlyList<ReviewQueueItemDto>> ListAsync(Guid projectId, string? assignee, bool overdueOnly, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct);
        var q = db.ReviewQueue.AsNoTracking().Where(i => i.ProjectId == projectId && i.TenantId == acc.TenantId);
        if (assignee == "me")
        {
            q = q.Where(i => i.AssigneeId == acc.UserId);
        }
        else if (Guid.TryParse(assignee, out var a))
        {
            q = q.Where(i => i.AssigneeId == a);
        }

        if (overdueOnly)
        {
            q = q.Where(i => i.IsOverdue);
        }

        var rows = await q.OrderByDescending(i => i.IsOverdue).ThenBy(i => i.DueAt == null).ThenBy(i => i.DueAt).ThenBy(i => i.Reference).ToListAsync(ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        return rows.Select(i => new ReviewQueueItemDto(i.ItemType, i.ItemId, i.Reference, i.Title, i.State, RfiService.Ref(i.AssigneeId, names),
            i.DueAt, i.Discipline, i.IsOverdue, i.DaysOverdue)).ToList();
    }
}

public sealed class NotificationService(DocRoofDbContext db, ICurrentUser user, TimeProvider clock)
{
    public async Task<NotificationFeedDto> FeedAsync(CancellationToken ct)
    {
        var me = user.UserId;
        var unread = await db.Notifications.CountAsync(n => n.RecipientId == me && n.ViewedAt == null, ct);
        var items = await db.Notifications.AsNoTracking().Where(n => n.RecipientId == me)
            .OrderByDescending(n => n.CreatedAt).Take(30)
            .Select(n => new NotificationDto(n.Id, n.ProjectId, n.Kind, n.Resource, n.ResourceId, n.Message, n.CreatedAt, n.ViewedAt != null))
            .ToListAsync(ct);
        return new NotificationFeedDto(unread, items);
    }

    public async Task MarkReadAsync(Guid id, CancellationToken ct)
    {
        var me = user.UserId;
        var updated = await db.Notifications.Where(n => n.Id == id && n.RecipientId == me && n.ViewedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ViewedAt, clock.GetUtcNow().UtcDateTime), ct);
        if (updated == 0 && !await db.Notifications.AnyAsync(n => n.Id == id && n.RecipientId == me, ct))
        {
            throw new NotFoundException("Notification");
        }
    }

    public async Task<int> MarkAllReadAsync(CancellationToken ct)
    {
        var me = user.UserId;
        return await db.Notifications.Where(n => n.RecipientId == me && n.ViewedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ViewedAt, clock.GetUtcNow().UtcDateTime), ct);
    }
}

public sealed class ReminderOptions
{
    public const string Section = "Reminders";

    public bool Enabled { get; set; } = true;
    public int IntervalMinutes { get; set; } = 60;
    public int MaxAttempts { get; set; } = 3;
}

/// <summary>
/// Creates one overdue reminder per item, recipient and UTC day. Idempotency comes from a unique, filtered
/// <c>DedupeKey</c> index, so concurrent runs or retries cannot create duplicates.
/// </summary>
public sealed class OverdueReminderService(IServiceScopeFactory scopes, IOptions<ReminderOptions> options, TimeProvider clock, ILogger<OverdueReminderService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, options.Value.IntervalMinutes)), clock);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunWithRetriesAsync(stoppingToken);
        }
    }

    public async Task<int> RunWithRetriesAsync(CancellationToken ct)
    {
        var attempts = Math.Max(1, options.Value.MaxAttempts);
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            try
            {
                return await RunOnceAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Overdue reminder run failed (attempt {Attempt} of {Attempts})", attempt, attempts);
                if (attempt == attempts)
                {
                    logger.LogError(ex, "Overdue reminder run gave up after {Attempts} attempts", attempts);
                    return 0;
                }

                await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt)), clock, ct);
            }
        }

        return 0;
    }

    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DocRoofDbContext>();
        var now = clock.GetUtcNow().UtcDateTime;
        var overdue = await db.ReviewQueue.AsNoTracking().Where(i => i.IsOverdue && i.AssigneeId != null).ToListAsync(ct);
        var candidates = overdue.Select(i => new
        {
            Item = i,
            Key = DueDates.ReminderKey(i.ItemType == "Rfi" ? ResourceType.Rfi : ResourceType.Submittal, i.ItemId, i.AssigneeId!.Value, now),
        }).ToList();
        var keys = candidates.Select(c => c.Key).ToList();
        var existing = (await db.Notifications.Where(n => n.DedupeKey != null && keys.Contains(n.DedupeKey)).Select(n => n.DedupeKey!).ToListAsync(ct)).ToHashSet();

        var created = 0;
        foreach (var c in candidates.Where(c => !existing.Contains(c.Key)))
        {
            db.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                RecipientId = c.Item.AssigneeId!.Value,
                ProjectId = c.Item.ProjectId,
                Kind = NotificationKind.Overdue,
                Resource = c.Item.ItemType == "Rfi" ? ResourceType.Rfi : ResourceType.Submittal,
                ResourceId = c.Item.ItemId,
                Message = $"{c.Item.Reference} is overdue by {Math.Max(1, c.Item.DaysOverdue ?? 1)} day(s): {c.Item.Title}",
                CreatedAt = now,
                DedupeKey = c.Key,
            });
            try
            {
                await db.SaveChangesAsync(ct);
                created++;
            }
            catch (DbUpdateException ex) when (ex.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 2601 or 2627 })
            {
                // Another run inserted the same reminder first: that is the idempotent outcome we want.
                db.ChangeTracker.Clear();
            }
        }

        if (created > 0)
        {
            logger.LogInformation("Created {Count} overdue reminders", created);
        }

        return created;
    }
}
