using System.ComponentModel.DataAnnotations;
using DocRoof.Api.Infrastructure;
using DocRoof.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace DocRoof.Api.Controllers;

public sealed class PersonaRequest
{
    [Required, StringLength(40), RegularExpression("^[a-z0-9]+$")]
    public string Persona { get; set; } = "";
}

[ApiController]
[Route("api/demo")]
public sealed class DemoController(DemoService demo) : ControllerBase
{
    /// <summary>Creates an isolated guest workspace from the seed template and signs the visitor in as a persona.</summary>
    [HttpPost("start")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Demo)]
    public Task<DemoSessionDto> Start(CancellationToken ct) =>
        demo.StartAsync(HttpContext.Connection.RemoteIpAddress?.ToString(), ct);

    /// <summary>Rebuilds only the caller's own guest tenant.</summary>
    [HttpPost("reset")]
    [EnableRateLimiting(RateLimitPolicies.Demo)]
    public Task<DemoSessionDto> Reset(CancellationToken ct) => demo.ResetAsync(ct);

    [HttpGet("personas")]
    public Task<IReadOnlyList<PersonaDto>> Personas(CancellationToken ct) => demo.PersonasAsync(ct);

    [HttpPost("persona")]
    public Task<DemoSessionDto> Persona(PersonaRequest request, CancellationToken ct) => demo.SwitchPersonaAsync(request.Persona, ct);
}
