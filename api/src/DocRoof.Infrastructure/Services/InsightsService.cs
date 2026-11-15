using DocRoof.Domain;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Infrastructure.Services;

/// <summary>Live project metrics computed from the database on every request (nothing is hard-coded or cached).</summary>
public sealed class InsightsService(DocRoofDbContext db, IProjectAccessService access, TimeProvider clock)
{
    public const int Weeks = 12;

    public async Task<InsightsDto> GetAsync(Guid projectId, CancellationToken ct)
    {
        await access.RequireProjectAsync(projectId, ct);
        var now = clock.GetUtcNow().UtcDateTime;

        var rfis = await db.Rfis.AsNoTracking().Where(r => r.ProjectId == projectId && r.State != RfiState.Draft)
            .Select(r => new { r.State, r.SubmittedAt, r.CreatedAt, r.ClosedAt, Discipline = r.SourceRevision!.Document!.Discipline })
            .ToListAsync(ct);
        var submittals = await db.Submittals.AsNoTracking().Where(s => s.ProjectId == projectId)
            .Select(s => new { s.Status, s.Id }).ToListAsync(ct);
        var decisionDurations = await db.ReviewDecisions.AsNoTracking().Where(d => d.Submittal!.ProjectId == projectId)
            .Select(d => new { d.CreatedAt, d.Submittal!.SubmittedAt, d.Cycle, SubmittalCycle = d.Submittal.Cycle })
            .ToListAsync(ct);
        var queue = await db.ReviewQueue.AsNoTracking().Where(i => i.ProjectId == projectId).ToListAsync(ct);
        var docs = await db.Documents.AsNoTracking().Where(d => d.ProjectId == projectId).Select(d => new { d.Discipline, d.Status }).ToListAsync(ct);

        var turnaround = rfis.Where(r => r.State == RfiState.Closed && r.ClosedAt is not null)
            .Select(r => (r.ClosedAt!.Value - (r.SubmittedAt ?? r.CreatedAt)).TotalDays).ToList();
        // Review time is measurable for the current cycle (SubmittedAt is the latest submission time).
        var reviewTimes = decisionDurations.Where(d => d.Cycle == d.SubmittalCycle && d.CreatedAt >= d.SubmittedAt)
            .Select(d => (d.CreatedAt - d.SubmittedAt).TotalDays).ToList();

        var weekStart = StartOfWeek(now).AddDays(-7 * (Weeks - 1));
        var series = new List<SeriesPoint>();
        for (var w = 0; w < Weeks; w++)
        {
            var start = weekStart.AddDays(7 * w);
            var end = start.AddDays(7);
            var opened = rfis.Count(r => (r.SubmittedAt ?? r.CreatedAt) >= start && (r.SubmittedAt ?? r.CreatedAt) < end);
            var closed = rfis.Count(r => r.ClosedAt >= start && r.ClosedAt < end);
            var openAtEnd = rfis.Count(r => (r.SubmittedAt ?? r.CreatedAt) < end && (r.ClosedAt is null || r.ClosedAt >= end));
            series.Add(new SeriesPoint(start, opened, closed, openAtEnd));
        }

        var overdueByDiscipline = queue.Where(i => i.IsOverdue).GroupBy(i => i.Discipline)
            .Select(g => new CountItem(g.Key, g.Count())).OrderByDescending(c => c.Count).ThenBy(c => c.Key).ToList();
        var documentsByDiscipline = docs.GroupBy(d => d.Discipline)
            .Select(g => new DisciplineVolume(g.Key.ToString(), g.Count(),
                g.GroupBy(x => x.Status).Select(s => new CountItem(s.Key.ToString(), s.Count())).OrderBy(c => c.Key).ToList()))
            .OrderByDescending(d => d.Total).ThenBy(d => d.Discipline).ToList();

        return new InsightsDto(
            now,
            Median(turnaround),
            turnaround.Count,
            Median(reviewTimes),
            rfis.Count(r => r.State is RfiState.Submitted or RfiState.Assigned or RfiState.Answered or RfiState.Reopened),
            submittals.Count(s => s.Status is SubmittalStatus.Submitted or SubmittalStatus.InReview),
            queue.Count(i => i.IsOverdue),
            series,
            overdueByDiscipline,
            documentsByDiscipline,
            rfis.GroupBy(r => r.State).Select(g => new CountItem(g.Key.ToString(), g.Count())).OrderBy(c => c.Key).ToList(),
            submittals.GroupBy(s => s.Status).Select(g => new CountItem(g.Key.ToString(), g.Count())).OrderBy(c => c.Key).ToList());
    }

    public static double? Median(IReadOnlyList<double> values)
    {
        if (values.Count == 0)
        {
            return null;
        }

        var sorted = values.OrderBy(v => v).ToList();
        var mid = sorted.Count / 2;
        var median = sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        return Math.Round(median, 1);
    }

    private static DateTime StartOfWeek(DateTime utc)
    {
        var diff = ((int)utc.DayOfWeek + 6) % 7; // Monday
        return DateTime.SpecifyKind(utc.Date.AddDays(-diff), DateTimeKind.Utc);
    }
}
