using System.ComponentModel.DataAnnotations;
using DocRoof.Api.Infrastructure;
using DocRoof.Domain;
using DocRoof.Infrastructure.Data;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Api.Controllers;

public sealed class LoginRequest
{
    [Required, EmailAddress, StringLength(256)]
    public string Email { get; set; } = "";

    [Required, StringLength(128)]
    public string Password { get; set; } = "";
}

public sealed record MeProjectDto(Guid Id, string Code, string Title, ProjectRole Role);

public sealed record MeDto(
    Guid UserId, string DisplayName, string? Email, string JobTitle, Guid TenantId, string TenantName, bool IsGuest,
    DateTime? GuestExpiresAt, string? Persona, IReadOnlyList<MeProjectDto> Projects);

[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    SignInManager<AppUser> signIn,
    UserManager<AppUser> users,
    DocRoofDbContext db,
    IAntiforgery antiforgery,
    ILogger<AuthController> logger) : ControllerBase
{
    public const string XsrfCookie = "XSRF-TOKEN";

    /// <summary>Issues an antiforgery token: an HttpOnly cookie plus a readable XSRF-TOKEN cookie echoed in the X-XSRF-TOKEN header.</summary>
    [HttpGet("antiforgery")]
    [AllowAnonymous]
    public IActionResult Antiforgery()
    {
        var tokens = antiforgery.GetAndStoreTokens(HttpContext);
        Response.Cookies.Append(XsrfCookie, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Strict,
            Secure = Request.IsHttps,
            Path = "/",
        });
        return Ok(new { token = tokens.RequestToken, headerName = tokens.HeaderName });
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken ct)
    {
        const string generic = "Invalid email or password.";
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || !await users.HasPasswordAsync(user))
        {
            // Equalize work with the real path so response timing does not reveal whether the account exists.
            users.PasswordHasher.VerifyHashedPassword(new AppUser(), DummyHash, request.Password);
            return Problem(statusCode: 401, title: "Sign-in failed", detail: generic, type: ApiExceptionHandler.TypeFor(401));
        }

        var result = await signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);
        if (!result.Succeeded)
        {
            logger.LogInformation("Failed sign-in (locked out: {LockedOut})", result.IsLockedOut);
            return Problem(statusCode: 401, title: "Sign-in failed", detail: generic, type: ApiExceptionHandler.TypeFor(401));
        }

        await signIn.SignInAsync(user, isPersistent: false);
        return Ok(new { ok = true });
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        await signIn.SignOutAsync();
        return NoContent();
    }

    [HttpGet("me")]
    [AllowAnonymous]
    public async Task<ActionResult<MeDto>> Me(CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated != true)
        {
            return Problem(statusCode: 401, title: "Not signed in", type: ApiExceptionHandler.TypeFor(401));
        }

        var user = await users.GetUserAsync(User);
        var tenant = user is null ? null : await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == user.TenantId, ct);
        if (user is null || tenant is null || (tenant.IsGuest && tenant.ExpiresAt <= DateTime.UtcNow))
        {
            await signIn.SignOutAsync();
            return Problem(statusCode: 401, title: "Session expired", type: ApiExceptionHandler.TypeFor(401));
        }

        var projects = await db.ProjectMemberships.AsNoTracking()
            .Where(m => m.UserId == user.Id && m.Project!.TenantId == user.TenantId)
            .OrderBy(m => m.Project!.Title)
            .Select(m => new MeProjectDto(m.ProjectId, m.Project!.Code, m.Project.Title, m.Role))
            .ToListAsync(ct);
        return new MeDto(user.Id, user.DisplayName, tenant.IsGuest ? null : user.Email, user.JobTitle, tenant.Id, tenant.Name,
            tenant.IsGuest, tenant.ExpiresAt, user.PersonaKey, projects);
    }

    private static readonly string DummyHash = new PasswordHasher<AppUser>().HashPassword(new AppUser(), Guid.NewGuid().ToString());
}
