using System.Globalization;
using System.Text.RegularExpressions;
using DocRoof.Domain;

namespace DocRoof.Infrastructure.Extraction;

/// <summary>One page of untrusted document text. It is data to be matched, never instructions to follow.</summary>
public sealed record PageText(int Page, string Text);

/// <summary>A proposed metadata value with its evidence (page + matched snippet) and the rule that produced it.</summary>
public sealed record ExtractedFact(ExtractionField Field, string Value, int Page, string Snippet, ConfidenceLabel Confidence, string Rule);

/// <summary>
/// Extraction engines only <em>propose</em> values. They have no access to the database, the user or any service, so
/// nothing in a document can change state, roles or approvals; a person must accept each suggestion.
/// </summary>
public interface IExtractionEngine
{
    /// <summary>Stable engine id stored with each suggestion (for example <c>rules-v1</c>).</summary>
    string Name { get; }

    /// <summary>Human-facing label shown in the UI. The rules engine is never labelled as AI.</summary>
    string DisplayName { get; }

    Task<IReadOnlyList<ExtractedFact>> ExtractAsync(IReadOnlyList<PageText> pages, CancellationToken ct);
}

/// <summary>Deterministic, regex/heuristic extraction over page text. Same input, same output.</summary>
public sealed partial class RulesExtractionEngine : IExtractionEngine
{
    public const string EngineName = "rules-v1";
    private const int MaxPerField = 6;

    public string Name => EngineName;

    public string DisplayName => "Rules-based extraction";

    public Task<IReadOnlyList<ExtractedFact>> ExtractAsync(IReadOnlyList<PageText> pages, CancellationToken ct) =>
        Task.FromResult(Extract(pages));

    public static IReadOnlyList<ExtractedFact> Extract(IReadOnlyList<PageText> pages)
    {
        var facts = new List<ExtractedFact>();
        foreach (var page in pages)
        {
            var lines = page.Text.Replace("\r", "").Split('\n');
            foreach (var raw in lines)
            {
                var line = Normalize(raw);
                if (line.Length == 0)
                {
                    continue;
                }

                Match m;
                if ((m = DocumentNumberLabel().Match(line)).Success)
                {
                    facts.Add(Fact(ExtractionField.DocumentNumber, m.Groups[1].Value.Trim(), page, line, ConfidenceLabel.High, "title-block: Document No."));
                }

                if ((m = TitleLabel().Match(line)).Success)
                {
                    facts.Add(Fact(ExtractionField.Title, m.Groups[1].Value.Trim(), page, line, ConfidenceLabel.High, "title-block: Title"));
                }

                if ((m = DisciplineLabel().Match(line)).Success && MapDiscipline(m.Groups[1].Value) is { } d)
                {
                    facts.Add(Fact(ExtractionField.Discipline, d.ToString(), page, line, ConfidenceLabel.High, "title-block: Discipline"));
                }

                foreach (Match date in IssueDate().Matches(line))
                {
                    if (ValidDate(date.Groups[1].Value))
                    {
                        facts.Add(Fact(ExtractionField.Date, date.Groups[1].Value, page, line, ConfidenceLabel.High, "label: Issue Date"));
                    }
                }

                if (!IssueDate().IsMatch(line))
                {
                    foreach (Match date in IsoDate().Matches(line))
                    {
                        if (ValidDate(date.Value))
                        {
                            facts.Add(Fact(ExtractionField.Date, date.Value, page, line, ConfidenceLabel.Medium, "pattern: ISO date"));
                        }
                    }
                }

                if ((m = SectionHeading().Match(line)).Success)
                {
                    var section = Section(m.Groups[1].Value);
                    facts.Add(Fact(ExtractionField.SpecSection, section, page, line, ConfidenceLabel.High, "heading: SECTION nn nn nn"));
                    var title = m.Groups[2].Value.Trim();
                    if (title.Length > 3)
                    {
                        facts.Add(Fact(ExtractionField.Title, TitleCase(title), page, line, ConfidenceLabel.Medium, "heading: section title"));
                    }
                }
                else
                {
                    foreach (Match s in SectionReference().Matches(line))
                    {
                        facts.Add(Fact(ExtractionField.SpecSection, Section(s.Groups[1].Value), page, line, ConfidenceLabel.Medium, "reference: Section nn nn nn"));
                    }
                }

                if (!DocumentNumberLabel().IsMatch(line))
                {
                    foreach (Match n in DocumentNumberPattern().Matches(line))
                    {
                        facts.Add(Fact(ExtractionField.DocumentNumber, n.Value, page, line, ConfidenceLabel.Low, "pattern: document number"));
                    }
                }
            }

            if (!facts.Any(f => f.Field == ExtractionField.Discipline && f.Page == page.Page) && InferDiscipline(page.Text) is { } inferred)
            {
                facts.Add(Fact(ExtractionField.Discipline, inferred.Discipline.ToString(), page, inferred.Line, ConfidenceLabel.Low, "keywords: " + inferred.Keyword));
            }
        }

        // Keep the strongest, earliest evidence per field/value and cap each field.
        return facts
            .GroupBy(f => (f.Field, Key: f.Value.ToUpperInvariant()))
            .Select(g => g.OrderBy(f => f.Confidence).ThenBy(f => f.Page).First())
            .GroupBy(f => f.Field)
            .SelectMany(g => g.OrderBy(f => f.Confidence).ThenBy(f => f.Page).Take(MaxPerField))
            .OrderBy(f => f.Field).ThenBy(f => f.Confidence).ThenBy(f => f.Page)
            .ToList();
    }

