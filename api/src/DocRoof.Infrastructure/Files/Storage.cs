using DocRoof.Domain.Entities;
using DocRoof.Domain.Files;
using DocRoof.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DocRoof.Infrastructure.Files;

public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary><c>Local</c> (disk) or <c>Database</c> (varbinary table, for free hosting without a disk).</summary>
    public string Mode { get; set; } = "Local";

    public string LocalPath { get; set; } = "data/files";

    public long MaxUploadBytes { get; set; } = UploadRules.DefaultMaxBytes;
}

/// <summary>Binary storage for revision content. Keys are opaque, generated GUID paths (see <see cref="StorageKeys"/>).</summary>
public interface IFileStorage
{
    string Mode { get; }

    Task SaveAsync(string key, Guid tenantId, byte[] content, CancellationToken ct);

    Task<Stream?> OpenReadAsync(string key, CancellationToken ct);

    /// <summary>Best-effort removal of a single object (used to compensate a failed database transaction).</summary>
    Task DeleteAsync(string key, CancellationToken ct);

    Task DeleteTenantAsync(Guid tenantId, CancellationToken ct);
}

public sealed class LocalDiskFileStorage : IFileStorage
{
    private readonly string _root;

    public LocalDiskFileStorage(IOptions<StorageOptions> options, Microsoft.Extensions.Hosting.IHostEnvironment env)
    {
        _root = Path.GetFullPath(Path.Combine(env.ContentRootPath, options.Value.LocalPath));
        Directory.CreateDirectory(_root);
    }

    public string Mode => "Local";

    public async Task SaveAsync(string key, Guid tenantId, byte[] content, CancellationToken ct)
    {
        var path = Resolve(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        await File.WriteAllBytesAsync(temp, content, ct);
        File.Move(temp, path, overwrite: false);
    }

    public Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        var path = Resolve(key);
        Stream? stream = File.Exists(path)
            ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true)
            : null;
        return Task.FromResult(stream);
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        var path = Resolve(key);
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        return Task.CompletedTask;
    }

    public Task DeleteTenantAsync(Guid tenantId, CancellationToken ct)
    {
        var dir = Path.GetFullPath(Path.Combine(_root, "t", tenantId.ToString("N")));
        if (dir.StartsWith(_root, StringComparison.OrdinalIgnoreCase) && Directory.Exists(dir))
        {
            Directory.Delete(dir, recursive: true);
        }

        return Task.CompletedTask;
    }

    /// <summary>Validates the key shape and guarantees the resolved path stays under the storage root.</summary>
    private string Resolve(string key)
    {
        if (!StorageKeys.IsValid(key))
        {
            throw new ArgumentException("Invalid storage key.", nameof(key));
        }

        var full = Path.GetFullPath(Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Storage key escapes the storage root.", nameof(key));
        }

        return full;
    }
}

/// <summary>Stores bytes in the <c>StoredFiles</c> table. Participates in the caller's DbContext transaction.</summary>
public sealed class DatabaseFileStorage(DocRoofDbContext db, TimeProvider clock) : IFileStorage
{
    public string Mode => "Database";

    public async Task SaveAsync(string key, Guid tenantId, byte[] content, CancellationToken ct)
    {
        if (!StorageKeys.IsValid(key))
        {
            throw new ArgumentException("Invalid storage key.", nameof(key));
        }

        db.StoredFiles.Add(new StoredFile
        {
            StorageKey = key,
            TenantId = tenantId,
            Content = content,
            ByteSize = content.LongLength,
            CreatedAt = clock.GetUtcNow().UtcDateTime,
        });
        await db.SaveChangesAsync(ct);
    }

    public async Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        var bytes = await db.StoredFiles.AsNoTracking().Where(f => f.StorageKey == key).Select(f => f.Content).FirstOrDefaultAsync(ct);
        return bytes is null ? null : new MemoryStream(bytes, writable: false);
    }

    public Task DeleteAsync(string key, CancellationToken ct) =>
        db.StoredFiles.Where(f => f.StorageKey == key).ExecuteDeleteAsync(ct);

    public Task DeleteTenantAsync(Guid tenantId, CancellationToken ct) =>
        db.StoredFiles.Where(f => f.TenantId == tenantId).ExecuteDeleteAsync(ct);
}
