using System.ComponentModel.DataAnnotations;
using DocRoof.Domain;

namespace DocRoof.Infrastructure.Services;

public sealed record UploadedFile(string FileName, byte[] Content);

public sealed record UserRef(Guid Id, string DisplayName);

public sealed record MemberDto(Guid UserId, string DisplayName, string JobTitle, ProjectRole Role);

public sealed record ProjectSummaryDto(
    Guid Id, string Code, string Title, string Description, string Location, ProjectRole MyRole,
    int DocumentCount, int OpenRfiCount, int OpenSubmittalCount, int OverdueCount);

public sealed record ProjectDetailDto(
    Guid Id, string Code, string Title, string Description, string Location, ProjectRole MyRole, IReadOnlyList<MemberDto> Members);

public sealed class CreateProjectRequest
{
    [Required, StringLength(20, MinimumLength = 2), RegularExpression("^[A-Z0-9-]+$", ErrorMessage = "Use upper-case letters, digits and dashes.")]
    public string Code { get; set; } = "";

    [Required, StringLength(200, MinimumLength = 3)]
    public string Title { get; set; } = "";

    [StringLength(2000)]
    public string Description { get; set; } = "";

    [StringLength(200)]
    public string Location { get; set; } = "";
}

public sealed record RevisionChipDto(Guid Id, string VersionLabel, bool IsCurrent, RevisionApprovalStatus ApprovalStatus);

public sealed record DocumentListItemDto(
    Guid Id, Guid ProjectId, string DocumentNumber, string Title, DocumentCategory Category, Discipline Discipline,
    DocumentStatus Status, Guid? CurrentRevisionId, string? CurrentVersionLabel, RevisionApprovalStatus? CurrentApprovalStatus,
    string? CurrentMimeType, IReadOnlyList<RevisionChipDto> Revisions, DateTime UpdatedAt);

public sealed class DocumentQuery
{
    [StringLength(100)]
    public string? Search { get; set; }

    public Discipline? Discipline { get; set; }

    public DocumentStatus? Status { get; set; }

    public DocumentCategory? Category { get; set; }

    public RevisionApprovalStatus? ApprovalStatus { get; set; }

    [StringLength(20)]
    public string? Revision { get; set; }

    [Range(1, 10000)]
    public int? Page { get; set; }

    [Range(1, 100)]
    public int? PageSize { get; set; }

    /// <summary>number | title | updated (default) | -number | -title | -updated</summary>
    [StringLength(20)]
    public string? Sort { get; set; }
}

public sealed record RevisionDto(
    Guid Id, Guid DocumentId, string VersionLabel, string FileName, string MimeType, long ByteSize, string Sha256,
    int? PageCount, bool HasTextLayer, bool HasActiveContent, string ChangeNote, UserRef UploadedBy, DateTime UploadedAt,
    RevisionApprovalStatus ApprovalStatus, Guid? SupersedesRevisionId, bool IsCurrent, bool PreviewSupported);

public sealed record DocumentDetailDto(
    Guid Id, Guid ProjectId, string ProjectCode, string ProjectTitle, string DocumentNumber, string Title,
    DocumentCategory Category, Discipline Discipline, DocumentStatus Status, Guid? CurrentRevisionId,
    IReadOnlyList<RevisionDto> Revisions, ProjectRole MyRole, bool CanUpload, DateTime CreatedAt, DateTime UpdatedAt, string RowVersion,
    DateTime? IssueDate, string? SpecSection);

public sealed record AuditEventDto(
    long Id, DateTime Timestamp, UserRef? Actor, ResourceType Resource, Guid ResourceId, string Action, string ChangeJson, string? Reference);

public sealed record DocumentHistoryDto(IReadOnlyList<RevisionDto> Revisions, IReadOnlyList<AuditEventDto> Events);

public sealed record CreateDocumentCommand(
    string DocumentNumber, string Title, Discipline Discipline, DocumentCategory Category, string? VersionLabel, string? ChangeNote, UploadedFile File);

public sealed record AddRevisionCommand(string? VersionLabel, string? ChangeNote, UploadedFile File);

public sealed record RevisionFieldChange(string Field, string? From, string? To);

public sealed record RevisionComparisonDto(RevisionDto From, RevisionDto To, IReadOnlyList<RevisionFieldChange> Changes, bool ContentChanged, long SizeDelta);

public sealed record FileDownload(Stream Content, string MimeType, string FileName, string Sha256, bool DownloadOnly);
