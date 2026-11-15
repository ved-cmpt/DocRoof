using DocRoof.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace DocRoof.Infrastructure.Data;

public sealed class ImmutableRecordException(string message) : InvalidOperationException(message);

/// <summary>
/// Second line of defence after the service layer: rejects updates to immutable revision content columns and any
/// update/delete of audit events tracked through EF. The SQL triggers are the third line.
/// </summary>
public sealed class ImmutabilityInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Check(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Check(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void Check(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        foreach (var entry in context.ChangeTracker.Entries())
        {
            switch (entry.Entity)
            {
                case DocumentRevision when entry.State == EntityState.Modified:
                    var changed = DocumentRevision.ImmutableColumns.Where(c => entry.Property(c).IsModified).ToList();
                    if (changed.Count > 0)
                    {
                        throw new ImmutableRecordException(
                            $"Document revisions are immutable; attempted to modify: {string.Join(", ", changed)}.");
                    }

                    break;
                case DocumentRevision when entry.State == EntityState.Deleted:
                    throw new ImmutableRecordException("Document revisions cannot be deleted.");
                case AuditEvent when entry.State is EntityState.Modified or EntityState.Deleted:
                    throw new ImmutableRecordException("Audit events are append-only.");
            }
        }
    }
}

/// <summary>Used only by <c>dotnet ef</c> at design time.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<DocRoofDbContext>
{
    public DocRoofDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__DocRoof")
                 ?? "Server=127.0.0.1,14330;Database=DocRoof;User Id=sa;Password=design-time-only;TrustServerCertificate=True";
        var options = new DbContextOptionsBuilder<DocRoofDbContext>().UseSqlServer(cs).Options;
        return new DocRoofDbContext(options);
    }
}
