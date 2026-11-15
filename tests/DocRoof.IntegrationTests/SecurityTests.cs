using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Seeding;
using DocRoof.IntegrationTests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DocRoof.IntegrationTests;

[Collection(SqlCollection.Name)]
public class SecurityTests(AppFixture app)
{
    private DocRoofFactory Factory => app.Factory;

    // ---------- Headers ----------

    [Theory]
    [InlineData("/health")]
    [InlineData("/api/auth/me")]
    [InlineData("/api/does-not-exist")]
    public async Task Responses_carry_security_headers(string path)
    {
        var response = await Factory.CreateClient().GetAsync(path);
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("default-src 'self'", csp);
        Assert.Contains("script-src 'self'", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.Contains("object-src 'none'", csp);
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("strict-origin-when-cross-origin", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Contains("camera=()", response.Headers.GetValues("Permissions-Policy").Single());
        Assert.Equal("same-origin", response.Headers.GetValues("Cross-Origin-Opener-Policy").Single());
    }

    [Fact]
    public async Task Production_sends_hsts_over_https_and_secure_cookies()
    {
        await using var prod = new DocRoofFactory(app.ConnectionString, new Dictionary<string, string?> { ["Cookies:AllowInsecure"] = "false" })
            .WithWebHostBuilder(b => b.UseEnvironment("Production"));
        var client = prod.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://docroof.test"), HandleCookies = false });
        var response = await client.GetAsync("/api/auth/antiforgery");
        var hsts = response.Headers.GetValues("Strict-Transport-Security").Single();
        Assert.Contains("max-age=31536000", hsts);
        Assert.Contains("includeSubDomains", hsts);
        var cookies = response.Headers.GetValues("Set-Cookie").ToList();
        Assert.Contains(cookies, c => c.StartsWith("docroof.af=", StringComparison.Ordinal) && c.Contains("secure", StringComparison.OrdinalIgnoreCase)
                                     && c.Contains("httponly", StringComparison.OrdinalIgnoreCase) && c.Contains("samesite=strict", StringComparison.OrdinalIgnoreCase));
    }

    // ---------- Antiforgery on every unsafe endpoint ----------

    [Fact]
    public async Task Every_unsafe_api_endpoint_requires_an_antiforgery_token()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        c.Http.DefaultRequestHeaders.Remove("X-XSRF-TOKEN"); // authenticated, but no token

        var sources = Factory.Services.GetRequiredService<IEnumerable<EndpointDataSource>>();
        var unsafeRoutes = sources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Select(e => (Pattern: e.RoutePattern.RawText ?? "", Methods: e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []))
            .Where(e => e.Pattern.StartsWith("api/", StringComparison.Ordinal) && e.Methods.Any(m => m is "POST" or "PUT" or "PATCH" or "DELETE"))
            .ToList();
        Assert.True(unsafeRoutes.Count >= 25, $"Expected the full API surface, found {unsafeRoutes.Count} unsafe routes.");

        foreach (var (pattern, methods) in unsafeRoutes)
        {
            var url = "/" + System.Text.RegularExpressions.Regex.Replace(pattern, @"\{resource[^}]*\}", "rfis");
            url = System.Text.RegularExpressions.Regex.Replace(url, @"\{[^}]+\}", Guid.NewGuid().ToString());
            foreach (var method in methods.Where(m => m is "POST" or "PUT" or "PATCH" or "DELETE"))
            {
                using var request = new HttpRequestMessage(new HttpMethod(method), url) { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
                var response = await c.Http.SendAsync(request);
                Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{method} {url} returned {(int)response.StatusCode}");
                Assert.Contains("antiforgery", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    // ---------- Rate limits, quotas, lockout ----------

    [Fact]
    public async Task Login_is_rate_limited_per_client()
    {
        await using var limited = new DocRoofFactory(app.ConnectionString, new Dictionary<string, string?> { ["RateLimits:AuthPerMinute"] = "3" });
        var c = limited.CreateApiClient();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
        {
            statuses.Add((await c.Http.PostAsJsonAsync("/api/auth/login", new { email = "nobody@docroof.test", password = "wrong-password" })).StatusCode);
        }

        await c.RefreshAntiforgeryAsync();
        var blocked = await c.Http.PostAsJsonAsync("/api/auth/login", new { email = "nobody@docroof.test", password = "wrong-password" });
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        Assert.True(blocked.Headers.Contains("Retry-After"));
        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
    }

    [Fact]
    public async Task Guest_workspaces_are_limited_per_address()
    {
        await using var limited = new DocRoofFactory(app.ConnectionString, new Dictionary<string, string?>
        {
            ["Demo:MaxWorkspacesPerIpPerHour"] = "2",
            ["Demo:IpHashSalt"] = "quota-test-" + Guid.NewGuid().ToString("N"),
        });
        for (var i = 0; i < 2; i++)
        {
            await limited.CreateApiClient().StartDemoAsync();
        }

        var third = limited.CreateApiClient();
        await third.RefreshAntiforgeryAsync();
        var response = await third.Http.PostAsync("/api/demo/start", null);
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Contains("Demo limit reached", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Guest_upload_quota_is_enforced()
    {
        await using var limited = new DocRoofFactory(app.ConnectionString, new Dictionary<string, string?> { ["Demo:MaxUploadsPerWorkspace"] = "1" });
        var c = limited.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var doc = await c.FindDocumentAsync("MCC", "MCC-S-201");
        var pdf = DocRoof.Infrastructure.Files.SyntheticPdf.Build(new("X", "X", "General", "R1", "2026-01-01", "X", [new("H", ["x"])]));
        Assert.Equal(HttpStatusCode.Created, (await c.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "a.pdf", pdf)).StatusCode);
        var second = await c.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "b.pdf", pdf);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        Assert.Contains("upload quota", await second.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Accounts_lock_after_repeated_failures_without_revealing_it()
    {
        const string email = "lockout.test@docroof.test";
        const string password = "Lockout-Test-Password-1";
        using (var scope = Factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            if (await users.FindByEmailAsync(email) is { } existing)
            {
                await users.DeleteAsync(existing);
            }

            var created = await users.CreateAsync(new AppUser
            {
                Id = Guid.NewGuid(),
                TenantId = TenantSeeder.SampleTenantId,
                UserName = email,
                Email = email,
                DisplayName = "Lockout Test",
                LockoutEnabled = true,
            }, password);
            Assert.True(created.Succeeded);
        }

        var c = Factory.CreateApiClient();
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await c.LoginAsync(email, "wrong-password-" + i)).StatusCode);
        }

        var locked = await c.LoginAsync(email, password);
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
        var body = await locked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid email or password.", body.GetProperty("detail").GetString());
    }

    // ---------- Active content and traversal ----------

    [Fact]
    public async Task Pdf_with_embedded_javascript_is_flagged_and_served_download_only()
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        await c.SwitchPersonaAsync("controller");
        var doc = await c.FindDocumentAsync("MCC", "MCC-S-201");
        var clean = DocRoof.Infrastructure.Files.SyntheticPdf.Build(new("X", "X", "General", "R1", "2026-01-01", "X", [new("H", ["x"])]));
        // Append an incremental-update object with an OpenAction script; PdfPig still parses the original document.
        var withScript = clean.Concat(Encoding.Latin1.GetBytes("\n99 0 obj\n<< /Type /Action /S /JavaScript /JS (app.alert('x')) >>\nendobj\n")).ToArray();
        var upload = await c.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "with-script.pdf", withScript);
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        var revision = await upload.Content.ReadFromJsonAsync<JsonElement>(ApiClient.Json);
        Assert.True(revision.GetProperty("hasActiveContent").GetBoolean());
        Assert.False(revision.GetProperty("previewSupported").GetBoolean());

        var id = revision.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Conflict, (await c.Http.GetAsync($"/api/document-revisions/{id}/preview")).StatusCode);
        var download = await c.Http.GetAsync($"/api/document-revisions/{id}/download");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("application/octet-stream", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
    }

    [Theory]
    [InlineData("/api/document-revisions/..%2F..%2Fappsettings.json/download")]
    [InlineData("/api/document-revisions/%2e%2e/download")]
    [InlineData("/api/documents/..%5C..%5Cweb.config")]
    public async Task Path_traversal_style_ids_never_reach_storage(string url)
    {
        var c = Factory.CreateApiClient();
        await c.StartDemoAsync();
        var response = await c.Http.GetAsync(url);
        Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest, $"{url} â†’ {(int)response.StatusCode}");
        Assert.DoesNotContain("ConnectionStrings", await response.Content.ReadAsStringAsync());
    }
}
