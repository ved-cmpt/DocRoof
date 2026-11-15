using DocRoof.Domain;
using DocRoof.Domain.Workflows;
using DocRoof.Infrastructure.Services;

namespace DocRoof.UnitTests;

public class RfiWorkflowTests
{
    private static readonly RfiActor Pm = new(ProjectRole.ProjectManager, IsCreator: false, IsAssignee: false);
    private static readonly RfiActor Dc = new(ProjectRole.DocumentController, false, false);
    private static readonly RfiActor Creator = new(ProjectRole.Requester, IsCreator: true, IsAssignee: false);
    private static readonly RfiActor OtherRequester = new(ProjectRole.Requester, false, false);
    private static readonly RfiActor Assignee = new(ProjectRole.Reviewer, false, IsAssignee: true);
    private static readonly RfiActor OtherReviewer = new(ProjectRole.Reviewer, false, false);

    private static readonly RfiAnswerFacts NoAnswer = new(false, false);
    private static readonly RfiAnswerFacts Pending = new(true, false);
    private static readonly RfiAnswerFacts Approved = new(false, true);

    /// <summary>Every allowed transition (state, action, actor, facts) → target state.</summary>
    public static TheoryData<RfiState, RfiAction, string, string, RfiState> Allowed => new()
    {
        { RfiState.Draft, RfiAction.Submit, "creator", "none", RfiState.Submitted },
        { RfiState.Submitted, RfiAction.Assign, "pm", "none", RfiState.Assigned },
        { RfiState.Submitted, RfiAction.Assign, "dc", "none", RfiState.Assigned },
        { RfiState.Assigned, RfiAction.Assign, "pm", "none", RfiState.Assigned },
        { RfiState.Reopened, RfiAction.Assign, "dc", "none", RfiState.Assigned },
        { RfiState.Assigned, RfiAction.Answer, "assignee", "none", RfiState.Answered },
        { RfiState.Answered, RfiAction.ApproveAnswer, "pm", "pending", RfiState.Answered },
        { RfiState.Answered, RfiAction.RejectAnswer, "pm", "pending", RfiState.Assigned },
        { RfiState.Answered, RfiAction.Close, "pm", "approved", RfiState.Closed },
        { RfiState.Closed, RfiAction.Reopen, "pm", "approved", RfiState.Reopened },
        { RfiState.Closed, RfiAction.Reopen, "creator", "approved", RfiState.Reopened },
    };

    [Theory]
    [MemberData(nameof(Allowed))]
    public void Allowed_transitions_reach_the_expected_state(RfiState from, RfiAction action, string actor, string facts, RfiState to)
    {
        var result = RfiWorkflow.Evaluate(from, action, ActorFor(actor), FactsFor(facts));
        Assert.True(result.Allowed, result.Message);
        Assert.Equal(to, result.To);
    }

    /// <summary>
    /// Exhaustive check: for every state × action with an actor who holds the right role, anything not in the allowed
    /// table is rejected as an invalid-state conflict (409).
    /// </summary>
    [Fact]
    public void Every_other_state_action_combination_is_rejected_with_conflict()
    {
        var allowed = Allowed.Select(r => ((RfiState)r[0], (RfiAction)r[1])).ToHashSet();
        foreach (var state in Enum.GetValues<RfiState>())
        {
            foreach (var action in Enum.GetValues<RfiAction>())
            {
                if (allowed.Contains((state, action)))
                {
                    continue;
                }

                var actor = action switch
                {
                    RfiAction.Submit => Creator,
                    RfiAction.Answer => Assignee,
                    _ => Pm,
                };
                var result = RfiWorkflow.Evaluate(state, action, actor, Pending);
                Assert.False(result.Allowed, $"{state} + {action} should be rejected");
                Assert.Equal(TransitionFailure.InvalidState, result.Failure);
            }
        }
    }

    [Theory]
    [InlineData(RfiState.Draft, RfiAction.Submit, "other-requester")]
    [InlineData(RfiState.Draft, RfiAction.Submit, "pm")]
    [InlineData(RfiState.Submitted, RfiAction.Assign, "creator")]
    [InlineData(RfiState.Submitted, RfiAction.Assign, "assignee")]
    [InlineData(RfiState.Assigned, RfiAction.Answer, "other-reviewer")]
    [InlineData(RfiState.Assigned, RfiAction.Answer, "pm")]
    [InlineData(RfiState.Answered, RfiAction.ApproveAnswer, "dc")]
    [InlineData(RfiState.Answered, RfiAction.ApproveAnswer, "assignee")]
    [InlineData(RfiState.Answered, RfiAction.RejectAnswer, "creator")]
    [InlineData(RfiState.Answered, RfiAction.Close, "dc")]
    [InlineData(RfiState.Answered, RfiAction.Close, "creator")]
    [InlineData(RfiState.Closed, RfiAction.Reopen, "other-requester")]
    [InlineData(RfiState.Closed, RfiAction.Reopen, "dc")]
    public void Wrong_role_or_relationship_is_forbidden(RfiState state, RfiAction action, string actor)
    {
        var result = RfiWorkflow.Evaluate(state, action, ActorFor(actor), action == RfiAction.Close ? Approved : Pending);
        Assert.False(result.Allowed);
        Assert.Equal(TransitionFailure.Forbidden, result.Failure);
    }

