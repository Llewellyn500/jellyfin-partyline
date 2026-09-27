using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.SyncPlayChat.Configuration;

/// <summary>
/// SyncPlay Chat plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PluginConfiguration"/> class.
    /// </summary>
    public PluginConfiguration()
    {
        EnableVoiceChat = true;
        StunUrl = "stun:stun.l.google.com:19302";
        TurnCredentialLifetimeMinutes = 60;
    }

    /// <summary>
    /// Gets or sets a value indicating whether voice chat is enabled.
    /// </summary>
    public bool EnableVoiceChat { get; set; }

    /// <summary>
    /// Gets or sets comma-separated STUN URLs.
    /// </summary>
    public string StunUrl { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether TURN is enabled.
    /// </summary>
    public bool EnableTurn { get; set; }

    /// <summary>
    /// Gets or sets comma-separated TURN URLs, normally UDP and TCP.
    /// </summary>
    public string? TurnUrl { get; set; }

    /// <summary>
    /// Gets or sets comma-separated TURN TLS URLs.
    /// </summary>
    public string? TurnTlsUrl { get; set; }

    /// <summary>
    /// Gets or sets the coturn REST API shared secret. It is never sent to clients.
    /// </summary>
    public string? TurnSharedSecret { get; set; }

    /// <summary>
    /// Gets or sets the temporary TURN credential lifetime in minutes.
    /// </summary>
    public int TurnCredentialLifetimeMinutes { get; set; }
}
