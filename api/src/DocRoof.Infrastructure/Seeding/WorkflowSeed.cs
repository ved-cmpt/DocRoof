using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;

namespace DocRoof.Infrastructure.Seeding;

/// <summary>
/// Seeds 12 RFIs and 8 submittals across every lifecycle state, with approval histories, audit events and
/// notifications. Exactly three open items are overdue (MCC RFI-004, WOR RFI-001, MCC SUB-003).
/// </summary>
internal static class WorkflowSeed
{
    private sealed record RfiStep(string Action, string Actor, double DaysAgo, object? After = null);

    public static Task SeedAsync(DocRoofDbContext db, AuditWriter audit, SeedContext ctx, CancellationToken ct)
    {
        var u = ctx.Users;
        var mcc = ctx.Projects[SeedLibrary.Midtown];
        var wor = ctx.Projects[SeedLibrary.Westpark];

        // ---------------- RFIs ----------------
        Rfi(db, audit, ctx, mcc, "RFI-001", "Duct leakage test pressure for supply ductwork",
            "Clause 3.2 states 500 Pa 'or as noted on drawings' but M-401 shows no test pressure. Please confirm the test pressure for supply ducts.",
            ctx.Rev(SeedLibrary.HvacSpecKey, "R0"), 3, RfiState.Closed, "requester", "reviewer", dueInDays: -30,
            answer: ("Test all supply ductwork at 500 Pa. RTU-2 medium-pressure trunks will be clarified in the next revision of 23 05 00.", "reviewer", 33),
            approvedDaysAgo: 32, closedDaysAgo: 31, createdDaysAgo: 40);

        Rfi(db, audit, ctx, mcc, "RFI-002", "Allowable bearing pressure at grade beams",
            "General note 3 assumes 150 kPa. Geotechnical confirmation has not been issued for the clinic site. Can we proceed with forming?",
            ctx.Rev("mcc-foundation", "R0"), 1, RfiState.Closed, "requester", "reviewer2", dueInDays: -20,
            answer: ("Proceed at 150 kPa. Geotechnical field review letter is attached to the daily report of the same date.", "reviewer2", 24),
            approvedDaysAgo: 23, closedDaysAgo: 22, createdDaysAgo: 28);

        Rfi(db, audit, ctx, mcc, "RFI-003", "Sprinkler main clearance to RTU curbs",
            "Clause 1.3 requires clearances to RTU curbs but none are dimensioned. What minimum clearance applies?",
            ctx.Rev("mcc-sprinkler", "R0"), 1, RfiState.Answered, "requester", "reviewer", dueInDays: 4,
            answer: ("Maintain 450 mm clear from the curb face to the outside of the sprinkler main and hangers.", "reviewer", 1),
            createdDaysAgo: 6);

        Rfi(db, audit, ctx, mcc, "RFI-004", "RTU-2 trunk duct test pressure conflicts with drawings",
            "Revision R1 clause 3.2 adds 750 Pa for RTU-2 trunks, but drawing M-402 still notes 500 Pa for the same run. Which governs?",
            ctx.Rev(SeedLibrary.HvacSpecKey, "R1"), 3, RfiState.Assigned, "requester", "reviewer", dueInDays: -3, createdDaysAgo: 10);

        Rfi(db, audit, ctx, mcc, "RFI-005", "Feeder size for RTU-1 per product data",
            "Product data shows MCA 38 A. Please confirm feeder conductor size and overcurrent protection for RTU-1.",
            ctx.Rev("mcc-conductors", "R0"), 1, RfiState.Assigned, "controller", "reviewer", dueInDays: 5, createdDaysAgo: 4);

        Rfi(db, audit, ctx, mcc, "RFI-006", "PEX-a in ceiling spaces above pharmacy",
            "Clause 1.1 permits PEX-a in accessible locations only. Is the pharmacy T-bar ceiling considered accessible?",
            ctx.Rev("mcc-piping", "R0"), 1, RfiState.Submitted, "requester", null, dueInDays: null, createdDaysAgo: 2);

        Rfi(db, audit, ctx, mcc, "RFI-007", "Meeting 7 action item: confirm RTU-2 test pressure",
            "Draft RFI from coordination meeting 7, item 7.1. To be completed before submission.",
            ctx.Rev("mcc-minutes", "R0"), 1, RfiState.Draft, "requester", null, dueInDays: null, createdDaysAgo: 1);

        Rfi(db, audit, ctx, mcc, "RFI-008", "Access door locations at fire dampers",
            "Shop drawings omit access doors at FD-3 and FD-4. Please confirm required locations.",
            ctx.Rev("mcc-ducts", "R0"), 2, RfiState.Reopened, "requester", "reviewer", dueInDays: -12,
            answer: ("Provide access doors on the downstream side of every fire damper; minimum 300 x 300 mm.", "reviewer", 16),
            approvedDaysAgo: 15, closedDaysAgo: 14, createdDaysAgo: 20,
            reopen: ("FD-4 is above a hard ceiling; the answer does not say how access is provided there.", 3));

        Rfi(db, audit, ctx, mcc, "RFI-009", "RTU-1 operating weight vs dunnage detail",
            "Product data lists 1,240 kg operating weight. Detail 7/S-201 was designed for which unit weight?",
            ctx.Rev(SeedLibrary.InjectionKey, "R0"), 1, RfiState.Assigned, "requester", "reviewer2", dueInDays: 2,
            answer: ("Detail is adequate.", "reviewer2", 4), rejected: ("Please state the design weight used so the record is traceable.", 3),
            createdDaysAgo: 8);

        Rfi(db, audit, ctx, wor, "RFI-001", "Existing beam sizes on gridline C",
            "Field measurement shows W310x39 at gridline C, not W310x45 as assumed. Do cover plates still apply?",
            ctx.Rev("wor-steel", "R0"), 1, RfiState.Assigned, "requester", "reviewer2", dueInDays: -2, createdDaysAgo: 9);

        Rfi(db, audit, ctx, wor, "RFI-002", "Catch basin CB-3 connection elevation",
            "Existing storm main invert is 0.4 m higher than shown. Confirm connection approach for CB-3.",
            ctx.Rev("wor-grading", "R0"), 1, RfiState.Closed, "requester", "reviewer2", dueInDays: -25,
            answer: ("Connect with a drop structure; maintain 1 percent minimum slope on the lead.", "reviewer2", 30),
            approvedDaysAgo: 29, closedDaysAgo: 28, createdDaysAgo: 35);

        Rfi(db, audit, ctx, wor, "RFI-003", "Daylight harvesting zone depth",
            "Clause 1.2 says 4.5 m from windows; the reflected ceiling plan shows 3 m. Which applies to the open office?",
            ctx.Rev("wor-lighting", "R0"), 1, RfiState.Submitted, "controller", null, dueInDays: null, createdDaysAgo: 1);

        // ---------------- Submittals ----------------
        Submittal(db, audit, ctx, mcc, "SUB-001", "Sprinkler working plans and hydraulic calculations", "21 13 13", "mcc-sprinkler", "R0", "reviewer",
            SubmittalStatus.Final, submittedDaysAgo: 30, dueInDays: -16, decisions: [(ReviewDecisionType.Approved, "Approved as submitted.", 24, "R0")], finalizedDaysAgo: 22);

        Submittal(db, audit, ctx, mcc, "SUB-002", "Supply duct shop drawings, Level 2", "23 31 00", "mcc-ducts", "R0", "reviewer",
            SubmittalStatus.ApprovedWithComments, submittedDaysAgo: 18, dueInDays: -4,
            decisions: [(ReviewDecisionType.ApprovedWithComments, "Add access doors at FD-3 and FD-4; otherwise acceptable.", 7, "R0")]);

        Submittal(db, audit, ctx, mcc, "SUB-003", "RTU-1 product data", "23 05 00", SeedLibrary.InjectionKey, "R0", "reviewer",
            SubmittalStatus.InReview, submittedDaysAgo: 9, dueInDays: -2, reviewStartedDaysAgo: 5);

        Submittal(db, audit, ctx, mcc, "SUB-004", "Domestic water piping materials", "22 11 16", "mcc-piping", "R0", "reviewer",
            SubmittalStatus.Submitted, submittedDaysAgo: 3, dueInDays: 7);

        Submittal(db, audit, ctx, mcc, "SUB-005", "Power conductor product data", "26 05 19", "mcc-conductors", "R0", "reviewer",
            SubmittalStatus.InReview, submittedDaysAgo: 4, dueInDays: 6, reviewStartedDaysAgo: 1);

        Submittal(db, audit, ctx, wor, "SUB-001", "Steel reinforcement shop drawings", "05 12 00", "wor-steel", "R1", "reviewer2",
            SubmittalStatus.Submitted, submittedDaysAgo: 6, dueInDays: 4,
            decisions: [(ReviewDecisionType.ReviseAndResubmit, "Cover plates undersized for the measured W310x39 sections. Revise and resubmit.", 12, "R0")]);

        Submittal(db, audit, ctx, wor, "SUB-002", "DDC points list and sequences", "23 09 23", "wor-ddc", "R0", "reviewer2",
            SubmittalStatus.ReviseAndResubmit, submittedDaysAgo: 14, dueInDays: -5,
            decisions: [(ReviewDecisionType.ReviseAndResubmit, "Points list is missing VAV box airflow trends. Revise and resubmit.", 8, "R0")]);

        Submittal(db, audit, ctx, wor, "SUB-003", "Interior luminaire product data", "26 51 00", "wor-lighting", "R0", "reviewer2",
            SubmittalStatus.Approved, submittedDaysAgo: 20, dueInDays: -8,
            decisions: [(ReviewDecisionType.Approved, "Approved.", 11, "R0")]);

        // A few unread notifications so the bell is meaningful on first load.
        Notify(db, ctx, "reviewer", mcc, NotificationKind.Assigned, ResourceType.Rfi, "RFI-004 was assigned to you.", 10);
        Notify(db, ctx, "manager", mcc, NotificationKind.Answered, ResourceType.Rfi, "RFI-003 has an answer awaiting your approval.", 1);
        Notify(db, ctx, "requester", mcc, NotificationKind.AnswerRejected, ResourceType.Rfi, "RFI-009: the answer was returned for more detail.", 3);
        Notify(db, ctx, "controller", wor, NotificationKind.DecisionRecorded, ResourceType.Submittal, "SUB-002 was marked Revise and Resubmit.", 8);
        return Task.CompletedTask;
    }

