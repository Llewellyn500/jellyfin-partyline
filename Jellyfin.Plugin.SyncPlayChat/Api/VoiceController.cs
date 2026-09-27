using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.SyncPlayChat.Voice;
using MediaBrowser.Controller.Session;
using MediaBrowser.Controller.SyncPlay;
using MediaBrowser.Controller.SyncPlay.Requests;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

#pragma warning disable SA1611 // Endpoint summaries and OpenAPI signatures describe request parameters.
#pragma warning disable SA1615 // ASP.NET action result semantics are documented by response metadata.

namespace Jellyfin.Plugin.SyncPlayChat.Api;

/// <summary>
/// Authenticated WebRTC presence and signaling endpoints. Media never passes through these endpoints.
/// </summary>
[ApiController]
[Route("SyncPlayChat/Voice")]
[Authorize]
public sealed class VoiceController : ControllerBase
{
    private static readonly HashSet<string> AllowedSignalTypes = new(StringComparer.Ordinal)
    {
        "offer",
        "answer",
        "ice-candidate",
        "ice-restart"
    };

    private readonly ISessionManager _sessionManager;
    private readonly ISyncPlayManager _syncPlayManager;
    private readonly VoiceRoomManager _rooms;
    private readonly TurnCredentialService _turnCredentials;

    /// <summary>
    /// Initializes a new instance of the <see cref="VoiceController"/> class.
    /// </summary>
    public VoiceController(
        ISessionManager sessionManager,
        ISyncPlayManager syncPlayManager,
        VoiceRoomManager rooms,
        TurnCredentialService turnCredentials)
    {
        _sessionManager = sessionManager;
        _syncPlayManager = syncPlayManager;
        _rooms = rooms;
        _turnCredentials = turnCredentials;
    }

