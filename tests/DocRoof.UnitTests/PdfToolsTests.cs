using System.Text;
using DocRoof.Domain.Files;
using DocRoof.Infrastructure.Files;
using DocRoof.Infrastructure.Seeding;

namespace DocRoof.UnitTests;

public class PdfToolsTests
{
    private static byte[] Content(string docKey, string label) =>
        SeedLibrary.Documents.Single(d => d.Key == docKey).Revisions.Single(r => r.Label == label).Content();

    [Fact]
    public void Seed_library_has_fifteen_documents_across_both_projects()
    {
        Assert.Equal(15, SeedLibrary.Documents.Count);
        Assert.Equal(9, SeedLibrary.Documents.Count(d => d.ProjectCode == SeedLibrary.Midtown));
        Assert.Equal(6, SeedLibrary.Documents.Count(d => d.ProjectCode == SeedLibrary.Westpark));
        Assert.Equal(SeedLibrary.Documents.Count, SeedLibrary.Documents.Select(d => d.Number).Distinct().Count());
    }

    [Fact]
    public void Every_seed_file_passes_the_upload_allow_list()
    {
        foreach (var doc in SeedLibrary.Documents)
        {
            foreach (var rev in doc.Revisions)
            {
                var check = UploadRules.Check(rev.FileName, rev.Content(), UploadRules.DefaultMaxBytes);
                Assert.True(check.Ok, $"{doc.Number} {rev.Label}: {check.Error}");
            }
        }
    }

    [Fact]
    public void Hvac_specification_has_multiple_pages_with_a_text_layer()
    {
        var r1 = Content(SeedLibrary.HvacSpecKey, "R1");
        var info = PdfInspector.Inspect(r1);
        Assert.Equal(4, info.PageCount);
        Assert.True(info.HasTextLayer);
        Assert.False(info.HasActiveContent);

        var pages = PdfInspector.ExtractPages(r1);
        Assert.Equal(4, pages.Count);
        Assert.Contains("SECTION 23 05 00", pages[0].Text);
        Assert.Contains("750 Pa", pages[2].Text);
    }

    [Fact]
    public void Image_only_pdf_has_no_text_layer()
    {
        var info = PdfInspector.Inspect(Content(SeedLibrary.ImageOnlyKey, "R0"));
        Assert.Equal(1, info.PageCount);
        Assert.False(info.HasTextLayer);
    }

    [Fact]
    public void Synthetic_generation_is_deterministic()
    {
        var spec = new SyntheticPdfSpec("X-1", "Title", "General", "R0", "2026-01-01", "Project",
            [new SyntheticPage("Heading", ["Line one", "Line two"])]);
        Assert.Equal(Checksums.Sha256Hex(SyntheticPdf.Build(spec)), Checksums.Sha256Hex(SyntheticPdf.Build(spec)));
        Assert.Equal(SyntheticPng.ScannedDrawing(64, 64, 3), SyntheticPng.ScannedDrawing(64, 64, 3));
    }

    [Fact]
    public void Detects_javascript_and_launch_actions_including_hex_escaped_names()
    {
        var plain = Encoding.Latin1.GetBytes("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n");
        Assert.Contains("JavaScript", PdfInspector.FindActiveContent(plain));

        var escaped = Encoding.Latin1.GetBytes("%PDF-1.4\n1 0 obj << /OpenAction << /S /J#61vaScript >> >> endobj\n2 0 obj << /S /Launch /F (calc.exe) >> endobj\n");
        var markers = PdfInspector.FindActiveContent(escaped);
        Assert.Contains("JavaScript", markers);
        Assert.Contains("Launch", markers);
    }

    [Fact]
    public void Detects_active_content_hidden_in_a_compressed_object_stream()
    {
        using var ms = new MemoryStream();
        using (var z = new System.IO.Compression.ZLibStream(ms, System.IO.Compression.CompressionLevel.Optimal, leaveOpen: true))
        {
            z.Write(Encoding.Latin1.GetBytes("<< /Type /Action /S /JavaScript /JS (this.print()) >>"));
        }

        var bytes = Encoding.Latin1.GetBytes("%PDF-1.5\n5 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\n")
            .Concat(ms.ToArray()).Concat(Encoding.Latin1.GetBytes("\nendstream\nendobj\n")).ToArray();
        Assert.Contains("JavaScript", PdfInspector.FindActiveContent(bytes));
    }

    [Fact]
    public void Seed_pdfs_contain_no_active_content()
    {
        foreach (var rev in SeedLibrary.Documents.SelectMany(d => d.Revisions).Where(r => r.FileName.EndsWith(".pdf")))
        {
            Assert.Empty(PdfInspector.FindActiveContent(rev.Content()));
        }
    }
}
