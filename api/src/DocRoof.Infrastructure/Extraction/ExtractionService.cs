using System.Globalization;
using System.Text;
using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Files;
using DocRoof.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DocRoof.Infrastructure.Extraction;

public sealed record SuggestionDto(
    Guid Id, Guid RevisionId, ExtractionField Field, string ProposedValue, int Page, string Snippet, ConfidenceLabel Confidence,
    string Rule, string Engine, SuggestionStatus Status, UserRef? DecidedBy, DateTime? DecidedAt, string? CurrentValue, string RowVersion);

/// <summary>NotRun | Ready | NoTextLayer | Unsupported</summary>
public sealed record ExtractionResultDto(
    Guid RevisionId, string Status, string EngineLabel, string Message, bool CanRun, IReadOnlyList<SuggestionDto> Suggestions);

public sealed class DecideSuggestionRequest
{
    [System.ComponentModel.DataAnnotations.Required, System.ComponentModel.DataAnnotations.StringLength(64)]
    public string RowVersion { get; set; } = "";
}

/// <summary>
/// Orchestrates extraction. The engines only return proposals; this service can only insert
/// <see cref="ExtractionSuggestion"/> rows when running, and only a person accepting a suggestion changes document
/// metadata (through the audited path below). Document text never reaches any other code path.
/// </summary>
public sealed class ExtractionService(
    DocRoofDbContext db,
    IProjectAccessService access,
    IFileStorage storage,
    AuditWriter audit,
    UserDirectory directory,
    ICurrentUser current,
    IServiceProvider services,
    IOptions<ExtractionOptions> options,
    TimeProvider clock,
    ILogger<ExtractionService> logger)
{
    public const string NoTextLayerMessage = "No text layer detected — extraction unavailable (no OCR configured).";
    public static readonly ProjectRole[] RunRoles = [ProjectRole.DocumentController, ProjectRole.ProjectManager];

    public async Task<ExtractionResultDto> GetAsync(Guid revisionId, CancellationToken ct)
    {
        var (rev, acc) = await access.RequireRevisionAsync(revisionId, ct);
        return await ResultAsync(rev, acc, null, ct);
    }

    public async Task<ExtractionResultDto> RunAsync(Guid revisionId, CancellationToken ct)
    {
        var (rev, acc) = await access.RequireRevisionAsync(revisionId, ct, RunRoles);
        if (Unsupported(rev) || !rev.HasTextLayer)
        {
            return await ResultAsync(rev, acc, null, ct);
        }

        if (await db.ExtractionSuggestions.AnyAsync(s => s.RevisionId == rev.Id, ct))
        {
            return await ResultAsync(rev, acc, null, ct); // idempotent: one extraction per revision
        }

        var pages = await ReadPagesAsync(rev, ct);
        var engine = await ChooseEngineAsync(acc, ct);
        IReadOnlyList<ExtractedFact> facts;
        string? note = null;
        try
        {
            facts = await engine.ExtractAsync(pages, ct);
        }
        catch (Exception ex) when (engine is not RulesExtractionEngine && ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            logger.LogWarning(ex, "Language-model extraction failed; falling back to rules");
            engine = new RulesExtractionEngine();
            facts = await engine.ExtractAsync(pages, ct);
            note = "The optional language-model provider was unavailable, so rules-based extraction was used.";
        }

        var pageCount = rev.PageCount ?? pages.Count;
        var now = clock.GetUtcNow().UtcDateTime;
        await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            foreach (var f in facts.Where(f => f.Page >= 1 && f.Page <= pageCount))
            {
                db.ExtractionSuggestions.Add(new ExtractionSuggestion
                {
                    Id = Guid.NewGuid(),
                    RevisionId = rev.Id,
                    Field = f.Field,
                    ProposedValue = f.Value,
                    Page = f.Page,
                    Snippet = f.Snippet,
                    ConfidenceLabel = f.Confidence,
                    Rule = f.Rule.Length > 100 ? f.Rule[..100] : f.Rule,
                    Engine = engine.Name,
                    Status = SuggestionStatus.Pending,
                    CreatedAt = now,
                });
            }

            audit.Add(acc, ResourceType.DocumentRevision, rev.Id, engine is RulesExtractionEngine ? "extraction.run" : "extraction.llm-run", null,
                new { Engine = engine.Name, Suggestions = facts.Count, Pages = pages.Count });
            await Task.CompletedTask;
            return true;
        }, ct);
        db.ChangeTracker.Clear();
        return await ResultAsync(rev, acc, note, ct);
    }

    public Task<SuggestionDto> AcceptAsync(Guid suggestionId, DecideSuggestionRequest req, CancellationToken ct) =>
        DecideAsync(suggestionId, req, accept: true, ct);

    public Task<SuggestionDto> RejectAsync(Guid suggestionId, DecideSuggestionRequest req, CancellationToken ct) =>
        DecideAsync(suggestionId, req, accept: false, ct);

    private async Task<SuggestionDto> DecideAsync(Guid suggestionId, DecideSuggestionRequest req, bool accept, CancellationToken ct)
    {
        var revisionId = await db.ExtractionSuggestions.AsNoTracking().Where(s => s.Id == suggestionId).Select(s => (Guid?)s.RevisionId)
            .FirstOrDefaultAsync(ct) ?? throw new NotFoundException("Suggestion");
        ProjectAccess acc;
        try
        {
            (_, acc) = await access.RequireRevisionAsync(revisionId, ct, RunRoles);
        }
        catch (NotFoundException)
        {
            throw new NotFoundException("Suggestion");
        }

        var suggestion = await db.ExtractionSuggestions.FirstAsync(s => s.Id == suggestionId, ct);
        if (suggestion.Status != SuggestionStatus.Pending)
        {
            throw new ConflictException($"This suggestion was already {suggestion.Status.ToString().ToLowerInvariant()}.");
        }

        WorkflowGuard.CheckRowVersion(db, suggestion, suggestion.RowVersion, req.RowVersion);
        var revision = await db.DocumentRevisions.AsNoTracking().FirstAsync(r => r.Id == revisionId, ct);
        var doc = await db.Documents.FirstAsync(d => d.Id == revision.DocumentId, ct);
        var now = clock.GetUtcNow().UtcDateTime;

        await WorkflowGuard.InTransactionAsync(db, async () =>
        {
            suggestion.Status = accept ? SuggestionStatus.Accepted : SuggestionStatus.Rejected;
            suggestion.DecidedById = acc.UserId;
            suggestion.DecidedAt = now;
            audit.Add(acc, ResourceType.ExtractionSuggestion, suggestion.Id, accept ? "extraction.accepted" : "extraction.rejected", null,
                new { suggestion.Field, suggestion.ProposedValue, suggestion.Page, suggestion.Rule });
            if (accept)
            {
                await ApplyAsync(doc, suggestion, acc, now, ct);
            }

            return true;
        }, ct);
        db.ChangeTracker.Clear();
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var saved = await db.ExtractionSuggestions.AsNoTracking().FirstAsync(s => s.Id == suggestionId, ct);
        var freshDoc = await db.Documents.AsNoTracking().FirstAsync(d => d.Id == doc.Id, ct);
        return ToDto(saved, names, freshDoc);
    }

    /// <summary>The only path from an extracted value into document metadata: explicit human acceptance, audited.</summary>
    private async Task ApplyAsync(Document doc, ExtractionSuggestion s, ProjectAccess acc, DateTime now, CancellationToken ct)
    {
        var before = CurrentValue(doc, s.Field);
        switch (s.Field)
        {
            case ExtractionField.Title:
                doc.Title = s.ProposedValue.Length > 300 ? s.ProposedValue[..300] : s.ProposedValue;
                break;
            case ExtractionField.Discipline:
                doc.Discipline = Enum.TryParse<Discipline>(s.ProposedValue, out var d) ? d
                    : throw new RequestValidationException("proposedValue", "Unknown discipline.");
                break;
            case ExtractionField.DocumentNumber:
                var number = s.ProposedValue.Trim();
                if (number.Length > 60 || await db.Documents.AnyAsync(x => x.ProjectId == doc.ProjectId && x.DocumentNumber == number && x.Id != doc.Id, ct))
                {
                    throw new ConflictException($"Document number {number} is already used in this project.");
                }

                doc.DocumentNumber = number;
                break;
            case ExtractionField.Date:
                doc.IssueDate = DateTime.SpecifyKind(DateTime.ParseExact(s.ProposedValue, "yyyy-MM-dd", CultureInfo.InvariantCulture), DateTimeKind.Utc);
                break;
            case ExtractionField.SpecSection:
                doc.SpecSection = s.ProposedValue.Length > 20 ? s.ProposedValue[..20] : s.ProposedValue;
                break;
        }

        doc.UpdatedAt = now;
        audit.Add(acc, ResourceType.Document, doc.Id, "document.metadata-updated", new Dictionary<string, string?> { [s.Field.ToString()] = before },
            new Dictionary<string, string?> { [s.Field.ToString()] = CurrentValue(doc, s.Field), ["Source"] = $"suggestion page {s.Page} ({s.Engine})" });
    }

    private async Task<IExtractionEngine> ChooseEngineAsync(ProjectAccess acc, CancellationToken ct)
    {
        var opt = options.Value;
        if (!opt.LanguageModelConfigured || (current.IsGuest && !opt.AllowGuests))
        {
            return new RulesExtractionEngine();
        }

        var since = clock.GetUtcNow().UtcDateTime.AddDays(-1);
        var used = await db.AuditEvents.CountAsync(a => a.TenantId == acc.TenantId && a.Action == "extraction.llm-run" && a.Timestamp >= since, ct);
        return used >= opt.DailyQuotaPerTenant
            ? new RulesExtractionEngine()
            : services.GetRequiredService<LanguageModelExtractionEngine>();
    }

    private async Task<IReadOnlyList<PageText>> ReadPagesAsync(DocumentRevision rev, CancellationToken ct)
    {
        await using var stream = await storage.OpenReadAsync(rev.StorageKey, ct) ?? throw new NotFoundException("File content");
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        if (rev.MimeType == "application/pdf")
        {
            return PdfInspector.ExtractPages(bytes).Select(p => new PageText(p.PageNumber, p.Text)).ToList();
        }

        return Encoding.UTF8.GetString(bytes).Split('\f').Select((t, i) => new PageText(i + 1, t)).ToList();
    }

    private static bool Unsupported(DocumentRevision rev) => rev.MimeType is not ("application/pdf" or "text/plain");

    private async Task<ExtractionResultDto> ResultAsync(DocumentRevision rev, ProjectAccess acc, string? note, CancellationToken ct)
    {
        var canRun = RunRoles.Contains(acc.Role);
        var label = options.Value.LanguageModelConfigured && (!current.IsGuest || options.Value.AllowGuests)
            ? "Rules-based extraction (optional language-model provider configured)"
            : "Rules-based extraction";
        if (Unsupported(rev))
        {
            return new ExtractionResultDto(rev.Id, "Unsupported", label, "Extraction works on PDF and TXT files only (no OCR configured).", false, []);
        }

        if (!rev.HasTextLayer)
        {
            return new ExtractionResultDto(rev.Id, "NoTextLayer", label, NoTextLayerMessage, false, []);
        }

        var suggestions = await db.ExtractionSuggestions.AsNoTracking().Where(s => s.RevisionId == rev.Id)
            .OrderBy(s => s.Field).ThenBy(s => s.ConfidenceLabel).ThenBy(s => s.Page).ToListAsync(ct);
        var names = await directory.NamesAsync(acc.TenantId, ct);
        var doc = await db.Documents.AsNoTracking().FirstAsync(d => d.Id == rev.DocumentId, ct);
        var engine = suggestions.FirstOrDefault()?.Engine;
        if (engine == LanguageModelExtractionEngine.EngineName)
        {
            label = $"Language-model extraction ({options.Value.Model ?? "external provider"}) — validated against page text";
        }

        var status = suggestions.Count > 0 || await db.AuditEvents.AnyAsync(a => a.ResourceId == rev.Id && a.Action.StartsWith("extraction."), ct)
            ? "Ready" : "NotRun";
        var message = note ?? (status == "NotRun"
            ? "Suggestions are proposals only; a person accepts or rejects each one."
            : $"{suggestions.Count} suggestions, each citing the page it came from.");
        return new ExtractionResultDto(rev.Id, status, label, message, canRun && status == "NotRun",
            suggestions.Select(s => ToDto(s, names, doc)).ToList());
    }

    private static string? CurrentValue(Document doc, ExtractionField field) => field switch
    {
        ExtractionField.Title => doc.Title,
        ExtractionField.Discipline => doc.Discipline.ToString(),
        ExtractionField.DocumentNumber => doc.DocumentNumber,
        ExtractionField.Date => doc.IssueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ExtractionField.SpecSection => doc.SpecSection,
        _ => null,
    };

    private static SuggestionDto ToDto(ExtractionSuggestion s, IReadOnlyDictionary<Guid, string> names, Document doc) =>
        new(s.Id, s.RevisionId, s.Field, s.ProposedValue, s.Page, s.Snippet, s.ConfidenceLabel, s.Rule, s.Engine, s.Status,
            RfiService.Ref(s.DecidedById, names), s.DecidedAt, CurrentValue(doc, s.Field), Convert.ToBase64String(s.RowVersion));
}
