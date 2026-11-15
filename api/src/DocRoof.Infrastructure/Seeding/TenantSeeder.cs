using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Domain.Files;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Files;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace DocRoof.Infrastructure.Seeding;

/// <summary>Context handed to the workflow seeding step so it can resolve seeded users, projects and revisions.</summary>
public sealed class SeedContext
{
    public required Tenant Tenant { get; init; }
    public required DateTime Now { get; init; }
    public Dictionary<string, AppUser> Users { get; } = new();
    public Dictionary<string, Project> Projects { get; } = new();
    public Dictionary<string, Document> Documents { get; } = new();

    /// <summary>Revisions keyed by "documentKey/label".</summary>
    public Dictionary<string, DocumentRevision> Revisions { get; } = new();

    public DateTime DaysAgo(double days) => Now.AddDays(-days);

    public DocumentRevision Rev(string docKey, string label) => Revisions[docKey + "/" + label];
}

/// <summary>Builds a complete, isolated tenant from <see cref="SeedLibrary"/> inside one transaction.</summary>
public sealed class TenantSeeder(
    DocRoofDbContext db,
    UserManager<AppUser> users,
    IFileStorage storage,
    AuditWriter audit,
    TimeProvider clock,
    ILogger<TenantSeeder> logger)
{
    public static readonly Guid SampleTenantId = Guid.Parse("5a3f0000-0000-4000-8000-00000000d0c1");

    /// <summary>Idempotent: creates the persistent sample workspace once (used by /login demo accounts).</summary>
    public async Task EnsureSampleTenantAsync(string? demoPassword, CancellationToken ct)
    {
        if (await db.Tenants.AnyAsync(t => t.Id == SampleTenantId, ct))
        {
            logger.LogInformation("Sample tenant already seeded; skipping");
            return;
        }

        var tenant = new Tenant { Id = SampleTenantId, Name = "DocRoof Sample Workspace", IsGuest = false, CreatedAt = clock.GetUtcNow().UtcDateTime };
        await SeedAsync(tenant, "sample", demoPassword, isNewTenant: true, ct);
    }

    /// <summary>Seeds all content for a tenant. When <paramref name="isNewTenant"/> is false the tenant row already exists (demo reset).</summary>
    public async Task<SeedContext> SeedAsync(Tenant tenant, string userPrefix, string? password, bool isNewTenant, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var ctx = await SeedCoreAsync(tenant, userPrefix, password, isNewTenant, ct);
            await tx.CommitAsync(ct);
            db.ChangeTracker.Clear();
            logger.LogInformation("Seeded tenant {TenantId} ({Documents} documents)", tenant.Id, ctx.Documents.Count);
            return ctx;
        });
    }

    private async Task<SeedContext> SeedCoreAsync(Tenant tenant, string userPrefix, string? password, bool isNewTenant, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var ctx = new SeedContext { Tenant = tenant, Now = now };
        if (isNewTenant)
        {
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync(ct);
        }

        foreach (var persona in SeedLibrary.Personas)
        {
            var email = $"{persona.Key}.{userPrefix}@docroof.test".ToLowerInvariant();
            var user = new AppUser
            {
                Id = Guid.NewGuid(),
                TenantId = tenant.Id,
                UserName = email,
                Email = email,
                EmailConfirmed = true,
                DisplayName = persona.DisplayName,
                JobTitle = persona.JobTitle,
                PersonaKey = persona.Key,
                LockoutEnabled = true,
            };
            var result = string.IsNullOrEmpty(password) ? await users.CreateAsync(user) : await users.CreateAsync(user, password);
            if (!result.Succeeded)
            {
                throw new InvalidOperationException("Seeding user failed: " + string.Join("; ", result.Errors.Select(e => e.Description)));
            }

            ctx.Users[persona.Key] = user;
        }

        foreach (var sp in SeedLibrary.Projects)
        {
            var project = new Project
            {
                Id = Guid.NewGuid(),
                TenantId = tenant.Id,
                Code = sp.Code,
                Title = sp.Title,
                Description = sp.Description,
                Location = sp.Location,
                CreatedAt = ctx.DaysAgo(70),
            };
            db.Projects.Add(project);
            ctx.Projects[sp.Code] = project;
            audit.Add(tenant.Id, project.Id, ctx.Users["manager"].Id, ResourceType.Project, project.Id, "project.created", after: new { project.Code, project.Title }, at: project.CreatedAt);
        }

        foreach (var persona in SeedLibrary.Personas)
        {
            foreach (var code in persona.ProjectCodes)
            {
                db.ProjectMemberships.Add(new ProjectMembership
                {
                    Id = Guid.NewGuid(),
                    ProjectId = ctx.Projects[code].Id,
                    UserId = ctx.Users[persona.Key].Id,
                    Role = persona.Role,
                    CreatedAt = ctx.DaysAgo(70),
                });
            }
        }

        foreach (var sd in SeedLibrary.Documents)
        {
            var project = ctx.Projects[sd.ProjectCode];
            var firstUpload = ctx.DaysAgo(sd.Revisions[0].DaysAgo);
            var doc = new Document
            {
                Id = Guid.NewGuid(),
                ProjectId = project.Id,
                DocumentNumber = sd.Number,
                Title = sd.Title,
                Discipline = sd.Discipline,
                Category = sd.Category,
                Status = sd.Status,
                CreatedById = ctx.Users["controller"].Id,
                CreatedAt = firstUpload,
                UpdatedAt = ctx.DaysAgo(sd.Revisions[^1].DaysAgo),
            };
            db.Documents.Add(doc);
            ctx.Documents[sd.Key] = doc;
            audit.Add(tenant.Id, project.Id, doc.CreatedById, ResourceType.Document, doc.Id, "document.created",
                after: new { doc.DocumentNumber, doc.Title, doc.Discipline, doc.Category }, at: firstUpload);

            DocumentRevision? previous = null;
            foreach (var sr in sd.Revisions)
            {
                var bytes = sr.Content();
                var type = FileSignatures.Detect(bytes);
                var revision = new DocumentRevision
                {
                    Id = Guid.NewGuid(),
                    DocumentId = doc.Id,
                    VersionLabel = sr.Label,
                    StorageKey = StorageKeys.New(tenant.Id),
                    Sha256 = Checksums.Sha256Hex(bytes),
                    FileName = FileNameSanitizer.Sanitize(sr.FileName),
                    MimeType = FileSignatures.MimeType(type),
                    ByteSize = bytes.LongLength,
                    ChangeNote = sr.ChangeNote,
                    UploadedById = ctx.Users[sr.UploadedBy].Id,
                    UploadedAt = ctx.DaysAgo(sr.DaysAgo),
                    SupersedesRevisionId = previous?.Id,
                    ApprovalStatus = RevisionApprovalStatus.NotReviewed,
                };
                ApplyContentFacts(revision, type, bytes);
                await storage.SaveAsync(revision.StorageKey, tenant.Id, bytes, ct);
                db.DocumentRevisions.Add(revision);
                ctx.Revisions[sd.Key + "/" + sr.Label] = revision;
                audit.Add(tenant.Id, project.Id, revision.UploadedById, ResourceType.DocumentRevision, revision.Id,
                    previous is null ? "revision.uploaded" : "revision.superseded",
                    before: previous is null ? null : new { previous.VersionLabel, previous.Sha256 },
                    after: new { revision.VersionLabel, revision.Sha256, revision.ByteSize, revision.FileName },
                    at: revision.UploadedAt);
                previous = revision;
            }
        }

        // Insert documents and revisions first, then point each document at its latest revision (circular FK).
        await db.SaveChangesAsync(ct);
        foreach (var sd in SeedLibrary.Documents)
        {
            ctx.Documents[sd.Key].CurrentRevisionId = ctx.Rev(sd.Key, sd.Revisions[^1].Label).Id;
        }

        await db.SaveChangesAsync(ct);

        await WorkflowSeed.SeedAsync(db, audit, ctx, ct);
        await db.SaveChangesAsync(ct);
        return ctx;
    }

    /// <summary>Page count, text-layer and active-content facts captured once at insert time.</summary>
    public static void ApplyContentFacts(DocumentRevision revision, DetectedFileType type, byte[] bytes)
    {
        switch (type)
        {
            case DetectedFileType.Pdf:
                var info = PdfInspector.Inspect(bytes);
                revision.PageCount = info.PageCount;
                revision.HasTextLayer = info.HasTextLayer;
                revision.HasActiveContent = info.HasActiveContent;
                break;
            case DetectedFileType.Text:
                revision.PageCount = Math.Max(1, System.Text.Encoding.UTF8.GetString(bytes).Split('\f').Length);
                revision.HasTextLayer = true;
                break;
            default:
                revision.PageCount = 1;
                revision.HasTextLayer = false;
                break;
        }
    }
}