    private static void Rfi(DocRoofDbContext db, AuditWriter audit, SeedContext ctx, Project project, string reference, string subject, string question,
        DocumentRevision source, int page, RfiState finalState, string creator, string? assignee, double? dueInDays,
        (string Text, string Author, double DaysAgo)? answer = null, double? approvedDaysAgo = null, double? closedDaysAgo = null,
        double createdDaysAgo = 5, (string Reason, double DaysAgo)? reopen = null, (string Reason, double DaysAgo)? rejected = null)
    {
        var u = ctx.Users;
        var tenantId = ctx.Tenant.Id;
        var rfi = new Rfi
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            ReferenceNumber = reference,
            Subject = subject,
            Question = question,
            SourceRevisionId = source.Id,
            SourcePage = page,
            State = finalState,
            CreatedById = u[creator].Id,
            CreatedAt = ctx.DaysAgo(createdDaysAgo),
            UpdatedAt = ctx.DaysAgo(createdDaysAgo),
        };
        db.Rfis.Add(rfi);
        void Log(string action, string actor, double daysAgo, object? before, object? after) =>
            audit.Add(tenantId, project.Id, u[actor].Id, ResourceType.Rfi, rfi.Id, action, before, after, ctx.DaysAgo(daysAgo));

        Log("rfi.created", creator, createdDaysAgo, null, new { rfi.ReferenceNumber, rfi.Subject, SourcePage = page, State = RfiState.Draft });
        if (finalState == RfiState.Draft)
        {
            rfi.State = RfiState.Draft;
            return;
        }

