using System.ComponentModel.DataAnnotations;
using DocRoof.Domain;
using DocRoof.Domain.Workflows;

namespace DocRoof.Infrastructure.Services;

public sealed record CitationDto(
    Guid DocumentId, string DocumentNumber, string DocumentTitle, Guid RevisionId, string VersionLabel, int Page,
    int? PageCount, bool NewerRevisionExists, string? CurrentVersionLabel);

public sealed record RfiListItemDto(
    Guid Id, string ReferenceNumber, string Subject, RfiState State, Discipline Discipline, UserRef? Assignee,
    DateTime? DueAt, bool IsOverdue, int DaysOverdue, UserRef CreatedBy, DateTime CreatedAt, CitationDto Citation);

public sealed record RfiResponseDto(
    Guid Id, UserRef Author, string Answer, DateTime CreatedAt, RfiResponseStatus Status, UserRef? ApprovedBy,
    DateTime? ApprovedAt, UserRef? RejectedBy, DateTime? RejectedAt, string? RejectionReason);

public sealed record CommentDto(Guid Id, UserRef Author, string Body, int? Page, Guid? RevisionId, string? VersionLabel, DateTime CreatedAt);

public sealed record RfiDetailDto(
    Guid Id, Guid ProjectId, string ProjectCode, string ReferenceNumber, string Subject, string Question, RfiState State,
    Discipline Discipline, UserRef? Assignee, DateTime? DueAt, bool IsOverdue, UserRef CreatedBy, DateTime CreatedAt,
    DateTime? SubmittedAt, DateTime? AnsweredAt, DateTime? ClosedAt, string? ReopenReason, Guid? ApprovedResponseId,
    CitationDto Citation, IReadOnlyList<RfiResponseDto> Responses, IReadOnlyList<AuditEventDto> Timeline,
    IReadOnlyList<CommentDto> Comments, IReadOnlyList<RfiAction> AvailableActions, ProjectRole MyRole, string RowVersion);

public sealed class RfiQuery
{
    public RfiState? State { get; set; }

    /// <summary>A user id, or "me".</summary>
    [StringLength(40)]
    public string? Assignee { get; set; }

    /// <summary>overdue | week | none</summary>
    [StringLength(10)]
    public string? Due { get; set; }

    public Discipline? Discipline { get; set; }

    [StringLength(100)]
    public string? Search { get; set; }

    [Range(1, 10000)]
    public int? Page { get; set; }

    [Range(1, 100)]
    public int? PageSize { get; set; }
}

public sealed class CreateRfiRequest
{
    [Required, StringLength(300, MinimumLength = 5)]
    public string Subject { get; set; } = "";

    [Required, StringLength(4000, MinimumLength = 10)]
    public string Question { get; set; } = "";

    [Required]
    public Guid? SourceRevisionId { get; set; }

    [Required, Range(1, 100000)]
    public int? SourcePage { get; set; }

    /// <summary>Submit immediately instead of saving a draft.</summary>
    public bool Submit { get; set; }
}

public class RowVersionRequest
{
    [Required, StringLength(64)]
    public string RowVersion { get; set; } = "";
}

public sealed class AssignRfiRequest : RowVersionRequest
{
    [Required]
    public Guid? AssigneeId { get; set; }

    [Required]
    public DateTime? DueAt { get; set; }
}

public sealed class AnswerRfiRequest : RowVersionRequest
{
    [Required, StringLength(4000, MinimumLength = 5)]
    public string Answer { get; set; } = "";
}

public sealed class ReasonRequest : RowVersionRequest
{
    [Required, StringLength(1000, MinimumLength = 5)]
    public string Reason { get; set; } = "";
}

public sealed record DecisionDto(Guid Id, int Cycle, Guid RevisionId, string VersionLabel, UserRef Reviewer, ReviewDecisionType Decision, string Comments, DateTime CreatedAt);

public sealed record SubmittalListItemDto(
    Guid Id, string Number, string Title, string SpecSection, SubmittalStatus Status, int Cycle, Discipline Discipline,
    UserRef Reviewer, DateTime? DueAt, bool IsOverdue, int DaysOverdue, Guid DocumentId, string DocumentNumber,
    string VersionLabel, DateTime SubmittedAt);

