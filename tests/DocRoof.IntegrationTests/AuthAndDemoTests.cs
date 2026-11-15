using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DocRoof.Infrastructure.Seeding;
using DocRoof.Infrastructure.Services;
using DocRoof.IntegrationTests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace DocRoof.IntegrationTests;

[Collection(SqlCollection.Name)]
public class AuthAndDemoTests(AppFixture app)
{
    private DocRoofFactory Factory => app.Factory;

    [Fact]
    public async Task Health_endpoints_report_healthy()
    {
        var client = Factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }

    [Fact]
    public async Task Sample_tenant_is_seeded_idempotently_with_both_projects()
    {
        using var scope = Factory.Services.CreateScope();
        var seeder = scope.ServiceProvider.GetRequiredService<TenantSeeder>();
        await seeder.EnsureSampleTenantAsync(DocRoofFactory.SamplePassword, CancellationToken.None); // second call: no-op

        var counts = await Factory.WithDbAsync(async db => new
        {
            Tenants = await db.Tenants.CountAsync(t => t.Id == TenantSeeder.SampleTenantId),
            Projects = await db.Projects.CountAsync(p => p.TenantId == TenantSeeder.SampleTenantId),
            Documents = await db.Documents.CountAsync(d => d.Project!.TenantId == TenantSeeder.SampleTenantId),
            Rfis = await db.Rfis.CountAsync(r => r.Project!.TenantId == TenantSeeder.SampleTenantId),
            Submittals = await db.Submittals.CountAsync(s => s.Project!.TenantId == TenantSeeder.SampleTenantId),
        });
        Assert.Equal(1, counts.Tenants);
        Assert.Equal(2, counts.Projects);
        Assert.Equal(15, counts.Documents);
        Assert.Equal(12, counts.Rfis);
        Assert.Equal(8, counts.Submittals);
    }

    [Fact]
    public async Task Login_succeeds_with_seeded_account_and_failures_do_not_reveal_account_existence()
    {
        var client = Factory.CreateApiClient();
        var bad = await client.LoginAsync("controller.sample@docroof.test", "wrong-password-123");
        var unknown = await client.LoginAsync("nobody@docroof.test", "wrong-password-123");
        Assert.Equal(HttpStatusCode.Unauthorized, bad.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        var badBody = await bad.Content.ReadFromJsonAsync<JsonElement>();
        var unknownBody = await unknown.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(badBody.GetProperty("detail").GetString(), unknownBody.GetProperty("detail").GetString());

        var ok = await client.LoginAsync("manager.sample@docroof.test", DocRoofFactory.SamplePassword);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var me = await client.MeAsync();
        Assert.Equal("Priya Raman", me.GetProperty("displayName").GetString());
        Assert.False(me.GetProperty("isGuest").GetBoolean());
    }

    [Fact]
    public async Task Unsafe_requests_without_antiforgery_token_are_rejected()
    {
        var client = Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email = "a@b.test", password = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("antiforgery", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Anonymous_api_access_returns_401_problem_details()
    {
        var response = await Factory.CreateClient().GetAsync("/api/projects");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Guest_demo_creates_isolated_tenant_and_persona_switch_stays_inside_it()
    {
        var a = Factory.CreateApiClient();
        var sessionA = await a.StartDemoAsync();
        var b = Factory.CreateApiClient();
        var sessionB = await b.StartDemoAsync();
        Assert.NotEqual(sessionA.GetProperty("tenantId").GetGuid(), sessionB.GetProperty("tenantId").GetGuid());

        var personas = await a.GetAsync<JsonElement>("/api/demo/personas");
        Assert.Equal(5, personas.GetArrayLength());

        await a.SwitchPersonaAsync("manager");
        var me = await a.MeAsync();
        Assert.Equal("Priya Raman", me.GetProperty("displayName").GetString());
        Assert.Equal(sessionA.GetProperty("tenantId").GetGuid(), me.GetProperty("tenantId").GetGuid());

        var unknown = await a.Http.PostAsJsonAsync("/api/demo/persona", new { persona = "admin" });
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

        // Starting again from an active guest session reuses the same workspace (no quota burn).
        var again = await a.Http.PostAsync("/api/demo/start", null);
        var againBody = await again.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(againBody.GetProperty("reused").GetBoolean());
    }

    [Fact]
    public async Task Non_guests_cannot_switch_persona()
    {
        var client = Factory.CreateApiClient();
        await client.LoginAsync("controller.sample@docroof.test", DocRoofFactory.SamplePassword);
        var response = await client.Http.PostAsJsonAsync("/api/demo/persona", new { persona = "manager" });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Reset_rebuilds_only_the_callers_workspace()
    {
        var a = Factory.CreateApiClient();
        var tenantA = (await a.StartDemoAsync()).GetProperty("tenantId").GetGuid();
        var b = Factory.CreateApiClient();
        var tenantB = (await b.StartDemoAsync()).GetProperty("tenantId").GetGuid();
        var bDocsBefore = await Factory.WithDbAsync(db => db.Documents.Where(d => d.Project!.TenantId == tenantB).Select(d => d.Id).ToListAsync());

        await a.SwitchPersonaAsync("controller");
        var doc = await a.FindDocumentAsync("MCC", "MCC-S-201");
        var pdf = DocRoof.Infrastructure.Files.SyntheticPdf.Build(new("X", "X", "General", "R1", "2026-01-01", "X", [new("H", ["x"])]));
        Assert.Equal(HttpStatusCode.Created, (await a.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "x.pdf", pdf)).StatusCode);

        var reset = await a.Http.PostAsync("/api/demo/reset", null);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        await a.RefreshAntiforgeryAsync();

        var revisionsA = await Factory.WithDbAsync(db => db.DocumentRevisions.CountAsync(r => r.Document!.Project!.TenantId == tenantA));
        Assert.Equal(SeedLibrary.Documents.Sum(d => d.Revisions.Count), revisionsA);
        var me = await a.MeAsync();
        Assert.Equal("controller", me.GetProperty("persona").GetString());
        var bDocsAfter = await Factory.WithDbAsync(db => db.Documents.Where(d => d.Project!.TenantId == tenantB).Select(d => d.Id).ToListAsync());
        Assert.Equal(bDocsBefore.OrderBy(x => x), bDocsAfter.OrderBy(x => x));
    }

    [Fact]
    public async Task Expired_guest_workspaces_are_purged_with_their_files()
    {
        var client = Factory.CreateApiClient();
        var tenantId = (await client.StartDemoAsync()).GetProperty("tenantId").GetGuid();
        var keyPrefix = Path.Combine(Factory.StoragePath, "t", tenantId.ToString("N"));
        Assert.True(Directory.Exists(keyPrefix));

        await Factory.WithDbAsync(db => db.Tenants.Where(t => t.Id == tenantId)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ExpiresAt, DateTime.UtcNow.AddMinutes(-1))));
        var cleanup = Factory.Services.GetRequiredService<GuestCleanupService>();
        Assert.True(await cleanup.RunOnceAsync(CancellationToken.None) >= 1);

        Assert.False(await Factory.WithDbAsync(db => db.Tenants.AnyAsync(t => t.Id == tenantId)));
        Assert.False(await Factory.WithDbAsync(db => db.Users.AnyAsync(u => u.TenantId == tenantId)));
        Assert.False(await Factory.WithDbAsync(db => db.AuditEvents.AnyAsync(a => a.TenantId == tenantId)));
        Assert.False(Directory.Exists(keyPrefix));

        // The visitor's old cookie no longer grants access.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.Http.GetAsync("/api/auth/me")).StatusCode);
    }
}
