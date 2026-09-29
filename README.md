# Jellyfin Partyline

`Partyline` adds text chat and opt-in voice chat to Jellyfin SyncPlay. Text messages appear as Jellyfin toasts and in a mobile-friendly panel containing the room's latest 100 messages. Voice is direct browser-to-browser WebRTC audio with Jellyfin used only for authenticated signaling.

<p align="center"><img src="assets/partyline-banner.png" alt="Jellyfin Partyline banner" width="840"></p>

Partyline is a fork of [Syncplay Chat](https://github.com/AbhayVAshokan/jellyfin-syncplay-chat) by Abhay V Ashokan. It keeps the original SyncPlay text chat and adds opt-in WebRTC voice chat, persistent history, mobile controls, and connection recovery. This fork is independently maintained by [Llewellyn500](https://github.com/Llewellyn500), retains the original GPL license and Git history, and uses its own plugin identity and release feed.

## Pre-requisites

- Jellyfin server compatible with `Jellyfin.Controller` / `Jellyfin.Model` `10.11.8`.
- .NET SDK 9.0 for building.
- Jellyfin [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) plugin installed and enabled.
    - Without File Transformation, `partyline.js` will not be injected into the web client.
- HTTPS for microphone access when Jellyfin is not running on localhost.

For a complete Caddy setup covering trusted HTTPS on a private LAN, Tailscale HTTPS, Windows startup, verification, and troubleshooting, see [Caddy HTTPS setup](docs/caddy-https.md).

## Voice chat

Join a SyncPlay group, then choose `🎙 Join Voice`. Microphone permission is requested only after that click. Mute disables the existing microphone track; it does not reconnect or renegotiate. Leaving voice does not leave SyncPlay, pause playback, or affect text chat.

- Recommended maximum: 8 voice participants.
- Hard maximum: 10 voice participants. The server atomically rejects participant 11 while leaving their movie, SyncPlay session, and text chat untouched.
- One microphone stream and one `RTCPeerConnection` per remote participant (up to 9 connections per client).
- Native WebRTC mesh: normal audio travels directly between browsers, or through coturn when direct connectivity fails. Voice media never travels through Jellyfin.
- Opus is preferred without SDP rewriting. Per-peer bitrate ceilings start at 32 kbps (24 kbps for 9–10 users), fall to 24/16 kbps after persistent loss, jitter, or RTT, and recover slowly after about 25 seconds of healthy samples.
- Signaling uses authenticated 25-second long polling. Established audio stays alive during signaling outages and is reconciled when signaling returns.
- Per-peer recovery waits through short disconnects, then uses deterministic ICE restart ownership, fresh ICE credentials, and finally rebuilds only the failed peer.
- Presence is memory-only with 10-second heartbeats and a 40-second stale timeout. A server restart clears voice rooms.

Primary support is Jellyfin Web in current Chrome, Firefox, Safari, and Chromium-based Jellyfin Media Player. Mobile web support depends on the OS browser's WebRTC and background-audio policies. Unsupported clients receive a small voice-panel error; playback is not interrupted.

## Text chat

Open the chat button while in a SyncPlay group to read and send messages. Jellyfin keeps the latest 100 messages for each group in memory, so refreshing or briefly leaving the page does not lose the conversation. History clears when Jellyfin restarts.

### Voice configuration

Open Dashboard > Plugins > Partyline:

- **Enable voice chat**
- **STUN URL(s)** — comma-separated; the default is `stun:stun.l.google.com:19302`
- **Enable TURN**
- **TURN URL(s)** — put UDP first, then TCP
- **TURN TLS URL(s)** — optional TLS fallback
- **coturn shared secret** — stored server-side and never returned to browsers

TURN is optional on simple LANs but strongly recommended for remote users, carrier-grade NAT, and restrictive networks. The plugin creates coturn REST credentials that expire after approximately one hour.

Caddy does not replace coturn: Caddy supplies HTTPS for the Jellyfin page and signaling API, while coturn is only a fallback relay for WebRTC audio. Leave TURN disabled for a normal LAN or Tailscale deployment unless direct voice connections fail.

### coturn Docker example

Create `turnserver.conf` (replace the realm and secret; do not reuse the example value):

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=replace-with-a-long-random-secret
realm=voice.example.com
min-port=49160
max-port=49200
no-cli
```

Run coturn, publishing its listener and relay range:

```bash
docker run -d --name coturn --restart unless-stopped \
  -p 3478:3478/tcp -p 3478:3478/udp \
  -p 5349:5349/tcp -p 5349:5349/udp \
  -p 49160-49200:49160-49200/udp \
  -v "$PWD/turnserver.conf:/etc/coturn/turnserver.conf:ro" \
  coturn/coturn:latest -c /etc/coturn/turnserver.conf
```

Configure public DNS and firewall/NAT forwarding to the coturn host. For TLS, mount a certificate/key, add coturn's `cert=` and `pkey=` settings, and use URLs such as:

```text
turn:voice.example.com:3478?transport=udp
turn:voice.example.com:3478?transport=tcp
turns:voice.example.com:5349?transport=tcp
```

Paste the same `static-auth-secret` into the plugin configuration. Never put the shared secret into a browser, JavaScript file, URL, or reverse-proxy configuration visible to clients.

### Privacy and security

Voice is never recorded, stored, logged, or transcribed. Participant identity is the authenticated Jellyfin user ID plus the authenticated device session. The server derives the current SyncPlay group from Jellyfin, generates sender IDs itself, and rejects cross-group targets, stale participants, unsupported signals, spoofed sessions, and rooms above ten users.

## Installation

If `SyncPlay Chat` is installed, uninstall it and restart Jellyfin first. Running both plugins would inject two sets of controls.

1. In Jellyfin, go to Dashboard > Plugins > Catalog > ⚙️
2. Click ➕ and give the repository a name (e.g., "Jellyfin Partyline").
3. Set the Repository URL to:
    ```
    https://raw.githubusercontent.com/Llewellyn500/jellyfin-partyline/main/manifest.json
    ```
4. Click Save.
5. Go to the Catalog tab, find `Partyline` in the list, and click Install.
6. Restart your Jellyfin server to complete the installation.

## Local Development Deploy

From repository root:

```bash
./scripts/deploy-dev.sh
```

What it does:

- Publishes the solution in Debug.
- Copies publish output to Jellyfin plugin directory.

Environment overrides:

```bash
JELLYFIN_DATA_DIR="$HOME/Library/Application Support/jellyfin" \
PLUGIN_DIR="$HOME/Library/Application Support/jellyfin/plugins/Partyline" \
./scripts/deploy-dev.sh
```

Notes:

- `PLUGIN_DIR` takes precedence over `JELLYFIN_DATA_DIR`.
- Default `JELLYFIN_DATA_DIR` is `$HOME/Library/Application Support/jellyfin`.
- Restart Jellyfin after deploy.

## Manual Build and Install

Build:

```bash
mise exec dotnet@9.0 -- dotnet publish Jellyfin.Plugin.Partyline/Jellyfin.Plugin.Partyline.csproj -c Release
```

Output:

- `Jellyfin.Plugin.Partyline/bin/Release/net9.0/publish/`

Install manually by copying publish output into a plugin folder such as:

- macOS: `$HOME/Library/Application Support/jellyfin/plugins/Partyline`
- Linux: `$HOME/.local/share/jellyfin/plugins/Partyline`
- Windows: `%ProgramData%\Jellyfin\Server\plugins\Partyline`

Then restart Jellyfin.

## Releasing a New Version

1. Publish release output:
    ```bash
    dotnet publish Jellyfin.Plugin.Partyline/Jellyfin.Plugin.Partyline.csproj -c Release
    ```
2. Zip the contents of `Jellyfin.Plugin.Partyline/bin/Release/net9.0/publish/` (not the folder itself):
    ```bash
    cd Jellyfin.Plugin.Partyline/bin/Release/net9.0/publish
    zip -r Jellyfin.Plugin.Partyline_<version>.zip .
    ```
3. Create a new GitHub release with tag `v<version>` (e.g., `v1.0.2.0`).
4. Attach the zip file (`Jellyfin.Plugin.Partyline_<version>.zip`) to the release.
5. Add release notes in the release body describing what changed.
6. Publish the release.

The `release.yaml` workflow will automatically:
- Compute the checksum of the attached zip.
- Prepend a new version entry to `manifest.json`.
- Update `Directory.Build.props` with the new version.
- Commit and push to `main`.

Plugin ID: `9512396d-7364-4d1f-aa1a-aa719e8ee3ff`

## Troubleshooting

- Chat button does not appear:
    - Verify user is in an active SyncPlay group.
    - Verify File Transformation plugin is installed and enabled.
    - Restart Jellyfin after plugin deploy/update.
- Messages only appear on one device:
    - Check browser console for `[Partyline]` send failure logs.
    - Confirm target devices are active sessions visible to Jellyfin.
- `Voice chat requires HTTPS`:
    - Use HTTPS through your Jellyfin reverse proxy. Browsers normally allow insecure microphone access only on localhost.
- Voice works on LAN but not remotely:
    - Configure coturn, publish both its listener and relay UDP range, and verify the public TURN hostname resolves correctly.
- One participant shows `reconnecting`:
    - The plugin is silently trying ICE restart and fresh TURN credentials. Other peers and movie playback should remain unaffected.
- No microphone prompt:
    - Join SyncPlay first, enable voice in the plugin settings, and check the browser's microphone permission for the Jellyfin origin.
- Mobile voice stops in the background:
    - Mobile operating systems may suspend browser tabs; keep Jellyfin in the foreground where possible.

## Development checks

```bash
dotnet build Jellyfin.Plugin.Partyline.sln -c Release
dotnet test Jellyfin.Plugin.Partyline.sln -c Release
node --check Jellyfin.Plugin.Partyline/Web/partyline.js
node --check Jellyfin.Plugin.Partyline/Web/voice-chat.js
node Jellyfin.Plugin.Partyline.Tests/voice-chat.test.js
```

The automated suite covers idempotent join, the atomic 10-user cap, participant 11 rejection, same-room signaling, cross-room isolation, sender authorization, and TURN secret non-disclosure. Real NAT traversal, microphone behavior, network switching, and browser autoplay policies still require multi-device testing against a running Jellyfin and coturn deployment.

## License

Partyline is free software under the GNU General Public License v3. See `LICENSE`. The repository retains the upstream project history and attribution.