    [Fact]
    public void Second_approval_is_a_conflict()
    {
        var result = RfiWorkflow.Evaluate(RfiState.Answered, RfiAction.ApproveAnswer, Pm, Approved);
        Assert.Equal(TransitionFailure.InvalidState, result.Failure);
        Assert.Contains("already been approved", result.Message);
    }

    [Fact]
    public void Closing_requires_an_approved_answer()
    {
        var result = RfiWorkflow.Evaluate(RfiState.Answered, RfiAction.Close, Pm, Pending);
        Assert.Equal(TransitionFailure.InvalidState, result.Failure);
    }

    [Fact]
    public void Available_actions_reflect_role_and_state()
    {
        Assert.Equal([RfiAction.ApproveAnswer, RfiAction.RejectAnswer], RfiWorkflow.AvailableActions(RfiState.Answered, Pm, Pending));
        Assert.Equal([RfiAction.Close], RfiWorkflow.AvailableActions(RfiState.Answered, Pm, Approved));
        Assert.Empty(RfiWorkflow.AvailableActions(RfiState.Answered, Creator, Pending));
        Assert.Equal([RfiAction.Answer], RfiWorkflow.AvailableActions(RfiState.Assigned, Assignee, NoAnswer));
    }

    private static RfiActor ActorFor(string key) => key switch
    {
        "pm" => Pm,
        "dc" => Dc,
        "creator" => Creator,
        "assignee" => Assignee,
        "other-reviewer" => OtherReviewer,
        _ => OtherRequester,
    };

    private static RfiAnswerFacts FactsFor(string key) => key switch
    {
        "pending" => Pending,
        "approved" => Approved,
        _ => NoAnswer,
    };
}

public class SubmittalWorkflowTests
{
    private static readonly SubmittalActor Reviewer = new(ProjectRole.Reviewer, IsAssignedReviewer: true);
    private static readonly SubmittalActor OtherReviewer = new(ProjectRole.Reviewer, false);
    private static readonly SubmittalActor Pm = new(ProjectRole.ProjectManager, false);
    private static readonly SubmittalActor Dc = new(ProjectRole.DocumentController, false);
    private static readonly SubmittalActor Requester = new(ProjectRole.Requester, false);

    public static TheoryData<SubmittalStatus, SubmittalAction, string, ReviewDecisionType?, SubmittalStatus> Allowed => new()
    {
        { SubmittalStatus.Submitted, SubmittalAction.StartReview, "reviewer", null, SubmittalStatus.InReview },
        { SubmittalStatus.InReview, SubmittalAction.Decide, "reviewer", ReviewDecisionType.Approved, SubmittalStatus.Approved },
        { SubmittalStatus.InReview, SubmittalAction.Decide, "reviewer", ReviewDecisionType.ApprovedWithComments, SubmittalStatus.ApprovedWithComments },
        { SubmittalStatus.InReview, SubmittalAction.Decide, "reviewer", ReviewDecisionType.ReviseAndResubmit, SubmittalStatus.ReviseAndResubmit },
        { SubmittalStatus.Approved, SubmittalAction.Finalize, "pm", null, SubmittalStatus.Final },
        { SubmittalStatus.ApprovedWithComments, SubmittalAction.Finalize, "dc", null, SubmittalStatus.Final },
        { SubmittalStatus.ReviseAndResubmit, SubmittalAction.Resubmit, "dc", null, SubmittalStatus.Submitted },
        { SubmittalStatus.Submitted, SubmittalAction.Reassign, "pm", null, SubmittalStatus.Submitted },
        { SubmittalStatus.InReview, SubmittalAction.Reassign, "dc", null, SubmittalStatus.InReview },
    };

    [Theory]
    [MemberData(nameof(Allowed))]
    public void Allowed_transitions_reach_the_expected_status(SubmittalStatus from, SubmittalAction action, string actor, ReviewDecisionType? decision, SubmittalStatus to)
    {
        var result = SubmittalWorkflow.Evaluate(from, action, ActorFor(actor), decision);
        Assert.True(result.Allowed, result.Message);
        Assert.Equal(to, result.To);
    }

    [Fact]
    public void Every_other_status_action_combination_is_rejected_with_conflict()
    {
        var allowed = Allowed.Select(r => ((SubmittalStatus)r[0], (SubmittalAction)r[1])).ToHashSet();
        foreach (var status in Enum.GetValues<SubmittalStatus>())
        {
            foreach (var action in Enum.GetValues<SubmittalAction>())
            {
                if (allowed.Contains((status, action)))
                {
                    continue;
                }

                var actor = action is SubmittalAction.StartReview or SubmittalAction.Decide ? Reviewer : Pm;
                var result = SubmittalWorkflow.Evaluate(status, action, actor, ReviewDecisionType.Approved);
                Assert.False(result.Allowed, $"{status} + {action} should be rejected");
                Assert.Equal(TransitionFailure.InvalidState, result.Failure);
            }
        }
    }