    /// <summary>Checks voice availability and current SyncPlay membership before microphone access.</summary>
    [HttpGet("Eligibility")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<VoiceEligibilityResult> Eligibility([FromQuery] string sessionId)
    {
        Identity? identity = VoiceEnabled() ? ResolveIdentity(sessionId, true) : null;
        return identity is null
            ? Conflict("Join an active SyncPlay group before joining voice.")
            : Ok(new VoiceEligibilityResult { GroupId = identity.GroupId });
    }

    /// <summary>Joins or idempotently reconciles the caller's current SyncPlay voice room.</summary>
    [HttpPost("Join")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public ActionResult<VoiceJoinResult> Join([FromBody] VoiceSessionRequest request)
    {
        if (!VoiceEnabled())
        {
            return NotFound("Voice chat is disabled.");
        }

        Identity? identity = ResolveIdentity(request.SessionId, true);
        if (identity is null)
        {
            return Conflict("Join an active SyncPlay group before joining voice.");
        }

        try
        {
            return Ok(_rooms.Join(identity.GroupId, identity.UserId, identity.Session.Id, identity.Session.UserName ?? "Jellyfin user"));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    /// <summary>Leaves voice without leaving SyncPlay.</summary>
    [HttpPost("Leave")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult Leave([FromBody] VoiceSessionRequest request)
    {
        Identity? identity = ResolveIdentity(request.SessionId, false);
        if (identity is not null)
        {
            _rooms.Leave(identity.UserId, identity.Session.Id);
        }

        return NoContent();
    }

    /// <summary>Refreshes voice presence and returns the authoritative participant list.</summary>
    [HttpPost("Heartbeat")]
    public ActionResult<IReadOnlyList<VoiceParticipant>> Heartbeat([FromBody] VoiceHeartbeatRequest request)
    {
        Identity? identity = ResolveIdentity(request.SessionId, true);
        if (identity is null || string.IsNullOrWhiteSpace(request.ParticipantId))
        {
            return Conflict("The authenticated session is no longer in this SyncPlay voice room.");
        }

        try
        {
            return Ok(_rooms.Heartbeat(identity.GroupId, identity.UserId, identity.Session.Id, request.ParticipantId));
        }
        catch (UnauthorizedAccessException)
        {
            return Conflict("Voice presence expired; rejoin voice to continue.");
        }
    }

    /// <summary>Forwards an authorized WebRTC signal to one participant in the same SyncPlay group.</summary>
    [HttpPost("Signal")]
    [RequestSizeLimit(65536)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult Signal([FromBody] VoiceSignalRequest request)
    {
        Identity? identity = ResolveIdentity(request.SessionId, true);
        if (identity is null
            || string.IsNullOrWhiteSpace(request.ParticipantId)
            || string.IsNullOrWhiteSpace(request.TargetParticipantId)
            || string.IsNullOrWhiteSpace(request.Type)
            || request.Payload.ValueKind == JsonValueKind.Undefined
            || !AllowedSignalTypes.Contains(request.Type))
        {
            return BadRequest("Invalid or unauthorized voice signal.");
        }

        try
        {
            _rooms.Signal(
                identity.GroupId,
                identity.UserId,
                identity.Session.Id,
                request.ParticipantId,
                request.TargetParticipantId,
                request.Type,
                request.Payload);
            return NoContent();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(ex.Message);
        }
    }

    /// <summary>Long-polls WebRTC signaling events for approximately 25 seconds.</summary>
    [HttpGet("Events")]
    public async Task<ActionResult<IReadOnlyList<VoiceEvent>>> Events(
        [FromQuery] string sessionId,
        [FromQuery] string participantId,
        [FromQuery] long cursor = 0,
        CancellationToken cancellationToken = default)
    {
        Identity? identity = ResolveIdentity(sessionId, true);
        if (identity is null)
        {
            return Conflict("The authenticated session is no longer in this SyncPlay voice room.");
        }

        try
        {
            return Ok(await _rooms.GetEventsAsync(
                identity.GroupId,
                identity.UserId,
                identity.Session.Id,
                participantId,
                Math.Max(0, cursor),
                cancellationToken).ConfigureAwait(false));
        }
        catch (UnauthorizedAccessException)
        {
            return Conflict("Voice presence expired; rejoin voice to continue.");
        }
    }

    /// <summary>Returns STUN URLs and short-lived coturn credentials.</summary>
    [HttpGet("IceConfiguration")]
    public ActionResult<IReadOnlyList<VoiceIceServer>> IceConfiguration([FromQuery] string sessionId)
    {
        Identity? identity = ResolveIdentity(sessionId, true);
        if (identity is null || !VoiceEnabled())
        {
            return Conflict("The authenticated session is not eligible for voice.");
        }

        return Ok(_turnCredentials.Create(identity.UserId, identity.Session.Id, Plugin.Instance!.Configuration));
    }

    private bool VoiceEnabled() => Plugin.Instance?.Configuration.EnableVoiceChat == true;

    private Identity? ResolveIdentity(string? requestedSessionId, bool requireGroup)
    {
        Guid userId = ReadGuidClaim("Jellyfin-UserId");
        string deviceId = ReadClaim("Jellyfin-DeviceId");
        if (userId == Guid.Empty || string.IsNullOrWhiteSpace(deviceId))
        {
            return null;
        }

        SessionInfo? session = _sessionManager.Sessions
            .Where(s => s.UserId == userId && string.Equals(s.DeviceId, deviceId, StringComparison.Ordinal))
            .Where(s => string.IsNullOrWhiteSpace(requestedSessionId) || string.Equals(s.Id, requestedSessionId, StringComparison.Ordinal))
            .OrderByDescending(s => s.LastActivityDate)
            .FirstOrDefault();
        if (session is null)
        {
            return null;
        }

        Guid groupId = Guid.Empty;
        if (requireGroup)
        {
            groupId = _syncPlayManager.ListGroups(session, new ListGroupsRequest())
                .Where(group => group.Participants.Contains(session.Id, StringComparer.Ordinal))
                .Select(group => group.GroupId)
                .FirstOrDefault();
            if (groupId == Guid.Empty)
            {
                _rooms.Leave(userId, session.Id);
                return null;
            }
        }

        return new Identity(userId, session, groupId);
    }

    private string ReadClaim(string type)
        => User.Claims.FirstOrDefault(c => string.Equals(c.Type, type, StringComparison.OrdinalIgnoreCase))?.Value ?? string.Empty;

    private Guid ReadGuidClaim(string type)
        => Guid.TryParse(ReadClaim(type), out Guid value) ? value : Guid.Empty;

    private sealed record Identity(Guid UserId, SessionInfo Session, Guid GroupId);
}
