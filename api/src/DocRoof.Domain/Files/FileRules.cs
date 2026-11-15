using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DocRoof.Domain.Files;

public enum DetectedFileType
{
    Unknown,
    Pdf,
    Png,
    Jpeg,
    Text,
    Executable,
}

/// <summary>Magic-byte sniffing. The client-supplied content type is never trusted.</summary>
public static class FileSignatures
{
    private static readonly byte[] Pdf = "%PDF-"u8.ToArray();
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];

    private static readonly byte[][] Executables =
    [
        "MZ"u8.ToArray(), // Windows PE / DOS
        [0x7F, 0x45, 0x4C, 0x46], // ELF
        [0xFE, 0xED, 0xFA, 0xCE], [0xFE, 0xED, 0xFA, 0xCF], // Mach-O
        [0xCE, 0xFA, 0xED, 0xFE], [0xCF, 0xFA, 0xED, 0xFE],
        [0xCA, 0xFE, 0xBA, 0xBE], // Mach-O fat / Java class
        "#!"u8.ToArray(), // shebang scripts
    ];

    public static DetectedFileType Detect(ReadOnlySpan<byte> content)
    {
        if (content.IsEmpty)
        {
            return DetectedFileType.Unknown;
        }

        foreach (var sig in Executables)
        {
            if (content.StartsWith(sig))
            {
                return DetectedFileType.Executable;
            }
        }

        if (content.StartsWith(Pdf))
        {
            return DetectedFileType.Pdf;
        }

        if (content.StartsWith(Png))
        {
            return DetectedFileType.Png;
        }

        if (content.StartsWith(Jpeg))
        {
            return DetectedFileType.Jpeg;
        }

        return LooksLikeText(content) ? DetectedFileType.Text : DetectedFileType.Unknown;
    }

    /// <summary>Strict UTF-8 without NUL or unexpected control characters.</summary>
    public static bool LooksLikeText(ReadOnlySpan<byte> content)
    {
        if (content.IndexOf((byte)0) >= 0)
        {
            return false;
        }

        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(content);
        }
        catch (DecoderFallbackException)
        {
            return false;
        }

        foreach (var ch in text)
        {
            if (char.IsControl(ch) && ch is not ('\n' or '\r' or '\t' or '\f'))
            {
                return false;
            }
        }

        return true;
    }

    public static string MimeType(DetectedFileType type) => type switch
    {
        DetectedFileType.Pdf => "application/pdf",
        DetectedFileType.Png => "image/png",
        DetectedFileType.Jpeg => "image/jpeg",
        DetectedFileType.Text => "text/plain",
        _ => "application/octet-stream",
    };

    public static IReadOnlyList<string> Extensions(DetectedFileType type) => type switch
    {
        DetectedFileType.Pdf => [".pdf"],
        DetectedFileType.Png => [".png"],
        DetectedFileType.Jpeg => [".jpg", ".jpeg"],
        DetectedFileType.Text => [".txt"],
        _ => [],
    };
}

public sealed record UploadCheck(bool Ok, string? Error, DetectedFileType Type, string MimeType, string SafeFileName);

/// <summary>Allow-list validation for uploaded files: PDF, TXT, PNG and JPG only.</summary>
public static class UploadRules
{
    public const long DefaultMaxBytes = 25L * 1024 * 1024;

    public static UploadCheck Check(string? clientFileName, ReadOnlySpan<byte> content, long maxBytes)
    {
        var safeName = FileNameSanitizer.Sanitize(clientFileName);
        if (content.Length == 0)
        {
            return Fail("The file is empty.");
        }

        if (content.Length > maxBytes)
        {
            return Fail($"The file exceeds the {maxBytes / (1024 * 1024)} MB limit.");
        }

        var type = FileSignatures.Detect(content);
        if (type == DetectedFileType.Executable)
        {
            return Fail("Executable content is not allowed.");
        }

        if (type == DetectedFileType.Unknown)
        {
            return Fail("Only PDF, TXT, PNG and JPG files are allowed.");
        }

        var ext = Path.GetExtension(safeName).ToLowerInvariant();
        if (!FileSignatures.Extensions(type).Contains(ext))
        {
            return Fail($"The file extension '{ext}' does not match its content ({type}).");
        }

        return new UploadCheck(true, null, type, FileSignatures.MimeType(type), safeName);

        UploadCheck Fail(string message) => new(false, message, DetectedFileType.Unknown, "application/octet-stream", safeName);
    }
}

/// <summary>Produces display/download-safe file names. Results are never used as storage paths.</summary>
public static partial class FileNameSanitizer
{
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    public const int MaxLength = 120;

    public static string Sanitize(string? name, string fallback = "document")
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return fallback;
        }

        // Keep only the last path segment (handles both separators and traversal like ../../x).
        var lastSep = Math.Max(name.LastIndexOf('/'), name.LastIndexOf('\\'));
        var candidate = lastSep >= 0 ? name[(lastSep + 1)..] : name;

        var sb = new StringBuilder(candidate.Length);
        foreach (var ch in candidate.Normalize(NormalizationForm.FormC))
        {
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (char.IsControl(ch) || cat is UnicodeCategory.Format or UnicodeCategory.LineSeparator
                    or UnicodeCategory.ParagraphSeparator or UnicodeCategory.Surrogate or UnicodeCategory.PrivateUse
                    or UnicodeCategory.OtherNotAssigned)
            {
                continue; // drops bidi overrides such as U+202E used to disguise extensions
            }

            sb.Append(ch is '<' or '>' or ':' or '"' or '|' or '?' or '*' or ';' or '%' ? '_' : ch);
        }

        var cleaned = Whitespace().Replace(sb.ToString(), " ").Trim().Trim('.', ' ');
        cleaned = DotRuns().Replace(cleaned, ".");
        if (cleaned.Length == 0)
        {
            return fallback;
        }

        var ext = Path.GetExtension(cleaned);
        var stem = ext.Length > 0 ? cleaned[..^ext.Length] : cleaned;
        if (ext.Length > 10)
        {
            ext = ext[..10];
        }

        if (stem.Length == 0 || Reserved.Contains(stem))
        {
            stem = "_" + stem;
        }

        if (stem.Length + ext.Length > MaxLength)
        {
            stem = stem[..(MaxLength - ext.Length)].TrimEnd('.', ' ');
        }

        return stem + ext;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"\.{2,}")]
    private static partial Regex DotRuns();
}

/// <summary>Storage keys are opaque GUID paths scoped to a tenant; user-supplied names never reach the file system.</summary>
public static partial class StorageKeys
{
    public static string New(Guid tenantId) => $"t/{tenantId:N}/{Guid.NewGuid():N}";

    public static bool IsValid(string? key) => key is not null && KeyPattern().IsMatch(key);

    public static string TenantPrefix(Guid tenantId) => $"t/{tenantId:N}/";

    [GeneratedRegex("^t/[0-9a-f]{32}/[0-9a-f]{32}$")]
    private static partial Regex KeyPattern();
}

public static class Checksums
{
    public static string Sha256Hex(ReadOnlySpan<byte> content) => Convert.ToHexStringLower(SHA256.HashData(content));
}
