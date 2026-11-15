namespace DocRoof.Domain.Workflows;

public enum TransitionFailure
{
    None,

    /// <summary>The actor's role or relationship to the item does not permit the action (HTTP 403).</summary>
    Forbidden,

    /// <summary>The action is not valid from the current state (HTTP 409).</summary>
    InvalidState,
}

public sealed record TransitionResult<TState>(bool Allowed, TState? To, TransitionFailure Failure, string Message)
    where TState : struct, Enum
{
    public static TransitionResult<TState> Ok(TState to) => new(true, to, TransitionFailure.None, "");

    public static TransitionResult<TState> Forbidden(string message) => new(false, null, TransitionFailure.Forbidden, message);

    public static TransitionResult<TState> Conflict(string message) => new(false, null, TransitionFailure.InvalidState, message);
}

public enum RfiAction
{
    Submit,
    Assign,
    Answer,
    ApproveAnswer,
    RejectAnswer,
    Close,
    Reopen,
}

/// <summary>Facts about the actor and item that the RFI rules depend on.</summary>
public sealed record RfiActor(ProjectRole Role, bool IsCreator, bool IsAssignee);

/// <summary>Facts about the RFI's current answer.</summary>
public sealed record RfiAnswerFacts(bool HasPendingResponse, bool HasApprovedResponse);

/// <summary>
/// Single source of truth for the RFI lifecycle:
/// Draft → Submitted → Assigned → Answered → (answer approved) → Closed → Reopened → Assigned.
/// Rejecting an answer returns Answered → Assigned. Role checks are evaluated before state checks.
/// </summary>
public static class RfiWorkflow
{
    public static readonly ProjectRole[] CreatorRoles = [ProjectRole.Requester, ProjectRole.ProjectManager, ProjectRole.DocumentController];

    public static TransitionResult<RfiState> Evaluate(RfiState state, RfiAction action, RfiActor actor, RfiAnswerFacts answer)
    {
        switch (action)
        {
            case RfiAction.Submit:
                if (!actor.IsCreator)
                {
                    return TransitionResult<RfiState>.Forbidden("Only the RFI author can submit it.");
                }

                return state == RfiState.Draft
                    ? TransitionResult<RfiState>.Ok(RfiState.Submitted)
                    : Conflict(state, action);

            case RfiAction.Assign:
                if (actor.Role is not (ProjectRole.ProjectManager or ProjectRole.DocumentController))
                {
                    return TransitionResult<RfiState>.Forbidden("Only a project manager or document controller can assign RFIs.");
                }

                return state is RfiState.Submitted or RfiState.Reopened or RfiState.Assigned
                    ? TransitionResult<RfiState>.Ok(RfiState.Assigned)
                    : Conflict(state, action);

            case RfiAction.Answer:
                if (!actor.IsAssignee)
                {
                    return TransitionResult<RfiState>.Forbidden("Only the assigned reviewer can answer this RFI.");
                }

                return state == RfiState.Assigned
                    ? TransitionResult<RfiState>.Ok(RfiState.Answered)
                    : Conflict(state, action);

            case RfiAction.ApproveAnswer:
                if (actor.Role != ProjectRole.ProjectManager)
                {
                    return TransitionResult<RfiState>.Forbidden("Only a project manager can approve an RFI answer.");
                }

                if (state != RfiState.Answered)
                {
                    return Conflict(state, action);
                }

                if (answer.HasApprovedResponse)
                {
                    return TransitionResult<RfiState>.Conflict("The answer has already been approved.");
                }

                return answer.HasPendingResponse
                    ? TransitionResult<RfiState>.Ok(RfiState.Answered)
                    : TransitionResult<RfiState>.Conflict("There is no pending answer to approve.");

            case RfiAction.RejectAnswer:
                if (actor.Role != ProjectRole.ProjectManager)
                {
                    return TransitionResult<RfiState>.Forbidden("Only a project manager can reject an RFI answer.");
                }

                if (state != RfiState.Answered)
                {
                    return Conflict(state, action);
                }

                if (answer.HasApprovedResponse)
                {
                    return TransitionResult<RfiState>.Conflict("An approved answer cannot be rejected.");
                }

                return answer.HasPendingResponse
                    ? TransitionResult<RfiState>.Ok(RfiState.Assigned)
                    : TransitionResult<RfiState>.Conflict("There is no pending answer to reject.");

            case RfiAction.Close:
                if (actor.Role != ProjectRole.ProjectManager)
                {
                    return TransitionResult<RfiState>.Forbidden("Only a project manager can close an RFI.");
                }

                if (state != RfiState.Answered)
                {
                    return Conflict(state, action);
                }

                return answer.HasApprovedResponse
                    ? TransitionResult<RfiState>.Ok(RfiState.Closed)
                    : TransitionResult<RfiState>.Conflict("The answer must be approved before the RFI can be closed.");

            case RfiAction.Reopen:
                if (actor.Role != ProjectRole.ProjectManager && !actor.IsCreator)
                {
                    return TransitionResult<RfiState>.Forbidden("Only a project manager or the original requester can reopen an RFI.");
                }

                return state == RfiState.Closed
                    ? TransitionResult<RfiState>.Ok(RfiState.Reopened)
                    : Conflict(state, action);

            default:
                return TransitionResult<RfiState>.Conflict("Unknown action.");
        }
    }

