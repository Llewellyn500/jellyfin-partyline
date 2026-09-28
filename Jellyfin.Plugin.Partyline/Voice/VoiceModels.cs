using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable SA1402 // Related wire DTOs are intentionally kept together.
#pragma warning disable SA1649 // This file contains the small voice wire model set.

namespace Jellyfin.Plugin.Partyline.Voice;

/// <summary>
/// A participant in a SyncPlay voice room.
/// </summary>
public sealed class VoiceParticipant
{
    /// <summary>Gets or sets the server-generated participant identifier.</summary>
    [JsonPropertyName("participantId")]
    public string ParticipantId { get; set; } = string.Empty;

    /// <summary>Gets or sets the authenticated Jellyfin user identifier.</summary>
    [JsonIgnore]
    public Guid JellyfinUserId { get; set; }

    /// <summary>Gets or sets the authenticated Jellyfin session identifier.</summary>
    [JsonIgnore]
    public string JellyfinSessionId { get; set; } = string.Empty;

    /// <summary>Gets or sets the display name.</summary>
    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Gets or sets the last heartbeat time.</summary>
    [JsonIgnore]
    public DateTimeOffset LastHeartbeat { get; set; }
}

/// <summary>
/// A signaling event addressed to one voice participant.
/// </summary>
public sealed class VoiceEvent
{
    /// <summary>Gets or sets the room-local event cursor.</summary>
    [JsonPropertyName("eventId")]
    public long EventId { get; set; }

    /// <summary>Gets or sets the server-authorized sender identifier.</summary>
    [JsonPropertyName("senderParticipantId")]
    public string SenderParticipantId { get; set; } = string.Empty;

    /// <summary>Gets or sets the target identifier.</summary>
    [JsonPropertyName("targetParticipantId")]
    public string TargetParticipantId { get; set; } = string.Empty;

    /// <summary>Gets or sets the signaling type.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    /// <summary>Gets or sets the signaling payload.</summary>
    [JsonPropertyName("payload")]
    public JsonElement Payload { get; set; }

    /// <summary>Gets or sets the event creation time.</summary>
    [JsonPropertyName("timestamp")]
    public DateTimeOffset Timestamp { get; set; }
}

/// <summary>
/// Result of joining or reconciling a voice room.
/// </summary>
public sealed class VoiceJoinResult
{
    /// <summary>Gets or sets the authoritative SyncPlay group identifier.</summary>
    [JsonPropertyName("groupId")]
    public Guid GroupId { get; set; }

    /// <summary>Gets or sets the caller's voice participant.</summary>
    [JsonPropertyName("participant")]
    public VoiceParticipant Participant { get; set; } = new();

    /// <summary>Gets or sets all other current voice participants.</summary>
    [JsonPropertyName("participants")]
    public IReadOnlyList<VoiceParticipant> Participants { get; set; } = [];

    /// <summary>Gets or sets the initial event cursor.</summary>
    [JsonPropertyName("cursor")]
    public long Cursor { get; set; }
}

/// <summary>
/// Voice eligibility for the authenticated Jellyfin session.
/// </summary>
public sealed class VoiceEligibilityResult
{
    /// <summary>Gets or sets the authoritative SyncPlay group identifier.</summary>
    [JsonPropertyName("groupId")]
    public Guid GroupId { get; set; }
}

/// <summary>
/// Browser request containing its claimed Jellyfin session for server validation.
/// </summary>
public class VoiceSessionRequest
{
    /// <summary>Gets or sets the Jellyfin session identifier.</summary>
    public string? SessionId { get; set; }
}

/// <summary>
/// Browser heartbeat request.
/// </summary>
public class VoiceHeartbeatRequest : VoiceSessionRequest
{
    /// <summary>Gets or sets the server-issued participant identifier.</summary>
    public string? ParticipantId { get; set; }
}

/// <summary>
/// Browser signaling request.
/// </summary>
public sealed class VoiceSignalRequest : VoiceHeartbeatRequest
{
    /// <summary>Gets or sets the intended target participant.</summary>
    public string? TargetParticipantId { get; set; }

    /// <summary>Gets or sets the signal type.</summary>
    public string? Type { get; set; }

    /// <summary>Gets or sets the opaque WebRTC signaling payload.</summary>
    public JsonElement Payload { get; set; }
}

/// <summary>
/// Browser ICE server configuration.
/// </summary>
public sealed class VoiceIceServer
{
    /// <summary>Gets or sets ICE URLs.</summary>
    [JsonPropertyName("urls")]
    public IReadOnlyList<string> Urls { get; set; } = [];

    /// <summary>Gets or sets the temporary TURN username.</summary>
    [JsonPropertyName("username")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Username { get; set; }

    /// <summary>Gets or sets the temporary TURN credential.</summary>
    [JsonPropertyName("credential")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Credential { get; set; }
}
