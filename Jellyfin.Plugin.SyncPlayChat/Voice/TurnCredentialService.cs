using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.SyncPlayChat.Configuration;

#pragma warning disable SA1611 // The method signature is self-describing and documented as a unit.
#pragma warning disable SA1615 // The method summary documents the returned ICE configuration.

namespace Jellyfin.Plugin.SyncPlayChat.Voice;

/// <summary>
/// Builds browser ICE configuration and coturn REST API credentials.
/// </summary>
public sealed class TurnCredentialService
{
    /// <summary>
    /// Creates ICE servers without exposing the configured shared secret.
    /// </summary>
    public IReadOnlyList<VoiceIceServer> Create(Guid userId, string sessionId, PluginConfiguration configuration)
    {
        var result = new List<VoiceIceServer>();
        string[] stunUrls = SplitUrls(configuration.StunUrl);
        if (stunUrls.Length > 0)
        {
            result.Add(new VoiceIceServer { Urls = stunUrls });
        }

        if (!configuration.EnableTurn || string.IsNullOrWhiteSpace(configuration.TurnSharedSecret))
        {
            return result;
        }

        string[] turnUrls = SplitUrls(configuration.TurnUrl).Concat(SplitUrls(configuration.TurnTlsUrl)).ToArray();
        if (turnUrls.Length == 0)
        {
            return result;
        }

        int lifetimeMinutes = Math.Clamp(configuration.TurnCredentialLifetimeMinutes, 5, 1440);
        long expires = DateTimeOffset.UtcNow.AddMinutes(lifetimeMinutes).ToUnixTimeSeconds();
        string identity = userId.ToString("N") + "-" + ShortHash(sessionId);
        string username = expires.ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + identity;
        byte[] secret = Encoding.UTF8.GetBytes(configuration.TurnSharedSecret);
#pragma warning disable CA5350 // coturn's time-limited REST credential protocol requires HMAC-SHA1.
        byte[] password = HMACSHA1.HashData(secret, Encoding.UTF8.GetBytes(username));
#pragma warning restore CA5350

        result.Add(new VoiceIceServer
        {
            Urls = turnUrls,
            Username = username,
            Credential = Convert.ToBase64String(password)
        });
        return result;
    }

    private static string[] SplitUrls(string? value)
        => (value ?? string.Empty)
            .Split([',', ';', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private static string ShortHash(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..12];
}