    [Theory]
    [InlineData(SubmittalStatus.Submitted, SubmittalAction.StartReview, "other-reviewer")]
    [InlineData(SubmittalStatus.Submitted, SubmittalAction.StartReview, "pm")]
    [InlineData(SubmittalStatus.InReview, SubmittalAction.Decide, "other-reviewer")]
    [InlineData(SubmittalStatus.InReview, SubmittalAction.Decide, "pm")]
    [InlineData(SubmittalStatus.Approved, SubmittalAction.Finalize, "reviewer")]
    [InlineData(SubmittalStatus.Approved, SubmittalAction.Finalize, "requester")]
    [InlineData(SubmittalStatus.ReviseAndResubmit, SubmittalAction.Resubmit, "requester")]
    [InlineData(SubmittalStatus.ReviseAndResubmit, SubmittalAction.Resubmit, "reviewer")]
    public void Only_the_assigned_reviewer_decides_and_only_coordinators_finalize(SubmittalStatus status, SubmittalAction action, string actor)
    {
        var result = SubmittalWorkflow.Evaluate(status, action, ActorFor(actor), ReviewDecisionType.Approved);
        Assert.Equal(TransitionFailure.Forbidden, result.Failure);
    }

    [Theory]
    [InlineData(SubmittalStatus.Approved)]
    [InlineData(SubmittalStatus.ApprovedWithComments)]
    [InlineData(SubmittalStatus.ReviseAndResubmit)]
    public void A_second_decision_in_the_same_cycle_is_a_conflict(SubmittalStatus decided)
    {
        var result = SubmittalWorkflow.Evaluate(decided, SubmittalAction.Decide, Reviewer, ReviewDecisionType.Approved);
        Assert.Equal(TransitionFailure.InvalidState, result.Failure);
        Assert.Contains("already been recorded", result.Message);
    }

    [Theory]
    [InlineData(ReviewDecisionType.Approved, RevisionApprovalStatus.Approved)]
    [InlineData(ReviewDecisionType.ApprovedWithComments, RevisionApprovalStatus.ApprovedWithComments)]
    [InlineData(ReviewDecisionType.ReviseAndResubmit, RevisionApprovalStatus.ReviseAndResubmit)]
    public void Decisions_map_to_revision_approval_status(ReviewDecisionType decision, RevisionApprovalStatus expected) =>
        Assert.Equal(expected, SubmittalWorkflow.ToRevisionStatus(decision));

    private static SubmittalActor ActorFor(string key) => key switch
    {
        "reviewer" => Reviewer,
        "other-reviewer" => OtherReviewer,
        "pm" => Pm,
        "dc" => Dc,
        _ => Requester,
    };
}

public class DueDateAndReminderTests
{
    private static readonly DateTime Now = new(2026, 11, 15, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Open_items_past_due_are_overdue()
    {
        Assert.True(DueDates.IsOverdue(Now.AddMinutes(-1), Now, isOpen: true));
        Assert.False(DueDates.IsOverdue(Now.AddMinutes(1), Now, isOpen: true));
        Assert.False(DueDates.IsOverdue(Now.AddDays(-3), Now, isOpen: false));
        Assert.False(DueDates.IsOverdue(null, Now, isOpen: true));
    }

    [Fact]
    public void Days_overdue_counts_whole_days()
    {
        Assert.Equal(3, DueDates.DaysOverdue(Now.AddDays(-3.5), Now));
        Assert.Equal(0, DueDates.DaysOverdue(Now.AddHours(-2), Now));
        Assert.Equal(0, DueDates.DaysOverdue(Now.AddDays(2), Now));
    }

    [Fact]
    public void Reminder_key_is_stable_within_a_day_and_changes_the_next_day()
    {
        var item = Guid.NewGuid();
        var recipient = Guid.NewGuid();
        var morning = DueDates.ReminderKey(ResourceType.Rfi, item, recipient, Now.Date.AddHours(1));
        var evening = DueDates.ReminderKey(ResourceType.Rfi, item, recipient, Now.Date.AddHours(23));
        var tomorrow = DueDates.ReminderKey(ResourceType.Rfi, item, recipient, Now.Date.AddDays(1).AddHours(1));
        Assert.Equal(morning, evening);
        Assert.NotEqual(morning, tomorrow);
        Assert.NotEqual(morning, DueDates.ReminderKey(ResourceType.Rfi, item, Guid.NewGuid(), Now));
        Assert.True(morning.Length <= 200);
    }

    [Theory]
    [InlineData(new double[] { }, null)]
    [InlineData(new[] { 4.0 }, 4.0)]
    [InlineData(new[] { 1.0, 9.0, 3.0 }, 3.0)]
    [InlineData(new[] { 1.0, 2.0, 3.0, 10.0 }, 2.5)]
    public void Median_turnaround(double[] values, double? expected) => Assert.Equal(expected, InsightsService.Median(values));
}
