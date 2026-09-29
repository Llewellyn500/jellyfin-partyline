# Instructions for installing the CRT

This guide installs the private certificate used by **Jellyfin Partyline**. Install it only if you received it directly from the person who runs the Jellyfin server.

![Where to install the Caddy root certificate on each platform](docs/images/crt-install/platform-paths.svg)

## What you need

- The file named `root.crt` from the Jellyfin server owner.
- The Jellyfin address supplied by the owner.
- Your device passcode or administrator password.

## Addresses for this server

- **Apartment Wi-Fi:** <https://192.168.1.53>
- **Tailscale by IP:** <https://100.81.99.21>
- **Tailscale by name:** <https://llewellyn-omen-15.tail80ca43.ts.net>

Use the apartment Wi-Fi address while connected locally. The two Tailscale addresses require an active Tailscale connection. Do not add `:8096` to any of them.

For this Partyline server, the certificate file should have this SHA-256 fingerprint:

```text
933A975D396B92E713382D3467E9ADCA630D8EE73DCBB0A594238008D56AABA0
```

> **Safety:** install only `root.crt`. Never accept a private-key file, and do not install a certificate received from an unknown person. This certificate lets your device trust sites signed by this private Caddy certificate authority.

## Windows 10 or 11

1. Double-click `root.crt`.
2. Select **Install Certificate**.
3. Select **Local Machine**, then approve the administrator prompt.
4. Select **Place all certificates in the following store**.
5. Select **Browse** → **Trusted Root Certification Authorities** → **OK**.
6. Select **Next** → **Finish**. Windows should report that the import was successful.
7. Completely restart the browser. In Chrome, open `chrome://restart`.

If you do not have administrator access, choose **Current User** instead. It is enough for browsers running under that Windows account.

If Chrome or Edge still shows the old warning, press `Win` + `R`, enter `inetcpl.cpl`, then select **Content** → **Clear SSL state** and restart the browser.

## macOS

1. Double-click `root.crt`. **Keychain Access** should open.
2. Add the certificate to the **System** keychain. Enter an administrator password if requested.
3. In Keychain Access, select **System** → **Certificates**.
4. Double-click **Caddy Local Authority**.
5. Expand **Trust** and set **When using this certificate** to **Always Trust**.
6. Close the certificate window and approve the change with Touch ID or the administrator password.
7. Completely quit and reopen the browser.

Apple’s current Keychain Access instructions also describe how to [change certificate trust settings](https://support.apple.com/guide/keychain-access/kyca11871/mac).

## Android

Menu names vary slightly between phone manufacturers and Android versions.

1. Save `root.crt` in the device’s **Downloads** folder.
2. Open **Settings** and search for **Install a certificate**.
3. Open **Install a certificate** → **CA certificate**.
4. A security warning may appear. Confirm that you understand it, then choose **Install anyway**.
5. Enter the device PIN, pattern, or password.
6. Select `root.crt` from **Downloads**. If asked for a name, use **Partyline Caddy**.
7. Completely close and reopen Chrome.

A common Android path is **Settings** → **Security & privacy** → **More security settings** → **Encryption & credentials** → **Install a certificate** → **CA certificate**. If that path is absent, use Settings search; Google notes that certificate menus vary by device in its [Android network settings guide](https://support.google.com/android/answer/9654714).

## iPhone or iPad

There are two separate stages: install the downloaded profile, then enable full trust.

1. Open `root.crt` from Safari, Mail, AirDrop, or the Files app.
2. Open **Settings**. Tap **Profile Downloaded** near the top. If it is not shown, open **General** → **VPN & Device Management** and select the downloaded certificate profile.
3. Tap **Install** in the upper-right corner, enter the device passcode, then tap **Install** again.
4. Go to **Settings** → **General** → **About** → **Certificate Trust Settings**.
5. Under **Enable Full Trust for Root Certificates**, turn on **Caddy Local Authority** and confirm.
6. Completely close and reopen Safari or Chrome.

Apple documents both [installing a downloaded profile](https://support.apple.com/102400) and the required second step to [enable full trust for a manually installed root certificate](https://support.apple.com/102390).

## Test the connection

1. Connect to the apartment Wi-Fi or Tailscale, as instructed by the server owner.
2. Open the exact address provided by the owner. It must start with `https://`.
3. Do **not** add Jellyfin’s old `:8096` port.
4. Confirm that the browser no longer shows a certificate warning or **Not secure** message.
5. Sign in to Jellyfin. The Partyline voice button should be available on the secure page.

## If it still says the connection is unsafe

- Confirm that the address starts with `https://`, not `http://`.
- Confirm that you used the exact IP address or hostname supplied by the server owner.
- Confirm that you installed `root.crt` as a **trusted root/CA certificate**, not as a Wi-Fi or user identity certificate.
- Restart the entire browser, not just the tab.
- Ask the server owner to confirm that your `root.crt` came from the Caddy instance that is currently running.
- Try the operating system’s default browser. Firefox may use a separate certificate store on some versions and configurations.

Do not bypass the browser warning. A warning-free HTTPS connection is required for reliable microphone permission.

## Remove the certificate later

- **Windows:** search for **Manage computer certificates**, then remove **Caddy Local Authority** from **Trusted Root Certification Authorities** → **Certificates**.
- **macOS:** open **Keychain Access** → **System** → **Certificates**, select **Caddy Local Authority**, then delete it.
- **Android:** open **Settings** → **Security & privacy** → **More security settings** → **Encryption & credentials** → **Trusted credentials** → **User**, then remove **Partyline Caddy**. Names vary by device.
- **iPhone/iPad:** open **Settings** → **General** → **VPN & Device Management**, select the certificate profile, then tap **Remove Profile**.

