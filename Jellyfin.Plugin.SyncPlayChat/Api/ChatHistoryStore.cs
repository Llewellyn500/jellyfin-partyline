using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace Jellyfin.Plugin.SyncPlayChat.Api;

/// <summary>
/// Keeps a small, process-local history for each SyncPlay group.
/// </summary>
public sealed class ChatHistoryStore
{
    private const int MaximumMessagesPerGroup = 100;
    private readonly ConcurrentDictionary<Guid, List<SyncPlayChatMessage>> _messages = new();
    private long _nextId;

    /// <summary>
    /// Adds a message to a group's bounded history.
    /// </summary>
    /// <param name="groupId">The SyncPlay group identifier.</param>
    /// <param name="userId">The authenticated sender identifier.</param>
    /// <param name="senderName">The sender display name.</param>
    /// <param name="text">The message body.</param>
    /// <returns>The stored message.</returns>
    public SyncPlayChatMessage Add(Guid groupId, Guid userId, string senderName, string text)
    {
        var message = new SyncPlayChatMessage
        {
            Id = Interlocked.Increment(ref _nextId),
            SenderUserId = userId,
            SenderName = senderName,
            Text = text,
            SentAt = DateTimeOffset.UtcNow
        };
        var messages = _messages.GetOrAdd(groupId, static _ => []);

        lock (messages)
        {
            messages.Add(message);
            if (messages.Count > MaximumMessagesPerGroup)
            {
                messages.RemoveRange(0, messages.Count - MaximumMessagesPerGroup);
            }
        }

        return message;
    }

    /// <summary>
    /// Gets a snapshot of a group's recent messages.
    /// </summary>
    /// <param name="groupId">The SyncPlay group identifier.</param>
    /// <returns>The recent messages.</returns>
    public IReadOnlyList<SyncPlayChatMessage> Get(Guid groupId)
    {
        if (!_messages.TryGetValue(groupId, out var messages))
        {
            return [];
        }

        lock (messages)
        {
            return messages.ToArray();
        }
    }
}
