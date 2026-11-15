using System.Text.RegularExpressions;
using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Domain.Files;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Files;
using DocRoof.Infrastructure.Seeding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DocRoof.Infrastructure.Services;

/// <summary>Resolves display names for users of the caller's tenant.</summary>
public sealed class UserDirectory(DocRoofDbContext db)
{
    private Dictionary<Guid, string>? _names;

    public async Task<UserRef> RefAsync(Guid tenantId, Guid id, CancellationToken ct) =>
        new(id, (await NamesAsync(tenantId, ct)).GetValueOrDefault(id, "Unknown user"));

    public async Task<IReadOnlyDictionary<Guid, string>> NamesAsync(Guid tenantId, CancellationToken ct) =>
        _names ??= await db.Users.AsNoTracking().Where(u => u.TenantId == tenantId).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
}

public sealed partial class DocumentService(
    DocRoofDbContext db,
    IProjectAccessService access,
    IFileStorage storage,
    AuditWriter audit,
    UserDirectory directory,
    TimeProvider clock,
    IOptions<StorageOptions> storageOptions,
    IOptions<DemoOptions> demoOptions,
    ICurrentUser currentUser,
    ILogger<DocumentService> logger)
{
    public static readonly ProjectRole[] UploadRoles = [ProjectRole.DocumentController, ProjectRole.ProjectManager];

    public async Task<PagedResult<DocumentListItemDto>> ListAsync(Guid projectId, DocumentQuery query, CancellationToken ct)
    {
        await access.RequireProjectAsync(projectId, ct);
        var (page, pageSize) = Paging.Normalize(query.Page, query.PageSize);
        var q = db.Documents.AsNoTracking().Where(d => d.ProjectId == projectId);

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            q = q.Where(d => d.DocumentNumber.Contains(term) || d.Title.Contains(term));
        }

        if (query.Discipline is { } discipline)
        {
            q = q.Where(d => d.Discipline == discipline);
        }

        if (query.Status is { } status)
        {
            q = q.Where(d => d.Status == status);
        }

        if (query.Category is { } category)
        {
            q = q.Where(d => d.Category == category);
        }

        if (query.ApprovalStatus is { } approval)
        {
            q = q.Where(d => d.CurrentRevision!.ApprovalStatus == approval);
        }

        if (!string.IsNullOrWhiteSpace(query.Revision))
        {
            var label = query.Revision.Trim();
            q = q.Where(d => d.Revisions.Any(r => r.VersionLabel == label));
        }

        q = (query.Sort ?? "-updated") switch
        {
            "number" => q.OrderBy(d => d.DocumentNumber),
            "-number" => q.OrderByDescending(d => d.DocumentNumber),
            "title" => q.OrderBy(d => d.Title),
            "-title" => q.OrderByDescending(d => d.Title),
            "updated" => q.OrderBy(d => d.UpdatedAt).ThenBy(d => d.DocumentNumber),
            _ => q.OrderByDescending(d => d.UpdatedAt).ThenBy(d => d.DocumentNumber),
        };

        var total = await q.CountAsync(ct);
        var items = await q.Skip((page - 1) * pageSize).Take(pageSize)
            .Select(d => new DocumentListItemDto(
                d.Id, d.ProjectId, d.DocumentNumber, d.Title, d.Category, d.Discipline, d.Status, d.CurrentRevisionId,
                d.CurrentRevision != null ? d.CurrentRevision.VersionLabel : null,
                d.CurrentRevision != null ? d.CurrentRevision.ApprovalStatus : null,
                d.CurrentRevision != null ? d.CurrentRevision.MimeType : null,
                d.Revisions.OrderBy(r => r.UploadedAt)
                    .Select(r => new RevisionChipDto(r.Id, r.VersionLabel, r.Id == d.CurrentRevisionId, r.ApprovalStatus)).ToList(),
                d.UpdatedAt))
            .AsSplitQuery()
            .ToListAsync(ct);

        return new PagedResult<DocumentListItemDto>(items, page, pageSize, total);
    }

    public async Task<DocumentDetailDto> GetAsync(Guid documentId, CancellationToken ct)
    {
        var (doc, acc) = await access.RequireDocumentAsync(documentId, ct);
        var project = await db.Projects.AsNoTracking().FirstAsync(p => p.Id == doc.ProjectId, ct);
        var revisions = await RevisionsAsync(doc, acc.TenantId, ct);
        return new DocumentDetailDto(doc.Id, doc.ProjectId, project.Code, project.Title, doc.DocumentNumber, doc.Title,
            doc.Category, doc.Discipline, doc.Status, doc.CurrentRevisionId, revisions, acc.Role, UploadRoles.Contains(acc.Role),
            doc.CreatedAt, doc.UpdatedAt, Convert.ToBase64String(doc.RowVersion), doc.IssueDate, doc.SpecSection);
    }

    public async Task<DocumentHistoryDto> HistoryAsync(Guid documentId, CancellationToken ct)
    {
        var (doc, acc) = await access.RequireDocumentAsync(documentId, ct);
        var revisions = await RevisionsAsync(doc, acc.TenantId, ct);
        var revIds = revisions.Select(r => r.Id).ToList();
        var events = await db.AuditEvents.AsNoTracking()
            .Where(a => a.ProjectId == doc.ProjectId &&
                        ((a.Resource == ResourceType.Document && a.ResourceId == doc.Id) ||
                         (a.Resource == ResourceType.DocumentRevision && revIds.Contains(a.ResourceId))))
            .OrderByDescending(a => a.Timestamp).ThenByDescending(a => a.Id)
            .Take(200)
            .ToListAsync(ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var labels = revisions.ToDictionary(r => r.Id, r => r.VersionLabel);
        return new DocumentHistoryDto(revisions, events.Select(e => ToDto(e, names,
            e.Resource == ResourceType.DocumentRevision && labels.TryGetValue(e.ResourceId, out var l) ? $"{doc.DocumentNumber} {l}" : doc.DocumentNumber)).ToList());
    }

    public async Task<RevisionComparisonDto> CompareAsync(Guid documentId, Guid fromId, Guid toId, CancellationToken ct)
    {
        var (doc, acc) = await access.RequireDocumentAsync(documentId, ct);
        var revisions = await RevisionsAsync(doc, acc.TenantId, ct);
        var from = revisions.FirstOrDefault(r => r.Id == fromId) ?? throw new NotFoundException("Revision");
        var to = revisions.FirstOrDefault(r => r.Id == toId) ?? throw new NotFoundException("Revision");
        var changes = new List<RevisionFieldChange>();
        void Diff(string field, string? a, string? b)
        {
            if (!string.Equals(a, b, StringComparison.Ordinal))
            {
                changes.Add(new RevisionFieldChange(field, a, b));
            }
        }

        Diff("Version", from.VersionLabel, to.VersionLabel);
        Diff("File name", from.FileName, to.FileName);
        Diff("Type", from.MimeType, to.MimeType);
        Diff("Size (bytes)", from.ByteSize.ToString(), to.ByteSize.ToString());
        Diff("Pages", from.PageCount?.ToString(), to.PageCount?.ToString());
        Diff("SHA-256", from.Sha256, to.Sha256);
        Diff("Uploaded by", from.UploadedBy.DisplayName, to.UploadedBy.DisplayName);
        Diff("Uploaded at", from.UploadedAt.ToString("u"), to.UploadedAt.ToString("u"));
        Diff("Approval status", from.ApprovalStatus.ToString(), to.ApprovalStatus.ToString());
        Diff("Text layer", from.HasTextLayer ? "Yes" : "No", to.HasTextLayer ? "Yes" : "No");
        Diff("Change note", from.ChangeNote, to.ChangeNote);
        return new RevisionComparisonDto(from, to, changes, from.Sha256 != to.Sha256, to.ByteSize - from.ByteSize);
    }

    public async Task<DocumentDetailDto> CreateAsync(Guid projectId, CreateDocumentCommand cmd, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct, UploadRoles);
        await EnforceGuestQuotaAsync(acc.TenantId, cmd.File.Content.LongLength, ct);
        var number = cmd.DocumentNumber.Trim();
        if (await db.Documents.AnyAsync(d => d.ProjectId == projectId && d.DocumentNumber == number, ct))
        {
            throw new ConflictException($"Document number {number} already exists in this project.");
        }

        var prepared = Prepare(cmd.File, acc.TenantId);
        var label = NormalizeLabel(cmd.VersionLabel) ?? "R0";
        var now = clock.GetUtcNow().UtcDateTime;
        var doc = new Document
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            DocumentNumber = number,
            Title = cmd.Title.Trim(),
            Discipline = cmd.Discipline,
            Category = cmd.Category,
            Status = DocumentStatus.Draft,
            CreatedById = acc.UserId,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await InTransactionWithFileAsync(prepared, acc.TenantId, async () =>
        {
            db.Documents.Add(doc);
            var revision = NewRevision(doc.Id, label, cmd.ChangeNote, prepared, acc.UserId, now, supersedes: null);
            db.DocumentRevisions.Add(revision);
            await db.SaveChangesAsync(ct);
            doc.CurrentRevisionId = revision.Id;
            audit.Add(acc, ResourceType.Document, doc.Id, "document.created", after: new { doc.DocumentNumber, doc.Title, doc.Discipline, doc.Category });
            audit.Add(acc, ResourceType.DocumentRevision, revision.Id, "revision.uploaded",
                after: new { revision.VersionLabel, revision.Sha256, revision.ByteSize, revision.FileName, revision.MimeType });
            await db.SaveChangesAsync(ct);
        }, ct);

        logger.LogInformation("Document {DocumentId} created in project {ProjectId}", doc.Id, projectId);
        return await GetAsync(doc.Id, ct);
    }

    public async Task<RevisionDto> AddRevisionAsync(Guid documentId, AddRevisionCommand cmd, CancellationToken ct)
    {
        var (doc, acc) = await access.RequireDocumentAsync(documentId, ct, UploadRoles);
        await EnforceGuestQuotaAsync(acc.TenantId, cmd.File.Content.LongLength, ct);
        var prepared = Prepare(cmd.File, acc.TenantId);
        var existingLabels = await db.DocumentRevisions.Where(r => r.DocumentId == doc.Id).Select(r => r.VersionLabel).ToListAsync(ct);
        var label = NormalizeLabel(cmd.VersionLabel) ?? NextLabel(existingLabels);
        if (existingLabels.Contains(label, StringComparer.OrdinalIgnoreCase))
        {
            throw new ConflictException($"Revision {label} already exists for this document.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var previous = doc.CurrentRevisionId;
        DocumentRevision revision = null!;
        await InTransactionWithFileAsync(prepared, acc.TenantId, async () =>
        {
            revision = NewRevision(doc.Id, label, cmd.ChangeNote, prepared, acc.UserId, now, previous);
            db.DocumentRevisions.Add(revision);
            await db.SaveChangesAsync(ct);
            doc.CurrentRevisionId = revision.Id;
            doc.UpdatedAt = now; // touches the document row so its rowversion serializes concurrent uploads
            audit.Add(acc, ResourceType.DocumentRevision, revision.Id, "revision.superseded",
                before: new { RevisionId = previous },
                after: new { revision.VersionLabel, revision.Sha256, revision.ByteSize, revision.FileName, revision.MimeType });
            await db.SaveChangesAsync(ct);
        }, ct);

        var names = await directory.NamesAsync(acc.TenantId, ct);
        return ToDto(revision, names, isCurrent: true);
    }

    public async Task<FileDownload> OpenAsync(Guid revisionId, bool forPreview, CancellationToken ct)
    {
        var (rev, _) = await access.RequireRevisionAsync(revisionId, ct);
        if (forPreview && !PreviewSupported(rev))
        {
            throw new ConflictException(rev.HasActiveContent
                ? "This PDF contains active content (scripts, launch actions or embedded files) and is available as a download only."
                : "Preview is not available for this file type.");
        }

        var stream = await storage.OpenReadAsync(rev.StorageKey, ct);
        if (stream is null)
        {
            logger.LogError("Stored object missing for revision {RevisionId}", revisionId);
            throw new NotFoundException("File content");
        }

        return new FileDownload(stream, rev.MimeType, FileNameSanitizer.Sanitize(rev.FileName), rev.Sha256, rev.HasActiveContent);
    }

    /// <summary>Guest workspaces get a small upload allowance so one visitor cannot fill the shared database.</summary>
    private async Task EnforceGuestQuotaAsync(Guid tenantId, long incomingBytes, CancellationToken ct)
    {
        if (!currentUser.IsGuest)
        {
            return;
        }

        var tenantCreated = await db.Tenants.Where(t => t.Id == tenantId).Select(t => t.CreatedAt).FirstAsync(ct);
        var uploads = db.DocumentRevisions.Where(r => r.Document!.Project!.TenantId == tenantId && r.UploadedAt >= tenantCreated);
        var count = await uploads.CountAsync(ct);
        var bytes = await uploads.SumAsync(r => (long?)r.ByteSize, ct) ?? 0;
        var opt = demoOptions.Value;
        if (count >= opt.MaxUploadsPerWorkspace || bytes + incomingBytes > opt.MaxUploadBytesPerWorkspace)
        {
            throw new TooManyRequestsException($"Guest workspace upload quota reached ({opt.MaxUploadsPerWorkspace} files / {opt.MaxUploadBytesPerWorkspace / (1024 * 1024)} MB). Use \"Reset my demo\" to start over.");
        }
    }

    public static bool PreviewSupported(DocumentRevision r) =>
        !r.HasActiveContent && r.MimeType is "application/pdf" or "text/plain" or "image/png" or "image/jpeg";

    internal async Task<IReadOnlyList<RevisionDto>> RevisionsAsync(Document doc, Guid tenantId, CancellationToken ct)
    {
        var revisions = await db.DocumentRevisions.AsNoTracking().Where(r => r.DocumentId == doc.Id).OrderByDescending(r => r.UploadedAt).ToListAsync(ct);
        var names = await directory.NamesAsync(tenantId, ct);
        return revisions.Select(r => ToDto(r, names, r.Id == doc.CurrentRevisionId)).ToList();
    }

    internal static RevisionDto ToDto(DocumentRevision r, IReadOnlyDictionary<Guid, string> names, bool isCurrent) =>
        new(r.Id, r.DocumentId, r.VersionLabel, r.FileName, r.MimeType, r.ByteSize, r.Sha256, r.PageCount, r.HasTextLayer,
            r.HasActiveContent, r.ChangeNote, new UserRef(r.UploadedById, names.GetValueOrDefault(r.UploadedById, "Unknown user")),
            r.UploadedAt, r.ApprovalStatus, r.SupersedesRevisionId, isCurrent, PreviewSupported(r));

    internal static AuditEventDto ToDto(AuditEvent e, IReadOnlyDictionary<Guid, string> names, string? reference) =>
        new(e.Id, e.Timestamp, e.ActorId is { } a ? new UserRef(a, names.GetValueOrDefault(a, "Unknown user")) : null,
            e.Resource, e.ResourceId, e.Action, e.ChangeJson, reference);

    private sealed record PreparedFile(UploadCheck Check, byte[] Bytes, string Sha256, string StorageKey, int? PageCount, bool HasText, bool HasActive);

    private PreparedFile Prepare(UploadedFile file, Guid tenantId)
    {
        var max = storageOptions.Value.MaxUploadBytes;
        if (file.Content.LongLength > max)
        {
            throw new PayloadTooLargeException($"The file exceeds the {max / (1024 * 1024)} MB limit.");
        }

        var check = UploadRules.Check(file.FileName, file.Content, max);
        if (!check.Ok)
        {
            throw new RequestValidationException("file", check.Error!);
        }

        var probe = new DocumentRevision();
        try
        {
            TenantSeeder.ApplyContentFacts(probe, check.Type, file.Content);
        }
        catch (Exception ex) when (check.Type == DetectedFileType.Pdf)
        {
            logger.LogWarning(ex, "Rejected unreadable PDF upload");
            throw new RequestValidationException("file", "The PDF could not be read. It may be damaged or encrypted.");
        }

        return new PreparedFile(check, file.Content, Checksums.Sha256Hex(file.Content), StorageKeys.New(tenantId),
            probe.PageCount, probe.HasTextLayer, probe.HasActiveContent);
    }

    private static DocumentRevision NewRevision(Guid documentId, string label, string? note, PreparedFile f, Guid userId, DateTime now, Guid? supersedes) => new()
    {
        Id = Guid.NewGuid(),
        DocumentId = documentId,
        VersionLabel = label,
        StorageKey = f.StorageKey,
        Sha256 = f.Sha256,
        FileName = f.Check.SafeFileName,
        MimeType = f.Check.MimeType,
        ByteSize = f.Bytes.LongLength,
        PageCount = f.PageCount,
        HasTextLayer = f.HasText,
        HasActiveContent = f.HasActive,
        ChangeNote = (note ?? "").Trim() is { Length: > 0 } n ? n[..Math.Min(n.Length, 1000)] : "",
        UploadedById = userId,
        UploadedAt = now,
        SupersedesRevisionId = supersedes,
        ApprovalStatus = RevisionApprovalStatus.NotReviewed,
    };

    /// <summary>Writes the file and the rows in one transaction; local-disk bytes are removed again if the transaction fails.</summary>
    private async Task InTransactionWithFileAsync(PreparedFile file, Guid tenantId, Func<Task> work, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await storage.SaveAsync(file.StorageKey, tenantId, file.Bytes, ct);
            await work();
            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None);
            db.ChangeTracker.Clear();
            if (storage.Mode == "Local")
            {
                await storage.DeleteAsync(file.StorageKey, CancellationToken.None);
            }

            throw;
        }
    }

    public static string? NormalizeLabel(string? label)
    {
        if (string.IsNullOrWhiteSpace(label))
        {
            return null;
        }

        var trimmed = label.Trim();
        if (!LabelPattern().IsMatch(trimmed))
        {
            throw new RequestValidationException("versionLabel", "Use 1-20 letters, digits, dots, dashes or spaces.");
        }

        return trimmed;
    }

    public static string NextLabel(IEnumerable<string> existing)
    {
        var max = existing.Select(l => RLabel().Match(l)).Where(m => m.Success).Select(m => int.Parse(m.Groups[1].Value)).DefaultIfEmpty(-1).Max();
        return "R" + (max + 1);
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9. -]{0,19}$")]
    private static partial Regex LabelPattern();

    [GeneratedRegex("^R(\\d{1,4})$", RegexOptions.IgnoreCase)]
    private static partial Regex RLabel();
}
