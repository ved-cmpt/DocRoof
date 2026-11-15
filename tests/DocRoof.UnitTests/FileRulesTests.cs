using System.Text;
using DocRoof.Domain.Files;
using DocRoof.Infrastructure.Services;

namespace DocRoof.UnitTests;

public class FileSignatureTests
{
    private static readonly byte[] Pdf = "%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46];
    private static readonly byte[] WindowsExe = [0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00];

    [Fact]
    public void Detects_allowed_types_from_magic_bytes()
    {
        Assert.Equal(DetectedFileType.Pdf, FileSignatures.Detect(Pdf));
        Assert.Equal(DetectedFileType.Png, FileSignatures.Detect(Png));
        Assert.Equal(DetectedFileType.Jpeg, FileSignatures.Detect(Jpeg));
        Assert.Equal(DetectedFileType.Text, FileSignatures.Detect("Plain site notes\nline 2\t\u00e9"u8));
    }

    [Theory]
    [InlineData(new byte[] { 0x4D, 0x5A, 0x90, 0x00 })] // PE
    [InlineData(new byte[] { 0x7F, 0x45, 0x4C, 0x46 })] // ELF
    [InlineData(new byte[] { 0xCF, 0xFA, 0xED, 0xFE })] // Mach-O
    [InlineData(new byte[] { 0x23, 0x21, 0x2F, 0x62 })] // #!/b
    public void Detects_executables(byte[] head) => Assert.Equal(DetectedFileType.Executable, FileSignatures.Detect(head));

    [Fact]
    public void Binary_garbage_and_invalid_utf8_are_unknown()
    {
        Assert.Equal(DetectedFileType.Unknown, FileSignatures.Detect(new byte[] { 0x00, 0x01, 0x02, 0x03 }));
        Assert.Equal(DetectedFileType.Unknown, FileSignatures.Detect(new byte[] { 0x41, 0xC3, 0x28 })); // invalid UTF-8
        Assert.Equal(DetectedFileType.Unknown, FileSignatures.Detect("PK\u0003\u0004zip"u8));
    }

    [Fact]
    public void Disguised_executable_named_pdf_is_rejected()
    {
        var result = UploadRules.Check("specification.pdf", WindowsExe, UploadRules.DefaultMaxBytes);
        Assert.False(result.Ok);
        Assert.Contains("Executable", result.Error);
    }

    [Fact]
    public void Extension_must_match_sniffed_content()
    {
        var result = UploadRules.Check("drawing.png", Pdf, UploadRules.DefaultMaxBytes);
        Assert.False(result.Ok);
        Assert.Contains("does not match", result.Error);
    }

    [Fact]
    public void Oversize_and_empty_files_are_rejected()
    {
        Assert.False(UploadRules.Check("a.pdf", new byte[11], 10).Ok);
        Assert.False(UploadRules.Check("a.pdf", ReadOnlySpan<byte>.Empty, 10).Ok);
    }

    [Fact]
    public void Valid_pdf_upload_reports_server_side_mime_type()
    {
        var result = UploadRules.Check("Spec R1.PDF", Pdf, UploadRules.DefaultMaxBytes);
        Assert.True(result.Ok);
        Assert.Equal("application/pdf", result.MimeType);
        Assert.Equal("Spec R1.PDF", result.SafeFileName);
    }

    [Theory]
    [InlineData("photo.jpeg")]
    [InlineData("photo.jpg")]
    public void Both_jpeg_extensions_are_accepted(string name) => Assert.True(UploadRules.Check(name, Jpeg, 100).Ok);
}

public class FileNameSanitizerTests
{
    [Theory]
    [InlineData("../../etc/passwd", "passwd")]
    [InlineData(@"..\..\Windows\System32\evil.pdf", "evil.pdf")]
    [InlineData("C:\\temp\\report.txt", "report.txt")]
    [InlineData("  spaced   name .pdf ", "spaced name .pdf")]
    [InlineData("quote\"pipe|star*.txt", "quote_pipe_star_.txt")]
    [InlineData("CON.txt", "_CON.txt")]
    [InlineData("", "document")]
    [InlineData(null, "document")]
    [InlineData("...", "document")]
    [InlineData("a..b...pdf", "a.b.pdf")]
    public void Sanitizes_names(string? input, string expected) => Assert.Equal(expected, FileNameSanitizer.Sanitize(input));

    [Fact]
    public void Removes_bidi_override_used_to_disguise_extensions()
    {
        var disguised = "invoice\u202Efdp.exe";
        var sanitized = FileNameSanitizer.Sanitize(disguised);
        Assert.DoesNotContain('\u202E', sanitized);
        Assert.EndsWith(".exe", sanitized);
    }

    [Fact]
    public void Removes_control_characters_and_newlines()
    {
        var sanitized = FileNameSanitizer.Sanitize("evil\r\nContent-Type: text/html\0.pdf");
        Assert.DoesNotContain('\r', sanitized);
        Assert.DoesNotContain('\n', sanitized);
        Assert.DoesNotContain('\0', sanitized);
    }

    [Fact]
    public void Truncates_long_names_but_keeps_extension()
    {
        var sanitized = FileNameSanitizer.Sanitize(new string('x', 400) + ".pdf");
        Assert.True(sanitized.Length <= FileNameSanitizer.MaxLength);
        Assert.EndsWith(".pdf", sanitized);
    }
}

public class StorageKeyAndChecksumTests
{
    [Fact]
    public void Storage_keys_are_tenant_scoped_guid_paths()
    {
        var tenant = Guid.NewGuid();
        var key = StorageKeys.New(tenant);
        Assert.StartsWith(StorageKeys.TenantPrefix(tenant), key);
        Assert.True(StorageKeys.IsValid(key));
        Assert.NotEqual(key, StorageKeys.New(tenant));
    }

    [Theory]
    [InlineData("../t/abc")]
    [InlineData("t/../../etc/passwd")]
    [InlineData("t/0123456789abcdef0123456789abcdef/report.pdf")]
    [InlineData("T/0123456789ABCDEF0123456789ABCDEF/0123456789ABCDEF0123456789ABCDEF")]
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_keys_that_are_not_generated(string? key) => Assert.False(StorageKeys.IsValid(key));

    [Fact]
    public void Sha256_matches_known_vector()
    {
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Checksums.Sha256Hex("abc"u8));
        Assert.Equal(64, Checksums.Sha256Hex(Encoding.UTF8.GetBytes("DocRoof")).Length);
    }

    [Theory]
    [InlineData(new string[0], "R0")]
    [InlineData(new[] { "R0" }, "R1")]
    [InlineData(new[] { "R0", "R1", "R9" }, "R10")]
    [InlineData(new[] { "A", "B" }, "R0")]
    public void Next_revision_label_follows_R_numbering(string[] existing, string expected) =>
        Assert.Equal(expected, DocumentService.NextLabel(existing));
}
