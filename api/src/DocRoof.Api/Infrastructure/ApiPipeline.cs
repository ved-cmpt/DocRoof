using System.Globalization;
using System.Net;
using System.Threading.RateLimiting;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Api.Infrastructure;

/// <summary>Maps exceptions to RFC 7807 ProblemDetails. Unexpected errors never leak stack traces or SQL text.</summary>
public sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, title, detail, errors) = exception switch
        {
            AppException app => (app.StatusCode, app.Title, app.Message, app.Errors),
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict, "Conflict",
                "The record was changed by someone else. Reload and try again.", null),
            DbUpdateException { InnerException: SqlException { Number: 2601 or 2627 } } => (StatusCodes.Status409Conflict, "Conflict",
                "A record with the same unique value already exists.", null),
            ImmutableRecordException imm => (StatusCodes.Status409Conflict, "Conflict", imm.Message, null),
            BadHttpRequestException bad => (bad.StatusCode, "Bad request", "The request could not be read.", (IDictionary<string, string[]>?)null),
            OperationCanceledException when httpContext.RequestAborted.IsCancellationRequested => (499, "Client closed request", "", null),
            _ => (StatusCodes.Status500InternalServerError, "Server error", "An unexpected error occurred.", null),
        };

        if (status >= 500)
        {
            logger.LogError(exception, "Unhandled exception for {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        }
        else
        {
            logger.LogInformation("Request failed with {Status}: {Message}", status, exception.Message);
        }

        httpContext.Response.StatusCode = status;
        var pd = new ProblemDetails { Status = status, Title = title, Detail = detail, Type = TypeFor(status) };
        if (errors is not null)
        {
            pd.Extensions["errors"] = errors;
        }

        if (exception is TooManyRequestsException)
        {
            httpContext.Response.Headers.RetryAfter = "3600";
        }

        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = pd, Exception = exception });
    }

    public static string TypeFor(int status) => status switch
    {
        400 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.1",
        401 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.2",
        403 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.4",
        404 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.5",
        409 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.10",
        413 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.14",
        429 => "https://datatracker.ietf.org/doc/html/rfc6585#section-4",
        503 => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.6.4",
        _ => "https://datatracker.ietf.org/doc/html/rfc9110#section-15.6.1",
    };
}

/// <summary>Validates the antiforgery header on every unsafe API request (POST/PUT/PATCH/DELETE).</summary>
public sealed class ValidateAntiforgeryFilter(IAntiforgery antiforgery, ILogger<ValidateAntiforgeryFilter> logger) : IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) || HttpMethods.IsTrace(method))
        {
            return;
        }

        try
        {
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        }
        catch (AntiforgeryValidationException ex)
        {
            logger.LogInformation("Antiforgery validation failed: {Message}", ex.Message);
            context.Result = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Invalid antiforgery token",
                Detail = "Refresh the page and try again (missing or invalid X-XSRF-TOKEN header).",
                Type = ApiExceptionHandler.TypeFor(400),
            })
            { StatusCode = StatusCodes.Status400BadRequest };
        }
    }
}

public sealed class RateLimitOptions
{
    public const string Section = "RateLimits";

    public int AuthPerMinute { get; set; } = 10;
    public int DemoPerHour { get; set; } = 10;
    public int UploadPerFiveMinutes { get; set; } = 30;
    public int ExtractionPerFiveMinutes { get; set; } = 20;
    public int GlobalPerMinute { get; set; } = 600;
}

public static class RateLimitPolicies
{
    public const string Auth = "auth";
    public const string Demo = "demo";
    public const string Upload = "upload";
    public const string Extraction = "extraction";

    public static IServiceCollection AddDocRoofRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var o = config.GetSection(RateLimitOptions.Section).Get<RateLimitOptions>() ?? new RateLimitOptions();
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (ctx, ct) =>
            {
                if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                {
                    ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString(CultureInfo.InvariantCulture);
                }

                ctx.HttpContext.Response.ContentType = "application/problem+json";
                await ctx.HttpContext.Response.WriteAsJsonAsync(new ProblemDetails
                {
                    Status = 429,
                    Title = "Too many requests",
                    Detail = "Rate limit exceeded. Please wait and try again.",
                    Type = ApiExceptionHandler.TypeFor(429),
                }, ct);
            };

            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
                RateLimitPartition.GetFixedWindowLimiter(ClientKey(http), _ => Window(o.GlobalPerMinute, TimeSpan.FromMinutes(1))));
            options.AddPolicy(Auth, http => RateLimitPartition.GetFixedWindowLimiter(ClientKey(http), _ => Window(o.AuthPerMinute, TimeSpan.FromMinutes(1))));
            options.AddPolicy(Demo, http => RateLimitPartition.GetFixedWindowLimiter(ClientKey(http), _ => Window(o.DemoPerHour, TimeSpan.FromHours(1))));
            options.AddPolicy(Upload, http => RateLimitPartition.GetFixedWindowLimiter(UserKey(http), _ => Window(o.UploadPerFiveMinutes, TimeSpan.FromMinutes(5))));
            options.AddPolicy(Extraction, http => RateLimitPartition.GetFixedWindowLimiter(UserKey(http), _ => Window(o.ExtractionPerFiveMinutes, TimeSpan.FromMinutes(5))));
        });
        return services;
    }

    private static FixedWindowRateLimiterOptions Window(int permits, TimeSpan window) =>
        new() { PermitLimit = Math.Max(1, permits), Window = window, QueueLimit = 0, AutoReplenishment = true };

    public static string ClientKey(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? IPAddress.Loopback.ToString();

    private static string UserKey(HttpContext http) =>
        http.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? ClientKey(http);
}

/// <summary>Security headers for every response. File endpoints tighten CSP further with a sandbox.</summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public const string AppCsp =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
        "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    public const string FileCsp = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'";

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var h = context.Response.Headers;
            h.XContentTypeOptions = "nosniff";
            h["Referrer-Policy"] = "strict-origin-when-cross-origin";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
            h["Cross-Origin-Opener-Policy"] = "same-origin";
            h["Cross-Origin-Resource-Policy"] = "same-origin";
            if (!h.ContainsKey("Content-Security-Policy"))
            {
                h.ContentSecurityPolicy = AppCsp;
            }

            if (!h.ContainsKey("X-Frame-Options"))
            {
                h.XFrameOptions = "DENY";
            }

            if (context.Request.Path.StartsWithSegments("/api") && !h.ContainsKey("Cache-Control"))
            {
                h.CacheControl = "no-store";
            }

            return Task.CompletedTask;
        });
        return next(context);
    }
}
