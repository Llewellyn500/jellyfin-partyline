using System;

namespace Jellyfin.Plugin.SyncPlayChat.Api;

/// <summary>
/// A recent SyncPlay chat message.
/// </summary>
public sealed class SyncPlayChatMessage
{
    /// <summary>Gets or sets the server-assigned message identifier.</summary>
    public long Id { get; set; }

    /// <summary>Gets or sets the authenticated sender identifier.</summary>
    public Guid SenderUserId { get; set; }

    /// <summary>Gets or sets the sender display name.</summary>
    public string SenderName { get; set; } = string.Empty;

    /// <summary>Gets or sets the message body.</summary>
    public string Text { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC send time.</summary>
    public DateTimeOffset SentAt { get; set; }
}