        var submitted = createdDaysAgo - 0.1;
        rfi.SubmittedAt = ctx.DaysAgo(submitted);
        Log("rfi.submitted", creator, submitted, new { State = RfiState.Draft }, new { State = RfiState.Submitted });
        if (assignee is null)
        {
            return;
        }

        var assigned = createdDaysAgo - 0.5;
        rfi.AssigneeId = u[assignee].Id;
        rfi.DueAt = dueInDays is { } d ? ctx.Now.AddDays(d) : null;
        Log("rfi.assigned", "manager", assigned, new { State = RfiState.Submitted }, new { State = RfiState.Assigned, Assignee = u[assignee].DisplayName, rfi.DueAt });
        rfi.UpdatedAt = ctx.DaysAgo(assigned);

        if (answer is { } a)
        {
            var response = new RfiResponse
            {
                Id = Guid.NewGuid(),
                RfiId = rfi.Id,
                AuthorId = u[a.Author].Id,
                Answer = a.Text,
                CreatedAt = ctx.DaysAgo(a.DaysAgo),
                Status = RfiResponseStatus.Pending,
            };
            db.RfiResponses.Add(response);
            rfi.AnsweredAt = response.CreatedAt;
            Log("rfi.answered", a.Author, a.DaysAgo, new { State = RfiState.Assigned }, new { State = RfiState.Answered, ResponseId = response.Id });

            if (rejected is { } rj)
            {
                response.Status = RfiResponseStatus.Rejected;
                response.RejectedById = u["manager"].Id;
                response.RejectedAt = ctx.DaysAgo(rj.DaysAgo);
                response.RejectionReason = rj.Reason;
                Log("rfi.answer-rejected", "manager", rj.DaysAgo, new { State = RfiState.Answered }, new { State = RfiState.Assigned, Reason = rj.Reason });
            }

            if (approvedDaysAgo is { } ap)
            {
                response.Status = RfiResponseStatus.Approved;
                response.ApprovedById = u["manager"].Id;
                response.ApprovedAt = ctx.DaysAgo(ap);
                rfi.ApprovedResponseId = response.Id;
                Log("rfi.answer-approved", "manager", ap, new { ApprovedResponseId = (Guid?)null }, new { ApprovedResponseId = response.Id });
            }

            if (closedDaysAgo is { } cl)
            {
                rfi.ClosedAt = ctx.DaysAgo(cl);
                Log("rfi.closed", "manager", cl, new { State = RfiState.Answered }, new { State = RfiState.Closed });
            }

            if (reopen is { } ro)
            {
                rfi.ReopenReason = ro.Reason;
                rfi.ApprovedResponseId = null;
                rfi.AssigneeId = null;
                rfi.DueAt = null;
                Log("rfi.reopened", creator, ro.DaysAgo, new { State = RfiState.Closed }, new { State = RfiState.Reopened, Reason = ro.Reason });
            }

            rfi.UpdatedAt = ctx.DaysAgo(new[] { a.DaysAgo, approvedDaysAgo ?? 999, closedDaysAgo ?? 999, reopen?.DaysAgo ?? 999, rejected?.DaysAgo ?? 999 }.Min());
        }
    }

    private static void Submittal(DocRoofDbContext db, AuditWriter audit, SeedContext ctx, Project project, string number, string title, string section,
        string docKey, string currentLabel, string reviewer, SubmittalStatus finalStatus, double submittedDaysAgo, double dueInDays,
        (ReviewDecisionType Decision, string Comments, double DaysAgo, string RevisionLabel)[]? decisions = null,
        double? reviewStartedDaysAgo = null, double? finalizedDaysAgo = null)
    {
        var u = ctx.Users;
        var tenantId = ctx.Tenant.Id;
        var doc = ctx.Documents[docKey];
        var current = ctx.Rev(docKey, currentLabel);
        var firstSubmitted = decisions is { Length: > 0 } ? Math.Max(submittedDaysAgo, decisions[0].DaysAgo + 3) : submittedDaysAgo;
        var s = new Submittal
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            Number = number,
            Title = title,
            SpecSection = section,
            DocumentId = doc.Id,
            RevisionId = current.Id,
            Status = finalStatus,
            Cycle = 1,
            AssignedReviewerId = u[reviewer].Id,
            DueAt = ctx.Now.AddDays(dueInDays),
            SubmittedById = u["controller"].Id,
            SubmittedAt = ctx.DaysAgo(submittedDaysAgo),
            UpdatedAt = ctx.DaysAgo(submittedDaysAgo),
        };
        db.Submittals.Add(s);
        void Log(string action, string actor, double daysAgo, object? before, object? after) =>
            audit.Add(tenantId, project.Id, u[actor].Id, ResourceType.Submittal, s.Id, action, before, after, ctx.DaysAgo(daysAgo));

        Log("submittal.submitted", "controller", firstSubmitted, null,
            new { s.Number, Status = SubmittalStatus.Submitted, Cycle = 1, Reviewer = u[reviewer].DisplayName });

        var cycle = 1;
        foreach (var (decision, comments, daysAgo, label) in decisions ?? [])
        {
            var rev = ctx.Rev(docKey, label);
            Log("submittal.review-started", reviewer, daysAgo + 1, new { Status = SubmittalStatus.Submitted }, new { Status = SubmittalStatus.InReview, Cycle = cycle });
            db.ReviewDecisions.Add(new ReviewDecision
            {
                Id = Guid.NewGuid(),
                SubmittalId = s.Id,
                Cycle = cycle,
                RevisionId = rev.Id,
                ReviewerId = u[reviewer].Id,
                Decision = decision,
                Comments = comments,
                CreatedAt = ctx.DaysAgo(daysAgo),
            });
            var revStatus = Domain.Workflows.SubmittalWorkflow.ToRevisionStatus(decision);
            rev.ApprovalStatus = revStatus;
            rev.ApprovalUpdatedAt = ctx.DaysAgo(daysAgo);
            s.ReviewStartedAt = ctx.DaysAgo(daysAgo + 1);
            s.DecidedAt = ctx.DaysAgo(daysAgo);
            Log("submittal.decided", reviewer, daysAgo, new { Status = SubmittalStatus.InReview }, new { Status = decision.ToString(), Cycle = cycle, Comments = comments });
            audit.Add(tenantId, project.Id, u[reviewer].Id, ResourceType.DocumentRevision, rev.Id, "revision.approval-status",
                new { ApprovalStatus = RevisionApprovalStatus.Pending }, new { ApprovalStatus = revStatus }, ctx.DaysAgo(daysAgo));

            if (decision == ReviewDecisionType.ReviseAndResubmit && finalStatus == SubmittalStatus.Submitted && current.Id != rev.Id)
            {
                cycle++;
                s.Cycle = cycle;
                s.ReviewStartedAt = null;
                s.DecidedAt = null;
                current.ApprovalStatus = RevisionApprovalStatus.Pending;
                current.ApprovalUpdatedAt = ctx.DaysAgo(submittedDaysAgo);
                Log("submittal.resubmitted", "controller", submittedDaysAgo, new { Status = SubmittalStatus.ReviseAndResubmit, Cycle = cycle - 1 },
                    new { Status = SubmittalStatus.Submitted, Cycle = cycle, Revision = current.VersionLabel });
            }
        }

        if (finalStatus is SubmittalStatus.Submitted or SubmittalStatus.InReview)
        {
            current.ApprovalStatus = RevisionApprovalStatus.Pending;
            current.ApprovalUpdatedAt ??= ctx.DaysAgo(submittedDaysAgo);
        }

        if (reviewStartedDaysAgo is { } rs)
        {
            s.ReviewStartedAt = ctx.DaysAgo(rs);
            Log("submittal.review-started", reviewer, rs, new { Status = SubmittalStatus.Submitted }, new { Status = SubmittalStatus.InReview, Cycle = cycle });
        }

        if (finalizedDaysAgo is { } fz)
        {
            s.FinalizedAt = ctx.DaysAgo(fz);
            s.FinalizedById = u["controller"].Id;
            Log("submittal.finalized", "controller", fz, new { Status = SubmittalStatus.Approved }, new { Status = SubmittalStatus.Final });
        }

        s.UpdatedAt = s.FinalizedAt ?? s.DecidedAt ?? s.ReviewStartedAt ?? s.SubmittedAt;
    }

    private static void Notify(DocRoofDbContext db, SeedContext ctx, string recipient, Project project, NotificationKind kind, ResourceType resource, string message, double daysAgo)
    {
        var reference = message.Split(' ')[0].TrimEnd('.', ':');
        var resourceId = resource == ResourceType.Rfi
            ? db.ChangeTracker.Entries<Rfi>().Select(e => e.Entity).First(r => r.ProjectId == project.Id && r.ReferenceNumber == reference).Id
            : db.ChangeTracker.Entries<Submittal>().Select(e => e.Entity).First(s => s.ProjectId == project.Id && s.Number == reference).Id;
        db.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            RecipientId = ctx.Users[recipient].Id,
            ProjectId = project.Id,
            Kind = kind,
            Resource = resource,
            ResourceId = resourceId,
            Message = message,
            CreatedAt = ctx.DaysAgo(daysAgo),
        });
    }
}
