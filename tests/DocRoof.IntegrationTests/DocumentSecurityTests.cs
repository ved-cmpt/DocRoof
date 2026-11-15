using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using DocRoof.Domain.Files;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Seeding;
using DocRoof.IntegrationTests.Infrastructure;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.IntegrationTests;

[Collection(SqlCollection.Name)]
public class DocumentSecurityTests(AppFixture app)
{
    private DocRoofFactory Factory => app.Factory;

    private static byte[] HvacR1 => SeedLibrary.Documents.Single(d => d.Key == SeedLibrary.HvacSpecKey).Revisions[1].Content();

    private static byte[] SmallPdf(string text) => DocRoof.Infrastructure.Files.SyntheticPdf.Build(
        new DocRoof.Infrastructure.Files.SyntheticPdfSpec("T-1", "Test", "General", "R9", "2026-01-01", "Test",
            [new DocRoof.Infrastructure.Files.SyntheticPage("Heading", [text])]));

    // ---------- Must-pass: unauthorized users cannot obtain other tenants' / projects' files ----------

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass1_Unauthorized_users_cannot_obtain_another_tenants_or_projects_files_by_guessed_ids()
    {
        var owner = Factory.CreateApiClient();
        await owner.StartDemoAsync();
        var doc = await owner.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var revisionId = doc.GetProperty("currentRevisionId").GetGuid();
        var documentId = doc.GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.OK, (await owner.Http.GetAsync($"/api/document-revisions/{revisionId}/download")).StatusCode);

