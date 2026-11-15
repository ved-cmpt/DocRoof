using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using DocRoof.Infrastructure.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.MsSql;

namespace DocRoof.IntegrationTests.Infrastructure;

/// <summary>
/// One SQL Server 2022 container per test run (Testcontainers). The API runs in-process via WebApplicationFactory and
/// applies the real EF Core migrations (including triggers and the review-queue view) on startup.
/// </summary>
public sealed class AppFixture : IAsyncLifetime
{
    private readonly MsSqlContainer _container = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-latest")
        .Build();

    public string ConnectionString { get; private set; } = "";

    public DocRoofFactory Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(_container.GetConnectionString())
        {
            InitialCatalog = "DocRoofTests",
        }.ConnectionString;
        Factory = new DocRoofFactory(ConnectionString);
        _ = Factory.Server; // start the host: migrations + sample seed run once here
    }

    public async Task DisposeAsync()
    {
        await Factory.DisposeAsync();
        await _container.DisposeAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class SqlCollection : ICollectionFixture<AppFixture>
{
    public const string Name = "sql";
}

public sealed class DocRoofFactory(string connectionString, IDictionary<string, string?>? overrides = null) : WebApplicationFactory<Program>
{
    public const string SamplePassword = "IntegrationTest-Password-1";
    public static readonly long MaxUploadBytes = 1024 * 1024;

    public string StoragePath { get; } = Path.Combine(Path.GetTempPath(), "docroof-tests", Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:DocRoof"] = connectionString,
            ["Database:MigrateOnStartup"] = "true",
            ["Database:SeedSampleTenant"] = "true",
            ["Database:SampleUserPassword"] = SamplePassword,
            ["Storage:Mode"] = "Local",
            ["Storage:LocalPath"] = StoragePath,
            ["Storage:MaxUploadBytes"] = MaxUploadBytes.ToString(),
            ["Cookies:AllowInsecure"] = "true",
            ["Demo:MaxWorkspacesPerIpPerHour"] = "1000",
            ["Demo:MaxActiveWorkspaces"] = "1000",
            ["Demo:CleanupIntervalMinutes"] = "600",
            ["RateLimits:AuthPerMinute"] = "1000",
            ["RateLimits:DemoPerHour"] = "1000",
            ["RateLimits:UploadPerFiveMinutes"] = "1000",
            ["RateLimits:ExtractionPerFiveMinutes"] = "1000",
            ["RateLimits:GlobalPerMinute"] = "100000",
        };
        foreach (var (k, v) in overrides ?? new Dictionary<string, string?>())
        {
            settings[k] = v;
        }

        foreach (var (k, v) in settings)
        {
            builder.UseSetting(k, v);
        }
    }

    public ApiClient CreateApiClient() =>
        new(CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false }));

    public async Task<T> WithDbAsync<T>(Func<DocRoofDbContext, Task<T>> work)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DocRoofDbContext>();
        return await work(db);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try
        {
            if (Directory.Exists(StoragePath))
            {
                Directory.Delete(StoragePath, recursive: true);
            }
        }
        catch (IOException)
        {
            // best effort
        }
    }
}

/// <summary>Cookie-aware client that keeps the antiforgery header in sync with the current identity.</summary>
public sealed class ApiClient(HttpClient http)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public HttpClient Http { get; } = http;

    public async Task RefreshAntiforgeryAsync()
    {
        var response = await Http.GetFromJsonAsync<JsonElement>("/api/auth/antiforgery");
        Http.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Http.DefaultRequestHeaders.Add("X-XSRF-TOKEN", response.GetProperty("token").GetString());
    }

    public async Task<JsonElement> StartDemoAsync()
    {
        await RefreshAntiforgeryAsync();
        var response = await Http.PostAsync("/api/demo/start", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await RefreshAntiforgeryAsync();
        return await response.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    public async Task SwitchPersonaAsync(string persona)
    {
        var response = await Http.PostAsJsonAsync("/api/demo/persona", new { persona });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await RefreshAntiforgeryAsync();
    }

    public async Task<HttpResponseMessage> LoginAsync(string email, string password)
    {
        await RefreshAntiforgeryAsync();
        var response = await Http.PostAsJsonAsync("/api/auth/login", new { email, password });
        await RefreshAntiforgeryAsync();
        return response;
    }

    public async Task<T> GetAsync<T>(string url)
    {
        var response = await Http.GetAsync(url);
        Assert.True(response.IsSuccessStatusCode, $"GET {url} returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>(Json))!;
    }

    public async Task<JsonElement> MeAsync() => await GetAsync<JsonElement>("/api/auth/me");

    public async Task<Guid> ProjectIdAsync(string code)
    {
        var me = await MeAsync();
        return me.GetProperty("projects").EnumerateArray().First(p => p.GetProperty("code").GetString() == code).GetProperty("id").GetGuid();
    }

    public async Task<JsonElement> FindDocumentAsync(string projectCode, string number)
    {
        var projectId = await ProjectIdAsync(projectCode);
        var page = await GetAsync<JsonElement>($"/api/projects/{projectId}/documents?search={Uri.EscapeDataString(number)}&pageSize=50");
        return page.GetProperty("items").EnumerateArray().First(d => d.GetProperty("documentNumber").GetString() == number);
    }

    public Task<HttpResponseMessage> UploadRevisionAsync(Guid documentId, string fileName, byte[] content, string? label = null)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf"); // client-claimed type is ignored by the server
        form.Add(file, "file", fileName);
        if (label is not null)
        {
            form.Add(new StringContent(label), "versionLabel");
        }

        return Http.PostAsync($"/api/documents/{documentId}/revisions", form);
    }
}
