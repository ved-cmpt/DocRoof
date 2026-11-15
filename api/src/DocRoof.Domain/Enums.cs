namespace DocRoof.Domain;

/// <summary>Role a user holds inside a single project. Roles are per project membership, never global.</summary>
public enum ProjectRole
{
    DocumentController,
    ProjectManager,
    Reviewer,
    Requester,
}

public enum DocumentStatus
{
    Draft,
    InReview,
    Issued,
    Archived,
}

public enum Discipline
{
    General,
    Architectural,
    Structural,
    Mechanical,
    Electrical,
    Plumbing,
    FireProtection,
    Civil,
}

public enum DocumentCategory
{
    Specification,
    Drawing,
    Report,
    ProductData,
    Schedule,
    Correspondence,
    Manual,
}

/// <summary>Review outcome reflected on a revision. This is the only mutable revision column group.</summary>
public enum RevisionApprovalStatus
{
    NotReviewed,
    Pending,
    Approved,
    ApprovedWithComments,
    ReviseAndResubmit,
}

public enum RfiState
{
    Draft,
    Submitted,
    Assigned,
    Answered,
    Closed,
    Reopened,
}

public enum RfiResponseStatus
{
    Pending,
    Approved,
    Rejected,
}

public enum SubmittalStatus
{
    Submitted,
    InReview,
    Approved,
    ApprovedWithComments,
    ReviseAndResubmit,
    Final,
}

public enum ReviewDecisionType
{
    Approved,
    ApprovedWithComments,
    ReviseAndResubmit,
}

public enum ExtractionField
{
    Title,
    Discipline,
    DocumentNumber,
    Date,
    SpecSection,
}

public enum ConfidenceLabel
{
    High,
    Medium,
    Low,
}

public enum SuggestionStatus
{
    Pending,
    Accepted,
    Rejected,
}

/// <summary>Resource names used by comments, audit events and notifications.</summary>
public enum ResourceType
{
    Tenant,
    Project,
    Membership,
    Document,
    DocumentRevision,
    Rfi,
    RfiResponse,
    Submittal,
    ReviewDecision,
    ExtractionSuggestion,
    Comment,
    Notification,
}

public enum NotificationKind
{
    Overdue,
    Assigned,
    Answered,
    AnswerApproved,
    AnswerRejected,
    Closed,
    Reopened,
    ReviewRequested,
    DecisionRecorded,
    Finalized,
    Commented,
}

public static class EnumNames
{
    /// <summary>Comma separated, single-quoted list of enum names for SQL check constraints.</summary>
    public static string SqlList<TEnum>()
        where TEnum : struct, Enum =>
        string.Join(", ", Enum.GetNames<TEnum>().Select(n => "'" + n + "'"));
}
