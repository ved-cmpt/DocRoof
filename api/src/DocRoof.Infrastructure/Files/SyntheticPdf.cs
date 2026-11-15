using System.IO.Compression;
using System.Text;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace DocRoof.Infrastructure.Files;

/// <summary>A page of a synthetic document: a heading and body lines (wrapped automatically).</summary>
public sealed record SyntheticPage(string Heading, IReadOnlyList<string> Lines);

public sealed record SyntheticPdfSpec(
    string DocumentNumber,
    string Title,
    string Discipline,
    string Revision,
    string IssueDate,
    string ProjectName,
    IReadOnlyList<SyntheticPage> Pages);

/// <summary>
/// Generates fictitious construction documents with PdfPig's writer (Apache-2.0) using standard-14 fonts, so no font
/// files are needed and output is deterministic for the same input.
/// </summary>
public static class SyntheticPdf
{
    private const double PageWidth = 612; // US Letter
    private const double PageHeight = 792;
    private const double Margin = 54;

    public static byte[] Build(SyntheticPdfSpec spec)
    {
        var builder = new PdfDocumentBuilder { IncludeDocumentInformation = false };
        var regular = builder.AddStandard14Font(Standard14Font.Helvetica);
        var bold = builder.AddStandard14Font(Standard14Font.HelveticaBold);
        var total = spec.Pages.Count;

        for (var i = 0; i < total; i++)
        {
            var page = builder.AddPage(PageWidth, PageHeight);
            var p = spec.Pages[i];

            // Header band.
            page.SetTextAndFillColor(30, 41, 59);
            page.DrawRectangle(new PdfPoint(Margin, PageHeight - 78), PageWidth - (2 * Margin), 36, 1, fill: true);
            page.SetTextAndFillColor(255, 255, 255);
            page.AddText(spec.ProjectName.ToUpperInvariant(), 9, new PdfPoint(Margin + 10, PageHeight - 56), bold);
            page.AddText("FICTITIOUS SAMPLE DOCUMENT - DOCROOF PORTFOLIO", 7, new PdfPoint(Margin + 10, PageHeight - 69), regular);
            page.SetTextAndFillColor(245, 158, 11);
            page.DrawRectangle(new PdfPoint(Margin, PageHeight - 82), PageWidth - (2 * Margin), 4, 1, fill: true);

            // Body.
            page.SetTextAndFillColor(15, 23, 42);
            var y = PageHeight - 110;
            page.AddText(p.Heading, 13, new PdfPoint(Margin, y), bold);
            y -= 22;
            foreach (var line in p.Lines.SelectMany(l => Wrap(l, 92)))
            {
                if (y < 120)
                {
                    break;
                }

                page.AddText(line, 10, new PdfPoint(Margin, y), regular);
                y -= 14;
            }

            // Title block (bottom), the layout extraction rules expect.
            page.SetStrokeColor(30, 41, 59);
            page.DrawRectangle(new PdfPoint(Margin, 40), PageWidth - (2 * Margin), 64, 1);
            page.AddText("Document No.: " + spec.DocumentNumber, 9, new PdfPoint(Margin + 8, 88), bold);
            page.AddText("Title: " + spec.Title, 9, new PdfPoint(Margin + 8, 75), regular);
            page.AddText("Discipline: " + spec.Discipline, 9, new PdfPoint(Margin + 8, 62), regular);
            page.AddText("Revision: " + spec.Revision + "    Issue Date: " + spec.IssueDate, 9, new PdfPoint(Margin + 8, 49), regular);
            page.AddText($"Page {i + 1} of {total}", 9, new PdfPoint(PageWidth - Margin - 70, 49), regular);
        }

        return Deterministic(builder.Build());
    }

    /// <summary>
    /// The writer emits a random trailer /ID. Replace it (same length, so xref offsets stay valid) with a hash of the
    /// document body so identical input always yields identical bytes and checksums.
    /// </summary>
    private static byte[] Deterministic(byte[] pdf)
    {
        var text = Encoding.Latin1.GetString(pdf);
        var idx = text.LastIndexOf("/ID [", StringComparison.Ordinal);
        if (idx < 0)
        {
            return pdf;
        }

        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(pdf.AsSpan(0, idx)))[..32];
        var first = text.IndexOf('<', idx);
        var second = text.IndexOf('<', first + 1);
        if (first < 0 || second < 0 || second - first < 33)
        {
            return pdf;
        }

