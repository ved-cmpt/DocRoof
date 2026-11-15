using DocRoof.Domain;
using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace DocRoof.Api.Controllers;

[ApiController]
public sealed class RfisController(RfiService rfis) : ControllerBase
{
    [HttpGet("api/projects/{projectId:guid}/rfis")]
    public Task<PagedResult<RfiListItemDto>> List(Guid projectId, [FromQuery] RfiQuery query, CancellationToken ct) => rfis.ListAsync(projectId, query, ct);

    [HttpPost("api/projects/{projectId:guid}/rfis")]
    public async Task<ActionResult<RfiDetailDto>> Create(Guid projectId, CreateRfiRequest request, CancellationToken ct)
    {
        var created = await rfis.CreateAsync(projectId, request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet("api/rfis/{id:guid}")]
    public Task<RfiDetailDto> Get(Guid id, CancellationToken ct) => rfis.GetAsync(id, ct);

    [HttpPost("api/rfis/{id:guid}/submit")]
    public Task<RfiDetailDto> Submit(Guid id, RowVersionRequest request, CancellationToken ct) => rfis.SubmitAsync(id, request, ct);

    [HttpPost("api/rfis/{id:guid}/assign")]
    public Task<RfiDetailDto> Assign(Guid id, AssignRfiRequest request, CancellationToken ct) => rfis.AssignAsync(id, request, ct);

    [HttpPost("api/rfis/{id:guid}/answer")]
    public Task<RfiDetailDto> Answer(Guid id, AnswerRfiRequest request, CancellationToken ct) => rfis.AnswerAsync(id, request, ct);

    [HttpPost("api/rfis/{id:guid}/approve-answer")]
    public Task<RfiDetailDto> ApproveAnswer(Guid id, RowVersionRequest request, CancellationToken ct) => rfis.ApproveAnswerAsync(id, request, ct);

    [HttpPost("api/rfis/{id:guid}/reject-answer")]
    public Task<RfiDetailDto> RejectAnswer(Guid id, ReasonRequest request, CancellationToken ct) => rfis.RejectAnswerAsync(id, request, ct);

    [HttpPost("api/rfis/{id:guid}/close")]
    public Task<RfiDetailDto> Close(Guid id, RowVersionRequest request, CancellationToken ct) => rfis.CloseAsync(id, request, ct);

    [HttpPost("api/rfis/{id:guid}/reopen")]
    public Task<RfiDetailDto> Reopen(Guid id, ReasonRequest request, CancellationToken ct) => rfis.ReopenAsync(id, request, ct);
}

[ApiController]
public sealed class SubmittalsController(SubmittalService submittals) : ControllerBase
{
    [HttpGet("api/projects/{projectId:guid}/submittals")]
    public Task<PagedResult<SubmittalListItemDto>> List(Guid projectId, [FromQuery] SubmittalQuery query, CancellationToken ct) =>
        submittals.ListAsync(projectId, query, ct);

    [HttpPost("api/projects/{projectId:guid}/submittals")]
    public async Task<ActionResult<SubmittalDetailDto>> Create(Guid projectId, CreateSubmittalRequest request, CancellationToken ct)
    {
        var created = await submittals.CreateAsync(projectId, request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet("api/submittals/{id:guid}")]
    public Task<SubmittalDetailDto> Get(Guid id, CancellationToken ct) => submittals.GetAsync(id, ct);

    [HttpPost("api/submittals/{id:guid}/start-review")]
    public Task<SubmittalDetailDto> StartReview(Guid id, RowVersionRequest request, CancellationToken ct) => submittals.StartReviewAsync(id, request, ct);

    [HttpPost("api/submittals/{id:guid}/decisions")]
    public Task<SubmittalDetailDto> Decide(Guid id, DecisionRequest request, CancellationToken ct) => submittals.DecideAsync(id, request, ct);

    [HttpPost("api/submittals/{id:guid}/finalize")]
    public Task<SubmittalDetailDto> Finalize(Guid id, RowVersionRequest request, CancellationToken ct) => submittals.FinalizeAsync(id, request, ct);

    [HttpPost("api/submittals/{id:guid}/resubmit")]
    public Task<SubmittalDetailDto> Resubmit(Guid id, ResubmitRequest request, CancellationToken ct) => submittals.ResubmitAsync(id, request, ct);
}

[ApiController]
public sealed class ActivityController(
    CommentService comments,
    AuditService audit,
    ReviewQueueService queue,
    NotificationService notifications,
    InsightsService insights) : ControllerBase
{
    [HttpGet("api/{resource:regex(^(documents|rfis|submittals)$)}/{id:guid}/comments")]
    public Task<IReadOnlyList<CommentDto>> Comments(string resource, Guid id, CancellationToken ct) => comments.ListAsync(Map(resource), id, ct);

    [HttpPost("api/{resource:regex(^(documents|rfis|submittals)$)}/{id:guid}/comments")]
    public async Task<ActionResult<CommentDto>> AddComment(string resource, Guid id, CreateCommentRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await comments.AddAsync(Map(resource), id, request, ct));

    [HttpGet("api/projects/{projectId:guid}/audit")]
    public Task<PagedResult<AuditEventDto>> Audit(Guid projectId, [FromQuery] AuditQuery query, CancellationToken ct) => audit.ListAsync(projectId, query, ct);

    [HttpGet("api/projects/{projectId:guid}/review-queue")]
    public Task<IReadOnlyList<ReviewQueueItemDto>> ReviewQueue(Guid projectId, [FromQuery] string? assignee, [FromQuery] bool overdueOnly, CancellationToken ct) =>
        queue.ListAsync(projectId, assignee, overdueOnly, ct);

    [HttpGet("api/projects/{projectId:guid}/insights")]
    public Task<InsightsDto> Insights(Guid projectId, CancellationToken ct) => insights.GetAsync(projectId, ct);

    [HttpGet("api/notifications")]
    public Task<NotificationFeedDto> Notifications(CancellationToken ct) => notifications.FeedAsync(ct);

    [HttpPost("api/notifications/{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        await notifications.MarkReadAsync(id, ct);
        return NoContent();
    }

    [HttpPost("api/notifications/read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken ct) => Ok(new { updated = await notifications.MarkAllReadAsync(ct) });

    private static ResourceType Map(string resource) => resource switch
    {
        "documents" => ResourceType.Document,
        "rfis" => ResourceType.Rfi,
        _ => ResourceType.Submittal,
    };
}
