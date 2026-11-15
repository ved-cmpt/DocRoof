using DocRoof.Domain;
using DocRoof.Domain.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace DocRoof.Infrastructure.Data;

/// <summary>Identity user. Every user belongs to exactly one tenant; project roles come from memberships.</summary>
public class AppUser : IdentityUser<Guid>
{
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string DisplayName { get; set; } = "";

    /// <summary>Stable persona key inside a tenant (controller, manager, reviewer, ...). Used by the guest persona switcher.</summary>
    public string? PersonaKey { get; set; }

    public string JobTitle { get; set; } = "";
}

public class DocRoofDbContext(DbContextOptions<DocRoofDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public const string RevisionTrigger = "trg_DocumentRevisions_Immutable";
    public const string AuditTrigger = "trg_AuditEvents_AppendOnly";
    public const string ReviewQueueView = "vw_ReviewQueue";

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMembership> ProjectMemberships => Set<ProjectMembership>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentRevision> DocumentRevisions => Set<DocumentRevision>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();
    public DbSet<Rfi> Rfis => Set<Rfi>();
    public DbSet<RfiResponse> RfiResponses => Set<RfiResponse>();
    public DbSet<Submittal> Submittals => Set<Submittal>();
    public DbSet<ReviewDecision> ReviewDecisions => Set<ReviewDecision>();
    public DbSet<ExtractionSuggestion> ExtractionSuggestions => Set<ExtractionSuggestion>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ReviewQueueItem> ReviewQueue => Set<ReviewQueueItem>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>().HaveColumnType("datetime2(3)");
        configurationBuilder.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeConverter>().HaveColumnType("datetime2(3)");
        Enum<ProjectRole>(configurationBuilder);
        Enum<DocumentStatus>(configurationBuilder);
        Enum<Discipline>(configurationBuilder);
        Enum<DocumentCategory>(configurationBuilder);
        Enum<RevisionApprovalStatus>(configurationBuilder);
        Enum<RfiState>(configurationBuilder);
        Enum<RfiResponseStatus>(configurationBuilder);
        Enum<SubmittalStatus>(configurationBuilder);
        Enum<ReviewDecisionType>(configurationBuilder);
        Enum<ExtractionField>(configurationBuilder);
        Enum<ConfidenceLabel>(configurationBuilder);
        Enum<SuggestionStatus>(configurationBuilder);
        Enum<ResourceType>(configurationBuilder);
        Enum<NotificationKind>(configurationBuilder);
    }

    private static void Enum<T>(ModelConfigurationBuilder b)
        where T : struct, Enum =>
        b.Properties<T>().HaveConversion<string>().HaveMaxLength(40).AreUnicode(false);

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<AppUser>(e =>
        {
            e.Property(u => u.DisplayName).HasMaxLength(120);
            e.Property(u => u.PersonaKey).HasMaxLength(40);
            e.Property(u => u.JobTitle).HasMaxLength(120);
            e.HasOne(u => u.Tenant).WithMany().HasForeignKey(u => u.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(u => new { u.TenantId, u.PersonaKey });
        });

        builder.Entity<Tenant>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(200);
            e.Property(t => t.CreatedByIpHash).HasMaxLength(64).IsUnicode(false);
            e.HasIndex(t => new { t.IsGuest, t.ExpiresAt });
            e.HasIndex(t => new { t.CreatedByIpHash, t.CreatedAt });
        });

        builder.Entity<Project>(e =>
        {
            e.Property(p => p.Code).HasMaxLength(20);
            e.Property(p => p.Title).HasMaxLength(200);
            e.Property(p => p.Description).HasMaxLength(2000);
            e.Property(p => p.Location).HasMaxLength(200);
            e.HasIndex(p => new { p.TenantId, p.Code }).IsUnique();
            e.HasOne(p => p.Tenant).WithMany().HasForeignKey(p => p.TenantId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<ProjectMembership>(e =>
        {
            e.ToTable(t => t.HasCheckConstraint("CK_ProjectMemberships_Role", $"[Role] IN ({EnumNames.SqlList<ProjectRole>()})"));
            e.HasIndex(m => new { m.ProjectId, m.UserId }).IsUnique();
            e.HasIndex(m => m.UserId);
            e.HasOne(m => m.Project).WithMany(p => p.Memberships).HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Document>(e =>
        {
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_Documents_Status", $"[Status] IN ({EnumNames.SqlList<DocumentStatus>()})");
                t.HasCheckConstraint("CK_Documents_Discipline", $"[Discipline] IN ({EnumNames.SqlList<Discipline>()})");
                t.HasCheckConstraint("CK_Documents_Category", $"[Category] IN ({EnumNames.SqlList<DocumentCategory>()})");
            });
            e.Property(d => d.DocumentNumber).HasMaxLength(60);
            e.Property(d => d.Title).HasMaxLength(300);
            e.Property(d => d.SpecSection).HasMaxLength(20);
            e.Property(d => d.IssueDate).HasColumnType("date");
            e.Property(d => d.RowVersion).IsRowVersion();
            e.HasIndex(d => new { d.ProjectId, d.DocumentNumber }).IsUnique();
            e.HasIndex(d => new { d.ProjectId, d.Discipline, d.Status });
            e.HasIndex(d => new { d.ProjectId, d.UpdatedAt });
            e.HasOne(d => d.Project).WithMany().HasForeignKey(d => d.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(d => d.CurrentRevision).WithMany().HasForeignKey(d => d.CurrentRevisionId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(d => d.Revisions).WithOne(r => r.Document).HasForeignKey(r => r.DocumentId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(d => d.CreatedById).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<DocumentRevision>(e =>
        {
            e.ToTable(t =>
            {
                t.HasTrigger(RevisionTrigger);
                t.HasCheckConstraint("CK_DocumentRevisions_ApprovalStatus", $"[ApprovalStatus] IN ({EnumNames.SqlList<RevisionApprovalStatus>()})");
                t.HasCheckConstraint("CK_DocumentRevisions_ByteSize", "[ByteSize] >= 0");
                t.HasCheckConstraint("CK_DocumentRevisions_PageCount", "[PageCount] IS NULL OR [PageCount] > 0");
                t.HasCheckConstraint("CK_DocumentRevisions_Sha256", "LEN([Sha256]) = 64");
            });
            e.Property(r => r.VersionLabel).HasMaxLength(20);
            e.Property(r => r.StorageKey).HasMaxLength(200).IsUnicode(false);
            e.Property(r => r.Sha256).HasMaxLength(64).IsFixedLength().IsUnicode(false);
            e.Property(r => r.FileName).HasMaxLength(260);
            e.Property(r => r.MimeType).HasMaxLength(100).IsUnicode(false);
            e.Property(r => r.ChangeNote).HasMaxLength(1000);
            e.Property(r => r.RowVersion).IsRowVersion();
            e.HasIndex(r => new { r.DocumentId, r.VersionLabel }).IsUnique();
            e.HasIndex(r => r.StorageKey).IsUnique();
            e.HasIndex(r => r.UploadedAt);
            e.HasOne(r => r.SupersedesRevision).WithMany().HasForeignKey(r => r.SupersedesRevisionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(r => r.UploadedById).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<StoredFile>(e =>
        {
            e.HasKey(f => f.StorageKey);
            e.Property(f => f.StorageKey).HasMaxLength(200).IsUnicode(false);
            e.Property(f => f.Content).HasColumnType("varbinary(max)");
            e.HasIndex(f => f.TenantId);
        });

        builder.Entity<Rfi>(e =>
        {
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_Rfis_State", $"[State] IN ({EnumNames.SqlList<RfiState>()})");
                t.HasCheckConstraint("CK_Rfis_SourcePage", "[SourcePage] >= 1");
            });
            e.Property(r => r.ReferenceNumber).HasMaxLength(20);
            e.Property(r => r.Subject).HasMaxLength(300);
            e.Property(r => r.Question).HasMaxLength(4000);
            e.Property(r => r.ReopenReason).HasMaxLength(1000);
            e.Property(r => r.RowVersion).IsRowVersion();
            e.HasIndex(r => new { r.ProjectId, r.ReferenceNumber }).IsUnique();
            e.HasIndex(r => new { r.ProjectId, r.State, r.DueAt }).IncludeProperties(r => r.AssigneeId);
            e.HasIndex(r => new { r.AssigneeId, r.State });
            e.HasIndex(r => r.SourceRevisionId);
            e.HasOne(r => r.Project).WithMany().HasForeignKey(r => r.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(r => r.SourceRevision).WithMany().HasForeignKey(r => r.SourceRevisionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(r => r.AssigneeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(r => r.CreatedById).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(r => r.Responses).WithOne(x => x.Rfi).HasForeignKey(x => x.RfiId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<RfiResponse>(e =>
        {
            e.ToTable(t => t.HasCheckConstraint("CK_RfiResponses_Status", $"[Status] IN ({EnumNames.SqlList<RfiResponseStatus>()})"));
            e.Property(r => r.Answer).HasMaxLength(4000);
            e.Property(r => r.RejectionReason).HasMaxLength(1000);
            e.HasIndex(r => new { r.RfiId, r.CreatedAt });
            e.HasOne<AppUser>().WithMany().HasForeignKey(r => r.AuthorId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Submittal>(e =>
        {
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_Submittals_Status", $"[Status] IN ({EnumNames.SqlList<SubmittalStatus>()})");
                t.HasCheckConstraint("CK_Submittals_Cycle", "[Cycle] >= 1");
            });
            e.Property(s => s.Number).HasMaxLength(30);
            e.Property(s => s.Title).HasMaxLength(300);
            e.Property(s => s.SpecSection).HasMaxLength(20);
            e.Property(s => s.RowVersion).IsRowVersion();
            e.HasIndex(s => new { s.ProjectId, s.Number }).IsUnique();
            e.HasIndex(s => new { s.ProjectId, s.Status, s.DueAt }).IncludeProperties(s => s.AssignedReviewerId);
            e.HasIndex(s => new { s.AssignedReviewerId, s.Status });
            e.HasOne(s => s.Project).WithMany().HasForeignKey(s => s.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(s => s.Document).WithMany().HasForeignKey(s => s.DocumentId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(s => s.Revision).WithMany().HasForeignKey(s => s.RevisionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(s => s.AssignedReviewerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(s => s.SubmittedById).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(s => s.Decisions).WithOne(d => d.Submittal).HasForeignKey(d => d.SubmittalId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<ReviewDecision>(e =>
        {
            e.ToTable(t => t.HasCheckConstraint("CK_ReviewDecisions_Decision", $"[Decision] IN ({EnumNames.SqlList<ReviewDecisionType>()})"));
            e.Property(d => d.Comments).HasMaxLength(4000);
            e.HasIndex(d => new { d.SubmittalId, d.Cycle }).IsUnique();
            e.HasOne<DocumentRevision>().WithMany().HasForeignKey(d => d.RevisionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(d => d.ReviewerId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<ExtractionSuggestion>(e =>
        {
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_ExtractionSuggestions_Field", $"[Field] IN ({EnumNames.SqlList<ExtractionField>()})");
                t.HasCheckConstraint("CK_ExtractionSuggestions_Confidence", $"[ConfidenceLabel] IN ({EnumNames.SqlList<ConfidenceLabel>()})");
                t.HasCheckConstraint("CK_ExtractionSuggestions_Status", $"[Status] IN ({EnumNames.SqlList<SuggestionStatus>()})");
                t.HasCheckConstraint("CK_ExtractionSuggestions_Page", "[Page] >= 1");
            });
            e.Property(s => s.ProposedValue).HasMaxLength(500);
            e.Property(s => s.Snippet).HasMaxLength(500);
            e.Property(s => s.Rule).HasMaxLength(100);
            e.Property(s => s.Engine).HasMaxLength(40);
            e.Property(s => s.RowVersion).IsRowVersion();
            e.HasIndex(s => new { s.RevisionId, s.Status });
            e.HasOne(s => s.Revision).WithMany().HasForeignKey(s => s.RevisionId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Comment>(e =>
        {
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_Comments_Resource", "[Resource] IN ('Document', 'Rfi', 'Submittal')");
                t.HasCheckConstraint("CK_Comments_Page", "[Page] IS NULL OR [Page] >= 1");
            });
            e.Property(c => c.Body).HasMaxLength(4000);
            e.HasIndex(c => new { c.Resource, c.ResourceId, c.CreatedAt });
            e.HasIndex(c => c.ProjectId);
            e.HasOne<Project>().WithMany().HasForeignKey(c => c.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<AppUser>().WithMany().HasForeignKey(c => c.AuthorId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<AuditEvent>(e =>
        {
            e.ToTable(t => t.HasTrigger(AuditTrigger));
            e.Property(a => a.Action).HasMaxLength(60).IsUnicode(false);
            e.Property(a => a.ChangeJson).HasColumnType("nvarchar(max)");
            e.HasIndex(a => new { a.ProjectId, a.Timestamp });
            e.HasIndex(a => new { a.Resource, a.ResourceId, a.Timestamp });
            e.HasIndex(a => new { a.TenantId, a.Timestamp });
        });

        builder.Entity<Notification>(e =>
        {
            e.ToTable(t => t.HasCheckConstraint("CK_Notifications_Kind", $"[Kind] IN ({EnumNames.SqlList<NotificationKind>()})"));
            e.Property(n => n.Message).HasMaxLength(500);
            e.Property(n => n.DedupeKey).HasMaxLength(200).IsUnicode(false);
            e.HasIndex(n => new { n.RecipientId, n.ViewedAt, n.CreatedAt });
            e.HasIndex(n => n.DedupeKey).IsUnique().HasFilter("[DedupeKey] IS NOT NULL");
            e.HasOne<AppUser>().WithMany().HasForeignKey(n => n.RecipientId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Project>().WithMany().HasForeignKey(n => n.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<ReviewQueueItem>(e =>
        {
            e.HasNoKey();
            e.ToView(ReviewQueueView);
            e.Property(q => q.ItemType).HasMaxLength(20);
        });
    }
}

public sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

public sealed class NullableUtcDateTimeConverter() : ValueConverter<DateTime?, DateTime?>(
    v => v.HasValue ? (v.Value.Kind == DateTimeKind.Utc ? v.Value : v.Value.ToUniversalTime()) : v,
    v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
