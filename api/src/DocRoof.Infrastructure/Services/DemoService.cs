using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using DocRoof.Domain.Entities;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Seeding;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DocRoof.Infrastructure.Services;

public sealed class DemoOptions
{
    public const string Section = "Demo";

    public bool Enabled { get; set; } = true;
    public int TtlHours { get; set; } = 24;
    public int MaxWorkspacesPerIpPerHour { get; set; } = 5;
    public int MaxActiveWorkspaces { get; set; } = 200;
    public int CleanupIntervalMinutes { get; set; } = 15;

    /// <summary>Salt for hashing client addresses before they are stored. Not a secret, but set per deployment.</summary>
    public string IpHashSalt { get; set; } = "docroof-local-salt";

    public string StartPersona { get; set; } = "requester";

    public int MaxUploadsPerWorkspace { get; set; } = 30;

    public long MaxUploadBytesPerWorkspace { get; set; } = 60L * 1024 * 1024;
}

public sealed record PersonaDto(string Key, Guid UserId, string DisplayName, string JobTitle, string Roles, bool IsActive);

public sealed record DemoSessionDto(Guid TenantId, DateTime? ExpiresAt, string Persona, bool Reused);

/// <summary>Adds tenant, display-name, guest and persona claims to the auth cookie.</summary>
public sealed class AppClaimsPrincipalFactory(
    UserManager<AppUser> userManager,
    IOptions<IdentityOptions> options,
    DocRoofDbContext db) : UserClaimsPrincipalFactory<AppUser>(userManager, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        var isGuest = await db.Tenants.Where(t => t.Id == user.TenantId).Select(t => t.IsGuest).FirstOrDefaultAsync();
        identity.AddClaim(new Claim(DocRoofClaims.TenantId, user.TenantId.ToString()));
        identity.AddClaim(new Claim(DocRoofClaims.DisplayName, user.DisplayName));
        identity.AddClaim(new Claim(DocRoofClaims.IsGuest, isGuest ? "true" : "false"));
        if (user.PersonaKey is { } persona)
        {
            identity.AddClaim(new Claim(DocRoofClaims.Persona, persona));
        }

        return identity;
    }
}