        var intruder = Factory.CreateApiClient();
        await intruder.StartDemoAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/document-revisions/{revisionId}/download")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/document-revisions/{revisionId}/preview")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/documents/{documentId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/documents/{documentId}/history")).StatusCode);
        var projectId = doc.GetProperty("projectId").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await intruder.Http.GetAsync($"/api/projects/{projectId}/documents")).StatusCode);

        var anonymous = Factory.CreateApiClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.Http.GetAsync($"/api/document-revisions/{revisionId}/download")).StatusCode);
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass1_Project_non_members_get_404_for_files_even_inside_the_same_tenant()
    {
        var client = Factory.CreateApiClient();
        await client.StartDemoAsync();
        await client.SwitchPersonaAsync("controller");
        var westparkDoc = await client.FindDocumentAsync("WOR", "WOR-S-301");

        // The mechanical reviewer persona is only a member of the Midtown project.
        await client.SwitchPersonaAsync("reviewer");
        var revisionId = westparkDoc.GetProperty("currentRevisionId").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await client.Http.GetAsync($"/api/document-revisions/{revisionId}/download")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.Http.GetAsync($"/api/documents/{westparkDoc.GetProperty("id").GetGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Random_guid_returns_404_not_500()
    {
        var client = Factory.CreateApiClient();
        await client.StartDemoAsync();
        var response = await client.Http.GetAsync($"/api/document-revisions/{Guid.NewGuid()}/download");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    // ---------- Must-pass: new revision creates a new row; old bytes/checksum/references intact ----------

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass2_New_revision_creates_a_new_row_and_keeps_old_bytes_checksum_and_references()
    {
        var client = Factory.CreateApiClient();
        var session = await client.StartDemoAsync();
        var tenantId = session.GetProperty("tenantId").GetGuid();
        await client.SwitchPersonaAsync("controller");
        var doc = await client.FindDocumentAsync("MCC", "MCC-M-23 05 00");
        var documentId = doc.GetProperty("id").GetGuid();
        var oldRevisionId = doc.GetProperty("currentRevisionId").GetGuid();

        var before = await Factory.WithDbAsync(db => db.DocumentRevisions.AsNoTracking().SingleAsync(r => r.Id == oldRevisionId));
        var citingRfis = await Factory.WithDbAsync(db => db.Rfis.CountAsync(r => r.SourceRevisionId == oldRevisionId));
        Assert.True(citingRfis > 0, "Seed should contain an RFI citing the current HVAC revision.");

        var newBytes = SmallPdf("Revision R2 content");
        var response = await client.UploadRevisionAsync(documentId, "MCC-M-23-05-00_R2.pdf", newBytes);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>(ApiClient.Json);
        Assert.Equal("R2", created.GetProperty("versionLabel").GetString());
        Assert.Equal(Checksums.Sha256Hex(newBytes), created.GetProperty("sha256").GetString());

        var after = await Factory.WithDbAsync(db => db.DocumentRevisions.AsNoTracking().SingleAsync(r => r.Id == oldRevisionId));
        Assert.Equal(before.Sha256, after.Sha256);
        Assert.Equal(before.StorageKey, after.StorageKey);
        Assert.Equal(before.ByteSize, after.ByteSize);
        Assert.Equal(before.UploadedAt, after.UploadedAt);

        var oldDownload = await client.Http.GetByteArrayAsync($"/api/document-revisions/{oldRevisionId}/download");
        Assert.Equal(before.Sha256, Convert.ToHexStringLower(SHA256.HashData(oldDownload)));
        Assert.Equal(HvacR1, oldDownload);

        var detail = await client.GetAsync<JsonElement>($"/api/documents/{documentId}");
        Assert.Equal(created.GetProperty("id").GetGuid(), detail.GetProperty("currentRevisionId").GetGuid());
        Assert.Equal(3, detail.GetProperty("revisions").GetArrayLength());
        var newRow = await Factory.WithDbAsync(db => db.DocumentRevisions.AsNoTracking().SingleAsync(r => r.Id == created.GetProperty("id").GetGuid()));
        Assert.Equal(oldRevisionId, newRow.SupersedesRevisionId);
        Assert.StartsWith(StorageKeys.TenantPrefix(tenantId), newRow.StorageKey);
        Assert.Equal(citingRfis, await Factory.WithDbAsync(db => db.Rfis.CountAsync(r => r.SourceRevisionId == oldRevisionId)));

        var audit = await Factory.WithDbAsync(db => db.AuditEvents.CountAsync(a => a.ResourceId == newRow.Id && a.Action == "revision.superseded"));
        Assert.Equal(1, audit);
    }

    [Fact]
    public async Task Database_trigger_rejects_updates_to_revision_content_columns()
    {
        var revisionId = await Factory.WithDbAsync(db => db.DocumentRevisions.Select(r => r.Id).FirstAsync());
        var ex = await Assert.ThrowsAsync<SqlException>(() => Factory.WithDbAsync(db =>
            db.Database.ExecuteSqlInterpolatedAsync($"UPDATE DocumentRevisions SET Sha256 = REPLICATE('0', 64) WHERE Id = {revisionId}")));
        Assert.Equal(51001, ex.Number);

        // Approval status is the one mutable column group and remains updatable.
        await Factory.WithDbAsync(db =>
            db.Database.ExecuteSqlInterpolatedAsync($"UPDATE DocumentRevisions SET ApprovalUpdatedAt = SYSUTCDATETIME() WHERE Id = {revisionId}"));
    }

    [Fact]
    public async Task Ef_interceptor_rejects_modifying_a_tracked_revision()
    {
        await Assert.ThrowsAsync<ImmutableRecordException>(() => Factory.WithDbAsync(async db =>
        {
            var rev = await db.DocumentRevisions.FirstAsync();
            rev.FileName = "tampered.pdf";
            return await db.SaveChangesAsync();
        }));
    }

    [Fact]
    public async Task Audit_events_cannot_be_updated()
    {
        var ex = await Assert.ThrowsAsync<SqlException>(() => Factory.WithDbAsync(db =>
            db.Database.ExecuteSqlRawAsync("UPDATE TOP (1) AuditEvents SET Action = 'tampered'")));
        Assert.Equal(51002, ex.Number);
    }

    // ---------- Must-pass: magic-byte allow-list, size limit, sanitized names ----------

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass3_Disguised_executable_is_rejected_by_magic_bytes_and_nothing_is_stored()
    {
        var client = Factory.CreateApiClient();
        await client.StartDemoAsync();
        await client.SwitchPersonaAsync("controller");
        var doc = await client.FindDocumentAsync("MCC", "MCC-S-201");
        var documentId = doc.GetProperty("id").GetGuid();
        var before = await Factory.WithDbAsync(db => db.DocumentRevisions.CountAsync(r => r.DocumentId == documentId));

        byte[] exe = [0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xFF, 0xFF];
        var response = await client.UploadRevisionAsync(documentId, "foundation-plan.pdf", exe);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Executable", await response.Content.ReadAsStringAsync());

        var mismatch = await client.UploadRevisionAsync(documentId, "plan.png", SmallPdf("pdf named png"));
        Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);

        Assert.Equal(before, await Factory.WithDbAsync(db => db.DocumentRevisions.CountAsync(r => r.DocumentId == documentId)));
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass3_Oversize_upload_is_rejected_with_413()
    {
        var client = Factory.CreateApiClient();
        await client.StartDemoAsync();
        await client.SwitchPersonaAsync("controller");
        var doc = await client.FindDocumentAsync("MCC", "MCC-S-201");
        var big = new byte[DocRoofFactory.MaxUploadBytes + 1];
        "%PDF-1.7\n"u8.CopyTo(big);
        var response = await client.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "huge.pdf", big);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    [Trait("Category", "MustPass")]
    public async Task MustPass3_Download_names_are_sanitized_and_served_as_nosniff_attachments()
    {
        var client = Factory.CreateApiClient();
        await client.StartDemoAsync();
        await client.SwitchPersonaAsync("controller");
        var doc = await client.FindDocumentAsync("MCC", "MCC-S-201");
        var upload = await client.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "..\\..\\evil\r\nname‮.pdf", SmallPdf("x"));
        Assert.Equal(HttpStatusCode.Created, upload.StatusCode);
        var revision = await upload.Content.ReadFromJsonAsync<JsonElement>(ApiClient.Json);

        var response = await client.Http.GetAsync($"/api/document-revisions/{revision.GetProperty("id").GetGuid()}/download");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var disposition = response.Content.Headers.ContentDisposition!;
        Assert.Equal("attachment", disposition.DispositionType);
        var name = disposition.FileNameStar ?? disposition.FileName!;
        Assert.DoesNotContain("..", name);
        Assert.DoesNotContain("\\", name);
        Assert.DoesNotContain("\n", name);
        Assert.False(name.Contains((char)0x202E), "bidi override must be stripped");
        Assert.EndsWith(".pdf", name.Trim('"'));
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Contains("sandbox", response.Headers.GetValues("Content-Security-Policy").Single());
    }

    [Fact]
    public async Task Requester_cannot_upload_revisions()
    {
        var client = Factory.CreateApiClient();
        await client.StartDemoAsync(); // starts as the requester persona
        var doc = await client.FindDocumentAsync("MCC", "MCC-S-201");
        var response = await client.UploadRevisionAsync(doc.GetProperty("id").GetGuid(), "x.pdf", SmallPdf("x"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