/// <summary>Deletes every row and file that belongs to a tenant (guest cleanup and demo reset).</summary>
public sealed class TenantPurger(DocRoofDbContext db, IFileStorage storage, ILogger<TenantPurger> logger)
{
    public async Task PurgeAsync(Guid tenantId, bool deleteTenantRow, CancellationToken ct)
    {
        if (tenantId == TenantSeeder.SampleTenantId)
        {
            throw new InvalidOperationException("The sample tenant cannot be purged.");
        }

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var projectIds = db.Projects.Where(p => p.TenantId == tenantId).Select(p => p.Id);
            var userIds = db.Users.Where(u => u.TenantId == tenantId).Select(u => u.Id);
            var docIds = db.Documents.Where(d => projectIds.Contains(d.ProjectId)).Select(d => d.Id);
            var revIds = db.DocumentRevisions.Where(r => docIds.Contains(r.DocumentId)).Select(r => r.Id);

            await db.Notifications.Where(n => projectIds.Contains(n.ProjectId) || userIds.Contains(n.RecipientId)).ExecuteDeleteAsync(ct);
            await db.AuditEvents.Where(a => a.TenantId == tenantId).ExecuteDeleteAsync(ct);
            await db.Comments.Where(c => projectIds.Contains(c.ProjectId)).ExecuteDeleteAsync(ct);
            await db.ExtractionSuggestions.Where(s => revIds.Contains(s.RevisionId)).ExecuteDeleteAsync(ct);
            await db.ReviewDecisions.Where(d => projectIds.Contains(d.Submittal!.ProjectId)).ExecuteDeleteAsync(ct);
            await db.Submittals.Where(s => projectIds.Contains(s.ProjectId)).ExecuteDeleteAsync(ct);
            await db.RfiResponses.Where(r => projectIds.Contains(r.Rfi!.ProjectId)).ExecuteDeleteAsync(ct);
            await db.Rfis.Where(r => projectIds.Contains(r.ProjectId)).ExecuteDeleteAsync(ct);
            await db.Documents.Where(d => projectIds.Contains(d.ProjectId)).ExecuteUpdateAsync(s => s.SetProperty(d => d.CurrentRevisionId, (Guid?)null), ct);
            await db.DocumentRevisions.Where(r => docIds.Contains(r.DocumentId)).ExecuteDeleteAsync(ct);
            await db.Documents.Where(d => projectIds.Contains(d.ProjectId)).ExecuteDeleteAsync(ct);
            await db.ProjectMemberships.Where(m => projectIds.Contains(m.ProjectId)).ExecuteDeleteAsync(ct);
            await db.Projects.Where(p => p.TenantId == tenantId).ExecuteDeleteAsync(ct);
            await db.Users.Where(u => u.TenantId == tenantId).ExecuteDeleteAsync(ct);
            await db.StoredFiles.Where(f => f.TenantId == tenantId).ExecuteDeleteAsync(ct);
            if (deleteTenantRow)
            {
                await db.Tenants.Where(t => t.Id == tenantId).ExecuteDeleteAsync(ct);
            }

            await tx.CommitAsync(ct);
        });

        if (storage.Mode == "Local")
        {
            await storage.DeleteTenantAsync(tenantId, ct);
        }

        db.ChangeTracker.Clear();
        logger.LogInformation("Purged tenant {TenantId} (row deleted: {Deleted})", tenantId, deleteTenantRow);
    }
}
