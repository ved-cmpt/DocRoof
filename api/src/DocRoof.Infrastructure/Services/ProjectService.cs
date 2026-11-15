using DocRoof.Domain;
using DocRoof.Domain.Entities;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DocRoof.Infrastructure.Services;

public sealed class ProjectService(DocRoofDbContext db, ICurrentUser user, IProjectAccessService access, AuditWriter audit, TimeProvider clock)
{
    public async Task<IReadOnlyList<ProjectSummaryDto>> ListAsync(CancellationToken ct)
    {
        var userId = user.UserId;
        var tenantId = user.TenantId;
        var now = clock.GetUtcNow().UtcDateTime;
        var openRfi = new[] { RfiState.Submitted, RfiState.Assigned, RfiState.Answered, RfiState.Reopened };
        var openSub = new[] { SubmittalStatus.Submitted, SubmittalStatus.InReview };
        return await db.ProjectMemberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.Project!.TenantId == tenantId)
            .OrderBy(m => m.Project!.Title)
            .Select(m => new ProjectSummaryDto(
                m.ProjectId, m.Project!.Code, m.Project.Title, m.Project.Description, m.Project.Location, m.Role,
                db.Documents.Count(d => d.ProjectId == m.ProjectId),
                db.Rfis.Count(r => r.ProjectId == m.ProjectId && openRfi.Contains(r.State)),
                db.Submittals.Count(s => s.ProjectId == m.ProjectId && openSub.Contains(s.Status)),
                db.Rfis.Count(r => r.ProjectId == m.ProjectId && openRfi.Contains(r.State) && r.DueAt < now) +
                db.Submittals.Count(s => s.ProjectId == m.ProjectId && openSub.Contains(s.Status) && s.DueAt < now)))
            .ToListAsync(ct);
    }

    public async Task<ProjectDetailDto> GetAsync(Guid projectId, CancellationToken ct)
    {
        var acc = await access.RequireProjectAsync(projectId, ct);
        var project = await db.Projects.AsNoTracking().FirstAsync(p => p.Id == projectId, ct);
        var members = await MembersAsync(projectId, ct);
        return new ProjectDetailDto(project.Id, project.Code, project.Title, project.Description, project.Location, acc.Role, members);
    }

    public async Task<IReadOnlyList<MemberDto>> MembersAsync(Guid projectId, CancellationToken ct) =>
        await (from m in db.ProjectMemberships.AsNoTracking()
               join u in db.Users.AsNoTracking() on m.UserId equals u.Id
               where m.ProjectId == projectId
               orderby m.Role, u.DisplayName
               select new MemberDto(u.Id, u.DisplayName, u.JobTitle, m.Role)).ToListAsync(ct);

    public async Task<ProjectDetailDto> CreateAsync(CreateProjectRequest req, CancellationToken ct)
    {
        var tenantId = user.TenantId;
        var userId = user.UserId;
        var code = req.Code.Trim().ToUpperInvariant();
        if (await db.Projects.AnyAsync(p => p.TenantId == tenantId && p.Code == code, ct))
        {
            throw new ConflictException($"Project code {code} is already in use.");
        }

        if (await db.Projects.CountAsync(p => p.TenantId == tenantId, ct) >= 20)
        {
            throw new ConflictException("This workspace has reached its project limit.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var project = new Project
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Code = code,
            Title = req.Title.Trim(),
            Description = req.Description.Trim(),
            Location = req.Location.Trim(),
            CreatedAt = now,
        };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Projects.Add(project);
        db.ProjectMemberships.Add(new ProjectMembership
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            UserId = userId,
            Role = ProjectRole.ProjectManager,
            CreatedAt = now,
        });
        audit.Add(tenantId, project.Id, userId, ResourceType.Project, project.Id, "project.created", after: new { project.Code, project.Title });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(project.Id, ct);
    }
}
