# Unofficial WAN Client

[![CI](https://github.com/NeonN3mesis/unofficial-wan-client/actions/workflows/ci.yml/badge.svg)](https://github.com/NeonN3mesis/unofficial-wan-client/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/NeonN3mesis/unofficial-wan-client?display_name=tag)](https://github.com/NeonN3mesis/unofficial-wan-client/releases/latest)
[![MIT License](https://img.shields.io/github/license/NeonN3mesis/unofficial-wan-client)](https://github.com/NeonN3mesis/unofficial-wan-client/blob/main/LICENSE)

Unofficial WAN Client is a Linux-first desktop client for watching the WAN Show on Floatplane with local playback relay, live chat, and optional Friday-night auto-watch scheduling.

## Download
- Latest AppImage: <https://github.com/NeonN3mesis/unofficial-wan-client/releases/latest>

Launch the AppImage on Linux after making it executable:

```bash
chmod +x Unofficial.WAN.Client-*.AppImage
./Unofficial.WAN.Client-*.AppImage
```

## Highlights
- Local-only desktop app with a backend bound to `127.0.0.1`
- Managed Chrome/Chromium sign-in flow for using your own Floatplane account
- Opaque local playback routes instead of raw upstream media URLs
- Live chat relay, tray/background mode, and Linux autostart support
- Optional auto-watch window that can restore the app and start playback when the stream goes live

## Quick start
1. Download the latest AppImage from the releases page.
2. Launch the app on Linux.
3. Click `Connect Floatplane`.
4. Finish sign-in in the managed browser window.
5. Return to the app and click `Finish Sign-In`.
6. Optionally enable auto-watch and edit the weekly watch window.

## Desktop defaults
- Auto-watch is off until you enable it.
- The default watch window is Friday, `19:00` to `00:00`, using the local system timezone.
- When auto-watch detects the stream has started, the app restores or opens the main window and starts playback immediately.
- If the saved session is expired during the active watch window, the app opens the reconnect flow automatically.

## Requirements
- Linux x64
- Node.js 20+ for development builds
- A locally installed Chrome or Chromium-based browser for managed sign-in
- Your own Floatplane account

## Development
Install dependencies and run the local app stack:

```bash
npm install
npm run dev
npm run dev:desktop
```

Build and test:

```bash
npm run build
npm test
```

Build a Linux AppImage locally:

```bash
npm run dist:linux
```

## Test auto-watch without a real broadcast
Launch the hidden desktop app and simulate a live launch:

```bash
npm run dev:desktop:simulate-live
```

Launch the hidden desktop app and simulate a reconnect prompt:

```bash
npm run dev:desktop:simulate-reauth
```

Or launch in background and trigger checks manually from the tray:

```bash
npm run dev:desktop:background
```

These Linux dev scripts launch Electron with `--no-sandbox` to avoid the local `chrome-sandbox` SUID requirement inside `node_modules/electron`.

## Local data and security
- Desktop builds store runtime data under the Electron user-data directory, not under `apps/server/data`.
- The embedded server listens on loopback only.
- Playback URLs exposed to the renderer are opaque local routes, not raw upstream fetch targets.
- Clearing the session also tears down managed browser state used by the app runtime.
- Do not share cookies, storage-state files, Chrome profiles, HAR captures, or probe payloads from real accounts.

## Contributing
- Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security policy: [SECURITY.md](./SECURITY.md)
- Release process: [releasing.md](./docs/releasing.md)
