# Unofficial WAN Client

Unofficial WAN Client is a Linux-first desktop client for watching the WAN Show from Floatplane with a local playback relay, live chat surface, and optional background auto-watch scheduling.

## What it does
- Runs as an Electron desktop app with a local Express backend bound to `127.0.0.1`
- Launches a managed Chrome/Chromium window so users can sign in with their own Floatplane account
- Stores session data in per-user desktop app data instead of the repository
- Detects live WAN Show playback from saved Floatplane session state and proxies playback through local opaque routes
- Relays chat through an authenticated managed browser runtime when a valid session is present
- Supports optional auto-watch scheduling, tray/background mode, and Linux autostart

## Desktop defaults
- Auto-watch is off until the user enables it
- The default watch window is Friday, `19:00` to `00:00`, using the local system timezone
- When auto-watch detects the stream has started, the app restores or opens the main window and starts playback immediately
- If the saved session is expired during the active watch window, the app opens the reconnect flow automatically

## Build and run
1. Install dependencies:

```bash
npm install
```

2. Run the browser-based dev stack:

```bash
npm run dev
```

3. Run the desktop app from a built local bundle:

```bash
npm run dev:desktop
```

4. Build everything:

```bash
npm run build
```

5. Build a Linux AppImage release artifact:

```bash
npm run dist:linux
```

## Publish a GitHub release
1. Update `package.json` with the release version you want to ship.
2. Commit the release changes.
3. Create and push a tag such as `v0.1.0`.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag runs [release.yml](/home/scott/WAN%20show%20Floatplane%20client/.github/workflows/release.yml), which tests the repo, builds the Linux AppImage, generates `sha256sums.txt`, and attaches the artifacts to a GitHub Release automatically.

## Test auto-watch without a real broadcast
- Launch the hidden desktop app and simulate a live launch:

```bash
npm run dev:desktop:simulate-live
```

- Launch the hidden desktop app and simulate a reconnect prompt:

```bash
npm run dev:desktop:simulate-reauth
```

- Or launch in background and trigger checks manually from the tray:

```bash
npm run dev:desktop:background
```

These Linux dev scripts launch Electron with `--no-sandbox` to avoid the local `chrome-sandbox` SUID requirement inside `node_modules/electron`.

In development builds, the tray menu exposes `Run Auto-Watch Check`, `Simulation > Trigger Live Launch`, and `Simulation > Trigger Reconnect Prompt` so the exact hidden-window restore path can be exercised without waiting for Friday.

## User flow
1. Launch the desktop app
2. Click `Connect Floatplane`
3. Finish sign-in in the managed browser window
4. Return to the app and click `Finish Sign-In`
5. Optionally enable auto-watch and edit the weekly watch window

## Desktop data and security
- Desktop builds store runtime data under the Electron user-data directory, not under `apps/server/data`
- The server listens on loopback only
- Playback URLs exposed to the renderer are opaque local routes, not raw upstream fetch targets
- Clearing the session also tears down managed browser state used by the app runtime

## Development notes
- The legacy capture and probe scripts are still available for local reverse-engineering work:
  - `npm run capture:floatplane`
  - `npm run probe:floatplane`
  - `npm run analyze:capture`
- Shared contracts live in `packages/shared`
- Server code lives in `apps/server`
- Desktop shell code lives in `apps/desktop`
- Renderer code lives in `apps/web`

## Verify
```bash
npm test
```
