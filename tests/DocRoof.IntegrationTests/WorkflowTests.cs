using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Infrastructure.Services;
using DocRoof.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace DocRoof.IntegrationTests;

[Collection(SqlCollection.Name)]
public class WorkflowTests(AppFixture app)
{
    private DocRoofFactory Factory => app.Factory;

    private static async Task<JsonElement> Json(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>(ApiClient.Json);

    private static async Task<JsonElement> Ok(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await Json(response);
    }

    private static async Task<JsonElement> FindRfiAsync(ApiClient c, string project, string reference)
    {
        var projectId = await c.ProjectIdAsync(project);
        var list = await c.GetAsync<JsonElement>($"/api/projects/{projectId}/rfis?search={reference}");
        var id = list.GetProperty("items").EnumerateArray().First(r => r.GetProperty("referenceNumber").GetString() == reference).GetProperty("id").GetGuid();
        return await c.GetAsync<JsonElement>($"/api/rfis/{id}");
    }

    private static async Task<JsonElement> FindSubmittalAsync(ApiClient c, string project, string number)
    {
        var projectId = await c.ProjectIdAsync(project);
        var list = await c.GetAsync<JsonElement>($"/api/projects/{projectId}/submittals?pageSize=50");
        var id = list.GetProperty("items").EnumerateArray().First(r => r.GetProperty("number").GetString() == number).GetProperty("id").GetGuid();
        return await c.GetAsync<JsonElement>($"/api/submittals/{id}");
    }

    private static Guid Id(JsonElement e) => e.GetProperty("id").GetGuid();

    private static string Rv(JsonElement e) => e.GetProperty("rowVersion").GetString()!;

    // ---------- The guided scenario through the API ----------

    [Fact]
    public async Task Guided_rfi_scenario_runs_end_to_end_with_audit_trail()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync(); // requester
        var hvac = await c.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var projectId = hvac.GetProperty("projectId").GetGuid();
        var revisionId = hvac.GetProperty("currentRevisionId").GetGuid();

        var rfi = await Ok(await c.Http.PostAsJsonAsync($"/api/projects/{projectId}/rfis", new
        {
            subject = "Clarify RTU-2 trunk test pressure",
            question = "Clause 3.2 lists 500 Pa and 750 Pa. Which applies to the RTU-2 trunk?",
            sourceRevisionId = revisionId,
            sourcePage = 3,
            submit = true,
        }));
        Assert.Equal("Submitted", rfi.GetProperty("state").GetString());
        Assert.Equal("RFI-010", rfi.GetProperty("referenceNumber").GetString());
        Assert.Equal(3, rfi.GetProperty("citation").GetProperty("page").GetInt32());

        await c.SwitchPersonaAsync("manager");
        var reviewerId = (await c.GetAsync<JsonElement>($"/api/projects/{projectId}/members")).EnumerateArray()
            .First(m => m.GetProperty("displayName").GetString() == "Marcus Lindqvist").GetProperty("userId").GetGuid();
        rfi = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/assign", new { rowVersion = Rv(rfi), assigneeId = reviewerId, dueAt = DateTime.UtcNow.AddDays(5) }));
        Assert.Equal("Assigned", rfi.GetProperty("state").GetString());

        await c.SwitchPersonaAsync("reviewer");
        rfi = await c.GetAsync<JsonElement>($"/api/rfis/{Id(rfi)}");
        Assert.Contains("Answer", rfi.GetProperty("availableActions").EnumerateArray().Select(a => a.GetString()));
        rfi = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/answer", new { rowVersion = Rv(rfi), answer = "Use 750 Pa for the RTU-2 trunk; 500 Pa elsewhere." }));
        Assert.Equal("Answered", rfi.GetProperty("state").GetString());

        await c.SwitchPersonaAsync("manager");
        rfi = await c.GetAsync<JsonElement>($"/api/rfis/{Id(rfi)}");
        rfi = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/approve-answer", new { rowVersion = Rv(rfi) }));
        rfi = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/close", new { rowVersion = Rv(rfi) }));
        Assert.Equal("Closed", rfi.GetProperty("state").GetString());

        var actions = rfi.GetProperty("timeline").EnumerateArray().Select(e => e.GetProperty("action").GetString()).ToList();
        Assert.Equal(["rfi.created", "rfi.submitted", "rfi.assigned", "rfi.answered", "rfi.answer-approved", "rfi.closed"], actions);
        var audit = await c.GetAsync<JsonElement>($"/api/projects/{projectId}/audit?resource=Rfi&pageSize=100");
        Assert.Contains(audit.GetProperty("items").EnumerateArray(), e => e.GetProperty("reference").GetString() == "RFI-010" && e.GetProperty("action").GetString() == "rfi.closed");
    }

