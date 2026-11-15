using System.Diagnostics;
using System.Text.Json.Serialization;
using DocRoof.Api.Infrastructure;
using DocRoof.Infrastructure;
using DocRoof.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;

// Container HEALTHCHECK mode: the runtime image has no curl, so the app probes its own /health endpoint.
if (args.Contains("--healthcheck"))
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
    var port = Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS") ?? "8080";
    try
    {
        var ok = (await probe.GetAsync($"http://127.0.0.1:{port.Split(';')[0]}/health")).IsSuccessStatusCode;
        return ok ? 0 : 1;
    }
    catch (HttpRequestException)
    {
        return 1;
    }
}

var builder = WebApplication.CreateBuilder(args);

// ---------- Logging: structured JSON outside development ----------
if (!builder.Environment.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(o =>
    {
        o.IncludeScopes = true;
        o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
        o.UseUtcTimestamp = true;
    });
}

// ---------- Services ----------
// Cookies are Secure-only except in development or an explicitly plain-http local container.
var insecureCookies = builder.Environment.IsDevelopment() || builder.Configuration.GetValue<bool>("Cookies:AllowInsecure");
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddDocRoofRateLimits(builder.Configuration);
builder.Services.AddScoped<ValidateAntiforgeryFilter>();
builder.Services.AddControllers(o => o.Filters.AddService<ValidateAntiforgeryFilter>())
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Extensions["traceId"] = Activity.Current?.Id ?? ctx.HttpContext.TraceIdentifier;
    ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path;
});
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddOpenApi();

builder.Services.AddAntiforgery(o =>
{
    o.HeaderName = "X-XSRF-TOKEN";
    o.Cookie.Name = "docroof.af";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = insecureCookies ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
});

builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "docroof.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = insecureCookies ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = ctx => WriteStatus(ctx.HttpContext, 401, "Not signed in");
    o.Events.OnRedirectToAccessDenied = ctx => WriteStatus(ctx.HttpContext, 403, "Forbidden");
});
builder.Services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.FromMinutes(5));
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.AddHealthChecks()
    .AddDbContextCheck<DocRoofDbContext>("database", tags: ["ready"]);

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1;
    // Hosting platforms terminate TLS at their proxy; trust only when explicitly enabled.
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

// ---------- Pipeline ----------
if (app.Configuration.GetValue<bool>("ForwardedHeaders:Enabled"))
{
    app.UseForwardedHeaders();
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseMiddleware<SecurityHeadersMiddleware>();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var name = ctx.File.Name;
        ctx.Context.Response.Headers.CacheControl = name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            ? "no-cache"
            : "public, max-age=31536000, immutable";
    },
});

app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous().DisableRateLimiting();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") }).AllowAnonymous().DisableRateLimiting();
app.MapControllers();
app.MapFallback("/api/{**path}", (HttpContext ctx) =>
    Results.Problem(statusCode: 404, title: "Not found", detail: "No such API endpoint.", type: ApiExceptionHandler.TypeFor(404))).AllowAnonymous();
app.MapFallbackToFile("index.html").AllowAnonymous();

await app.RunAsync();
return 0;

static Task WriteStatus(HttpContext http, int status, string title)
{
    http.Response.StatusCode = status;
    return http.Response.WriteAsJsonAsync(
        new Microsoft.AspNetCore.Mvc.ProblemDetails { Status = status, Title = title, Type = ApiExceptionHandler.TypeFor(status) },
        options: null, contentType: "application/problem+json");
}

/// <summary>Exposed for WebApplicationFactory integration tests.</summary>
public partial class Program;
