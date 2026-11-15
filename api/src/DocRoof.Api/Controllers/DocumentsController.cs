using System.ComponentModel.DataAnnotations;
using DocRoof.Api.Infrastructure;
using DocRoof.Domain;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Files;
using DocRoof.Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace DocRoof.Api.Controllers;

[ApiController]
[Route("api/projects")]
public sealed class ProjectsController(ProjectService projects) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<ProjectSummaryDto>> List(CancellationToken ct) => projects.ListAsync(ct);

    [HttpPost]
    public async Task<ActionResult<ProjectDetailDto>> Create(CreateProjectRequest request, CancellationToken ct)
    {
        var created = await projects.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet("{id:guid}")]
    public Task<ProjectDetailDto> Get(Guid id, CancellationToken ct) => projects.GetAsync(id, ct);

    [HttpGet("{id:guid}/members")]
    public async Task<IReadOnlyList<MemberDto>> Members(Guid id, CancellationToken ct)
    {
        await projects.GetAsync(id, ct); // authorizes
        return await projects.MembersAsync(id, ct);
    }
}

public sealed class CreateDocumentForm
{
    [Required, StringLength(60, MinimumLength = 2)]
    public string DocumentNumber { get; set; } = "";

    [Required, StringLength(300, MinimumLength = 2)]
    public string Title { get; set; } = "";

    [Required]
    public Discipline? Discipline { get; set; }

    [Required]
    public DocumentCategory? Category { get; set; }

    [StringLength(20)]
    public string? VersionLabel { get; set; }

    [StringLength(1000)]
    public string? ChangeNote { get; set; }

    [Required]
    public IFormFile? File { get; set; }
}

public sealed class AddRevisionForm
{
    [StringLength(20)]
    public string? VersionLabel { get; set; }

    [StringLength(1000)]
    public string? ChangeNote { get; set; }

    [Required]
    public IFormFile? File { get; set; }
}

[ApiController]
public sealed class DocumentsController(DocumentService documents, IOptions<StorageOptions> storage) : ControllerBase
{
    private const long MultipartLimit = 64L * 1024 * 1024;

    [HttpGet("api/projects/{projectId:guid}/documents")]
    public Task<PagedResult<DocumentListItemDto>> List(Guid projectId, [FromQuery] DocumentQuery query, CancellationToken ct) =>
        documents.ListAsync(projectId, query, ct);

    [HttpPost("api/projects/{projectId:guid}/documents")]
    [EnableRateLimiting(RateLimitPolicies.Upload)]
    [RequestSizeLimit(MultipartLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = MultipartLimit)]
    public async Task<ActionResult<DocumentDetailDto>> Create(Guid projectId, [FromForm] CreateDocumentForm form, CancellationToken ct)
    {
        var file = await ReadAsync(form.File!, ct);
        var created = await documents.CreateAsync(projectId,
            new CreateDocumentCommand(form.DocumentNumber, form.Title, form.Discipline!.Value, form.Category!.Value, form.VersionLabel, form.ChangeNote, file), ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet("api/documents/{id:guid}")]
    public Task<DocumentDetailDto> Get(Guid id, CancellationToken ct) => documents.GetAsync(id, ct);

    [HttpGet("api/documents/{id:guid}/history")]
    public Task<DocumentHistoryDto> History(Guid id, CancellationToken ct) => documents.HistoryAsync(id, ct);

    [HttpGet("api/documents/{id:guid}/compare")]
    public Task<RevisionComparisonDto> Compare(Guid id, [FromQuery] Guid from, [FromQuery] Guid to, CancellationToken ct) =>
        documents.CompareAsync(id, from, to, ct);

    [HttpPost("api/documents/{id:guid}/revisions")]
    [EnableRateLimiting(RateLimitPolicies.Upload)]
    [RequestSizeLimit(MultipartLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = MultipartLimit)]
    public async Task<ActionResult<RevisionDto>> AddRevision(Guid id, [FromForm] AddRevisionForm form, CancellationToken ct)
    {
        var file = await ReadAsync(form.File!, ct);
        var revision = await documents.AddRevisionAsync(id, new AddRevisionCommand(form.VersionLabel, form.ChangeNote, file), ct);
        return StatusCode(StatusCodes.Status201Created, revision);
    }

    /// <summary>Authorized, streamed download with a sanitized attachment name.</summary>
    [HttpGet("api/document-revisions/{id:guid}/download")]
    public async Task<IActionResult> Download(Guid id, CancellationToken ct)
    {
        var f = await documents.OpenAsync(id, forPreview: false, ct);
        SetFileHeaders(f);
        return File(f.Content, f.DownloadOnly ? "application/octet-stream" : f.MimeType, f.FileName, enableRangeProcessing: true);
    }

    /// <summary>Inline content for the in-app viewer. Refused for PDFs flagged with active content.</summary>
    [HttpGet("api/document-revisions/{id:guid}/preview")]
    public async Task<IActionResult> Preview(Guid id, CancellationToken ct)
    {
        var f = await documents.OpenAsync(id, forPreview: true, ct);
        SetFileHeaders(f);
        var disposition = new ContentDispositionHeaderValue("inline");
        disposition.SetHttpFileName(f.FileName);
        Response.Headers.ContentDisposition = disposition.ToString();
        var mime = f.MimeType == "text/plain" ? "text/plain; charset=utf-8" : f.MimeType;
        return File(f.Content, mime, enableRangeProcessing: true);
    }

    private void SetFileHeaders(FileDownload f)
    {
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = SecurityHeadersMiddleware.FileCsp;
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ETag = $"\"{f.Sha256}\"";
        Response.Headers["X-Checksum-SHA256"] = f.Sha256;
    }

    private async Task<UploadedFile> ReadAsync(IFormFile file, CancellationToken ct)
    {
        var max = storage.Value.MaxUploadBytes;
        if (file.Length > max)
        {
            throw new PayloadTooLargeException($"The file exceeds the {max / (1024 * 1024)} MB limit.");
        }

        using var ms = new MemoryStream((int)Math.Min(file.Length, int.MaxValue));
        await file.CopyToAsync(ms, ct);
        return new UploadedFile(file.FileName, ms.ToArray());
    }
}
