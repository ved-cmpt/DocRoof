using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DocRoof.Infrastructure.Extraction;
using DocRoof.Infrastructure.Files;
using DocRoof.Infrastructure.Seeding;
using DocRoof.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.IntegrationTests;

[Collection(SqlCollection.Name)]
public class ExtractionTests(AppFixture app)
{
    private DocRoofFactory Factory => app.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>(ApiClient.Json);
    }

    private static Guid Current(JsonElement doc) => doc.GetProperty("currentRevisionId").GetGuid();

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass5_Extracted_facts_link_to_real_existing_pages_with_matching_snippets()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var hvac = await c.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var result = await Ok(await c.Http.PostAsync($"/api/document-revisions/{Current(hvac)}/extract-suggestions", null));
        Assert.Equal("Ready", result.GetProperty("status").GetString());
        Assert.Equal("Rules-based extraction", result.GetProperty("engineLabel").GetString());

        var pages = PdfInspector.ExtractPages(SeedLibrary.Documents.Single(d => d.Key == SeedLibrary.HvacSpecKey).Revisions[1].Content());
        var suggestions = result.GetProperty("suggestions").EnumerateArray().ToList();
        Assert.NotEmpty(suggestions);
        foreach (var s in suggestions)
        {
            var page = s.GetProperty("page").GetInt32();
            Assert.InRange(page, 1, pages.Count);
            var snippet = s.GetProperty("snippet").GetString()!.TrimEnd('…');
            var pageText = string.Join(' ', pages[page - 1].Text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            Assert.Contains(snippet, pageText);
            Assert.Equal("rules-v1", s.GetProperty("engine").GetString());
            Assert.False(string.IsNullOrWhiteSpace(s.GetProperty("rule").GetString()));
        }

        Assert.Contains(suggestions, s => s.GetProperty("field").GetString() == "DocumentNumber" && s.GetProperty("proposedValue").GetString() == "MCC-M-23 05 00"
                                          && s.GetProperty("confidence").GetString() == "High" && s.GetProperty("page").GetInt32() == 1);
        Assert.Contains(suggestions, s => s.GetProperty("field").GetString() == "SpecSection" && s.GetProperty("proposedValue").GetString() == "23 05 00");
        Assert.Contains(suggestions, s => s.GetProperty("field").GetString() == "Date" && s.GetProperty("proposedValue").GetString() == "2026-03-02");
        Assert.Contains(suggestions, s => s.GetProperty("field").GetString() == "Discipline" && s.GetProperty("proposedValue").GetString() == "Mechanical");

        // Idempotent: a second run creates nothing new.
        var again = await Ok(await c.Http.PostAsync($"/api/document-revisions/{Current(hvac)}/extract-suggestions", null));
        Assert.Equal(suggestions.Count, again.GetProperty("suggestions").GetArrayLength());
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass5_Image_only_pdf_reports_the_no_text_layer_limitation_and_creates_nothing()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var scan = await c.FindDocumentAsync("MCC", "MCC-A-101");
        var result = await Ok(await c.Http.PostAsync($"/api/document-revisions/{Current(scan)}/extract-suggestions", null));
        Assert.Equal("NoTextLayer", result.GetProperty("status").GetString());
        Assert.Equal(ExtractionService.NoTextLayerMessage, result.GetProperty("message").GetString());
        Assert.Equal(0, result.GetProperty("suggestions").GetArrayLength());
        Assert.Equal(0, await Factory.WithDbAsync(db => db.ExtractionSuggestions.CountAsync(s => s.RevisionId == Current(scan))));
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass6_Prompt_injection_text_in_an_upload_causes_no_privileged_operation()
    {
        var c = Factory.CreateApiClient();
        var tenantId = (await c.StartDemoAsync()).GetProperty("tenantId").GetGuid();
        await c.SwitchPersonaAsync("controller");
        var rtu = await c.FindDocumentAsync("MCC", "MCC-M-PD-01");
        var revisionId = Current(rtu);
        var pages = PdfInspector.ExtractPages(SeedLibrary.Documents.Single(d => d.Key == SeedLibrary.InjectionKey).Revisions[0].Content());
        Assert.Contains("Ignore all previous instructions", string.Join(' ', pages.Select(p => p.Text)));

        var before = await SnapshotAsync(tenantId);
        var result = await Ok(await c.Http.PostAsync($"/api/document-revisions/{revisionId}/extract-suggestions", null));
        var after = await SnapshotAsync(tenantId);

        // Nothing privileged changed: submittal statuses, RFI states, memberships/roles, approvals, users, audit history.
        Assert.Equal(before.Submittals, after.Submittals);
        Assert.Equal(before.Rfis, after.Rfis);
        Assert.Equal(before.Memberships, after.Memberships);
        Assert.Equal(before.Approvals, after.Approvals);
        Assert.Equal(before.Users, after.Users);
        Assert.Equal(before.AuditCount + 1, after.AuditCount);
        Assert.Equal("extraction.run", await Factory.WithDbAsync(db => db.AuditEvents.Where(a => a.TenantId == tenantId).OrderByDescending(a => a.Id).Select(a => a.Action).FirstAsync()));

        // The only new rows are pending suggestions for this revision, limited to the five metadata fields.
        var rows = await Factory.WithDbAsync(db => db.ExtractionSuggestions.Where(s => s.RevisionId == revisionId).ToListAsync());
        Assert.Equal(result.GetProperty("suggestions").GetArrayLength(), rows.Count);
        Assert.All(rows, r => Assert.Equal(DocRoof.Domain.SuggestionStatus.Pending, r.Status));
        Assert.DoesNotContain(rows, r => r.ProposedValue.Contains("Ignore", StringComparison.OrdinalIgnoreCase)
                                         || r.ProposedValue.Contains("Project Manager", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Accepting_a_suggestion_updates_document_metadata_through_the_audited_path()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var ducts = await c.FindDocumentAsync("MCC", "MCC-M-23 31 00");
        var result = await Ok(await c.Http.PostAsync($"/api/document-revisions/{Current(ducts)}/extract-suggestions", null));
        var spec = result.GetProperty("suggestions").EnumerateArray().First(s => s.GetProperty("field").GetString() == "SpecSection" && s.GetProperty("confidence").GetString() == "High");
        var date = result.GetProperty("suggestions").EnumerateArray().First(s => s.GetProperty("field").GetString() == "Date");

        var accepted = await Ok(await c.Http.PostAsJsonAsync($"/api/extraction-suggestions/{spec.GetProperty("id").GetGuid()}/accept", new { rowVersion = spec.GetProperty("rowVersion").GetString() }));
        Assert.Equal("Accepted", accepted.GetProperty("status").GetString());
        Assert.Equal("23 31 00", accepted.GetProperty("currentValue").GetString());

        var twice = await c.Http.PostAsJsonAsync($"/api/extraction-suggestions/{spec.GetProperty("id").GetGuid()}/accept", new { rowVersion = accepted.GetProperty("rowVersion").GetString() });
        Assert.Equal(HttpStatusCode.Conflict, twice.StatusCode);

        var rejected = await Ok(await c.Http.PostAsJsonAsync($"/api/extraction-suggestions/{date.GetProperty("id").GetGuid()}/reject", new { rowVersion = date.GetProperty("rowVersion").GetString() }));
        Assert.Equal("Rejected", rejected.GetProperty("status").GetString());

        var detail = await c.GetAsync<JsonElement>($"/api/documents/{ducts.GetProperty("id").GetGuid()}");
        Assert.Equal("23 31 00", detail.GetProperty("specSection").GetString());
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("issueDate").ValueKind);
        var history = await c.GetAsync<JsonElement>($"/api/documents/{ducts.GetProperty("id").GetGuid()}/history");
        Assert.Contains(history.GetProperty("events").EnumerateArray(), e => e.GetProperty("action").GetString() == "document.metadata-updated");
    }

    [Fact]
    public async Task Only_coordinators_run_or_decide_extraction_and_other_tenants_get_404()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync(); // requester
        var hvac = await c.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        Assert.Equal(HttpStatusCode.Forbidden, (await c.Http.PostAsync($"/api/document-revisions/{Current(hvac)}/extract-suggestions", null)).StatusCode);
        var view = await c.GetAsync<JsonElement>($"/api/document-revisions/{Current(hvac)}/extract-suggestions");
        Assert.False(view.GetProperty("canRun").GetBoolean());

        await c.SwitchPersonaAsync("manager");
        var result = await Ok(await c.Http.PostAsync($"/api/document-revisions/{Current(hvac)}/extract-suggestions", null));
        var first = result.GetProperty("suggestions")[0];

        var other = Factory.CreateApiClient();
        await other.StartDemoAsync();
        await other.SwitchPersonaAsync("manager");
        Assert.Equal(HttpStatusCode.NotFound, (await other.Http.GetAsync($"/api/document-revisions/{Current(hvac)}/extract-suggestions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.Http.PostAsJsonAsync($"/api/extraction-suggestions/{first.GetProperty("id").GetGuid()}/accept", new { rowVersion = first.GetProperty("rowVersion").GetString() })).StatusCode);
    }

    [Fact]
    public async Task Unreachable_language_model_provider_falls_back_to_rules()
    {
        await using var factory = new DocRoofFactory(app.ConnectionString, new Dictionary<string, string?>
        {
            ["Extraction:Provider"] = "http-json",
            ["Extraction:Endpoint"] = "http://127.0.0.1:9/extract",
            ["Extraction:ApiKey"] = "test-key-not-secret",
            ["Extraction:DailyQuotaPerTenant"] = "5",
            ["Extraction:AllowGuests"] = "true",
            ["Extraction:TimeoutSeconds"] = "3",
        });
        var c = factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var hvac = await c.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var result = await Ok(await c.Http.PostAsync($"/api/document-revisions/{Current(hvac)}/extract-suggestions", null));
        Assert.Contains("rules-based extraction was used", result.GetProperty("message").GetString());
        Assert.All(result.GetProperty("suggestions").EnumerateArray(), s => Assert.Equal("rules-v1", s.GetProperty("engine").GetString()));
    }

    private Task<(string Submittals, string Rfis, string Memberships, string Approvals, string Users, int AuditCount)> SnapshotAsync(Guid tenantId) =>
        Factory.WithDbAsync(async db =>
        {
            var submittals = string.Join(",", await db.Submittals.Where(s => s.Project!.TenantId == tenantId).OrderBy(s => s.Id).Select(s => s.Status + ":" + s.Cycle).ToListAsync());
            var rfis = string.Join(",", await db.Rfis.Where(r => r.Project!.TenantId == tenantId).OrderBy(r => r.Id).Select(r => r.State + ":" + r.ApprovedResponseId).ToListAsync());
            var members = string.Join(",", await db.ProjectMemberships.Where(m => m.Project!.TenantId == tenantId).OrderBy(m => m.Id).Select(m => m.UserId + ":" + m.Role).ToListAsync());
            var approvals = string.Join(",", await db.DocumentRevisions.Where(r => r.Document!.Project!.TenantId == tenantId).OrderBy(r => r.Id).Select(r => r.ApprovalStatus.ToString()).ToListAsync());
            var users = string.Join(",", await db.Users.Where(u => u.TenantId == tenantId).OrderBy(u => u.Id).Select(u => u.Id + ":" + u.SecurityStamp).ToListAsync());
            var audit = await db.AuditEvents.CountAsync(a => a.TenantId == tenantId);
            return (submittals, rfis, members, approvals, users, audit);
        });
}