    // ---------- Cross-tenant / cross-project isolation ----------

    [Fact]
    public async Task Other_tenants_get_404_for_rfis_submittals_comments_audit_and_queue()
    {
        var owner = Factory.CreateApiClient();
        await owner.StartDemoAsync();
        var rfi = await FindRfiAsync(owner, "MCC", "RFI-004");
        var sub = await FindSubmittalAsync(owner, "MCC", "SUB-003");
        var projectId = rfi.GetProperty("projectId").GetGuid();

        var intruder = Factory.CreateApiClient();
        await intruder.StartDemoAsync();
        await intruder.SwitchPersonaAsync("manager");
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/rfis/{Id(rfi)}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/close", new { rowVersion = Rv(rfi) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/submittals/{Id(sub)}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/finalize", new { rowVersion = Rv(sub) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/rfis/{Id(rfi)}/comments")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/comments", new { body = "hi" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/projects/{projectId}/audit")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/projects/{projectId}/review-queue")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/projects/{projectId}/insights")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/projects/{projectId}/rfis")).StatusCode);
    }

    [Fact]
    public async Task Project_non_member_gets_404_for_another_projects_rfi()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var westparkRfi = await FindRfiAsync(c, "WOR", "RFI-001");
        await c.SwitchPersonaAsync("reviewer"); // Midtown-only reviewer
        Assert.Equal(HttpStatusCode.NotFound, (await c.Http.GetAsync($"/api/rfis/{Id(westparkRfi)}")).StatusCode);
    }

    [Fact]
    public async Task Drafts_are_invisible_to_other_project_members()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync(); // requester owns the seeded draft RFI-007
        var draft = await FindRfiAsync(c, "MCC", "RFI-007");
        await c.SwitchPersonaAsync("manager");
        Assert.Equal(HttpStatusCode.NotFound, (await c.Http.GetAsync($"/api/rfis/{Id(draft)}")).StatusCode);
    }

    // ---------- Wrong role → 403 ----------

    [Fact]
    public async Task Wrong_role_returns_403_and_changes_nothing()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync(); // requester
        var answered = await FindRfiAsync(c, "MCC", "RFI-003");
        var response = await c.Http.PostAsJsonAsync($"/api/rfis/{Id(answered)}/approve-answer", new { rowVersion = Rv(answered) });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var sub = await FindSubmittalAsync(c, "MCC", "SUB-003");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/decisions", new { rowVersion = Rv(sub), decision = "Approved" })).StatusCode);

        await c.SwitchPersonaAsync("reviewer2"); // a reviewer, but not the one assigned to SUB-003
        sub = await FindSubmittalAsync(c, "MCC", "SUB-003");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/decisions", new { rowVersion = Rv(sub), decision = "Approved" })).StatusCode);
        var unchanged = await Factory.WithDbAsync(db => db.ReviewDecisions.CountAsync(d => d.SubmittalId == Id(sub)));
        Assert.Equal(0, unchanged);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await c.Http.PostAsJsonAsync($"/api/projects/{sub.GetProperty("projectId").GetGuid()}/submittals", new
            {
                title = "Valid submittal title",
                documentId = sub.GetProperty("documentId").GetGuid(),
                reviewerId = Guid.NewGuid(),
                dueAt = DateTime.UtcNow.AddDays(3),
            })).StatusCode);
    }

    // ---------- Duplicate approval / decision → 409 with no DB change ----------

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass4_Duplicate_rfi_approval_returns_409_and_changes_nothing()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("manager");
        var rfi = await FindRfiAsync(c, "MCC", "RFI-003");
        var approved = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/approve-answer", new { rowVersion = Rv(rfi) }));

        var snapshot = await SnapshotAsync(Id(rfi));
        var second = await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/approve-answer", new { rowVersion = Rv(approved) });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(Id(rfi)));
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass4_Duplicate_review_decision_returns_409_and_changes_nothing()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("reviewer");
        var sub = await FindSubmittalAsync(c, "MCC", "SUB-003");
        var decided = await Ok(await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/decisions",
            new { rowVersion = Rv(sub), decision = "ApprovedWithComments", comments = "Confirm curb height with structural." }));
        Assert.Equal("ApprovedWithComments", decided.GetProperty("status").GetString());
        Assert.Equal("ApprovedWithComments", decided.GetProperty("revisionApprovalStatus").GetString());

        var before = await Factory.WithDbAsync(async db => (await db.ReviewDecisions.CountAsync(d => d.SubmittalId == Id(sub)), await db.AuditEvents.CountAsync(a => a.ResourceId == Id(sub))));
        var again = await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/decisions", new { rowVersion = Rv(decided), decision = "Approved" });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        var after = await Factory.WithDbAsync(async db => (await db.ReviewDecisions.CountAsync(d => d.SubmittalId == Id(sub)), await db.AuditEvents.CountAsync(a => a.ResourceId == Id(sub))));
        Assert.Equal(before, after);
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass4_Invalid_rfi_and_submittal_transitions_are_rejected_with_409()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("manager");
        var assigned = await FindRfiAsync(c, "MCC", "RFI-004");
        Assert.Equal(HttpStatusCode.Conflict, (await c.Http.PostAsJsonAsync($"/api/rfis/{Id(assigned)}/close", new { rowVersion = Rv(assigned) })).StatusCode);
        var finalSub = await FindSubmittalAsync(c, "MCC", "SUB-001");
        Assert.Equal(HttpStatusCode.Conflict, (await c.Http.PostAsJsonAsync($"/api/submittals/{Id(finalSub)}/finalize", new { rowVersion = Rv(finalSub) })).StatusCode);
        var answered = await FindRfiAsync(c, "MCC", "RFI-003");
        Assert.Equal(HttpStatusCode.Conflict, (await c.Http.PostAsJsonAsync($"/api/rfis/{Id(answered)}/close", new { rowVersion = Rv(answered) })).StatusCode);
    }

    // ---------- Concurrency ----------

    [Fact]
    public async Task Stale_rowversion_returns_409()
    {
        var pm = Factory.CreateApiClient();
        await pm.StartDemoAsync();
        await pm.SwitchPersonaAsync("manager");
        var rfi = await FindRfiAsync(pm, "MCC", "RFI-006"); // Submitted
        var staleVersion = Rv(rfi);
        var reviewerId = (await pm.GetAsync<JsonElement>($"/api/projects/{rfi.GetProperty("projectId").GetGuid()}/members")).EnumerateArray()
            .First(m => m.GetProperty("role").GetString() == "Reviewer").GetProperty("userId").GetGuid();
        await Ok(await pm.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/assign", new { rowVersion = staleVersion, assigneeId = reviewerId, dueAt = DateTime.UtcNow.AddDays(4) }));

        var second = await pm.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/assign", new { rowVersion = staleVersion, assigneeId = reviewerId, dueAt = DateTime.UtcNow.AddDays(9) });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var due = await Factory.WithDbAsync(db => db.Rfis.Where(r => r.Id == Id(rfi)).Select(r => r.DueAt).SingleAsync());
        Assert.True(due < DateTime.UtcNow.AddDays(5));
    }

    [Fact]
    public async Task Concurrent_approvals_produce_exactly_one_approval()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("manager");
        var rfi = await FindRfiAsync(c, "MCC", "RFI-003");
        var body = new { rowVersion = Rv(rfi) };
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/approve-answer", body)));
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.All(results.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        var approvals = await Factory.WithDbAsync(db => db.AuditEvents.CountAsync(a => a.ResourceId == Id(rfi) && a.Action == "rfi.answer-approved"));
        Assert.Equal(1, approvals);
    }

    // ---------- Transactions ----------

    [Fact]
    public async Task Failed_transaction_leaves_no_partial_rows_audit_events_or_files()
    {
        var interceptor = new FailOnAuditActionInterceptor("revision.superseded");
        await using var baseFactory = new DocRoofFactory(app.ConnectionString);
        await using var faulty = baseFactory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IInterceptor>(interceptor)));
        var c = new ApiClient(faulty.CreateClient(new() { HandleCookies = true }));
        var session = await c.StartDemoAsync();
        var tenantId = session.GetProperty("tenantId").GetGuid();
        await c.SwitchPersonaAsync("controller");
        var doc = await c.FindDocumentAsync("MCC", "MCC-S-201");
        var docId = doc.GetProperty("id").GetGuid();
        var before = await Factory.WithDbAsync(async db => (
            await db.DocumentRevisions.CountAsync(r => r.DocumentId == docId),
            await db.AuditEvents.CountAsync(a => a.TenantId == tenantId),
            await db.Documents.Where(d => d.Id == docId).Select(d => d.CurrentRevisionId).SingleAsync()));
        var storage = Directory.GetFiles(Path.Combine(baseFactory.StoragePath, "t", tenantId.ToString("N"))).Length;

        interceptor.Armed = true; // seeding the demo also writes revision audit events, so arm only now
        var pdf = DocRoof.Infrastructure.Files.SyntheticPdf.Build(new("X", "X", "General", "R1", "2026-01-01", "X", [new("H", ["x"])]));
        var response = await c.UploadRevisionAsync(docId, "plan-r1.pdf", pdf);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

        var after = await Factory.WithDbAsync(async db => (
            await db.DocumentRevisions.CountAsync(r => r.DocumentId == docId),
            await db.AuditEvents.CountAsync(a => a.TenantId == tenantId),
            await db.Documents.Where(d => d.Id == docId).Select(d => d.CurrentRevisionId).SingleAsync()));
        Assert.Equal(before, after);
        Assert.Equal(storage, Directory.GetFiles(Path.Combine(baseFactory.StoragePath, "t", tenantId.ToString("N"))).Length);
    }

    // ---------- Citations ----------

    [Fact]
    public async Task Citation_page_out_of_range_or_foreign_revision_is_rejected()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var hvac = await c.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var projectId = hvac.GetProperty("projectId").GetGuid();
        var rev = hvac.GetProperty("currentRevisionId").GetGuid(); // 4 pages

        var tooFar = await c.Http.PostAsJsonAsync($"/api/projects/{projectId}/rfis", new { subject = "Page check", question = "Out of range page citation", sourceRevisionId = rev, sourcePage = 5 });
        Assert.Equal(HttpStatusCode.BadRequest, tooFar.StatusCode);
        Assert.Contains("outside", await tooFar.Content.ReadAsStringAsync());

        var westpark = await c.FindDocumentAsync("WOR", "WOR-S-301");
        var foreign = await c.Http.PostAsJsonAsync($"/api/projects/{projectId}/rfis", new
        {
            subject = "Foreign revision",
            question = "Citing another project's revision",
            sourceRevisionId = westpark.GetProperty("currentRevisionId").GetGuid(),
            sourcePage = 1,
        });
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        Assert.Equal(9, await Factory.WithDbAsync(db => db.Rfis.CountAsync(r => r.ProjectId == projectId)));
    }

    [Fact]
    public async Task Citations_stay_pinned_and_flag_newer_revisions()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var rfi = await FindRfiAsync(c, "MCC", "RFI-004"); // cites HVAC R1 (current)
        Assert.False(rfi.GetProperty("citation").GetProperty("newerRevisionExists").GetBoolean());
        var pinned = rfi.GetProperty("citation").GetProperty("revisionId").GetGuid();

        await c.SwitchPersonaAsync("controller");
        var hvac = await c.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var pdf = DocRoof.Infrastructure.Files.SyntheticPdf.Build(new("X", "X", "General", "R2", "2026-01-01", "X", [new("H", ["x"])]));
        Assert.Equal(HttpStatusCode.Created, (await c.UploadRevisionAsync(hvac.GetProperty("id").GetGuid(), "r2.pdf", pdf)).StatusCode);

        rfi = await c.GetAsync<JsonElement>($"/api/rfis/{Id(rfi)}");
        Assert.Equal(pinned, rfi.GetProperty("citation").GetProperty("revisionId").GetGuid());
        Assert.Equal("R1", rfi.GetProperty("citation").GetProperty("versionLabel").GetString());
        Assert.True(rfi.GetProperty("citation").GetProperty("newerRevisionExists").GetBoolean());
        Assert.Equal("R2", rfi.GetProperty("citation").GetProperty("currentVersionLabel").GetString());
    }

    // ---------- Submittal cycle ----------

    [Fact]
    public async Task Revise_and_resubmit_requires_a_newer_revision_and_starts_a_new_cycle()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var sub = await FindSubmittalAsync(c, "WOR", "SUB-002"); // ReviseAndResubmit on WOR-M-23 09 23 R0
        Assert.DoesNotContain("Resubmit", sub.GetProperty("availableActions").EnumerateArray().Select(a => a.GetString()));
        var sameRevision = await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/resubmit", new { rowVersion = Rv(sub), revisionId = sub.GetProperty("revisionId").GetGuid() });
        Assert.Equal(HttpStatusCode.Conflict, sameRevision.StatusCode);

        var pdf = DocRoof.Infrastructure.Files.SyntheticPdf.Build(new("X", "X", "General", "R1", "2026-01-01", "X", [new("H", ["points list v2"])]));
        var upload = await Ok(await c.UploadRevisionAsync(sub.GetProperty("documentId").GetGuid(), "ddc-r1.pdf", pdf));
        sub = await c.GetAsync<JsonElement>($"/api/submittals/{Id(sub)}");
        sub = await Ok(await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/resubmit", new { rowVersion = Rv(sub), revisionId = Id(upload) }));
        Assert.Equal("Submitted", sub.GetProperty("status").GetString());
        Assert.Equal(2, sub.GetProperty("cycle").GetInt32());
        Assert.Equal("Pending", sub.GetProperty("revisionApprovalStatus").GetString());

        await c.SwitchPersonaAsync("reviewer2");
        sub = await c.GetAsync<JsonElement>($"/api/submittals/{Id(sub)}");
        sub = await Ok(await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/start-review", new { rowVersion = Rv(sub) }));
        var missingComments = await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/decisions", new { rowVersion = Rv(sub), decision = "ApprovedWithComments" });
        Assert.Equal(HttpStatusCode.BadRequest, missingComments.StatusCode);
        sub = await Ok(await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/decisions", new { rowVersion = Rv(sub), decision = "Approved" }));
        Assert.Equal(2, sub.GetProperty("decisions").GetArrayLength());

        await c.SwitchPersonaAsync("manager");
        sub = await c.GetAsync<JsonElement>($"/api/submittals/{Id(sub)}");
        sub = await Ok(await c.Http.PostAsJsonAsync($"/api/submittals/{Id(sub)}/finalize", new { rowVersion = Rv(sub) }));
        Assert.Equal("Final", sub.GetProperty("status").GetString());
    }

    // ---------- Review queue, reminders, notifications, insights, comments ----------

    [Fact]
    public async Task Review_queue_view_flags_the_three_seeded_overdue_items()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var mcc = await c.ProjectIdAsync("MCC");
        var wor = await c.ProjectIdAsync("WOR");
        var overdue = (await c.GetAsync<JsonElement>($"/api/projects/{mcc}/review-queue?overdueOnly=true")).EnumerateArray()
            .Concat((await c.GetAsync<JsonElement>($"/api/projects/{wor}/review-queue?overdueOnly=true")).EnumerateArray())
            .Select(i => i.GetProperty("reference").GetString()).OrderBy(x => x).ToList();
        Assert.Equal(["RFI-001", "RFI-004", "SUB-003"], overdue);
    }

    [Fact]
    public async Task Overdue_reminders_are_idempotent_per_item_recipient_and_day()
    {
        var c = Factory.CreateApiClient();
        var tenantId = (await c.StartDemoAsync()).GetProperty("tenantId").GetGuid();
        var reminders = Factory.Services.GetRequiredService<OverdueReminderService>();
        await reminders.RunOnceAsync(CancellationToken.None);
        var first = await Factory.WithDbAsync(db => db.Notifications.CountAsync(n => n.Kind == NotificationKind.Overdue && db.Users.Any(u => u.Id == n.RecipientId && u.TenantId == tenantId)));
        await reminders.RunOnceAsync(CancellationToken.None);
        await reminders.RunWithRetriesAsync(CancellationToken.None);
        var second = await Factory.WithDbAsync(db => db.Notifications.CountAsync(n => n.Kind == NotificationKind.Overdue && db.Users.Any(u => u.Id == n.RecipientId && u.TenantId == tenantId)));
        Assert.Equal(3, first);
        Assert.Equal(first, second);

        await c.SwitchPersonaAsync("reviewer");
        var feed = await c.GetAsync<JsonElement>("/api/notifications");
        var overdue = feed.GetProperty("items").EnumerateArray().Where(n => n.GetProperty("kind").GetString() == "Overdue").ToList();
        Assert.Equal(2, overdue.Count); // RFI-004 and SUB-003 are assigned to the mechanical reviewer
        var unread = feed.GetProperty("unreadCount").GetInt32();
        Assert.Equal(HttpStatusCode.NoContent, (await c.Http.PostAsync($"/api/notifications/{overdue[0].GetProperty("id").GetGuid()}/read", null)).StatusCode);
        Assert.Equal(unread - 1, (await c.GetAsync<JsonElement>("/api/notifications")).GetProperty("unreadCount").GetInt32());
        await c.Http.PostAsync("/api/notifications/read-all", null);
        Assert.Equal(0, (await c.GetAsync<JsonElement>("/api/notifications")).GetProperty("unreadCount").GetInt32());

        // Another user's notification cannot be marked read.
        await c.SwitchPersonaAsync("manager");
        Assert.Equal(HttpStatusCode.NotFound, (await c.Http.PostAsync($"/api/notifications/{overdue[1].GetProperty("id").GetGuid()}/read", null)).StatusCode);
    }

    [Fact]
    public async Task Insights_are_computed_from_live_data()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var mcc = await c.ProjectIdAsync("MCC");
        var insights = await c.GetAsync<JsonElement>($"/api/projects/{mcc}/insights");
        Assert.Equal(2, insights.GetProperty("overdueItems").GetInt32());
        Assert.Equal(6, insights.GetProperty("openRfis").GetInt32());
        Assert.Equal(2, insights.GetProperty("closedRfiSample").GetInt32());
        Assert.True(insights.GetProperty("rfiTurnaroundMedianDays").GetDouble() > 0);
        Assert.Equal(InsightsService.Weeks, insights.GetProperty("rfiOpenVsClosed").GetArrayLength());
        Assert.Equal(9, insights.GetProperty("documentsByDiscipline").EnumerateArray().Sum(d => d.GetProperty("total").GetInt32()));

        // Closing an RFI changes the numbers (nothing is hard-coded).
        await c.SwitchPersonaAsync("manager");
        var rfi = await FindRfiAsync(c, "MCC", "RFI-003");
        rfi = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/approve-answer", new { rowVersion = Rv(rfi) }));
        await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/close", new { rowVersion = Rv(rfi) }));
        insights = await c.GetAsync<JsonElement>($"/api/projects/{mcc}/insights");
        Assert.Equal(5, insights.GetProperty("openRfis").GetInt32());
        Assert.Equal(3, insights.GetProperty("closedRfiSample").GetInt32());
    }

    [Fact]
    public async Task Comments_support_page_citations_and_validate_them()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var rfi = await FindRfiAsync(c, "MCC", "RFI-004");
        var revisionId = rfi.GetProperty("citation").GetProperty("revisionId").GetGuid();
        var created = await Ok(await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/comments", new { body = "See clause 3.2 on this page.", page = 3, revisionId }));
        Assert.Equal(3, created.GetProperty("page").GetInt32());
        Assert.Equal("R1", created.GetProperty("versionLabel").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.Http.PostAsJsonAsync($"/api/rfis/{Id(rfi)}/comments", new { body = "bad", page = 99, revisionId })).StatusCode);
        var list = await c.GetAsync<JsonElement>($"/api/rfis/{Id(rfi)}/comments");
        Assert.Contains(list.EnumerateArray(), x => x.GetProperty("body").GetString() == "See clause 3.2 on this page.");
    }

    private Task<string> SnapshotAsync(Guid rfiId) => Factory.WithDbAsync(async db =>
    {
        var rfi = await db.Rfis.AsNoTracking().SingleAsync(r => r.Id == rfiId);
        var responses = await db.RfiResponses.AsNoTracking().Where(r => r.RfiId == rfiId).OrderBy(r => r.Id).Select(r => $"{r.Id}:{r.Status}:{r.ApprovedAt}").ToListAsync();
        var audits = await db.AuditEvents.CountAsync(a => a.ResourceId == rfiId);
        var notes = await db.Notifications.CountAsync(n => n.ResourceId == rfiId);
        return $"{rfi.State}|{rfi.ApprovedResponseId}|{Convert.ToBase64String(rfi.RowVersion)}|{string.Join(",", responses)}|{audits}|{notes}";
    });
}

/// <summary>Test-only fault injection: throws while saving a specific audit action to prove transactions roll back.</summary>
internal sealed class FailOnAuditActionInterceptor(string action) : SaveChangesInterceptor
{
    public bool Armed { get; set; }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (Armed && eventData.Context!.ChangeTracker.Entries<AuditEvent>().Any(e => e.State == EntityState.Added && e.Entity.Action == action))
        {
            throw new InvalidOperationException("Injected failure for transaction test.");
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
