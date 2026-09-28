# Caddy HTTPS setup

Browser microphone access requires a secure context. An HTTP URL such as `http://192.168.1.50:8096` or `http://100.x.y.z:8096` is not sufficient even when the traffic stays inside a LAN or Tailscale. Caddy can terminate HTTPS and proxy requests to Jellyfin's existing HTTP listener without changing Jellyfin's configuration.

This guide provides two private-network options:

- **Tailscale HTTPS** — easiest trusted certificate; every client using this URL must be connected to the tailnet.
- **LAN HTTPS** — clients do not need Tailscale, but each client must trust Caddy's private root certificate.

Both can be enabled at the same time. Neither requires a public server, public DNS record, router port forwarding, or exposing Jellyfin to the internet.

## Before starting

1. Confirm Jellyfin works locally at `http://127.0.0.1:8096`.
2. Confirm TCP ports 80 and 443 are not already used:

   ```powershell
   Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 80,443
   ```

3. Download the standard Caddy Windows binary from <https://caddyserver.com/download> and place `caddy.exe` in `C:\Caddy`.
4. Open an elevated PowerShell window and verify it:

   ```powershell
   C:\Caddy\caddy.exe version
   ```

Caddy's `reverse_proxy` supports Jellyfin's WebSocket connection automatically. No special WebSocket headers or routes are required.

## Option A: Tailscale HTTPS

Use this when all clients that need this URL can run Tailscale. The certificate is publicly trusted, but the service remains reachable only through the tailnet.

### 1. Enable Tailscale HTTPS

In the Tailscale admin console:

1. Open **DNS**.
2. Enable **MagicDNS**.
3. Under **HTTPS Certificates**, choose **Enable HTTPS**.
4. Read and accept Tailscale's certificate-transparency notice. The machine's full `*.ts.net` name will be recorded in the public Certificate Transparency log, but this does not make the machine publicly reachable.

### 2. Find the server's full MagicDNS name

Run this on the Jellyfin server:

```powershell
$tailscaleStatus = tailscale status --json | ConvertFrom-Json
$tailscaleStatus.Self.DNSName.TrimEnd('.')
```

The result resembles `jellyfin-server.example-tailnet.ts.net`. Use the exact result below; do not use the bare machine name, Tailscale IP, or LAN IP.

### 3. Create the Caddyfile

Create `C:\Caddy\Caddyfile`:

```caddyfile
jellyfin-server.example-tailnet.ts.net {
    reverse_proxy 127.0.0.1:8096
}
```

Replace the example hostname with the full MagicDNS name from the previous step. Caddy obtains and renews the certificate through the local Tailscale daemon.

### 4. Validate and test

```powershell
C:\Caddy\caddy.exe validate --config C:\Caddy\Caddyfile --adapter caddyfile
C:\Caddy\caddy.exe run --config C:\Caddy\Caddyfile --adapter caddyfile
```

Leave that terminal open for the first test. From another device connected to the same tailnet, open:

```text
https://jellyfin-server.example-tailnet.ts.net
```

Do not append `:8096`; HTTPS terminates on Caddy's port 443.

## Option B: LAN HTTPS without Tailscale on clients

Use this for phones, televisions, and computers that stay on the apartment Wi-Fi and should not run Tailscale.

### 1. Give the Jellyfin server a stable LAN address

Create a DHCP reservation in the router for the Jellyfin server. Do not rely on an address that can change after a restart.

### 2. Create a private DNS name

Use a name under `home.arpa`, for example `jellyfin.home.arpa`. Configure the router, Pi-hole, AdGuard Home, or another local DNS server to resolve that name to the Jellyfin server's reserved LAN address.

If the router cannot create local DNS records, an IP address can be used instead:

```caddyfile
https://192.168.1.50 {
    tls internal
    reverse_proxy 127.0.0.1:8096
}
```

Replace the address with the server's reserved LAN IP. A hostname is preferable because it survives future addressing changes more cleanly.

### 3. Add the LAN site to the Caddyfile

```caddyfile
jellyfin.home.arpa {
    tls internal
    reverse_proxy 127.0.0.1:8096
}
```

To offer both LAN and Tailscale HTTPS, put both site blocks in the same file:

```caddyfile
jellyfin.home.arpa {
    tls internal
    reverse_proxy 127.0.0.1:8096
}

jellyfin-server.example-tailnet.ts.net {
    reverse_proxy 127.0.0.1:8096
}
```

### 4. Start Caddy and locate its root certificate

Run Caddy once from an elevated terminal:

```powershell
C:\Caddy\caddy.exe validate --config C:\Caddy\Caddyfile --adapter caddyfile
C:\Caddy\caddy.exe run --config C:\Caddy\Caddyfile --adapter caddyfile
```

Caddy creates a local certificate authority and normally trusts it on the server automatically. Run `caddy environ` and find `caddy.AppDataDir`; the root certificate is beneath that directory at:

```text
pki\authorities\local\root.crt
```

For example, an interactive Windows installation commonly stores it beneath `%APPDATA%\Caddy`, but use the directory reported by Caddy rather than assuming a path.

### 5. Trust the root certificate on every LAN client

Copy only `root.crt` to each client. Never copy Caddy's private keys or the intermediate CA key.

