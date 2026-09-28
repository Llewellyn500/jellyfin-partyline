using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

#pragma warning disable SA1611 // Public method summaries describe the compact identity parameter set.
#pragma warning disable SA1615 // Public method summaries describe their results.

namespace Jellyfin.Plugin.Partyline.Voice;

/// <summary>
/// Thread-safe, in-memory voice presence and signaling store.
/// </summary>
public sealed class VoiceRoomManager
{
    /// <summary>The mesh architecture hard limit.</summary>
    public const int MaximumParticipants = 10;

    private static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan LongPollTimeout = TimeSpan.FromSeconds(25);
    private readonly Lock _sync = new();
    private readonly Dictionary<Guid, Room> _rooms = [];

    /// <summary>
    /// Atomically joins a room, or refreshes the existing identity's presence.
    /// </summary>
    /// <exception cref="InvalidOperationException">The room is full.</exception>
    public VoiceJoinResult Join(Guid groupId, Guid userId, string sessionId, string displayName)
    {
        lock (_sync)
        {
            CleanupExpiredLocked(DateTimeOffset.UtcNow);
            RemoveIdentityFromOtherRoomsLocked(groupId, userId, sessionId);
            Room room = GetOrCreateRoomLocked(groupId);
            VoiceParticipant? existing = room.Participants.Values.FirstOrDefault(p => IsIdentity(p, userId, sessionId));
            if (existing is not null)
            {
                existing.LastHeartbeat = DateTimeOffset.UtcNow;
                return CreateJoinResult(room, existing);
            }

            if (room.Participants.Count >= MaximumParticipants)
            {
                throw new InvalidOperationException("Voice chat is full. Maximum 10 participants.");
            }

            var participant = new VoiceParticipant
            {
                ParticipantId = Guid.NewGuid().ToString("N"),
                JellyfinUserId = userId,
                JellyfinSessionId = sessionId,
                DisplayName = displayName,
                LastHeartbeat = DateTimeOffset.UtcNow
            };

            VoiceParticipant[] existingParticipants = room.Participants.Values.ToArray();
            room.Participants.Add(participant.ParticipantId, participant);
            foreach (VoiceParticipant target in existingParticipants)
            {
                AddEventLocked(room, participant.ParticipantId, target.ParticipantId, "peer-joined", JsonSerializer.SerializeToElement(participant));
            }

            return CreateJoinResult(room, participant);
        }
    }

    /// <summary>
    /// Removes an identity from voice. The operation is idempotent.
    /// </summary>
    public void Leave(Guid userId, string sessionId)
    {
        lock (_sync)
        {
            foreach (Room room in _rooms.Values.ToArray())
            {
                VoiceParticipant? participant = room.Participants.Values.FirstOrDefault(p => IsIdentity(p, userId, sessionId));
                if (participant is not null)
                {
                    RemoveParticipantLocked(room, participant);
                }
            }
        }
    }

    /// <summary>
    /// Refreshes presence and returns the authoritative participant list.
    /// </summary>
    public IReadOnlyList<VoiceParticipant> Heartbeat(Guid groupId, Guid userId, string sessionId, string participantId)
    {
        lock (_sync)
        {
            CleanupExpiredLocked(DateTimeOffset.UtcNow);
            VoiceParticipant participant = GetAuthorizedParticipantLocked(groupId, userId, sessionId, participantId);
            participant.LastHeartbeat = DateTimeOffset.UtcNow;
            return _rooms[groupId].Participants.Values.Select(ClonePublic).ToArray();
        }
    }

    /// <summary>
    /// Queues an authorized signal for one participant in the same room.
    /// </summary>
    public void Signal(Guid groupId, Guid userId, string sessionId, string senderId, string targetId, string type, JsonElement payload)
    {
        lock (_sync)
        {
            CleanupExpiredLocked(DateTimeOffset.UtcNow);
            _ = GetAuthorizedParticipantLocked(groupId, userId, sessionId, senderId);
            Room room = _rooms[groupId];
            if (!room.Participants.ContainsKey(targetId))
            {
                throw new KeyNotFoundException("Target voice participant was not found in this SyncPlay group.");
            }

            AddEventLocked(room, senderId, targetId, type, payload.Clone());
        }
    }