        var hashBytes = Encoding.ASCII.GetBytes(hash);
        hashBytes.CopyTo(pdf, first + 1);
        hashBytes.CopyTo(pdf, second + 1);
        return pdf;
    }

    /// <summary>A PDF whose only content is a raster image: there is no text layer to extract.</summary>
    public static byte[] BuildImageOnly(int pages, int seed)
    {
        var builder = new PdfDocumentBuilder { IncludeDocumentInformation = false };
        for (var i = 0; i < pages; i++)
        {
            var page = builder.AddPage(PageWidth, PageHeight);
            var png = SyntheticPng.ScannedDrawing(850, 1100, seed + i);
            page.AddPng(png, new PdfRectangle(36, 36, PageWidth - 36, PageHeight - 36));
        }

        return Deterministic(builder.Build());
    }

    public static IEnumerable<string> Wrap(string text, int width)
    {
        if (text.Length == 0)
        {
            yield return "";
            yield break;
        }

        var line = new StringBuilder();
        foreach (var word in text.Split(' '))
        {
            if (line.Length > 0 && line.Length + word.Length + 1 > width)
            {
                yield return line.ToString();
                line.Clear();
            }

            if (line.Length > 0)
            {
                line.Append(' ');
            }

            line.Append(word);
        }

        if (line.Length > 0)
        {
            yield return line.ToString();
        }
    }
}

/// <summary>Minimal deterministic grayscale PNG encoder used for the "scanned" seed drawing.</summary>
public static class SyntheticPng
{
    private static readonly uint[] CrcTable = BuildCrcTable();

    public static byte[] ScannedDrawing(int width, int height, int seed)
    {
        var rng = new Random(seed);
        var raw = new byte[height * (width + 1)];
        for (var y = 0; y < height; y++)
        {
            var row = y * (width + 1);
            raw[row] = 0; // filter: none
            for (var x = 0; x < width; x++)
            {
                byte v = (byte)(236 + rng.Next(0, 12)); // paper with scan noise
                var border = x < 30 || x > width - 30 || y < 30 || y > height - 30;
                var frame = x is > 40 and < 44 || x > width - 44 && x < width - 40 || y is > 40 and < 44 || y > height - 44 && y < height - 40;
                var grid = (x - 60) % 120 == 0 && y is > 80 and < 900 || (y - 80) % 120 == 0 && x is > 60 and < 790;
                var titleBlock = y > height - 200 && y < height - 196 && x > 44 && x < width - 44;
                var wall = (x is > 120 and < 128 || x is > 700 and < 708) && y is > 140 and < 820 || (y is > 140 and < 148 || y is > 812 and < 820) && x is > 120 and < 708;
                if (frame || titleBlock || wall)
                {
                    v = 40;
                }
                else if (grid)
                {
                    v = 170;
                }
                else if (border)
                {
                    v = 250;
                }

                raw[row + 1 + x] = v;
            }
        }

        using var ms = new MemoryStream();
        ms.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        var ihdr = new byte[13];
        WriteBigEndian(ihdr, 0, (uint)width);
        WriteBigEndian(ihdr, 4, (uint)height);
        ihdr[8] = 8; // bit depth
        ihdr[9] = 0; // grayscale
        WriteChunk(ms, "IHDR", ihdr);
        using (var compressed = new MemoryStream())
        {
            using (var z = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
            {
                z.Write(raw);
            }

            WriteChunk(ms, "IDAT", compressed.ToArray());
        }

        WriteChunk(ms, "IEND", []);
        return ms.ToArray();
    }

    private static void WriteChunk(Stream s, string type, byte[] data)
    {
        var len = new byte[4];
        WriteBigEndian(len, 0, (uint)data.Length);
        s.Write(len);
        var typeBytes = Encoding.ASCII.GetBytes(type);
        s.Write(typeBytes);
        s.Write(data);
        var crc = Crc(typeBytes, data);
        var crcBytes = new byte[4];
        WriteBigEndian(crcBytes, 0, crc);
        s.Write(crcBytes);
    }

    private static void WriteBigEndian(byte[] buffer, int offset, uint value)
    {
        buffer[offset] = (byte)(value >> 24);
        buffer[offset + 1] = (byte)(value >> 16);
        buffer[offset + 2] = (byte)(value >> 8);
        buffer[offset + 3] = (byte)value;
    }

    private static uint Crc(byte[] type, byte[] data)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in type.Concat(data))
        {
            c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        }

        return c ^ 0xFFFFFFFFu;
    }

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++)
            {
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }

            table[n] = c;
        }

        return table;
    }
}