- **Windows:** open an elevated terminal and run `certutil -addstore -f Root root.crt`, or import it into **Trusted Root Certification Authorities** for the local computer.
- **Android:** install it as a CA certificate in the device security settings. Browser support is device-dependent; use current Chrome or Firefox and confirm the site shows no certificate warning.
- **iPhone/iPad:** install the certificate profile, then enable full trust under **Settings > General > About > Certificate Trust Settings**.
- **macOS:** import it into the System keychain with Keychain Access and set it to **Always Trust**.
- **Linux:** add it to the distribution's system CA store and refresh that store.

Only devices that trust this root can use the LAN HTTPS URL without a certificate warning. A warning bypass is not sufficient for reliable microphone access.

### 6. Test the LAN URL

Open this exact URL from a LAN client:

```text
https://jellyfin.home.arpa
```

Do not use the old HTTP IP-and-port bookmark. If the browser still shows a certificate warning, fix certificate trust before testing voice.

## Allow Caddy through Windows Firewall

Allow inbound TCP 443 on the server's **Private** network profile. TCP 80 is optional and is used only for automatic HTTP-to-HTTPS redirects. Do not create router port-forwarding rules for either port.

If Windows prompts when Caddy first starts, allow access only on private networks. For a manually created firewall rule, scope it to the LAN and/or Tailscale address ranges used by the installation rather than the public internet.

## Run Caddy automatically on Windows

After the foreground test works, stop it with `Ctrl+C`. From an elevated PowerShell window, create and start a Windows service:

```powershell
sc.exe create caddy start= auto binPath= '"C:\Caddy\caddy.exe" run --config "C:\Caddy\Caddyfile" --adapter caddyfile'
sc.exe start caddy
sc.exe query caddy
```

Important for `tls internal`: Caddy's data directory contains the private CA and certificates. The Windows service must use a persistent, writable data directory. If the service runs as a different Windows account from the foreground test, it can create a different root CA. Either run the service under the same account or distribute the root generated by the service. Use `caddy environ` under the service account to identify its data directory.

After changing the Caddyfile, validate and reload it without restarting Jellyfin:

```powershell
C:\Caddy\caddy.exe validate --config C:\Caddy\Caddyfile --adapter caddyfile
C:\Caddy\caddy.exe reload --config C:\Caddy\Caddyfile --adapter caddyfile
```

## Verify the finished setup

1. Visit the chosen `https://` URL and confirm there is no certificate warning.
2. In the browser console, confirm `window.isSecureContext` returns `true`.
3. Sign in to Jellyfin and join a SyncPlay group.
4. Confirm the **Join Voice** button appears.
5. Join from a second device and confirm chat, SyncPlay updates, microphone permission, and voice work.
6. Refresh the page and confirm Jellyfin reconnects normally. Caddy proxies Jellyfin's WebSocket automatically.

The connection path is:

```text
Browser -- HTTPS/WSS --> Caddy -- HTTP/WS on localhost --> Jellyfin :8096
```

Jellyfin can remain on HTTP because the Caddy-to-Jellyfin hop stays on the same machine.

## Troubleshooting

### The browser opens Jellyfin but Join Voice is hidden

- Confirm the address begins with `https://`.
- Confirm `window.isSecureContext` is `true`.
- Confirm the user is currently inside a SyncPlay group.
- Hard-refresh after changing from the HTTP URL to the HTTPS URL.

### `502 Bad Gateway`

- Confirm Jellyfin responds at `http://127.0.0.1:8096` on the server.
- Confirm the Caddyfile uses `reverse_proxy 127.0.0.1:8096`.
- Do not use `https://127.0.0.1:8096`; Jellyfin's default backend listener is HTTP.

### LAN certificate warning

- Confirm the client trusts the same `root.crt` used by the running Caddy instance.
- Check whether the Windows service created a second Caddy data directory and therefore a different root.
- Confirm the URL hostname or IP exactly matches the Caddyfile site address.

### Tailscale certificate cannot be obtained

- Confirm MagicDNS and HTTPS Certificates are enabled in the Tailscale admin console.
- Use the full `machine-name.tailnet-name.ts.net` hostname.
- Confirm Tailscale is running and logged in on the Jellyfin server.
- Confirm Caddy can communicate with the local Tailscale daemon.
- Do not use the `100.x.y.z` address in the HTTPS URL; Tailscale certificates are issued for the full MagicDNS name.

### Caddy cannot bind to port 80 or 443

Use `Get-NetTCPConnection -State Listen` to find the conflicting process. Stop or reconfigure that service before starting Caddy. Do not change Jellyfin's port 8096.

### Works on Tailscale but not apartment Wi-Fi

The `*.ts.net` option requires the client to be connected to Tailscale. For Wi-Fi-only clients, configure the LAN `home.arpa` site, local DNS, and Caddy root trust.

## Security notes

- Do not expose Jellyfin port 8096 through router port forwarding.
- Do not expose Caddy ports 80/443 through router port forwarding for this private-only setup.
- Keep Tailscale access controls limited to the users and devices that should reach Jellyfin.
- Protect Caddy's data directory; it contains private certificate keys.
- Never distribute anything from Caddy's PKI directory except `root.crt`.
- Keep using Jellyfin authentication. Caddy provides HTTPS; it does not replace Jellyfin login controls.

## References

- [Caddy reverse proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy)
- [Caddy automatic and local HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy Windows service instructions](https://caddyserver.com/docs/running#windows-service)
- [Caddy certificates on Tailscale](https://tailscale.com/docs/integrations/web-servers/caddy/caddy-certificates)
- [Enable Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates)