    /// <summary>
    /// Long-polls events addressed to an authorized participant.
    /// </summary>
    public async Task<IReadOnlyList<VoiceEvent>> GetEventsAsync(
        Guid groupId,
        Guid userId,
        string sessionId,
        string participantId,
        long cursor,
        CancellationToken cancellationToken)
    {
        Task changed;
        lock (_sync)
        {
            CleanupExpiredLocked(DateTimeOffset.UtcNow);
            _ = GetAuthorizedParticipantLocked(groupId, userId, sessionId, participantId);
            VoiceEvent[] ready = GetEventsLocked(_rooms[groupId], participantId, cursor);
            if (ready.Length > 0)
            {
                return ready;
            }

            changed = _rooms[groupId].Changed.Task;
        }

        Task timeout = Task.Delay(LongPollTimeout, cancellationToken);
        _ = await Task.WhenAny(changed, timeout).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        lock (_sync)
        {
            CleanupExpiredLocked(DateTimeOffset.UtcNow);
            _ = GetAuthorizedParticipantLocked(groupId, userId, sessionId, participantId);
            return GetEventsLocked(_rooms[groupId], participantId, cursor);
        }
    }

    private static bool IsIdentity(VoiceParticipant participant, Guid userId, string sessionId)
        => participant.JellyfinUserId == userId && string.Equals(participant.JellyfinSessionId, sessionId, StringComparison.Ordinal);

    private static VoiceParticipant ClonePublic(VoiceParticipant participant)
        => new() { ParticipantId = participant.ParticipantId, DisplayName = participant.DisplayName };

    private static VoiceJoinResult CreateJoinResult(Room room, VoiceParticipant participant)
        => new()
        {
            GroupId = room.GroupId,
            Participant = ClonePublic(participant),
            Participants = room.Participants.Values.Where(p => p.ParticipantId != participant.ParticipantId).Select(ClonePublic).ToArray(),
            Cursor = room.NextEventId
        };

    private static VoiceEvent[] GetEventsLocked(Room room, string participantId, long cursor)
        => room.Events.Where(e => e.EventId > cursor && e.TargetParticipantId == participantId).Take(100).ToArray();

    private Room GetOrCreateRoomLocked(Guid groupId)
    {
        if (!_rooms.TryGetValue(groupId, out Room? room))
        {
            room = new Room(groupId);
            _rooms.Add(groupId, room);
        }

        return room;
    }

    private VoiceParticipant GetAuthorizedParticipantLocked(Guid groupId, Guid userId, string sessionId, string participantId)
    {
        if (!_rooms.TryGetValue(groupId, out Room? room)
            || !room.Participants.TryGetValue(participantId, out VoiceParticipant? participant)
            || !IsIdentity(participant, userId, sessionId))
        {
            throw new UnauthorizedAccessException("Voice participant is not authorized for this SyncPlay group.");
        }

        return participant;
    }

    private void AddEventLocked(Room room, string senderId, string targetId, string type, JsonElement payload)
    {
        room.Events.Add(new VoiceEvent
        {
            EventId = ++room.NextEventId,
            SenderParticipantId = senderId,
            TargetParticipantId = targetId,
            Type = type,
            Payload = payload,
            Timestamp = DateTimeOffset.UtcNow
        });

        if (room.Events.Count > 256)
        {
            room.Events.RemoveRange(0, room.Events.Count - 256);
        }

        TaskCompletionSource<bool> previous = room.Changed;
        room.Changed = NewSignal();
        previous.TrySetResult(true);
    }

    private void RemoveIdentityFromOtherRoomsLocked(Guid groupId, Guid userId, string sessionId)
    {
        foreach (Room room in _rooms.Values.Where(r => r.GroupId != groupId).ToArray())
        {
            VoiceParticipant? participant = room.Participants.Values.FirstOrDefault(p => IsIdentity(p, userId, sessionId));
            if (participant is not null)
            {
                RemoveParticipantLocked(room, participant);
            }
        }
    }

    private void CleanupExpiredLocked(DateTimeOffset now)
    {
        foreach (Room room in _rooms.Values.ToArray())
        {
            foreach (VoiceParticipant participant in room.Participants.Values.Where(p => now - p.LastHeartbeat > StaleAfter).ToArray())
            {
                RemoveParticipantLocked(room, participant);
            }
        }
    }

    private void RemoveParticipantLocked(Room room, VoiceParticipant participant)
    {
        if (!room.Participants.Remove(participant.ParticipantId))
        {
            return;
        }

        foreach (VoiceParticipant target in room.Participants.Values)
        {
            AddEventLocked(room, participant.ParticipantId, target.ParticipantId, "peer-left", JsonSerializer.SerializeToElement(participant.ParticipantId));
        }

        if (room.Participants.Count == 0)
        {
            _rooms.Remove(room.GroupId);
        }
    }

    private static TaskCompletionSource<bool> NewSignal()
        => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class Room
    {
        public Room(Guid groupId)
        {
            GroupId = groupId;
        }

        public Guid GroupId { get; }

        public Dictionary<string, VoiceParticipant> Participants { get; } = new(StringComparer.Ordinal);

        public List<VoiceEvent> Events { get; } = [];

        public long NextEventId { get; set; }

        public TaskCompletionSource<bool> Changed { get; set; } = NewSignal();
    }
}
