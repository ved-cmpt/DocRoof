using System.IO.Compression;
using System.Text;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace DocRoof.Infrastructure.Files;

public sealed record PdfPageText(int PageNumber, string Text);

public sealed record PdfInspection(int PageCount, bool HasTextLayer, bool HasActiveContent, IReadOnlyList<string> ActiveContentMarkers);

/// <summary>Reads PDFs with PdfPig. Page text returned here is untrusted data and is never interpreted as instructions.</summary>
public static class PdfInspector
{
    /// <summary>PDF name tokens that indicate scripts, launch actions, embedded files or form submission.</summary>
    private static readonly HashSet<string> ActiveNames = new(StringComparer.Ordinal)
    {
        "JavaScript", "JS", "Launch", "EmbeddedFile", "EmbeddedFiles", "RichMedia", "SubmitForm", "ImportData", "GoToE", "XFA",
    };

    public static PdfInspection Inspect(byte[] content)
    {
        using var doc = PdfDocument.Open(content);
        var pages = doc.NumberOfPages;
        var hasText = false;
        foreach (var page in doc.GetPages())
        {
            if (page.Letters.Any(l => !string.IsNullOrWhiteSpace(l.Value)))
            {
                hasText = true;
                break;
            }
        }

        var markers = FindActiveContent(content);
        return new PdfInspection(pages, hasText, markers.Count > 0, markers);
    }

    public static IReadOnlyList<PdfPageText> ExtractPages(byte[] content, int maxPages = 200)
    {
        using var doc = PdfDocument.Open(content);
        var result = new List<PdfPageText>();
        foreach (var page in doc.GetPages())
        {
            if (page.Number > maxPages)
            {
                break;
            }

            result.Add(new PdfPageText(page.Number, PageToText(page)));
        }

        return result;
    }

    /// <summary>Groups words into lines by baseline so that extracted text keeps a readable order.</summary>
    public static string PageToText(Page page)
    {
        var words = page.GetWords().OrderByDescending(w => Math.Round(w.BoundingBox.Bottom, 0)).ThenBy(w => w.BoundingBox.Left).ToList();
        var sb = new StringBuilder();
        double? lastY = null;
        foreach (var w in words)
        {
            var y = w.BoundingBox.Bottom;
            if (lastY is { } ly && Math.Abs(ly - y) > 3)
            {
                sb.Append('\n');
            }
            else if (lastY is not null)
            {
                sb.Append(' ');
            }

            sb.Append(w.Text);
            lastY = y;
        }

        return sb.ToString();
    }

    /// <summary>
    /// Scans raw PDF bytes and inflated FlateDecode streams (which can hold object streams) for active-content name
    /// tokens. Name escapes such as <c>/J#61vaScript</c> are decoded before matching.
    /// </summary>
    public static IReadOnlyList<string> FindActiveContent(byte[] content)
    {
        var found = new SortedSet<string>(StringComparer.Ordinal);
        ScanNames(content, found);

        var latin1 = Encoding.Latin1.GetString(content);
        var idx = 0;
        var inflatedTotal = 0L;
        while ((idx = latin1.IndexOf("stream", idx, StringComparison.Ordinal)) >= 0)
        {
            var start = idx + 6;
            if (start < latin1.Length && latin1[start] == '\r')
            {
                start++;
            }

            if (start < latin1.Length && latin1[start] == '\n')
            {
                start++;
            }

            var end = latin1.IndexOf("endstream", start, StringComparison.Ordinal);
            if (end < 0)
            {
                break;
            }

            if (idx >= 3 && latin1.AsSpan(idx - 3, 3).SequenceEqual("end"))
            {
                idx = start;
                continue;
            }

            try
            {
                using var input = new MemoryStream(content, start, end - start);
                using var z = new ZLibStream(input, CompressionMode.Decompress);
                using var output = new MemoryStream();
                var buffer = new byte[8192];
                int read;
                while ((read = z.Read(buffer)) > 0 && output.Length < 8 * 1024 * 1024)
                {
                    output.Write(buffer, 0, read);
                }

                inflatedTotal += output.Length;
                ScanNames(output.ToArray(), found);
            }
            catch (InvalidDataException)
            {
                // Not a zlib stream (image data, uncompressed content) — raw bytes were already scanned.
            }

            idx = end + 9;
            if (inflatedTotal > 64L * 1024 * 1024)
            {
                found.Add("InflateLimit");
                break;
            }
        }

        return found.ToList();
    }

    private static void ScanNames(byte[] data, ISet<string> found)
    {
        for (var i = 0; i < data.Length; i++)
        {
            if (data[i] != (byte)'/')
            {
                continue;
            }

            var sb = new StringBuilder();
            var j = i + 1;
            while (j < data.Length && sb.Length < 40)
            {
                var b = data[j];
                if (b is (byte)'#' && j + 2 < data.Length && IsHex(data[j + 1]) && IsHex(data[j + 2]))
                {
                    sb.Append((char)Convert.ToByte(Encoding.ASCII.GetString(data, j + 1, 2), 16));
                    j += 3;
                    continue;
                }

                if (b <= 32 || b is (byte)'/' or (byte)'(' or (byte)')' or (byte)'<' or (byte)'>' or (byte)'[' or (byte)']' or (byte)'{' or (byte)'}' or (byte)'%')
                {
                    break;
                }

                sb.Append((char)b);
                j++;
            }

            var name = sb.ToString();
            if (ActiveNames.Contains(name))
            {
                found.Add(name);
            }

            i = j - 1;
        }
    }

    private static bool IsHex(byte b) => b is >= (byte)'0' and <= (byte)'9' or >= (byte)'a' and <= (byte)'f' or >= (byte)'A' and <= (byte)'F';
}