    public static Discipline? MapDiscipline(string text)
    {
        var t = text.Trim().ToLowerInvariant();
        if (t.Contains("mechanical") || t.Contains("hvac"))
        {
            return Discipline.Mechanical;
        }

        if (t.Contains("fire"))
        {
            return Discipline.FireProtection;
        }

        foreach (var d in Enum.GetValues<Discipline>())
        {
            if (t.StartsWith(d.ToString().ToLowerInvariant(), StringComparison.Ordinal))
            {
                return d;
            }
        }

        return null;
    }

    private static (Discipline Discipline, string Line, string Keyword)? InferDiscipline(string text)
    {
        (string Keyword, Discipline Discipline)[] keywords =
        [
            ("duct", Discipline.Mechanical), ("rooftop unit", Discipline.Mechanical), ("sprinkler", Discipline.FireProtection),
            ("conductor", Discipline.Electrical), ("luminaire", Discipline.Electrical), ("piping", Discipline.Plumbing),
            ("footing", Discipline.Structural), ("reinforc", Discipline.Structural), ("grading", Discipline.Civil),
        ];
        foreach (var line in text.Split('\n'))
        {
            var lower = line.ToLowerInvariant();
            foreach (var (keyword, discipline) in keywords)
            {
                if (lower.Contains(keyword, StringComparison.Ordinal))
                {
                    return (discipline, Normalize(line), keyword);
                }
            }
        }

        return null;
    }

    private static ExtractedFact Fact(ExtractionField field, string value, PageText page, string line, ConfidenceLabel confidence, string rule) =>
        new(field, Clip(value, 200), page.Page, Clip(line, 240), confidence, rule);

    private static string Normalize(string s) => Whitespace().Replace(s, " ").Trim();

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    private static string Section(string digits) => Whitespace().Replace(digits.Trim(), " ");

    private static bool ValidDate(string s) =>
        DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) && d.Year is >= 1990 and <= 2100;

    private static string TitleCase(string s) => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant());

    [GeneratedRegex(@"\bDocument\s+No\.?\s*:\s*([A-Z0-9][A-Z0-9 .\-]{2,40}?)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex DocumentNumberLabel();

    [GeneratedRegex(@"^Title\s*:\s*(.{3,200})$", RegexOptions.IgnoreCase)]
    private static partial Regex TitleLabel();

    [GeneratedRegex(@"\bDiscipline\s*:\s*([A-Za-z /]{3,40})", RegexOptions.IgnoreCase)]
    private static partial Regex DisciplineLabel();

    [GeneratedRegex(@"\bIssue\s+Date\s*:\s*(\d{4}-\d{2}-\d{2})", RegexOptions.IgnoreCase)]
    private static partial Regex IssueDate();

    [GeneratedRegex(@"\b\d{4}-\d{2}-\d{2}\b")]
    private static partial Regex IsoDate();

    [GeneratedRegex(@"^SECTION\s+(\d{2}\s\d{2}\s\d{2})\s*[-–]\s*(.+)$")]
    private static partial Regex SectionHeading();

    [GeneratedRegex(@"\bSection\s+(\d{2}\s\d{2}\s\d{2})\b", RegexOptions.IgnoreCase)]
    private static partial Regex SectionReference();

    [GeneratedRegex(@"\b[A-Z]{2,4}-[A-Z]{1,2}(?:-[A-Z]{2})?-(?:\d{2} \d{2} \d{2}|\d{1,3}|[A-Z]?\d{2,3})\b")]
    private static partial Regex DocumentNumberPattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
