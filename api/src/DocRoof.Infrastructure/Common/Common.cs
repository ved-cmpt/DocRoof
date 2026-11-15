using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Infrastructure.Common;

/// <summary>Base type for errors that map to an RFC 7807 ProblemDetails response.</summary>
public abstract class AppException(string message, int statusCode, string title) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Title { get; } = title;
    public IDictionary<string, string[]>? Errors { get; init; }
}

/// <summary>404. Also used for cross-tenant and cross-project access so that existence is never leaked.</summary>
public sealed class NotFoundException(string resource = "Resource")
    : AppException($"{resource} was not found.", StatusCodes.Status404NotFound, "Not found");

public sealed class ForbiddenException(string message)
    : AppException(message, StatusCodes.Status403Forbidden, "Forbidden");

public sealed class ConflictException(string message)
    : AppException(message, StatusCodes.Status409Conflict, "Conflict");

public sealed class RequestValidationException : AppException
{
    public RequestValidationException(string field, string message)
        : base(message, StatusCodes.Status400BadRequest, "Validation failed") =>
        Errors = new Dictionary<string, string[]> { [field] = [message] };
}

public sealed class PayloadTooLargeException(string message)
    : AppException(message, StatusCodes.Status413PayloadTooLarge, "Payload too large");

public sealed class TooManyRequestsException(string message)
    : AppException(message, StatusCodes.Status429TooManyRequests, "Too many requests");

public sealed class ServiceUnavailableException(string message)
    : AppException(message, StatusCodes.Status503ServiceUnavailable, "Service unavailable");

public static class DocRoofClaims
{
    public const string TenantId = "docroof:tenant";
    public const string DisplayName = "docroof:name";
    public const string IsGuest = "docroof:guest";
    public const string Persona = "docroof:persona";
}

/// <summary>The authenticated caller, resolved from the auth cookie claims.</summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    Guid UserId { get; }
    Guid TenantId { get; }
    bool IsGuest { get; }
    string DisplayName { get; }
}

public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

    public Guid UserId => Guid.TryParse(Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
        ? id
        : throw new ForbiddenException("Not signed in.");

    public Guid TenantId => Guid.TryParse(Principal?.FindFirstValue(DocRoofClaims.TenantId), out var id)
        ? id
        : throw new ForbiddenException("Not signed in.");

    public bool IsGuest => Principal?.FindFirstValue(DocRoofClaims.IsGuest) == "true";

    public string DisplayName => Principal?.FindFirstValue(DocRoofClaims.DisplayName) ?? "";
}

/// <summary>Result of a successful object-level project authorization check.</summary>
public sealed record ProjectAccess(Guid ProjectId, Guid TenantId, Guid UserId, ProjectRole Role);

public interface IProjectAccessService
{
    /// <summary>
    /// Ensures the caller is a member of the project inside their own tenant. Non-members get 404 (existence is not
    /// leaked); members without one of <paramref name="allowedRoles"/> get 403.
    /// </summary>
    Task<ProjectAccess> RequireProjectAsync(Guid projectId, CancellationToken ct, params ProjectRole[] allowedRoles);

    Task<(Document Document, ProjectAccess Access)> RequireDocumentAsync(Guid documentId, CancellationToken ct, params ProjectRole[] allowedRoles);

    Task<(DocumentRevision Revision, ProjectAccess Access)> RequireRevisionAsync(Guid revisionId, CancellationToken ct, params ProjectRole[] allowedRoles);
}

public sealed class ProjectAccessService(DocRoofDbContext db, ICurrentUser user) : IProjectAccessService
{
    public async Task<ProjectAccess> RequireProjectAsync(Guid projectId, CancellationToken ct, params ProjectRole[] allowedRoles)
    {
        var userId = user.UserId;
        var tenantId = user.TenantId;
        var membership = await db.ProjectMemberships.AsNoTracking()
            .Where(m => m.ProjectId == projectId && m.UserId == userId && m.Project!.TenantId == tenantId)
            .Select(m => new { m.Role })
            .FirstOrDefaultAsync(ct);

        if (membership is null)
        {
            throw new NotFoundException("Project");
        }

        if (allowedRoles.Length > 0 && !allowedRoles.Contains(membership.Role))
        {
            throw new ForbiddenException($"Your project role ({membership.Role}) cannot perform this action.");
        }

        return new ProjectAccess(projectId, tenantId, userId, membership.Role);
    }

    public async Task<(Document Document, ProjectAccess Access)> RequireDocumentAsync(
        Guid documentId, CancellationToken ct, params ProjectRole[] allowedRoles)
    {
        var projectId = await db.Documents.AsNoTracking().Where(d => d.Id == documentId).Select(d => (Guid?)d.ProjectId)
            .FirstOrDefaultAsync(ct) ?? throw new NotFoundException("Document");
        var access = await RequireProjectOr404Async(projectId, "Document", ct, allowedRoles);
        var doc = await db.Documents.FirstAsync(d => d.Id == documentId, ct);
        return (doc, access);
    }

    public async Task<(DocumentRevision Revision, ProjectAccess Access)> RequireRevisionAsync(
        Guid revisionId, CancellationToken ct, params ProjectRole[] allowedRoles)
    {
        var projectId = await db.DocumentRevisions.AsNoTracking().Where(r => r.Id == revisionId)
            .Select(r => (Guid?)r.Document!.ProjectId).FirstOrDefaultAsync(ct) ?? throw new NotFoundException("Revision");
        var access = await RequireProjectOr404Async(projectId, "Revision", ct, allowedRoles);
        var revision = await db.DocumentRevisions.Include(r => r.Document).FirstAsync(r => r.Id == revisionId, ct);
        return (revision, access);
    }

    /// <summary>Same as <see cref="RequireProjectAsync"/> but reports the child resource as missing.</summary>
    internal async Task<ProjectAccess> RequireProjectOr404Async(Guid projectId, string resource, CancellationToken ct, ProjectRole[] roles)
    {
        try
        {
            return await RequireProjectAsync(projectId, ct, roles);
        }
        catch (NotFoundException)
        {
            throw new NotFoundException(resource);
        }
    }
}

/// <summary>Adds append-only audit rows to the current unit of work (saved in the same transaction).</summary>
public sealed class AuditWriter(DocRoofDbContext db, TimeProvider clock)
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public AuditEvent Add(Guid tenantId, Guid? projectId, Guid? actorId, ResourceType resource, Guid resourceId, string action,
        object? before = null, object? after = null, DateTime? at = null)
    {
        var evt = new AuditEvent
        {
            TenantId = tenantId,
            ProjectId = projectId,
            ActorId = actorId,
            Resource = resource,
            ResourceId = resourceId,
            Action = action,
            ChangeJson = JsonSerializer.Serialize(new { before, after }, JsonOptions),
            Timestamp = at ?? clock.GetUtcNow().UtcDateTime,
        };
        db.AuditEvents.Add(evt);
        return evt;
    }

    public AuditEvent Add(ProjectAccess access, ResourceType resource, Guid resourceId, string action, object? before = null, object? after = null) =>
        Add(access.TenantId, access.ProjectId, access.UserId, resource, resourceId, action, before, after);
}

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount)
{
    public int TotalPages => PageSize == 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}

public static class Paging
{
    public static (int Page, int PageSize) Normalize(int? page, int? pageSize, int max = 100) =>
        (Math.Max(1, page ?? 1), Math.Clamp(pageSize ?? 20, 1, max));
}