    /// <summary>Actions that could be valid for the actor right now (used to drive UI affordances; the server re-checks).</summary>
    public static IReadOnlyList<RfiAction> AvailableActions(RfiState state, RfiActor actor, RfiAnswerFacts answer) =>
        Enum.GetValues<RfiAction>().Where(a => Evaluate(state, a, actor, answer).Allowed).ToList();

    public static bool IsOpen(RfiState state) => state is not (RfiState.Closed or RfiState.Draft);

    private static TransitionResult<RfiState> Conflict(RfiState state, RfiAction action) =>
        TransitionResult<RfiState>.Conflict($"Cannot {action} an RFI in state {state}.");
}

public enum SubmittalAction
{
    StartReview,
    Decide,
    Finalize,
    Resubmit,
    Reassign,
}

public sealed record SubmittalActor(ProjectRole Role, bool IsAssignedReviewer);

/// <summary>
/// Submittal lifecycle: Submitted → InReview → Approved | ApprovedWithComments | ReviseAndResubmit → Final.
/// ReviseAndResubmit returns to Submitted only with a new revision (new review cycle).
/// </summary>
public static class SubmittalWorkflow
{
    public static readonly ProjectRole[] CoordinatorRoles = [ProjectRole.ProjectManager, ProjectRole.DocumentController];

