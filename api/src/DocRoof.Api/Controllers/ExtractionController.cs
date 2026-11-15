using DocRoof.Api.Infrastructure;
using DocRoof.Infrastructure.Extraction;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace DocRoof.Api.Controllers;

[ApiController]
public sealed class ExtractionController(ExtractionService extraction) : ControllerBase
{
    /// <summary>Current extraction status and suggestions for a revision (any project member).</summary>
    [HttpGet("api/document-revisions/{id:guid}/extract-suggestions")]
    public Task<ExtractionResultDto> Get(Guid id, CancellationToken ct) => extraction.GetAsync(id, ct);

    /// <summary>Runs extraction once per revision (Document Controller / Project Manager). Only creates suggestions.</summary>
    [HttpPost("api/document-revisions/{id:guid}/extract-suggestions")]
    [EnableRateLimiting(RateLimitPolicies.Extraction)]
    public Task<ExtractionResultDto> Run(Guid id, CancellationToken ct) => extraction.RunAsync(id, ct);

    [HttpPost("api/extraction-suggestions/{id:guid}/accept")]
    public Task<SuggestionDto> Accept(Guid id, DecideSuggestionRequest request, CancellationToken ct) => extraction.AcceptAsync(id, request, ct);

    [HttpPost("api/extraction-suggestions/{id:guid}/reject")]
    public Task<SuggestionDto> Reject(Guid id, DecideSuggestionRequest request, CancellationToken ct) => extraction.RejectAsync(id, request, ct);
}
