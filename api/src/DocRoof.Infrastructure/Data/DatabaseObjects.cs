namespace DocRoof.Infrastructure.Data;

/// <summary>Hand-written T-SQL objects created by migrations. Documented in docs/DATABASE.md.</summary>
public static class DatabaseObjects
{
    /// <summary>
    /// Third line of defence for revision immutability: any UPDATE that touches a content column fails, even when
    /// issued outside the application (ad-hoc SQL, another service). Only approval-status columns may change.
    /// </summary>
    public const string CreateRevisionTrigger = """
        CREATE TRIGGER dbo.trg_DocumentRevisions_Immutable ON dbo.DocumentRevisions
        AFTER UPDATE
        AS
        BEGIN
            SET NOCOUNT ON;
            IF UPDATE(DocumentId) OR UPDATE(VersionLabel) OR UPDATE(StorageKey) OR UPDATE(Sha256) OR UPDATE(FileName)
               OR UPDATE(MimeType) OR UPDATE(ByteSize) OR UPDATE(PageCount) OR UPDATE(HasTextLayer)
               OR UPDATE(HasActiveContent) OR UPDATE(ChangeNote) OR UPDATE(UploadedById) OR UPDATE(UploadedAt)
               OR UPDATE(SupersedesRevisionId)
            BEGIN
                THROW 51001, 'DocumentRevisions content columns are immutable.', 1;
            END
        END
        """;

    /// <summary>Audit rows are append-only: UPDATE is always rejected. (DELETE is only used when purging an expired guest tenant.)</summary>
    public const string CreateAuditTrigger = """
        CREATE TRIGGER dbo.trg_AuditEvents_AppendOnly ON dbo.AuditEvents
        AFTER UPDATE
        AS
        BEGIN
            SET NOCOUNT ON;
            THROW 51002, 'AuditEvents are append-only.', 1;
        END
        """;

    /// <summary>
    /// Review queue: every open RFI and submittal with assignee, due date and overdue flag. Both branches are served
    /// by the (ProjectId, State/Status, DueAt) INCLUDE (assignee) indexes, so filtering by project and state is a seek.
    /// The overdue flag is computed in SQL against SYSUTCDATETIME() so every consumer uses the same clock.
    /// </summary>
    public const string CreateReviewQueueView = """
        CREATE VIEW dbo.vw_ReviewQueue
        AS
        SELECT CAST('Rfi' AS nvarchar(20))          AS ItemType,
               r.Id                                 AS ItemId,
               r.ProjectId,
               p.TenantId,
               r.ReferenceNumber                    AS Reference,
               r.Subject                            AS Title,
               CAST(r.State AS varchar(40))         AS State,
               r.AssigneeId,
               r.DueAt,
               CAST(d.Discipline AS varchar(40))    AS Discipline,
               CAST(CASE WHEN r.DueAt < SYSUTCDATETIME() THEN 1 ELSE 0 END AS bit) AS IsOverdue,
               CASE WHEN r.DueAt < SYSUTCDATETIME() THEN DATEDIFF(day, r.DueAt, SYSUTCDATETIME()) END AS DaysOverdue
        FROM dbo.Rfis r
        JOIN dbo.Projects p ON p.Id = r.ProjectId
        JOIN dbo.DocumentRevisions rev ON rev.Id = r.SourceRevisionId
        JOIN dbo.Documents d ON d.Id = rev.DocumentId
        WHERE r.State IN ('Submitted', 'Assigned', 'Answered', 'Reopened')
        UNION ALL
        SELECT CAST('Submittal' AS nvarchar(20)),
               s.Id,
               s.ProjectId,
               p.TenantId,
               s.Number,
               s.Title,
               CAST(s.Status AS varchar(40)),
               s.AssignedReviewerId,
               s.DueAt,
               CAST(d.Discipline AS varchar(40)),
               CAST(CASE WHEN s.DueAt < SYSUTCDATETIME() THEN 1 ELSE 0 END AS bit),
               CASE WHEN s.DueAt < SYSUTCDATETIME() THEN DATEDIFF(day, s.DueAt, SYSUTCDATETIME()) END
        FROM dbo.Submittals s
        JOIN dbo.Projects p ON p.Id = s.ProjectId
        JOIN dbo.Documents d ON d.Id = s.DocumentId
        WHERE s.Status IN ('Submitted', 'InReview');
        """;

    public const string DropAll = """
        DROP VIEW IF EXISTS dbo.vw_ReviewQueue;
        DROP TRIGGER IF EXISTS dbo.trg_AuditEvents_AppendOnly;
        DROP TRIGGER IF EXISTS dbo.trg_DocumentRevisions_Immutable;
        """;
}