    public static TransitionResult<SubmittalStatus> Evaluate(
        SubmittalStatus status, SubmittalAction action, SubmittalActor actor, ReviewDecisionType? decision = null)
    {
        switch (action)
        {
            case SubmittalAction.StartReview:
                if (!actor.IsAssignedReviewer)
                {
                    return TransitionResult<SubmittalStatus>.Forbidden("Only the assigned reviewer can start the review.");
                }

                return status == SubmittalStatus.Submitted
                    ? TransitionResult<SubmittalStatus>.Ok(SubmittalStatus.InReview)
                    : Conflict(status, action);

            case SubmittalAction.Decide:
                if (!actor.IsAssignedReviewer)
                {
                    return TransitionResult<SubmittalStatus>.Forbidden("Only the assigned reviewer can record a decision.");
                }

                if (status != SubmittalStatus.InReview)
                {
                    return status is SubmittalStatus.Approved or SubmittalStatus.ApprovedWithComments or SubmittalStatus.ReviseAndResubmit
                        ? TransitionResult<SubmittalStatus>.Conflict("A decision has already been recorded for this review cycle.")
                        : Conflict(status, action);
                }

                return decision switch
                {
                    ReviewDecisionType.Approved => TransitionResult<SubmittalStatus>.Ok(SubmittalStatus.Approved),
                    ReviewDecisionType.ApprovedWithComments => TransitionResult<SubmittalStatus>.Ok(SubmittalStatus.ApprovedWithComments),
                    ReviewDecisionType.ReviseAndResubmit => TransitionResult<SubmittalStatus>.Ok(SubmittalStatus.ReviseAndResubmit),
                    _ => TransitionResult<SubmittalStatus>.Conflict("A decision value is required."),
                };

            case SubmittalAction.Finalize:
                if (!CoordinatorRoles.Contains(actor.Role))
                {
                    return TransitionResult<SubmittalStatus>.Forbidden("Only a project manager or document controller can finalize.");
                }

                return status is SubmittalStatus.Approved or SubmittalStatus.ApprovedWithComments
                    ? TransitionResult<SubmittalStatus>.Ok(SubmittalStatus.Final)
                    : Conflict(status, action);

            case SubmittalAction.Resubmit:
                if (!CoordinatorRoles.Contains(actor.Role))
                {
                    return TransitionResult<SubmittalStatus>.Forbidden("Only a project manager or document controller can resubmit.");
                }

                return status == SubmittalStatus.ReviseAndResubmit
                    ? TransitionResult<SubmittalStatus>.Ok(SubmittalStatus.Submitted)
                    : Conflict(status, action);

            case SubmittalAction.Reassign:
                if (!CoordinatorRoles.Contains(actor.Role))
                {
                    return TransitionResult<SubmittalStatus>.Forbidden("Only a project manager or document controller can reassign reviewers.");
                }

                return status is SubmittalStatus.Submitted or SubmittalStatus.InReview
                    ? TransitionResult<SubmittalStatus>.Ok(status)
                    : Conflict(status, action);

            default:
                return TransitionResult<SubmittalStatus>.Conflict("Unknown action.");
        }
    }

    public static IReadOnlyList<SubmittalAction> AvailableActions(SubmittalStatus status, SubmittalActor actor) =>
        Enum.GetValues<SubmittalAction>()
            .Where(a => a == SubmittalAction.Decide
                ? Evaluate(status, a, actor, ReviewDecisionType.Approved).Allowed
                : Evaluate(status, a, actor).Allowed)
            .ToList();

    public static bool IsOpen(SubmittalStatus status) => status is SubmittalStatus.Submitted or SubmittalStatus.InReview;

    public static RevisionApprovalStatus ToRevisionStatus(ReviewDecisionType decision) => decision switch
    {
        ReviewDecisionType.Approved => RevisionApprovalStatus.Approved,
        ReviewDecisionType.ApprovedWithComments => RevisionApprovalStatus.ApprovedWithComments,
        _ => RevisionApprovalStatus.ReviseAndResubmit,
    };

    private static TransitionResult<SubmittalStatus> Conflict(SubmittalStatus status, SubmittalAction action) =>
        TransitionResult<SubmittalStatus>.Conflict($"Cannot {action} a submittal in status {status}.");
}

/// <summary>Due-date rules shared by the review queue, reminders and the UI.</summary>
public static class DueDates
{
    public static bool IsOverdue(DateTime? dueAt, DateTime nowUtc, bool isOpen) => isOpen && dueAt is { } due && due < nowUtc;

    public static int DaysOverdue(DateTime? dueAt, DateTime nowUtc) =>
        dueAt is { } due && due < nowUtc ? (int)Math.Floor((nowUtc - due).TotalDays) : 0;

    /// <summary>Idempotency key for overdue reminders: one per item, recipient and UTC day.</summary>
    public static string ReminderKey(ResourceType resource, Guid itemId, Guid recipientId, DateTime nowUtc) =>
        $"overdue:{resource}:{itemId:N}:{recipientId:N}:{nowUtc:yyyyMMdd}";
}
