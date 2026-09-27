using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.SyncPlayChat.Configuration;
using Jellyfin.Plugin.SyncPlayChat.Infrastructure;
using Jellyfin.Plugin.SyncPlayChat.Voice;
using Xunit;

namespace Jellyfin.Plugin.SyncPlayChat.Tests;

public sealed class VoiceRoomManagerTests
{
    [Fact]
    public void WebTransformerInjectsTextAndVoiceOnce()
    {
        const string html = "<html><body>Jellyfin</body></html>";
        string transformed = SyncChatWebTransformer.TransformIndexHtml(new WebContentTransformPayload { Contents = html });
        string repeated = SyncChatWebTransformer.TransformIndexHtml(new WebContentTransformPayload { Contents = transformed });

        Assert.Contains("__syncPlayChatLoaded", transformed, StringComparison.Ordinal);
        Assert.Contains("__syncPlayVoiceLoaded", transformed, StringComparison.Ordinal);
        Assert.Equal(transformed, repeated);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(6)]
    [InlineData(8)]
    [InlineData(10)]
    public void SupportsDocumentedRoomSizes(int size)
    {
        var manager = new VoiceRoomManager();
        Guid room = Guid.NewGuid();
        VoiceJoinResult? last = null;
        for (int i = 0; i < size; i++)
        {
            last = manager.Join(room, Guid.NewGuid(), "size-" + i, "User " + i);
        }

        Assert.NotNull(last);
        Assert.Equal(size - 1, last.Participants.Count);
    }

    [Fact]
    public void JoinIsIdempotentAndRejectsParticipantEleven()
    {
        var manager = new VoiceRoomManager();
        Guid room = Guid.NewGuid();
        Guid user = Guid.NewGuid();
        VoiceJoinResult first = manager.Join(room, user, "session-0", "User 0");
        VoiceJoinResult duplicate = manager.Join(room, user, "session-0", "User 0");

        Assert.Equal(first.Participant.ParticipantId, duplicate.Participant.ParticipantId);
        for (int i = 1; i < VoiceRoomManager.MaximumParticipants; i++)
        {
            manager.Join(room, Guid.NewGuid(), "session-" + i, "User " + i);
        }

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(
            () => manager.Join(room, Guid.NewGuid(), "session-11", "Eleven"));
        Assert.Equal("Voice chat is full. Maximum 10 participants.", error.Message);
    }

    [Fact]
    public void RoomLimitIsAtomic()
    {
        var manager = new VoiceRoomManager();
        Guid room = Guid.NewGuid();
        var results = new ConcurrentBag<bool>();

        Parallel.For(0, 11, i =>
        {
            try
            {
                manager.Join(room, Guid.NewGuid(), "parallel-" + i, "User");
                results.Add(true);
            }
            catch (InvalidOperationException)
            {
                results.Add(false);
            }
        });

        Assert.Equal(10, results.Count(static accepted => accepted));
        Assert.Single(results, static accepted => !accepted);
    }

    [Fact]
    public async Task SignalsAreAuthorizedAndIsolatedByRoom()
    {
        var manager = new VoiceRoomManager();
        Guid roomA = Guid.NewGuid();
        Guid roomB = Guid.NewGuid();
        Guid userA = Guid.NewGuid();
        Guid userB = Guid.NewGuid();
        VoiceJoinResult a = manager.Join(roomA, userA, "a", "A");
        VoiceJoinResult b = manager.Join(roomA, userB, "b", "B");
        VoiceJoinResult other = manager.Join(roomB, Guid.NewGuid(), "other", "Other");

        manager.Signal(roomA, userA, "a", a.Participant.ParticipantId, b.Participant.ParticipantId, "offer", JsonSerializer.SerializeToElement(new { sdp = "test" }));
        var events = await manager.GetEventsAsync(roomA, userB, "b", b.Participant.ParticipantId, b.Cursor, CancellationToken.None);

        VoiceEvent signal = Assert.Single(events, static item => item.Type == "offer");
        Assert.Equal(a.Participant.ParticipantId, signal.SenderParticipantId);
        Assert.Throws<KeyNotFoundException>(() => manager.Signal(roomA, userA, "a", a.Participant.ParticipantId, other.Participant.ParticipantId, "offer", default));
        Assert.Throws<UnauthorizedAccessException>(() => manager.Signal(roomA, Guid.NewGuid(), "a", a.Participant.ParticipantId, b.Participant.ParticipantId, "offer", default));
    }

    [Fact]
    public void TurnCredentialsAreTemporaryAndSecretIsNotSerialized()
    {
        const string secret = "server-only-secret";
        var configuration = new PluginConfiguration
        {
            EnableTurn = true,
            TurnUrl = "turn:voice.example:3478?transport=udp,turn:voice.example:3478?transport=tcp",
            TurnTlsUrl = "turns:voice.example:5349?transport=tcp",
            TurnSharedSecret = secret
        };

        var ice = new TurnCredentialService().Create(Guid.NewGuid(), "session", configuration);
        string json = JsonSerializer.Serialize(ice);

        Assert.DoesNotContain(secret, json, StringComparison.Ordinal);
        VoiceIceServer turn = Assert.Single(ice, static server => server.Username is not null);
        Assert.StartsWith("turn", turn.Urls[0], StringComparison.Ordinal);
        Assert.NotEmpty(turn.Credential!);
        Assert.True(long.Parse(turn.Username!.Split(':')[0], System.Globalization.CultureInfo.InvariantCulture) > DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }
}