public sealed record SubmittalDetailDto(
    Guid Id, Guid ProjectId, string ProjectCode, string Number, string Title, string SpecSection, SubmittalStatus Status,
    int Cycle, Discipline Discipline, UserRef Reviewer, DateTime? DueAt, bool IsOverdue, UserRef SubmittedBy,
    DateTime SubmittedAt, DateTime? ReviewStartedAt, DateTime? DecidedAt, DateTime? FinalizedAt, Guid DocumentId,
    string DocumentNumber, string DocumentTitle, Guid RevisionId, string VersionLabel, RevisionApprovalStatus RevisionApprovalStatus,
    IReadOnlyList<RevisionChipDto> NewerRevisions, IReadOnlyList<DecisionDto> Decisions, IReadOnlyList<AuditEventDto> Timeline,
    IReadOnlyList<CommentDto> Comments, IReadOnlyList<SubmittalAction> AvailableActions, ProjectRole MyRole, string RowVersion);

public sealed class SubmittalQuery
{
    public SubmittalStatus? Status { get; set; }

    [StringLength(40)]
    public string? Reviewer { get; set; }

    [StringLength(10)]
    public string? Due { get; set; }

    public Discipline? Discipline { get; set; }

    [Range(1, 10000)]
    public int? Page { get; set; }

    [Range(1, 100)]
    public int? PageSize { get; set; }
}

public sealed class CreateSubmittalRequest
{
    [Required, StringLength(300, MinimumLength = 3)]
    public string Title { get; set; } = "";

    [StringLength(20)]
    public string SpecSection { get; set; } = "";

    [Required]
    public Guid? DocumentId { get; set; }

    /// <summary>Defaults to the document's current revision.</summary>
    public Guid? RevisionId { get; set; }

    [Required]
    public Guid? ReviewerId { get; set; }

    [Required]
    public DateTime? DueAt { get; set; }
}

public sealed class DecisionRequest : RowVersionRequest
{
    [Required]
    public ReviewDecisionType? Decision { get; set; }

    [StringLength(4000)]
    public string Comments { get; set; } = "";
}

public sealed class ResubmitRequest : RowVersionRequest
{
    [Required]
    public Guid? RevisionId { get; set; }

    public DateTime? DueAt { get; set; }
}

public sealed class CreateCommentRequest
{
    [Required, StringLength(4000, MinimumLength = 1)]
    public string Body { get; set; } = "";

    [Range(1, 100000)]
    public int? Page { get; set; }

    public Guid? RevisionId { get; set; }
}

public sealed class AuditQuery
{
    public ResourceType? Resource { get; set; }

    [StringLength(60)]
    public string? Action { get; set; }

    public Guid? ActorId { get; set; }

    public DateTime? From { get; set; }

    public DateTime? To { get; set; }

    [Range(1, 10000)]
    public int? Page { get; set; }

    [Range(1, 200)]
    public int? PageSize { get; set; }
}

public sealed record ReviewQueueItemDto(
    string ItemType, Guid ItemId, string Reference, string Title, string State, UserRef? Assignee, DateTime? DueAt,
    string Discipline, bool IsOverdue, int? DaysOverdue);

public sealed record NotificationDto(Guid Id, Guid ProjectId, NotificationKind Kind, ResourceType Resource, Guid ResourceId, string Message, DateTime CreatedAt, bool IsRead);

public sealed record NotificationFeedDto(int UnreadCount, IReadOnlyList<NotificationDto> Items);

public sealed record CountItem(string Key, int Count);

public sealed record SeriesPoint(DateTime WeekStart, int Opened, int Closed, int OpenAtEnd);

public sealed record DisciplineVolume(string Discipline, int Total, IReadOnlyList<CountItem> ByStatus);

public sealed record InsightsDto(
    DateTime GeneratedAt,
    double? RfiTurnaroundMedianDays,
    int ClosedRfiSample,
    double? SubmittalReviewMedianDays,
    int OpenRfis,
    int OpenSubmittals,
    int OverdueItems,
    IReadOnlyList<SeriesPoint> RfiOpenVsClosed,
    IReadOnlyList<CountItem> OverdueByDiscipline,
    IReadOnlyList<DisciplineVolume> DocumentsByDiscipline,
    IReadOnlyList<CountItem> RfisByState,
    IReadOnlyList<CountItem> SubmittalsByStatus);