/// <summary>
/// Guest workspaces: each visitor gets a private tenant built from the seed template, with a 24 h lifetime.
/// Persona switching only resolves users of the caller's own guest tenant.
/// </summary>
public sealed class DemoService(
    DocRoofDbContext db,
    TenantSeeder seeder,
    TenantPurger purger,
    SignInManager<AppUser> signIn,
    ICurrentUser current,
    IOptions<DemoOptions> options,
    TimeProvider clock,
    ILogger<DemoService> logger)
{
    private DemoOptions Opt => options.Value;

    public async Task<DemoSessionDto> StartAsync(string? clientIp, CancellationToken ct)
    {
        if (!Opt.Enabled)
        {
            throw new ServiceUnavailableException("The guest demo is disabled on this deployment.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        if (current.IsAuthenticated && current.IsGuest)
        {
            var existing = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == current.TenantId && t.IsGuest && t.ExpiresAt > now, ct);
            if (existing is not null)
            {
                return new DemoSessionDto(existing.Id, existing.ExpiresAt, CurrentPersona(), Reused: true);
            }
        }

        var ipHash = HashIp(clientIp);
        var since = now.AddHours(-1);
        if (await db.Tenants.CountAsync(t => t.IsGuest && t.CreatedByIpHash == ipHash && t.CreatedAt >= since, ct) >= Opt.MaxWorkspacesPerIpPerHour)
        {
            throw new TooManyRequestsException($"Demo limit reached: at most {Opt.MaxWorkspacesPerIpPerHour} workspaces per hour from one address.");
        }

        if (await db.Tenants.CountAsync(t => t.IsGuest && t.ExpiresAt > now, ct) >= Opt.MaxActiveWorkspaces)
        {
            throw new ServiceUnavailableException("The demo is at capacity right now. Please try again later.");
        }

        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = "Guest workspace",
            IsGuest = true,
            CreatedAt = now,
            ExpiresAt = now.AddHours(Opt.TtlHours),
            CreatedByIpHash = ipHash,
        };
        await seeder.SeedAsync(tenant, Prefix(tenant.Id), password: null, isNewTenant: true, ct);
        await SignInPersonaAsync(tenant.Id, Opt.StartPersona, ct);
        logger.LogInformation("Guest workspace {TenantId} created", tenant.Id);
        return new DemoSessionDto(tenant.Id, tenant.ExpiresAt, Opt.StartPersona, Reused: false);
    }

    public async Task<DemoSessionDto> ResetAsync(CancellationToken ct)
    {
        var tenant = await RequireGuestTenantAsync(ct);
        var persona = CurrentPersona();
        await purger.PurgeAsync(tenant.Id, deleteTenantRow: false, ct);
        await seeder.SeedAsync(tenant, Prefix(tenant.Id) + "r" + clock.GetUtcNow().ToUnixTimeSeconds().ToString("x"), password: null, isNewTenant: false, ct);
        await SignInPersonaAsync(tenant.Id, persona, ct);
        logger.LogInformation("Guest workspace {TenantId} reset", tenant.Id);
        return new DemoSessionDto(tenant.Id, tenant.ExpiresAt, persona, Reused: false);
    }

    public async Task<IReadOnlyList<PersonaDto>> PersonasAsync(CancellationToken ct)
    {
        var tenant = await RequireGuestTenantAsync(ct);
        var me = current.UserId;
        var users = await db.Users.AsNoTracking().Where(u => u.TenantId == tenant.Id && u.PersonaKey != null).ToListAsync(ct);
        var roles = await db.ProjectMemberships.AsNoTracking()
            .Where(m => m.Project!.TenantId == tenant.Id)
            .Select(m => new { m.UserId, m.Role, m.Project!.Code })
            .ToListAsync(ct);
        var order = SeedLibrary.Personas.Select(p => p.Key).ToList();
        return users.OrderBy(u => order.IndexOf(u.PersonaKey!)).Select(u => new PersonaDto(
            u.PersonaKey!, u.Id, u.DisplayName, u.JobTitle,
            string.Join(", ", roles.Where(r => r.UserId == u.Id).Select(r => $"{r.Role} ({r.Code})")),
            u.Id == me)).ToList();
    }

    public async Task<DemoSessionDto> SwitchPersonaAsync(string personaKey, CancellationToken ct)
    {
        var tenant = await RequireGuestTenantAsync(ct);
        await SignInPersonaAsync(tenant.Id, personaKey, ct);
        return new DemoSessionDto(tenant.Id, tenant.ExpiresAt, personaKey, Reused: true);
    }

    private async Task<Tenant> RequireGuestTenantAsync(CancellationToken ct)
    {
        if (!current.IsAuthenticated || !current.IsGuest)
        {
            throw new ForbiddenException("Persona switching and reset are only available inside a guest demo workspace.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        return await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == current.TenantId && t.IsGuest && t.ExpiresAt > now, ct)
               ?? throw new NotFoundException("Guest workspace");
    }

    private async Task SignInPersonaAsync(Guid tenantId, string personaKey, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.TenantId == tenantId && u.PersonaKey == personaKey, ct)
                   ?? throw new NotFoundException("Persona");
        await signIn.SignInAsync(user, isPersistent: false);
    }

    private string CurrentPersona() =>
        signIn.Context.User.FindFirstValue(DocRoofClaims.Persona) ?? Opt.StartPersona;

    private static string Prefix(Guid tenantId) => "g" + tenantId.ToString("N")[..12];

    public string HashIp(string? ip) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Opt.IpHashSalt + "|" + (ip ?? "unknown"))));
}

/// <summary>Deletes expired guest tenants (rows and files) on a fixed interval.</summary>
public sealed class GuestCleanupService(IServiceScopeFactory scopes, IOptions<DemoOptions> options, TimeProvider clock, ILogger<GuestCleanupService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(1, options.Value.CleanupIntervalMinutes));
        using var timer = new PeriodicTimer(interval, clock);
        // The first run waits one interval so startup migrations always finish first.
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Guest cleanup run failed");
            }
        }
    }

    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DocRoofDbContext>();
        var purger = scope.ServiceProvider.GetRequiredService<TenantPurger>();
        var now = clock.GetUtcNow().UtcDateTime;
        var expired = await db.Tenants.Where(t => t.IsGuest && t.ExpiresAt <= now).Select(t => t.Id).Take(50).ToListAsync(ct);
        foreach (var id in expired)
        {
            await purger.PurgeAsync(id, deleteTenantRow: true, ct);
        }

        if (expired.Count > 0)
        {
            logger.LogInformation("Guest cleanup removed {Count} expired workspaces", expired.Count);
        }

        return expired.Count;
    }
}
