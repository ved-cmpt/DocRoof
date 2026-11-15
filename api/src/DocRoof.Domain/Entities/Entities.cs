namespace DocRoof.Domain.Entities;

public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsGuest { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Salted hash of the creating client address (guest tenants only), used for per-IP quotas.</summary>
    public string? CreatedByIpHash { get; set; }
}

public class Project
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Code { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Location { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public List<ProjectMembership> Memberships { get; set; } = [];
}

public class ProjectMembership
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }
    public Guid UserId { get; set; }
    public ProjectRole Role { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Document
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }
    public string DocumentNumber { get; set; } = "";
    public DocumentCategory Category { get; set; }
    public Discipline Discipline { get; set; }
    public string Title { get; set; } = "";
    public DocumentStatus Status { get; set; }
    public Guid? CurrentRevisionId { get; set; }
    public DocumentRevision? CurrentRevision { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
    public List<DocumentRevision> Revisions { get; set; } = [];
}

/// <summary>
/// A stored file version. Content columns are immutable after insert (service layer, EF interceptor and a SQL trigger
/// all enforce this). Only <see cref="ApprovalStatus"/> and <see cref="ApprovalUpdatedAt"/> may change.
/// </summary>
public class DocumentRevision
{
    public Guid Id { get; set; }
    public Guid DocumentId { get; set; }
    public Document? Document { get; set; }
    public string VersionLabel { get; set; } = "";
    public string StorageKey { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public string FileName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long ByteSize { get; set; }
    public int? PageCount { get; set; }
    public bool HasTextLayer { get; set; }
    public bool HasActiveContent { get; set; }
    public string ChangeNote { get; set; } = "";
    public Guid UploadedById { get; set; }
    public DateTime UploadedAt { get; set; }
    public Guid? SupersedesRevisionId { get; set; }
    public DocumentRevision? SupersedesRevision { get; set; }
    public RevisionApprovalStatus ApprovalStatus { get; set; }
    public DateTime? ApprovalUpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];

    /// <summary>Columns that can never change after the row is inserted.</summary>
    public static readonly string[] ImmutableColumns =
    [
        nameof(DocumentId), nameof(VersionLabel), nameof(StorageKey), nameof(Sha256), nameof(FileName),
        nameof(MimeType), nameof(ByteSize), nameof(PageCount), nameof(HasTextLayer), nameof(HasActiveContent),
        nameof(ChangeNote), nameof(UploadedById), nameof(UploadedAt), nameof(SupersedesRevisionId),
    ];
}

/// <summary>Binary content for <c>Storage:Mode=Database</c>.</summary>
public class StoredFile
{
    public string StorageKey { get; set; } = "";
    public Guid TenantId { get; set; }
    public byte[] Content { get; set; } = [];
    public long ByteSize { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Rfi
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }
    public string ReferenceNumber { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Question { get; set; } = "";
    public Guid SourceRevisionId { get; set; }
    public DocumentRevision? SourceRevision { get; set; }
    public int SourcePage { get; set; }
    public RfiState State { get; set; }
    public Guid? AssigneeId { get; set; }
    public DateTime? DueAt { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? AnsweredAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public Guid? ApprovedResponseId { get; set; }
    public string? ReopenReason { get; set; }
    public DateTime UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
    public List<RfiResponse> Responses { get; set; } = [];
}

public class RfiResponse
{
    public Guid Id { get; set; }
    public Guid RfiId { get; set; }
    public Rfi? Rfi { get; set; }
    public Guid AuthorId { get; set; }
    public string Answer { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public RfiResponseStatus Status { get; set; }
    public Guid? ApprovedById { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public Guid? RejectedById { get; set; }
    public DateTime? RejectedAt { get; set; }
    public string? RejectionReason { get; set; }
}

public class Submittal
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }
    public string Number { get; set; } = "";
    public string Title { get; set; } = "";
    public string SpecSection { get; set; } = "";
    public Guid DocumentId { get; set; }
    public Document? Document { get; set; }
    public Guid RevisionId { get; set; }
    public DocumentRevision? Revision { get; set; }
    public SubmittalStatus Status { get; set; }
    public int Cycle { get; set; } = 1;
    public Guid AssignedReviewerId { get; set; }
    public DateTime? DueAt { get; set; }
    public Guid SubmittedById { get; set; }
    public DateTime SubmittedAt { get; set; }
    public DateTime? ReviewStartedAt { get; set; }
    public DateTime? DecidedAt { get; set; }
    public DateTime? FinalizedAt { get; set; }
    public Guid? FinalizedById { get; set; }
    public DateTime UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
    public List<ReviewDecision> Decisions { get; set; } = [];
}

public class ReviewDecision
{
    public Guid Id { get; set; }
    public Guid SubmittalId { get; set; }
    public Submittal? Submittal { get; set; }
    public int Cycle { get; set; }
    public Guid RevisionId { get; set; }
    public Guid ReviewerId { get; set; }
    public ReviewDecisionType Decision { get; set; }
    public string Comments { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class ExtractionSuggestion
{
    public Guid Id { get; set; }
    public Guid RevisionId { get; set; }
    public DocumentRevision? Revision { get; set; }
    public ExtractionField Field { get; set; }
    public string ProposedValue { get; set; } = "";
    public int Page { get; set; }
    public string Snippet { get; set; } = "";
    public ConfidenceLabel ConfidenceLabel { get; set; }
    public string Rule { get; set; } = "";
    public string Engine { get; set; } = "";
    public SuggestionStatus Status { get; set; }
    public Guid? DecidedById { get; set; }
    public DateTime? DecidedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

public class Comment
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public ResourceType Resource { get; set; }
    public Guid ResourceId { get; set; }
    public Guid AuthorId { get; set; }
    public string Body { get; set; } = "";
    public int? Page { get; set; }
    public Guid? RevisionId { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>Append-only audit trail entry. Updates are rejected by a SQL trigger and the EF interceptor.</summary>
public class AuditEvent
{
    public long Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? ActorId { get; set; }
    public ResourceType Resource { get; set; }
    public Guid ResourceId { get; set; }
    public string Action { get; set; } = "";
    public string ChangeJson { get; set; } = "{}";
    public DateTime Timestamp { get; set; }
}

public class Notification
{
    public Guid Id { get; set; }
    public Guid RecipientId { get; set; }
    public Guid ProjectId { get; set; }
    public NotificationKind Kind { get; set; }
    public ResourceType Resource { get; set; }
    public Guid ResourceId { get; set; }
    public string Message { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? ViewedAt { get; set; }

    /// <summary>Unique when present; makes reminder creation idempotent (one per item, recipient and day).</summary>
    public string? DedupeKey { get; set; }
}

/// <summary>Row of the <c>vw_ReviewQueue</c> SQL view (keyless).</summary>
public class ReviewQueueItem
{
    public string ItemType { get; set; } = "";
    public Guid ItemId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TenantId { get; set; }
    public string Reference { get; set; } = "";
    public string Title { get; set; } = "";
    public string State { get; set; } = "";
    public Guid? AssigneeId { get; set; }
    public DateTime? DueAt { get; set; }
    public string Discipline { get; set; } = "";
    public bool IsOverdue { get; set; }
    public int? DaysOverdue { get; set; }
}
